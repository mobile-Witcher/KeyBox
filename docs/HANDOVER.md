# KeyBox 项目交接书（面向接手的 AI Agent / 开发者）

> 最后更新：2026-10-04 ｜ 当前版本：**v0.5.0** ｜ 仓库：`mobile-Witcher/KeyBox`（public，默认分支 `main`）
> 配套文档：`docs/SIGNING-AND-TRUST.md`（签名与"在另一台电脑安装"手册，含中文 DevEco 重签步骤）、`docs/db-migrations/`（数据库迁移归档）

---

## 0. 一句话背景

KeyBox 是一个**端到端加密的密钥保管箱**：主密码与主密钥**永不离开设备**，云端只存密文与"盐+校验串"。
同一套契约有 **四个客户端**：网页版（Vite/React/TS）、Windows（C#/.NET 8/WinUI 3）、Android（Kotlin/Compose）、HarmonyOS（ArkTS）。
2026-10-04 起四个仓库**已合并为单一 monorepo**，并统一品牌为 **mobile-Witcher**。

---

## 1. 仓库形态（先看这个，别找错路径）

```
mobile-Witcher/KeyBox            ← 唯一在维护的仓库（public, main）
├── web/          网页版（Vite + React + TS；源契约的定义者）
│   ├── src/            React 源码
│   ├── src-tauri/      ⚠️ 已弃用的 Tauri 桌面壳（保留仅供追溯）
│   ├── android/        ⚠️ 已弃用的 Capacitor 安卓壳（保留仅供追溯）
│   └── public/         favicon 等
├── windows/      Windows 原生端（WinUI 3）  ← 取代 Tauri 壳
│   ├── src/KeyBox.App/     UI 壳（含 Assets/ 图标、Package.appxmanifest）
│   ├── src/KeyBox.Core/    纯 .NET 类库（加密/网络/会话，可脱离 WinUI 单测）
│   ├── tests/KeyBox.Core.Tests/
│   └── scripts/package-msix.ps1
├── android/      安卓原生端（Kotlin/Compose） ← 取代 Capacitor 壳
├── harmony/      鸿蒙原生端（ArkTS / DevEco 工程）
├── cloudfunctions/  11 个云函数（后端，跨端共用）
├── cloudbase/       数据库迁移归档（本地）
├── docs/            handover、签名手册、迁移归档、头图
└── .github/workflows/   web(build-desktop/build-android) + windows.yml + android.yml
```

**旧仓库（仍是 private，保持原样，不要再往里推代码）**：`KeyBox-Windows`、`KeyBox-Android`、`KeyBox-HarmonyOS`。
它们的 v0.4.0 Release 仍在，可下载；**新版本一律发到 monorepo**。删除它们需要在 GitHub 网页上操作（当前 CLI token 无 `delete_repo` 且非组织管理员，`gh repo delete` 会 403）。

---

## 2. 云端（唯一生产环境）

| 项 | 值 |
|---|---|
| 环境 ID | `weichi-d4gfw5uo1334e0ffb`（ap-shanghai，PostgreSQL 后端，个人版套餐） |
| 到期 | **2026-11-02，`IsAutoRenew=false`** ⚠️ 到期四端后端一起失效，接手时优先确认是否已续费 |
| 网关 | 客户端走 `https://<envId>.api.tcloudbasegateway.com`（函数路径 `/v1/functions/<name>`，鉴权 `Authorization: Bearer <access_token>` + `apikey: <publishable key>`） |
| 认证 | `/auth/v1/signin`（本环境**不支持** supabase 的 `?grant_type=password`；用户名密码登录走 body `{username,password}`）、`/auth/v1/token`（body `{grant_type:"refresh_token", refresh_token}`）、`/auth/v1/signup` |
| 登录方式 | **手机号 + 短信验证码**（`signInWithOtp` → `verifyOtp` → `signin`），`x-device-id` 每设备一个 |
| Token 生命周期 | access_token **7200s**；refresh_token **31 天**，且会轮换 |

**云函数（`cloudfunctions/`）**：`kbRegister`（开户/激活，含 20 人上限与 status 分流）、`kbInitAdmin`（首位管理员初始化）、`kbLogin`、`kbGetMyRole`（门禁探针，未激活时带 `initialized`）、`kbRotateMaster`、`kbInviteCreate`/`kbInviteRevoke`（管理员邀请码）、`kbAdminDeleteUserData`（唯一持 service_role 的函数）等。

**数据库要点（PostgreSQL）**
- `kb_users`：`uid`(平台 uid)、`status` ∈ {`active`,`disabled`,`deleted`}、`role`、`kdf_salt`、`kdf_verifier`、`key_epoch`、`recovery_*`
- **20 人上限 = 双层防护**：① `kbRegister` 应用层 `count(status<>'deleted') >= 20 → LIMIT_REACHED`；② 触发器 `kb_users_cap_before_insert → kb_enforce_user_cap()`（已加 `pg_advisory_xact_lock(hashtext('kb_users_cap'))` 串行化，避免并发超编）
- `kb_secrets` RLS：`(owner_id = auth.uid()) AND is_active_user()`（`is_active_user()` 要求 `uid=auth.uid() AND status='active'`）
- 迁移：**必须**用 MCP 工具 `managePgDatabase(action="applyMigration", migrationVersion="YYYYMMDDHHMMSS", migrationName="小写下划线", sql=..., confirm=true)`；成功后本地会生成 `cloudbase/migrations/<version>_<name>.sql`，请把它复制进 `KeyBox/docs/db-migrations/` 一起提交
- 只读查询用 `queryPgDatabase(action="sql")`（**只接受 SELECT**，DML/DDL 会被拒）

---

## 3. 不可变更的契约（改动=破坏兼容，别动）

| 项 | 约定 |
|---|---|
| KDF | PBKDF2-HMAC-SHA256，**600000** 次迭代，输出 **32 字节** |
| 加密 | AES-256-GCM；密文串格式 `KB1:` + base64(`iv ‖ ciphertext ‖ tag`) |
| 校验串 | 用主密钥加密固定明文 **`KeyBox-Verify`**，服务端只存 `kdf_salt` + `kdf_verifier` |
| 主密钥 | **永不持久化**（重启必锁）；本地可用 PIN / 生物识别包裹 |
| 门禁判定 | 必须 `ok === true` **且** `status === "active"`（只看 `ok` 会把软删/停用账号误判为已激活） |
| status 路由 | `active`→幂等通过；`disabled`→`ACCOUNT_DISABLED`（仅管理员可解）；`deleted`→允许重新开户（清旧 `kb_secrets`）；无行→邀请码 / 首位初始化（`initialized===false` 时隐藏邀请码字段） |
| 续期 | 401 → 用 refresh_token 静默续期一次并重放原请求；**续期失败再重试一次**（间隔 600ms）才判会话失效——平台偶发 `invalid_grant 4026` 竞态，直接登出会误伤用户 |

---

## 4. 构建与验证（照抄即可）

### Windows
```powershell
# 判断构建结果前必须先删 obj（否则 XAML 编译可能静默复用旧的，出现假通过）
Remove-Item KeyBox/windows/src/KeyBox.App/obj -Recurse -Force -ErrorAction SilentlyContinue
dotnet build KeyBox/windows/src/KeyBox.App/KeyBox.App.csproj -c Debug -p:Platform=x64 -nodeReuse:false   # 期望：0 警告 0 错误
dotnet test  KeyBox/windows/tests/KeyBox.Core.Tests/KeyBox.Core.Tests.csproj -c Release                    # 期望：125/125
# MSIX（未签名 sideload 包）+ 签名
.\KeyBox\windows\scripts\package-msix.ps1 -Version 0.5.0.0 -Platform x64
signtool sign /fd SHA256 /f <pfx> /p <密码> /tr http://timestamp.digicert.com /td SHA256 .\artifacts\*.msix
```
- `signtool.exe` 来自 NuGet `microsoft.windows.sdk.buildtools`（`~\.nuget\packages\microsoft.windows.sdk.buildtools\<ver>\bin\<ver>\x64\`）
- MSIX 清单 `Publisher` 必须与证书 `Subject` **完全一致**（当前 `CN=mobile-Witcher`）

### Android
```powershell
# 需要 android\key.properties + android\keybox-release.jks（都被 .gitignore，见 secrets）
cd KeyBox/android ; $env:JAVA_HOME='C:\Program Files\Java\jdk-17.0.5'
.\gradlew.bat :app:assembleRelease        # 期望产物 app\build\outputs\apk\release\app-release.apk 且已签名
# 验签（build-tools 里的 apksigner）
apksigner.bat verify --print-certs app\build\outputs\apk\release\app-release.apk
```
⚠️ `key.properties` 必须**无 BOM**（用 `System.IO.File.WriteAllText($p,$t,(New-Object System.Text.UTF8Encoding($false)))`）。带 BOM 时 Gradle 读不到配置，会**静默产出 unsigned 包**。

### HarmonyOS
```powershell
$env:DEVECO_SDK_HOME='C:\Program Files\Huawei\DevEco Studio\sdk'
cd KeyBox/harmony ; hvigorw assembleHap --mode module -p product=default
# 产物 entry\build\default\outputs\default\entry-default-signed.hap
```
- `harmony/hvigor/hvigor-config.json5` 已入库（此前被 ignore 导致别人 clone 后构建直接 `00304004 Not Found`）
- `harmony/entry/src/main/ets/lib/config.private.ets` 是 **gitignore 的本地私有配置**（仓库里有 `.example` 模板；备份在 `secrets/harmony-config.private.ets`）；缺失会报 `Cannot find module './config.private'`
- **改 `bundleName` 必须先在 DevEco 里重新「自动生成签名」**（华为 profile 与 bundleName 绑定，否则 profile 失效、构建失败）——见 `docs/SIGNING-AND-TRUST.md` 第五章（中文界面步骤）

### Web
```powershell
cd KeyBox/web ; npm install ; npm run build          # 产物 web/dist
npx vitest run src/lib/step8CloudFunctions.test.ts   # 云函数契约用例，期望全绿（含 20 人上限）
```
> 依赖目录可能位于 `KeyBox/node_modules`（搬迁前的遗留位置，npm 会向上查找，可正常工作）。

### 真机安装（鸿蒙）
```powershell
$hdc='C:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe'
& $hdc list targets
& $hdc install -r KeyBox\harmony\entry\build\default\outputs\default\entry-default-signed.hap
```
（第三方"小白调试助手"底层同样是 hdc；若手机未连上，先开开发者模式 + USB 调试 + 换一根能传数据的线）

---

## 5. 签名材料与发布

**三套材料**（正本在 `F:\project\keybox\secrets\`，**该目录在 git 仓库之外，永远不会被提交**；另有一份口令说明 `签名密钥-务必备份.txt`）：

| 用途 | 文件 | 备注 |
|---|---|---|
| Windows MSIX | `keybox-codesign-mobilewitcher.pfx` / `.cer` | CN=mobile-Witcher，自签名；`.cer` 已随仓库 `docs/certs/` 分发，他人导入 `LocalMachine\TrustedPeople` 即可信任 |
| Android | `keybox-release.jks` + `key.properties`（别名 `keybox`） | ⚠️ 丢失=永远无法更新已发布安卓应用；换密钥=老用户只能卸载重装 |
| HarmonyOS | `~/.ohos/config/default_harmony_*.{cer,p7b,p12}`（正本）+ `secrets/harmony-deveco/`（备份） | DevEco 托管，无独立口令 |
| 后端机密 | `tcb_custom_login*.json`、`custom_login_new.pem`、`service-api-key.txt` | 勿泄露 |

**发布流程（monorepo）**
1. 改版本号：`windows/.../Package.appxmanifest`(0.5.0.0) · `android/app/build.gradle.kts`(versionName/versionCode) · `harmony/AppScope/app.json5`(versionName/versionCode)
2. 三端重新出包（见 §4）+ 校验签名
3. `gh release create vX.Y.Z --repo mobile-Witcher/KeyBox --title ... --notes-file ...`，资产上传**建议走 REST API**：
   `POST https://uploads.github.com/repos/<owner>/<repo>/releases/<id>/assets?name=<n>`（`Authorization: Bearer $(gh auth token)`、`Content-Type: application/octet-stream`）
   ⚠️ 本机 gh 版本的 `gh release upload <tag> <file>` 会报 `accepts at most 1 arg(s)` —— 别在这上面浪费时间，直接用 REST API，并**比对远端 size == 本地 size** 才算成功
4. 当前最新：**v0.5.0**（MSIX 31.56 MB · APK 2.35 MB · HAP 0.7 MB）

---

## 6. 品牌与图标资产

| 项 | 位置 |
|---|---|
| 图标**矢量源**（正本） | `F:\project\keybox\KeyBox-icon\keybox-icon.svg`（512 viewBox：白底 + 锁梁 `#C9B28E` + 锁体 `#7C988B` + 白钥匙孔） |
| 生成的 1024 母版 | `design/icon-source/keybox-new-1024.png`（蒙版合成 + 4× 超采样） |
| 各端图标 | Windows 7 资产 · 安卓位图 mipmap + 自适应 XML · 鸿蒙 216 · web favicon 32 · Tauri/Capacitor 壳同源 |
| 头图 | `KeyBox-icon/keybox-banner-light.png`（1280×640）→ 各端 `docs/assets/` + README 顶部 |
| 品牌标识 | `com.mobilewitcher.keybox`（安卓 applicationId、tauri identifier、鸿蒙 bundleName）；安卓 Kotlin `namespace` 仍是 `com.keybox.app`（有意保留，避免大改包名） |
| 版权 | `LICENSE` → `Copyright (c) 2026 mobile-Witcher`（四端各一份）；Windows csproj `<Company>/<Copyright>`；鸿蒙 `vendor: mobile-Witcher` |
| GitHub 社交预览图 | **无 API**，需网页 Settings → Social preview 手动传 `keybox-banner-light.png` |

**重新生成一套图标**的正确做法（**别用位图放大**）：按上述 SVG 几何**重绘** —— 锁梁用"外环 − 内孔"蒙版（`ImageChops.subtract(外, 内)`）、锁体圆角矩形、钥匙孔白圆+梯形；4× 超采样后 LANCZOS 下采样；ICO 用 Pillow `bitmap_format="bmp"`（**DIB 帧**，PNG 帧会导致 `System.Drawing.Icon` 读不出、托盘图标消失）。

---

## 7. 血泪纪律（接手 agent 请逐条照做）

**通用**
1. 破坏性/结构性操作（删除、合并仓库、改数据库、改签名身份）**先列清单再执行**，并在报告里列出删了什么、保留了什么。
2. 判断构建/命令结果前，先确认"**同一窗口、可复现**"；构建前删 `obj`；不要拿一次偶然结果下结论。
3. 每次提交前扫一遍敏感文件（`.pfx/.jks/key.properties/secrets/`）；`secrets` 必须在仓库之外。
4. 不要 force push；不要改加密契约/RLS/触发器而不先取得所有者同意。
5. 一个批次 = 一个提交，提交信息写清"改了什么 + 验证方式 + 已知限制"。

**PowerShell（本机踩过太多次）**
6. `git add -A app src entry` 里只要有一个不存在的路径，**整条 add 会中止**（路径不存在时报 `pathspec` 错误）⇒ 用**明确存在的路径**，或逐个 `git add`。
7. `git add --ignore-submodules=...` **不是合法参数**（它会静默失败）⇒ 状态查询用 `git status --ignored`，子模块用 `git -c submodule.recurse=false ...`。
8. 写配置文件一律 `[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))`（**无 BOM**）；用 `Set-Content -Encoding UTF8` 会写 BOM，害过 gradle。
9. 控制台是 **GBK**：`Write-Host "✔"`、emoji 会抛 `illegal multibyte sequence` ⇒ 脚本输出只用 ASCII（`OK/FAIL`）。
10. 别写 `(...) .PadRight(...)`（括号后不能有空格）、别写 `(a; b)`（PowerShell 不是块语法的括号）——两处都让整段脚本**解析失败、什么都不执行**。
11. 批量 `git mv a b c dir/`：**一个源不存在则整批中止**（曾因此把仓库搞成半移动状态，要靠 `git reset --hard` 回滚）⇒ 逐个移动。
12. 输出可能被超大目录（node_modules）刷爆 ⇒ 先 `Select-Object -First N` 或只列顶层。

**平台相关的坑**
13. 改鸿蒙 `bundleName` 后**必须** DevEco 重签（§4）。
14. 平台偶发 `invalid_grant 4026`（短时间连续登录后的续期竞态）：**重试即成功**，客户端必须"重试一次再登出"。
15. `kb_users_cap_before_insert` 触发器现在带 advisory lock；再改它必须走 `applyMigration` 并保留 `KB_USER_LIMIT_REACHED` 语义。
16. 旧的 `KeyBox-harmony\keystore\ keybox.csr` 文件名带前导空格，复制时注意别覆盖同名文件（曾把发布用 keystore 覆盖掉，靠 `android/` 里的副本才恢复）。

---

## 8. 已知限制 / 未决事项

| 项 | 状态 |
|---|---|
| 云环境到期 | **2026-11-02 到期且未开自动续费** ⚠️ 需所有者处理 |
| Windows MSIX | 自签名证书 ⇒ 只在导入过 `keybox-codesign-mobilewitcher.cer` 的电脑受信任；要面向公网分发需买 OV/EV 代码签名证书 |
| 公开仓库历史 | monorepo 的 `harmony/` 历史里 2026-10-01 之前的提交曾明文写过环境 id 与 publishable key（后者本就是客户端公开密钥）；如需彻底清理要 `git filter-repo` 重写历史（会改 commit hash，需所有者批准） |
| 三旧私仓 | 保留未删（CLI 无权限）；不再维护 |
| 弃用壳 | `web/src-tauri/`、`web/android/`(Capacitor) 仍在仓库内，图标已同步但**不要在上面加功能** |
| 安卓包名 | `applicationId=com.mobilewitcher.keybox`，Kotlin `namespace=com.keybox.app`（有意不一致） |
| Tauri 时代老用户 | 旧包用**另一把** keystore 签名 ⇒ 无法覆盖升级，只能卸载重装（云端数据不受影响） |

---

## 9. 接手后第一小时的验收清单

- [ ] `git clone` 后：`git log --oneline -5`、`git ls-tree --name-only HEAD` 看到 `web/ windows/ android/ harmony/ cloudfunctions/ docs/`
- [ ] Windows：删 `obj` 后构建 **0 警告 0 错误** + `dotnet test` **125/125**
- [ ] Web：`npx vitest run src/lib/step8CloudFunctions.test.ts` 全绿（含 20 人上限用例）
- [ ] Android：`gradlew :app:assembleRelease` 出包 + `apksigner verify` 通过（无 `key.properties` 时应**明确报未签名**而不是假装成功）
- [ ] Harmony：`hvigorw assembleHap` BUILD SUCCESSFUL；若报 profile 失效 ⇒ 让所有者按 `docs/SIGNING-AND-TRUST.md` 第五章重签
- [ ] 数据库：`queryPgDatabase` 确认 `kb_users` 行数、触发器 `kb_enforce_user_cap` 含 `pg_advisory_xact_lock`
- [ ] 真机：鸿蒙 `hdc install -r ...hap` 成功并启动到登录页（含「没有账号？注册」）
- [ ] 问所有者三件事：环境是否续费、`secrets\` 是否有离线备份、是否需要公开发布（决定是否买正式代码签名证书）

---

## 10. 关键联系人/凭据索引（不在此文件内）

- 签名口令与材料：`F:\project\keybox\secrets\签名密钥-务必备份.txt`（**该目录不入库**）
- 签名/安装手册：`docs/SIGNING-AND-TRUST.md`
- 数据库迁移归档：`docs/db-migrations/`
- 云环境控制台：腾讯云 CloudBase → 环境 `weichi-d4gfw5uo1334e0ffb`

### 7.1 单仓 CI 专项（2026-10-04 实修记录）

合并为单仓后 CI 连挂四次，根因与正确写法：

1. **`defaults.run.working-directory` 只作用于 `run:` 步骤**，对 `uses:` 步骤（`actions/upload-artifact`、
   `actions/checkout` 等）**无效** —— 这类步骤的 `path` 一律相对**仓库根**。
   本项目就因此出现"打包步骤成功、上传却报 No files were found"：
   产物实际在 `windows/artifacts/`、`android/dist/`，而上传在根目录找 `artifacts/*.msix`、`dist/*.apk`。
   ⇒ 正确写法：`path: windows/artifacts/*.msix`、`path: android/dist/*-debug.apk`。
2. **产物路径/文件名不要硬编码版本号**（曾写死 `KeyBox-android-native-0.1.0-debug.apk`，
   版本升到 0.5.0 后必然找不到）。用通配符 `*-debug.apk` / `artifacts/*.msix`。
3. **`package-lock.json` 在 Windows 生成时，Linux CI 装不出平台专属可选依赖**
   （`npm ci` 与 `npm install` 都会照 lock 解析）⇒ CI 内 `rm -f package-lock.json && npm install`；
   仓库里的 lock 不动。（否则报 `Cannot find module @rollup/rollup-linux-x64-gnu`，npm/cli#4828）
4. 工作流 `name:` 不要重复（曾两个都叫 `build`，日志与通知里分不清），建议 `windows` / `android` / `web`。

### 7.2 测试路径与"勿批量重命名式改代码"

5. 单仓后 `cloudfunctions/`、`cloudbase/` 等**不再位于 web 根**：网页版测试里凡
   `resolve(here, "../../cloudfunctions")` 之类固定层级写法都会 ENOENT。
   ⇒ 建议统一锚定：向上寻找同时含 `cloudfunctions/` 与 `.github/` 的目录；或明确"相对 web 根"再上跳一层。
   本项目当前采用后者（`resolve(REPO, "../cloudfunctions")`，REPO 仍指向 `web/`，以免影响对 `src/` 的扫描）。
6. **不要用正则批量替换多文件**：本次一次批量替换把 5 个测试文件改成"加载即失败（0 test）"，
   靠 `git revert` 才挽回。正确做法：逐个文件改、逐个跑测试、一次只动一处。
### 7.3 关于"多端同时登录"的最终口径（2026-10-04 A/B 反证后修订）

- **不要**把 `x-device-id` 当成多端同时在线的修法：A/B 反证显示带与不带**失败率一致**
  （不带 3/3、带 3/3）。带它仍然正确（官方文档说明它参与设备统计），但不是解法。
- **也不要**宣称"续期失败重试一次即可恢复"：显式重试实验中 **0/3 恢复**，失败是**永久**的
  （服务端每个账号只保留一条活跃 refresh_token 世系，新登录接管旧世系）。
  四端的"重试一次"仅对网络抖动有效，保留即可，但别当成解法。
- **真实表现**：access_token 有效期 7200s，所以静置 30 分钟一切正常；约 2 小时后第一次续期
  才会失败 ⇒ 表现为"先登录的那端被迫重新登录"。
- **待定的产品决策**：是走"续期失败弹窗让用户选择重登"（优雅降级），还是去控制台确认
  CloudBase 是否支持多会话后改用多会话 API。详见 `docs/DIAGNOSIS-multi-device-login.md` §六。