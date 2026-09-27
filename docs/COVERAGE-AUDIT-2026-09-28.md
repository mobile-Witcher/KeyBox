# KeyBox 需求覆盖审计（独立、对抗式）

> 审计人：严过关（QA）
> 审计日期：2026-09-28
> 审计基线：commit `2910d2f`（HEAD）+ 当时工作树未提交改动（`docs/*` 若干、`src/lib/step8CloudFunctions.test.ts`、`scripts/`、`src/lib/rescueAdmin.test.ts`）。**审计期间未修改任何生产代码。**
> 权威来源：`docs/PRD.md`（R01–R29 + 红线 L1–L4）。**本文不采信任何文档/注释/PRD 的自述**，每一行"已实现"都必须落到**具体代码位置**或**只读实库查询结果**。

---

## 0. 审计方法（可复现）

1. **正向逐条对照 PRD 验收标准**，定位"实现落点"到 `数据库列 / 云函数文件 / 页面或 lib 文件`。
2. **反向 grep（关键）**：对"函数已写但从未被调用"这类半实现，用 `grep` 查导出符号在**非测试** `src/` 里的引用数。引用为 0 = 端到端未接线。
3. **只读实库核对**：经 `queryPgDatabase`(只读) 核对真实 PG 的**列 / 列级授权 / RLS 策略 / 函数(含 SECURITY DEFINER)**，而非采信迁移文件的自述。
4. **跑不到真机的标"未验证"**，不猜测。

### 关键反向 grep 结果（半实现证据）

| 检索 | 命令（节选） | 结果 |
|---|---|---|
| R28/R29 原语是否被非测试代码使用 | `grep -rn "Recovery\|Backup\|buildBackup\|openBackup\|masterKeyFromRaw\|generateRecoveryCode\|wrapMasterKeyWithRecovery\|unwrapMasterKeyWithRecovery" src \| grep -vE "\.test\.\|lib/crypto\.ts"` | **0 处**（仅 `crypto.ts` 自身定义 + 测试引用） |
| R21 本地暂存区是否被使用 | `grep -rn "putStagingMany\|getStaging\|clearStaging" src \| grep -vE "\.test\.\|lib/db\.ts"` | **0 处**（仅 `db.ts` 定义，`resetLocal()` 里被 clear） |
| R21 云函数是否存在 | `ls cloudfunctions/` | **无 `kbRotateMaster`**（仅 9 个函数，无改主密码） |
| R25 剪贴板倒计时/自动清空 | `grep -rn "倒计时\|clipboard\|自动清空" src \| grep -vE "\.test\."` | 只有 `SecretTable:35` 写剪贴板 + `:37` 一个 2s 的"已复制"指示灯复位；**无倒计时、无自动清空** |
| R28/R29 UI 入口 | `grep -rn "备份\|导出\|导入\|恢复码\|recovery" src/pages src/components \| grep -vE "\.test\."` | 只有 `RegisterPage.tsx:140` 一句 hint 文案，**无任何按钮/流程** |
| R17 明文外流路径 | `grep -rn "console\." src \| grep -vE "\.test\.\|lib/log\.ts"` / `grep -rn "fetch(\|XMLHttpRequest\|axios" src \| grep -vE "\.test\."` | **0 处**（日志只经 `log.ts` 脱敏；无直接网络出口） |
| R11 前端本地管理员常量 | `grep -rn "isAdmin" src \| grep -vE "\.test\."` | **0 处**（角色取自 `kbGetMyRole`） |

### 只读实库核对结果（envId 已脱敏，运行期自动解析）

- **RLS 全部开启**，策略总数 = **6**：`kb_secrets` 4 条（select_own / insert_own / update_own / delete_own）、`kb_users` 2 条（select_self / update_status_by_admin）、`kb_invites` 0 条。→ 与"DROP `kb_secrets_delete_by_admin` 后 7→6"一致，**管理员直连批量删除敞口已消除**。
- `pg_proc`：`is_admin` = **非 SECURITY DEFINER（INVOKER）**；`kb_admin_user_list` = **SECURITY DEFINER**（全项目唯一）——与架构一致。
- `information_schema.column_privileges`（authenticated）：`kb_users` SELECT **仅 6 列** `{created_at,key_epoch,role,status,uid,username}`，敏感列 `login_hash/kdf_salt/kdf_salt_prev/kdf_verifier` **未授予**；`kb_users` UPDATE **仅 `status` 一列**。→ R13 列级授权实库成立。
- `information_schema.tables`：`public` 下 **仅 3 张 BASE TABLE，无任何 VIEW**。
- 行数：`kb_users/kb_invites/kb_secrets` 均为 **0**（空库，尚未开户）。

---

## 1. 覆盖审计总表

> 状态取值：`已实现`＝落点确凿且本机可自证（代码/单测/静态或只读实库）；`部分实现`＝只有配置/原语/schema 或只做了半条链路；`未实现`＝无实现落点；`未验证`＝落点在，但**验收标准只能在真机+控制台端到端跑**才能确认，本机无法自证。

| 编号 | 需求摘要 | 实现落点（列 / 云函数 / 页面或 lib） | 状态 | 证据（file:line 或 SQL 结果） |
|---|---|---|---|---|
| R01 | 首个管理员手动初始化，标记管理员，此后不再出现 | `kb_users`(role/status) · `kbInitAdmin/index.js` · `src/pages/InitPage.tsx` · `src/App.tsx`(INIT_FLAG) | 未验证 | `App.tsx:53-54`（本机 flag 决定 init/login）；`api.ts:117`；实库 `kb_users` 表存在。**端到端需真机+控制台**（票签链路） |
| R02 | 云函数内生成一次性随机邀请码 | `kb_invites` · `kbInviteCreate/index.js`(`lib.js:31,202` 用 `crypto.randomBytes`) · `api.ts:121` · `AdminPage.tsx` | 已实现 | `kbInviteCreate/lib.js:31,202,203`；`api.ts:120-123` |
| R03 | 邀请码云函数校验并原子占用（一次性） | `cloudfunctions/kbRegister/index.js:55-61`（单语句条件 PATCH `status=eq.unused`，返回 0 行＝已被占用） | 未验证 | `kbRegister/index.js:55-61`（机制正确）；**并发一次性需真机并发验证** |
| R04 | 自助注册，票据由云函数签发 | `kbRegister/index.js:96-108`（`createTicket`）· `RegisterPage.tsx` · `api.ts:129` | 未验证 | `kbRegister/index.js:99-102`；`RegisterPage.tsx:63`（主密码本机派生）。**票签链路依赖控制台私钥** |
| R05 | 登录密码云端校验，请求不含主密码 | `kbLogin/index.js` · `LoginPage.tsx` · `api.ts:133` | 未验证 | `LoginPage.tsx:6`（请求体不含主密码）；`api.ts:64-67`（LoginParams 无主密码）。**需真机** |
| R06 | 主密码本机 KDF+随机盐派生 | `src/lib/crypto.ts:186`(`deriveMasterKey`) · `:28`(`PBKDF2_ITERATIONS=600000`) · `:181`(`generateSaltB64`) | 已实现 | `crypto.ts:112-128`(PBKDF2-HMAC-SHA256)、`:192`；`crypto.test.ts` |
| R07 | 密钥本机加密后上传，云端只存密文 | `crypto.ts:205,211`(`encrypt/decryptString`) · `vault.ts:50`(`encryptPlain`) · `sync.ts:79`(只传 `payload/key_epoch`) | 已实现 | `vault.ts:50-52`；`sync.ts:208-215`（上行仅密文）；密文前缀 `KB1:`(`crypto.ts:40`) |
| R08 | 每条记录写归属标记，云函数按会话写 owner | `kb_secrets.owner_id`(实库确认列存在, NOT NULL DEFAULT auth.uid()) · 策略 `kb_secrets_insert_own` · `kbSecretUpsert/index.js`(显式写 owner_id) · `sync.ts` | 已实现 | 实库 `information_schema.columns`：`owner_id text NOT NULL DEFAULT auth.uid()`；策略 `insert_own WITH CHECK (owner_id=auth.uid())`（实库 `pg_policies`） |
| R09 | RLS：用户只能读写自己的记录 | 策略 `kb_secrets_select_own/insert_own/update_own/delete_own`（均 `owner_id=auth.uid()`） | 已实现 | 实库 `pg_policies` 返回 4 条 `*_own`，`qual/with_check=(owner_id=auth.uid())` |
| R10 | 管理员可删任意记录、不可读密文 | 策略 `kb_secrets` SELECT **不含 is_admin**（实库确认） · 删除收口 `kbAdminDeleteUserData` | 已实现 | 实库 `pg_policies`：kb_secrets 的 SELECT 仅 `select_own`；删除经云函数。R14 详证 |
| R11 | 是否管理员由云函数判定 | `kbGetMyRole/index.js:22-37` · `App.tsx:44-46,70-71,115`(角色驱动入口) · `api.ts:137` | 已实现 | `kbGetMyRole/index.js:30-37`（role 由服务端返回，`select` 显式列禁 `select *`）；`App.tsx:115`（`role==="admin"`）；`grep isAdmin src` = 0 |
| R12 | 管理员用户列表（白名单 4 项+注册时间） | `kb_admin_user_list()`(SECURITY DEFINER, 实库确认存在) · `src/lib/admin.ts:47-61`(`adminListUsers` 白名单映射) | 未验证 | 实库 `pg_proc`：`kb_admin_user_list` `prosecdef=true`；`admin.ts:54-60` 只映射 5 字段。**RPC 调用需真机管理员会话** |
| R13 | 停用/启用 + 双窗口失效 + 改不了凭据 | 策略 `kb_users_update_status_by_admin` · 列授权 UPDATE(status) · `admin.ts:68-75` · `useSessionGuard.ts:20-57` | 未验证 | 实库 `pg_policies`+`column_privileges`：UPDATE 仅 status、策略 `is_admin()`；`useSessionGuard.ts:18`(60s 轮询)、`:28-33`(网络错不登出)。**窗口时延需真机** |
| R14 | 删除某用户全部数据，云函数二次校验 | `kbAdminDeleteUserData/index.js`（单 uid 收口、`is_admin` 自检、单次 DELETE+count=exact、`return=minimal`、仅返回 `{deletedCount}`） · `admin.ts:78-83` | 未验证 | `api.ts:152`；工程内 `src/lib/step8CloudFunctions.test.ts`、`kbAdminDeleteUserData.test.ts` 覆盖。**真实删除条数需真机** |
| R15 | 密钥增删改查（站点/网址/密钥/备注） | `vault.ts:50,55`(加密/解密) · `SecretDialog.tsx` · `VaultPage.tsx:204,251,280` · `kbSecretUpsert`/`kbSecretDelete` | 已实现 | `vault.ts:14-20`(SecretPlain 五字段)；`VaultPage.tsx:204`(`saveLocal`)；`api.ts:141,145` |
| R16 | 默认遮掩、点击显示、一键复制（不经上传） | `SecretTable.tsx:96`(`••••••••` 默认) · `:23-30`(`toggleReveal`) · `:32-41`(`copySecret`→`navigator.clipboard`) | 已实现 | `SecretTable.tsx:96`(默认圆点)、`:93-94`(显示才明文)、`:35`(复制只读本机内存) |
| R17 | 明文/主密码不出本机（不写日志/不回传） | `src/lib/log.ts:13-14`(`REDACT_KEY_PATTERN`) · `:48-57`(统一脱敏出口) | 已实现 | `log.ts:13-14`(含 recover/master/ticket/payload)、`:23-24`(超 64 字符截断)；`grep console.`/`grep fetch(` 非测试 src = 0 |
| R18 | 标签：新建/重命名/删除/筛选 | `vault.ts:97-108`(`collectTags`)、`:140-156`(`mapTagChange`) · `TagSidebar.tsx` · `VaultPage.tsx:251,280` | 已实现 | `vault.ts:140-156`（重命名去重、删除过滤）；`TagSidebar.tsx:18` |
| R19 | 本地检索（站点/网址/标签），不发云端 | `vault.ts:119-137`(`filterItems` 纯内存) · `TopBar.tsx`(搜索框) | 已实现 | `vault.ts:119-137` 纯 `filter`，无网络调用 |
| R20 | 桌面端 Tauri2 打包 Windows exe | `src-tauri/`(tauri.conf.json / Cargo.toml / Cargo.lock / icons) · `.github/workflows/build-desktop.yml` | 部分实现 | 配置文件齐备；`build-desktop.yml` 在 CI `npx tauri build` 产出 `.msi/.exe`。**本地可安装 exe 未产出**（本机缺 MSVC，任务 #16 进行中）→ "本地可产出可安装 exe"未验证 |
| R21 | 修改主密码（本机重加密整批覆盖） | `kb_users.kdf_salt_prev`(实库**已建列**) · `db.ts:42,136-150`(`staging` 暂存区, 注释"R21 备用") | **未实现** | 仅 schema/本地 store 预留：`grep putStagingMany/getStaging src`(非测试,非 db.ts) = **0 处**；**无改主密码 UI、无 `kbRotateMaster` 云函数、无重加密流程**。PRD Q2 明示"本期做"，但端到端缺环 |
| R22 | 人数上限 20，超出拒绝开户 | `kbRegister/lib.js:47`(`USER_LIMIT=20`) · `kbRegister/index.js:48-51`(`status neq.deleted` 计数 + `LIMIT_REACHED`) | 未验证 | `kbRegister/index.js:50-51`（软删释放名额）；`lib.js:176`(`pgCount` 读 Content-Range)。**需真机** |
| R23 | 安卓 Capacitor + Actions 产出 apk | `android/`(完整工程) · `capacitor.config.ts` · `.github/workflows/build-android.yml` | 部分实现 | 工程/工作流齐备（含签名 secrets 分支、debug 回退）；**apk 产物未产出**（任务 #15 进行中）→ "推送标签后可下载 apk 产物"未验证 |
| R24 | 夜间模式手动切换并记住 | `theme.ts:14`(`keybox.theme`) · `:50`(setItem) · `useTheme.ts` · `ThemeToggle.tsx` · `main.tsx`(`initTheme`) | 已实现 | `theme.ts:14,27,50`；`main.tsx` 首屏调用 `initTheme`；`App.tsx` 无系统深色读取（Q3 手动切换） |
| R25 | 复制后"N 秒后自动清空剪贴板"倒计时 | （无） | **未实现** | `SecretTable.tsx:35-37` 只有写剪贴板 + 2s 指示灯复位，**无倒计时 UI、无剪贴板自动清空**。P2 |
| R26 | 满员时后台顶部提示"已达上限" | `AdminPage.tsx:29-30`(`USER_LIMIT=20`) · `:227`(已开户/上限) · `:231-232`(满员提示条) | 已实现 | `AdminPage.tsx:231-232`：`已达 {USER_LIMIT} 人上限，无法再开户…` |
| R27 | 开源部署可复现：一键脚本 + 手工兜底 + README | `README.md §6/§7` · `docs/CONSOLE-STEPS.md` · `cloudbase/migrations/*.sql`(4 个) · `scripts/rescue-admin.js` | 部分实现 | 手工链路齐备：`CONSOLE-STEPS.md`(四项控制台)、4 个幂等迁移 SQL、README 第 7 节验收清单。**"一键下发脚本（建表+安全策略+角色策略）"不存在**：`scripts/` 仅有救援脚本；README:124 该勾选项**未勾**。任务 #19 补的 README 部署说明已到位 |
| R28 | 恢复码：只显示一次、可解本机数据、强制重设主密码 | `crypto.ts:265,285`(`generateRecoveryCode`)、`:311,331`(`wrap/unwrapMasterKeyWithRecovery`) · **无任何调用方** | **未实现** | 反向 grep：原语仅 `crypto.ts` 定义 + 测试引用，**非测试 src 引用 0 处**；UI 仅 `RegisterPage.tsx:140` 一句 hint。**红线 L1（生成页文案）缺失** |
| R29 | 加密备份导出/导入（离线、不传主密码） | `crypto.ts:368`(`buildBackup`)、`:398`(`openBackup`)、`:42`(`BACKUP_PREFIX=KBBK1:`) · **无任何调用方** | **未实现** | 反向 grep：原语非测试 src 引用 **0 处**；无导出/导入 UI |

### 红线（与 R28/R29 相关）核对

| # | 红线 | 落点 | 状态 | 证据 |
|---|---|---|---|---|
| L1 | "丢了就等于没开"必须出现在**生成恢复码的界面** | — | **未实现** | 无生成恢复码界面（R28 未实现），文案仅藏在 `README §3` 与 `RegisterPage.tsx:140` hint |
| L2 | "主密码+恢复码+备份三者全丢=永久不可恢复"必须在 README 第 3 节 | `README.md §3` | 已实现 | `README.md:57-59`（第三层：三者全丢） |
| L3 | 服务端不参与恢复（无密保/邮件重置） | 无相关云函数/端点 | 已实现（以"不存在"为证） | `cloudfunctions/` 无任何 reset/recover 函数；`grep` 无邮件/密保入口 |
| L4 | 管理员拿到恢复码密文也解不开；管理员侧无恢复入口 | — | **未实现**（因 R28 整体缺失；无存储即无泄露面） | 同上 |

---

## 2. 汇总

| 状态 | 数量 | 需求编号 |
|---|---|---|
| **已实现** | **14** | R02、R06、R07、R08、R09、R10、R11、R15、R16、R17、R18、R19、R24、R26 |
| **部分实现** | **3** | R20、R23、R27 |
| **未实现** | **4** | R21、R25、R28、R29 |
| **未验证** | **8** | R01、R03、R04、R05、R12、R13、R14、R22 |
| 合计 | 29 | — |

**未验证的 8 条**全部是"实现落点确凿、但验收标准必须在真机 + 控制台端到端跑"的登录/注册/管理链路（控制台四项配置未完成，本机无真实会话与私钥）。**它们的"未验证"≠"没实现"**，请在控制台配置完成后由我统一做端到端复核后转"已实现/部分实现"。

**部分实现的"最小补齐点"**：

- **R20**：本机装 Rust+MSVC（或直接依赖 CI `build-desktop.yml`）产出一次可安装 `.exe` 即可闭环（任务 #16）。
- **R23**：跑通一次 `build-android.yml`（或本地 `npx cap sync android` + gradle）产出 apk 产物即可闭环（任务 #15）。
- **R27**：补一个"一键下发脚本"——把 4 个迁移 SQL + 云函数 invoke 规则 + 安全域名白名单串成可重复执行的脚本（当前只有手工清单与迁移 SQL；README:124 勾选项仍空）。

**未实现的"最小补齐点"**：

- **R21**：新增改主密码流程 = 1 个 UI 入口 + 重加密编排（正好可用已预留的 `db.ts` `staging` 存 + `kdf_salt_prev` 列做回滚锚点）；若走云函数则需新增 `kbRotateMaster`。**注意 PRD Q2 明示"本期做"。**
- **R25**：`SecretTable.copySecret` 增加倒计时 UI + `setTimeout` 到点 `navigator.clipboard.writeText("")`（P2，可缓）。
- **R28**：接线 `crypto.ts` 三个恢复码原语 → 生成/展示（只显示一次）/遗忘场景解锁 + 强制重设主密码 UI；补红线 L1 文案。
- **R29**：接线 `buildBackup`/`openBackup` → 导出/导入 UI（离线、不传主密码）。

---

## 3. 最可能导致"用户以为有、其实没有"的三条（按风险排序）

> 判据：**文档/文案/注释/测试在"暗示已具备"，但端到端没有任何可用入口**——最容易被所有者或使用者误判。

### 第 1 名：R28 恢复码（最高风险）

- **为什么会被以为"有"**：`crypto.ts` 里三套原语 + 前缀 `KBRC1:` 俱全，且**有通过的单元测试**；`RegisterPage.tsx:140` 的 hint 明文写"**后续可用恢复码/备份自救**"；`README §3/§10` 以"项目**将提供**"的口吻成段描述。
- **实际**：**没有任何生成/展示/使用恢复码的界面或编排**（反向 grep 非测试 src 引用 0 处）。
- **后果**：用户在设主密码时**以为有自救网**，实际主密码一丢即**永久不可恢复**——且这不是"缺个 P2 提示"，是**直接导致数据丢失的承诺落差**。红线 **L1 同步落空**。

### 第 2 名：R29 加密备份导出（与 R28 成对）

- **为什么会被以为"有"**：与 R28 同段承诺（"恢复码 + 备份"），`buildBackup`/`openBackup`/前缀 `KBBK1:` 齐备，README 第 3 节把它列为"两个自救手段"之一。
- **实际**：**无导出按钮、无导入按钮、无文件读写流程**（非测试 src 引用 0 处）。
- **后果**：用户以为能"导出到本机/换设备还原"，实际设备一丢即全部密钥蒸发。

### 第 3 名：R21 修改主密码

- **为什么会被以为"有"**：**活库 `kb_users` 里 `kdf_salt_prev` 列真实存在**、`db.ts` 里 `staging` 暂存区带注释"供 R21 改主密码整批重加密时写入新代密文，本步骤先建好备用"；PRD Q2 白纸黑字"放在 P1，**本期做**"。任何读库/读码的人都会得出"这套骨架是为改主密码而备，应该能用"。
- **实际**：**无 UI、无云函数、无重加密编排**（暂存区 helper 非测试引用 0 处；无 `kbRotateMaster`）。属于典型"schema/名词先行、动作缺席"的**半实现**。
- **后果**：主密码疑似泄露时，用户**以为能自救**（改掉它），实际没有任何入口；而 PRD 已把这条列为 P1 交付项。

> 附（次一档，P2）：**R25** "已复制"文案容易让人以为会"定时自动清空剪贴板"，实际剪贴板内容会一直留存到被覆盖。风险低于上面三条，但同属"文案暗示 > 实际能力"。

---

## 4. 审计结论

- **29 条需求中，14 条已实现、3 条部分实现、4 条未实现、8 条待真机验证。**
- **P0/P1 中真正的"功能缺口"集中在 R21 / R28 / R29 三条**（均 P1，且 R28/R29 牵动红线 L1/L4）——它们不是"没做"，而是"骨架/原语/文案先行、动作缺席"，最易误判。
- **安全模型（R08/R09/R10/R13）经只读实库核对全部落地**：RLS 6 条策略、列级授权、`is_admin` INVOKER / `kb_admin_user_list` DEFINER 均与架构一致；`kb_secrets_delete_by_admin` 敞口已实库消除。**管理员"可删不可读"成立。**
- **无一处在明文外流路径上**：日志统一走 `log.ts` 脱敏，非测试 src 无裸 `console.*`、无直连 `fetch`。
- 建议：控制台四项配置完成后，把 R01/R03/R04/R05/R12/R13/R14/R22 八条转入**真机端到端复核**，再由我出"验证后修订版"。

---

*本文仅只读审计，未修改任何生产代码；证据均来自 `file:line` 或只读实库查询。*
