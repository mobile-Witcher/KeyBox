# KeyBox 第 4～7 步 独立验证报告（VERIFICATION）

- 验证人：**software-engineer（寇豆码）** —— 与实现者 `software-engineer-2` 无上下文重叠，独立复核。
- 验证对象：**第 4～7 步交付物**，锁定在提交 `7429c09`（"文档+健壮性：附录 A…"，即第 7 步之后的基线）。
- 方法：自读源码 + 自跑 `npm test` / `npm run build` + 自写对抗性测试（临时文件，已删除）+ 只读 grep 取证；**未修改任何被验证代码**；未执行 DB 迁移；未触碰第 8 步文件。
- 关于工作区的说明：验证期间 `software-engineer-2` 正在施工第 8 步（新增/改动 `cloudfunctions/kbAdminDeleteUserData/`、`src/lib/admin.ts`、`src/pages/AdminPage.tsx`、`src/hooks/`、并改动了 `src/App.tsx`、`src/components/TopBar.tsx`、`src/lib/api.ts`、`src/pages/VaultPage.tsx`）。这些**未提交**改动**不计入本报告范围**；凡涉及 `src` 的结论，均以 `src` 仍为干净的提交 `7429c09` 为准（静态证据用 `git grep 7429c09` 复核，见各条"证据"）。

## 汇总

- 通过：18 项
- 问题：4 项（**中 2**：C3、G4；**低 2**：A4、E7）
- 未验证：6 项（均卡在"需控制台配置 / 需部署"，见 §H）

---

## A. `src/lib/crypto.ts`（加密原语）

| 检查项 | 结论 | 证据 | 备注 / 修复建议 |
|---|---|---|---|
| A1 PBKDF2-HMAC-SHA256、32B、迭代 600000 | 通过 | `crypto.ts:28` `PBKDF2_ITERATIONS=600000`；`:112-133` `hash:"SHA-256"`、`deriveBits(...,GCM_KEY_BITS=256)` | 对抗性：同密码同盐、迭代 1000 vs 2000 → 结果不同（证明确实使用迭代次数） |
| A2 迭代下限 210000 | 通过 | `crypto.ts:30` | 测试用 `PBKDF2_ITERATIONS_MIN`（与生产同码路径） |
| A3 AES-256-GCM、IV 12B 内嵌、`KB1:` 前缀 | 通过 | `crypto.ts:147-159`（IV 12B 前置）、`:205-208`、`:33-35` | 对抗性：`KB1` 密文字节数 = 12 + 明文 + 16（GCM 标签），实测相等 |
| A4 **recovery_salt 必须独立于 kdf_salt** | **问题（低）** | `crypto.ts:306-316` / `:290-300`：`wrapMasterKeyWithRecovery` 接受任意 `recoverySaltB64`，**不校验其是否等于 kdf_salt** | 对抗性：故意把 `kdfSalt` 当 `recoverySalt` 传入 → **不报错、正常往返**。当前无调用方（恢复码 UI 未接），故暂无实际复用点；但"独立"只是**调用方契约**，代码未守。**修复**：接 R28 恢复码 UI 时由调用方另生成 16B 随机盐，或在该函数加断言 `recoverySalt !== kdfSalt` |
| A5 主密钥不可导出、不落盘 | 通过 | `crypto.ts:135-141` `importKey(..., extractable=false, ["encrypt","decrypt"])` | 主密钥 `CryptoKey` 不可导出，减少泄露面 |
| A6 恢复码只在生成时返回、不进日志/请求体 | 通过（端到端未验证，见 H6） | `crypto.ts:285-287` 仅返回字符串；全仓 grep 无 `recovery` 进入 `log.*` 或网络层 | 恢复码 UI 尚未接，故"只显示一次"属后续步骤 |
| A7 verifier 校验失败一律 false（fail-closed） | 通过 | `crypto.ts:229-242` try/catch 返回 false | 不泄露失败原因 |

## B. `src/lib/db.ts`（IndexedDB）

| 检查项 | 结论 | 证据 | 备注 |
|---|---|---|---|
| B1 是否存在"把解密后主密钥写库"的路径 | 通过 | `db.ts:17-29` `CachedSecret` 结构仅 `id/ownerId/payload(密文)/keyEpoch/updatedAt/pending`；无任何 `key/masterKey` 字段 | `db.test.ts:68-77` 断言落盘行键白名单（"masterKey"/"key" 均不存在） |
| B2 staging 与 main 是否真分离 | 通过 | `db.ts:56-67` 两个独立 objectStore；`:136-150` 独立读写 API | `db.test.ts:115-122` staging 往返不污染 main |
| B3 登出/换号清空四库 | 通过 | `db.ts:177-187` `resetLocal` 清 main/staging/queue/meta | `db.test.ts:138-152` |
| B4 队列自增序、按记录出队 | 通过 | `db.ts:101-131` | `db.test.ts:80-113` |

## C. `src/lib/sync.ts`（本地优先同步 + 冲突）

| 检查项 | 结论 | 证据 | 备注 / 修复建议 |
|---|---|---|---|
| C1 冲突判断**只按 epoch**、无字符串比较 | 通过 | `sync.ts:99` 调 `isNewer`；`time.ts:22-27` 先 `Date.parse` 再比 | 对抗性：`"...+00:00"` 与 `"...Z"` 等值判不更新；字典序反例被正确处理 |
| C2 "被更新版本覆盖"有可见提示、非静默 | 通过 | `sync.ts:101-109` 记录 `conflicts`；`VaultPage.tsx:313-315` + `:379-410` `ConflictNotice` 渲染 | 文案明确"这条被更新的版本覆盖了" |
| C3 队列重放不丢条目 / 不重复上传 | **问题（中）** | `sync.ts:125-158`（flushQueue）、`:166-172`（replaceCachedId） | **场景**：离线时"新增"再"删除"同一条（临时 id<0）→ flush 先 `upsert` 建出服务端行并把临时 id 换成真 id；随后那条 `delete(id<0)` 因缓存里已无临时 id → `deleteCached` 落空、**服务端残留孤儿行**（下次同步会重新出现）。**修复**：flushQueue 中对 `op==="delete" && id<0` 先查 `tempMap`，命中则按真 id 调 `api.secretDelete` |
| C4 上传失败保留剩余队列（离线可续） | 通过 | `sync.ts:138/150` 失败即 throw；`:189-192` catch 后保留队列、置 `online=false` | 断网不清空 |
| C5 换账号清本地（防串号） | 通过 | `sync.ts:176-180` `prevOwner !== uid` → `resetLocal()` | |
| C6 上行只传密文 + epoch | 通过 | `sync.ts:133-137` 仅 `payload/keyEpoch`；`:60-73` 下行 snake_case 显式列 | `owner_id` 不随上行 |

## D. `src/lib/vault.ts`（本机明文处理）

| 检查项 | 结论 | 证据 | 备注 |
|---|---|---|---|
| D1 搜索关键词**一个字节都不发云端** | 通过 | `vault.ts` 无任何 import 网络模块；`filterItems` `:119-137` 纯内存 | 对抗性：把 `globalThis.fetch` 换成会抛的间谍后运行 `filterItems/collectTags/decryptCached` → **fetch 0 次调用** |
| D2 解密失败条目边界不误导 | 通过 | `vault.ts:126-129`；`vault.test.ts:131-134` | |
| D3 标签统计/重命名/删除去重 | 通过 | `vault.ts:97-108/140-156`；`vault.test.ts` | |

## E. `cloudfunctions/`（8 个函数）

| 检查项 | 结论 | 证据 | 备注 |
|---|---|---|---|
| E1 无 `select *` | 通过 | `git grep "select *" 7429c09 -- cloudfunctions` 仅命中**注释**（禁令说明）；8 函数全为显式列（如 `kbLogin/index.js:22`、`kbSecretUpsert:44`、`kbGetMyRole:23`） | |
| E2 无 `RETURNING` 把内容带回响应体 | 通过 | `kbSecretUpsert/index.js:56-57,65-66` 只回 `{id, updatedAt}`；`kbSecretDelete/index.js:28-30` 只回 `{deletedId}` | **观察（非问题）**：两处用 `Prefer: return=representation` 会把含 `payload` 密文的行读回**服务端内存**；响应体不含密文。可降为 `return=minimal` + 计数以最小化 |
| E3 归属 `owner_id` 不采信入参 | 通过 | `kbSecretUpsert/index.js:63` 新增用 `owner_id: uid`；更新 `:44,50`、删除 `:25` 均带 `owner_id=eq.uid`；`git grep event.owner` → 无 | 归属由服务端身份写入 |
| E4 敏感值不入日志 | 通过 | `git grep "console\.(log|error|warn)" 7429c09 -- src cloudfunctions` → **无匹配**；失败仅回 `error.message`（如 `PG_<status>`） | |
| E5 身份只用运行时注入、不信 `event` 身份 | 通过 | 8 函数均 `getCaller()`（`lib.js:107-118` → `auth().getUserInfo()`）；无函数把 `event.uid` 当"我是谁" | |
| E6 邀请码原子占用（单语句条件更新） | 通过（**并发未验证**，见 H4） | `kbRegister/index.js:55-60`：`PATCH ... status=eq.unused` + `return=representation`，0 行=已被占用 | 需线上并发实测 |
| E7 20 人上限的并发安全 | **问题（低）** | `kbRegister/index.js:48-50`：`pgCount(...) >= LIMIT` 与随后 `INSERT` **非原子**（TOCTOU），并发注册可能超 20 | P1、20 人自用可接受。另：提交版按 `status=eq.active` 计数；`software-engineer-2` 已在**工作区**改为 `status=neq.deleted`（对齐新 §7 的"软删释放名额"）——属第 8 步范围，不计入本报告缺陷 |
| E8 8 份 `lib.js` 一致（防漂移） | 通过 | `md5sum cloudfunctions/*/lib.js` → 8 份**全为** `6d750d919cb204ec8f995c6d9df3ccaf` | |

## F. 仓库卫生

| 检查项 | 结论 | 证据 |
|---|---|---|
| F1 `.env.local` 被忽略、`.env.example` 保留 | 通过 | `git check-ignore -v .env.local` → 命中 `.gitignore:7`；`.env.example` 被跟踪 |
| F2 无环境 ID / 私钥 / keystore / 真实密钥 | 通过 | 全仓 grep `weichi-`/`SecretId`/`SecretKey`/`AKID`/`BEGIN`/`password=值` → 无真值；仅 `.env.example` 键名与政策文本 |
| F3 `.env.example` 只放键名 | 通过 | `.env.example:1-16` 全部空值 |
| F4 未跟踪的敏感文件 | 通过 | `git status` 未见 `.env*`（除 `.env.example`）、`tcb_custom_login.json`、`*.keystore` |

## G. 构建与测试（原始输出，自跑）

- `npm test`（vitest 2.1.9）：**4 files / 50 tests 全部通过**（crypto 13、vault 19、db 11、time 7）。
- `npm run build`（`tsc --noEmit && vite build`）：**成功**，63 modules，`dist/assets/index-*.js 1,041.44 kB（gzip 279.84 kB）`（>500kB 仅为 chunk 体积警告，非错误）。
- 自写对抗性测试（临时文件 `src/lib/__verify_adversarial.test.ts`，跑完已删）：**10/10 通过**，覆盖：迭代次数生效、密文长度=12+pt+16、跨主密钥隔离、恢复盐复用不被拒、LWW 反例、本地过滤/解密期间 fetch 0 调用。

## H. 未验证（不猜，说明卡点）

| # | 项 | 为什么无法在此验证 |
|---|---|---|
| H1 | 登录链路端到端：`kbLogin` → ticket → `auth.signInWithCustomTicket` → 会话落在 `authenticated` | 需控制台完成：开启用户名密码登录（已确认 `usernamePassword=true`）、publishable key、注入自定义登录私钥、安全域名白名单 |
| H2 | `auth.signInWithCustomTicket` 回调确切签名 | SDK 版本行为；`cloudbase.ts:39-44` 自标"待核实"。需真实会话实测 |
| H3 | 云函数持 `service_role` 经 `/v1/rdb/rest` 访问 PG | 需部署函数并注入 `CLOUDBASE_API_KEY`/`TCB_ENV` 环境变量 |
| H4 | 邀请码并发原子占用（同码并发只成功一次） | 需线上并发实测 |
| H5 | 20 人上限并发 | 同上 |
| H6 | R28 恢复码 / R29 备份 的端到端（只显示一次、导入还原不依赖云端） | 恢复 UI 尚未接线（第 6/7 步仅原语） |

## I. 附：R13 本机窗口（重要，单列）

- **问题（中）**：提交 `7429c09` 的 `src` 中 **无** `setInterval` / `visibilitychange` / `addEventListener`（`git grep 7429c09 -- src` → none）。`VaultPage.tsx:83-114` 仅在**挂载时**查一次 `kbGetMyRole`，`syncVault` 也不同步查询角色。故 R13「停用后客户端 **≤1 分钟**发现并强制登出 + 清空内存主密钥」**尚未实现**。
- 影响：管理员停用后，对方**已解锁**的内容在其本机可持续可见，直到该页重载/刷新（超出 R13 承诺的 1 分钟）。
- 建议修复：`VaultPage` 挂载后设 **60s 定时 + `visibilitychange` 回前台**触发 `api.getMyRole()`；`status !== "active"` → `onSignOut()` 并清空 `masterKey` state。
- ⚠️ 归属提示：架构 §7.1 已把该触发点写入**第 8 步**施工规格，工作区也已出现 `src/hooks/`（疑似对应实现）。**若第 8 步覆盖此项，则本条不计为第 4～7 步缺陷**；此处如实报出，交由 team-lead 判归属。

---

*本报告不改动任何被验证代码；发现问题仅记录，修复派发由 team-lead 决定。*
