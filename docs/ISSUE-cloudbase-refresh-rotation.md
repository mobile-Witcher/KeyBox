# CloudBase 工单草稿：同一账号并发会话时 refresh_token 被作废（`invalid_grant` 4026）

> 用途：直接粘贴到腾讯云 CloudBase 工单。数据均来自本仓库实测（可复现脚本见文末）。
> 创建日期：2026-10-04

---

## 一、环境信息

| 项 | 值 |
|---|---|
| 环境 ID | `weichi-d4gfw5uo1334e0ffb` |
| 地域 | ap-shanghai |
| 数据库后端 | PostgreSQL |
| 套餐 | 个人版 |
| 认证方式 | 手机号+短信验证码 / 用户名密码（自建测试账号） |
| 客户端 | 四个自研端（Web / Windows / Android / HarmonyOS），均用自建 HTTP 调用 `/auth/v1/*`，未使用 SDK 的会话管理能力 |

## 二、问题现象

同一账号在**两个会话**（模拟两台设备）先后登录后，**先登录的那个会话**再调用续期接口会**永久失败**：

```
POST /auth/v1/token
  body: {"grant_type":"refresh_token","refresh_token":"<先登录会话的 RT>"}
→ HTTP 400
  {"error":"invalid_grant","error_code":4026,
   "error_description":"invalid refresh token.  for it may be has been refreshed by other process"}
```

要点：
- **重试无效**：用同一个 refresh_token 隔 600 ms 重试，仍然 400（0/3 恢复）。
- **与 `x-device-id` 无关**：两个会话带**不同**的 `x-device-id` 与**完全不带**该头，失败率一致。
- **access_token 不受影响**：整个实验过程中所有业务请求（`/v1/functions/...`）都是 **200，没有 401**。
  因此故障只在"access_token 过期（7200s）后第一次续期"时暴露，表现为用户被要求重新登录。
- **后登录的会话总是能续期成功**；先登录的那个总是失败（下节数据）。

## 三、已做的自查（排除项）

调用 `describeClient` / 控制台同源接口查询本环境客户端配置：

| 字段 | 实测值 | 说明 |
|---|---|---|
| `MaxDevice` | **5** | 单用户最多 5 个并发会话 ⇒ **不是**"单会话/配额不足"导致 |
| `AccessTokenExpiresIn` | 7200 | access_token 2 小时 |
| `RefreshTokenExpiresIn` | 2592000 | refresh_token 30 天 |

⇒ 会话数上限充足（我们最多用 4 端），问题不在配额。

## 四、实验数据（均为一一次性测试账号，用后已删除）

**实验 1：A/B 反证（每组 3 轮）**

| 组 | 做法 | 先登录端续期失败轮数 |
|---|---|---|
| A | 两会话**不带** `x-device-id` | 3/3 |
| B | 两会话各带**不同** `x-device-id` | 3/3 |

规律：每轮 `signIn S1 → signIn S2 → refresh S1 → refresh S2` 中，**S1 必失败、S2 必成功**；两组均无 401。

**实验 2：重试是否可恢复**

| 做法 | 结果 |
|---|---|
| 首次续期失败后 600 ms 用同一 refresh_token 重试 | **0/3 恢复** |

**实验 3：登录后先主动续期一次是否有帮助（每组 4 轮）**

| 组 | 做法 | 他端登录后本端仍能续期 |
|---|---|---|
| X | 登录 → **先 refresh 一次** → 另会话登录 → 再 refresh | 1/4 |
| Y | 登录 → 另会话登录 → refresh | 0/4 |

⇒ 差异不具统计意义；**先续期一次并不能可靠规避**。

**可复现的最小序列（无需任何业务数据）**

```bash
GW=https://weichi-d4gfw5uo1334e0ffb.api.tcloudbasegateway.com
H='-H "Content-Type: application/json" -H "apikey: <publishable key>"'

# 1) 同一账号登录两次，拿到两个会话
curl -s $H -X POST $GW/auth/v1/signin -d '{"username":"<u>","password":"<p>"}'   # → S1.access_token / S1.refresh_token
curl -s $H -X POST $GW/auth/v1/signin -d '{"username":"<u>","password":"<p>"}'   # → S2.access_token / S2.refresh_token

# 2) 用【先登录会话】的 refresh_token 续期 → 期望成功，实测 400 invalid_grant(4026)
curl -s $H -X POST $GW/auth/v1/token \
  -d '{"grant_type":"refresh_token","refresh_token":"<S1.refresh_token>"}'

# 3) 用【后登录会话】的 refresh_token 续期 → 实测 200
curl -s $H -X POST $GW/auth/v1/token \
  -d '{"grant_type":"refresh_token","refresh_token":"<S2.refresh_token>"}'
```

## 五、希望得到的答复（明确诉求）

1. **请确认规则**：同一账号存在多个并发会话时，`/auth/v1/token` 的 refresh_token 轮换与失效规则具体是什么？
   为什么**先登录会话**的 refresh_token 在另一会话登录后会被判定为 `has been refreshed by other process`？
2. **这是预期行为还是缺陷**？若是预期：官方推荐的"多设备/多端同时在线"正确做法是什么？
   - `MaxDevice` 应设为多少（我们已经验证 5 不够用）？设 `0`（按 User-Agent 区分）是否即为"每类客户端各一个会话"？
   - 是否存在会话管理接口（列会话 / 吊销指定会话），或需要在控制台开启的开关？
3. 若属缺陷：请给出修复计划或临时规避建议。

## 六、业务影响（为什么需要它）

我们是一个约 20 人的小团队内部工具（端到端加密密钥保管箱），同一用户**同时**使用 Web、Windows、
Android、HarmonyOS 四端是核心使用场景（"在电脑上复制、在手机上查看"）。当前表现为：**任一端登录后，
其他端在约 2 小时后首次续期时会被要求重新登录**，用户感知为"莫名被登出"。

## 七、复现脚本

仓库内（私有）：
- `tools/kb-ab-deviceid.js` —— A/B 与重试实验
- `tools/kb-proactive-verify.js` —— X/Y 对照实验
- `tools/kb-soak-multidevice.js` —— 4 会话 30 分钟静置 + 一致性

如需，可将三个脚本脱敏后提供附件（账号与公钥均通过环境变量传入，脚本内无凭据）。
