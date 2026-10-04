# 诊断：安卓与鸿蒙为什么不能同时登录

> 日期 2026-10-02 · 结论：**服务端 refresh_token 轮换（rotation）+ 单例会话**，两端各自持有一份 token，
> 任一端刷新都会让另一端的 token 作废。这是**架构层面的机制**，不是某端的 bug。

## 一、事实链（代码实证）

### 1. 两端都走同一套自定义 HTTP 登录（无 SDK）
| 步骤 | 端点 | 两端是否一致 |
|---|---|---|
| 发码 | `POST /auth/v1/verification` | ✅ 一致 |
| 校验 | `POST /auth/v1/verification/verify` → `verification_token` | ✅ 一致 |
| 登录 | `POST /auth/v1/signin` → `{access_token, refresh_token, expires_in, sub}` | ✅ 一致 |
| 续期 | `POST /auth/v1/token`（**无 Authorization 头**）+ `{client_id=环境ID, client_secret:"", grant_type:"refresh_token", refresh_token}` | ✅ 一致 |

- 安卓：`app/.../data/AuthRepository.kt`（步骤 ①②③④ 注释完整）
- 鸿蒙：`entry/src/main/ets/lib/auth.ets:96-162`

### 2. 两端都把 refresh_token 持久化在本机
- 安卓：`SessionStore.kt` → SharedPreferences（`KEY_REFRESH_TOKEN`）
- 鸿蒙：`session.ets:62-84` → Preferences（`refreshToken`）

### 3. **关键证据：服务端会返回新的 refresh_token（轮换制）**
两端代码都明确处理了「返回新 token 并存回本地」：
- 安卓：`AuthRepository.kt:112` → `refreshToken = obj.optString("refresh_token", fallbackRefreshToken)`
  （**带了 fallback**：服务端返回新值就用新的，没返回就沿用旧的）
- 安卓拦截器：`AuthInterceptor.kt:48-51` → `refreshSession(...) .also { sessionStore.save(it) }`（存回新 token）
- 鸿蒙：`auth.ets:162` → `refreshToken: ... : refreshToken`（同上 fallback 逻辑）
- 鸿蒙启动：`Index.ets:45` → `await saveTokens(session.accessToken, session.refreshToken, session.uid)`（存回新 token）

**两端都写了 fallback 兜底，这本身就是「服务端有时返回新 token」的实证。**

### 4. 于是形成抢占（race）：
```
设备A 登录 → 拿到 RT_1
设备B 登录 → 拿到 RT_2（同一账号，服务端只保留最新的？或 RT_1 已被轮换失效）

设备A 打开 App → 用 RT_1 续期
  ├ 成功 → 服务端发 RT_3，RT_1 作废，A 存 RT_3
  └ 失败（RT_1 已被 B 的登录/续期顶掉）→ A 清本地登录态，回登录页
```
**结果**：A 能登上就把 B 顶下去，B 能登上就把 A 顶下去 —— 表现为「无法同时登录」。

## 二、根因判定（按可能性排序）

| # | 可能的服务端机制 | 与现象是否吻合 | 说明 |
|---|---|---|---|
| **1** | **refresh_token 轮换 + 每账号单活跃 refresh_token** | ✅ 高度吻合 | 一次续期作废旧值，另一端的旧值即刻失效 |
| 2 | 每账号单会话（登录即踢掉其他设备） | ✅ 吻合 | CloudBase/Supabase 系产品的常见默认策略 |
| 3 | 两端实现有 bug：save 了新 token 但内存里仍用旧的 | ⚠️ 部分可能 | 若某端续期后只存盘、未更新内存态，下次仍拿旧 token |
| 4 | 客户端并发刷新（同一端多个请求同时刷新） | ⚠️ 次要因素 | 安卓有 synchronized 单飞；鸿蒙未见，冷启动时可能重复刷 |

**判定：1（+2）是主因**，是腾讯云 CloudBase 服务端的会话策略，不是客户端能单方面绕过的。

## 三、可选解法（按推荐度）

### 方案 A：确认并接受「单会话」是产品设计（零代码改动）
如果 CloudBase 的会话策略就是单会话，那就**明确告知用户**：「同一账号同一时间只在一台设备登录」。
- 优点：零改动，符合多数密钥管理工具的「单点登录」安全直觉
- 缺点：与「四端一体、随时同步」的产品预期冲突

### 方案 B：客户端容错增强（小改动，改善体验）
即使服务端单会话，也能让切换体验不这么「炸」：
1. **续期失败时不清登录态**，而是提示「此账号已在其他设备登录，是否在此设备重新登录？」→ 用户主动选择，而非被动踢到登录页
2. **施加抖动**：App 回到前台时，若距上次续期 < 60 秒则跳过（减少无谓刷新，降低互相顶掉的频率）
3. **鸿蒙端补「单飞锁」**：照安卓的 synchronized 单飞模式，避免冷启动多请求并发刷新（并发刷新在轮换制下会自我作废）

### 方案 C：改用「多会话」能力（若服务端支持）
若 CloudBase 支持多会话（部分版本支持 `session_id` / 多设备并存）：
- 改 `POST /auth/v1/token` 的用法，或改用 SDK 的会话管理 API（`listSessions` / `revokeSession`）
- **需要先在控制台确认该能力是否对本环境开放**（当前文档未明确）

## 四、下一步：需要一次「实测」确认（10 分钟）

代码已备好探针：`F:\project\keybox\KeyBox\tools\probe-refresh.mjs`
方法：拿一份有效 refresh_token，**连续调两次** `/auth/v1/token`：
- 第 2 次失败 → **轮换+单例**（方案 A/B 二选一）
- 两次都成功且返回相同 token → 不轮换（那问题另有原因，继续查方案 3/4）

**需要你提供一份有效 refresh_token**（从手机端抓，或我用你的账号发一次验证码登录获取）。
拿到后我能给出确切结论 + 对应改法。

## 五、对当前产品的影响（诚实版）

- 这不是「安卓或鸿蒙写错了」，是**两端都在正确地使用同一套服务端机制**，而该机制默认单会话
- 现有四端（网页/Windows/安卓壳/鸿蒙）**同样受影响**——只要服务端单会话，任意两端都无法并存
- 因此这不是「安卓 vs 鸿蒙」的问题，而是**全产品线的会话策略问题**，值得作为一个产品决策来定：
  **到底要不要支持多端同时在线？**（安全 vs 便利的取舍）


---

## 六、【2026-10-04 实测复核】原判定（单会话/单活跃 refresh_token）**不成立**

用一次性测试账号（4 个不同 `x-device-id` 模拟 4 台设备）+ 真实网关做了两轮实测，结论与原 §二 的判定相反：

### 实测结果
| 测试 | 结果 |
|---|---|
| 4 个独立设备会话并存、静置 **30 分钟**、每 5 分钟心跳 | **24/24 全部 HTTP 200**，无掉线、无强制重登 |
| 单会话续期（`POST /auth/v1/token`，`grant_type` 放 **body**） | **200** ✔ 轮换正常 |
| **B 登录之后，A 仍能续期** | **200** ✔ ⇒ 新登录**不会**作废旧会话的 refresh_token |
| B 自身续期 / 续期后 A、B 各自调用 | 200 / 200·200 ✔ |
| **同一 `x-device-id` 再次登录后，旧会话仍能续期** | **200** ✔ ⇒ 不是"单会话踢人" |
| 连续两次续期（用轮换后的新 token） | 200 / 200 ✔ |
| **顺序 X**（A、B 快速连续登录后立刻用 A 的 RT 续期）复现 3 次 | **1 次** 400 `invalid_grant 4026 "may has been refreshed by other process"`，后 2 次 200；**重试即成功** |

### 修正后的结论
1. **多端会话是并存的**，各端用各自的 refresh_token 独立续期，互不影响 ⇒ §二 的"每账号单活跃 refresh_token / 单会话"判定不成立（至少本环境不是）。
2. 真正存在的是**偶发竞态**：短时间内同一账号连续登录后，旧会话的 RT 有一次续期窗口被拒（`4026`），**重试即成功**，不是确定性策略。
3. 因此正确的客户端策略是「**续期失败重试一次再判失效**」，而不是"续期失败就清登录态回登录页"——四端已按此加固（安卓 `AuthInterceptor` / Windows `AuthHttpHandler` / 鸿蒙 `auth.ets` 均 600ms 后重试一次；网页版由 SDK 托管）。
4. **`grant_type` 必须在 body**：放 query string 会被网关判为 `invalid_argument: grant type must be one of [...]`（实测踩过）。
5. `x-device-id` 与"登录账号数"相关（官方文档原话）：**每台设备应持久化一个随机 device-id 并每次请求都带上**。若某端不带（或两端共用同一个），平台可能把两设备视作同一会话——这正是原始"两端不能同时登录"现象的**最可能真因**，需按 §一 的代码逐端核实（见下方待办）。

### 复现方法（脚本已入库）
`tools/kb-soak-multidevice.js`（`node tools/kb-soak-multidevice.js`，通过环境变量 `KB_PUB_KEY` / `KB_TEST_USER` / `KB_TEST_PASS` 传入公钥与一次性测试账号；测试完毕请删除该账号与其 `kb_users` 行）。

### 遗留给接手的待办
- [ ] 逐端确认登录/续期请求都带**稳定且每设备唯一**的 `x-device-id`（安卓 `AuthRepository`、鸿蒙 `auth.ets`、Windows `AuthRepository`、网页 SDK 配置）
- [ ] 若确认缺少：补上并做一次"两端同时在线 + 静置 >2 小时"的真实回归（access_token 只有 7200s，2 小时才真正逼出续期路径）