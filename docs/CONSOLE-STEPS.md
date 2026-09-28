# KeyBox 控制台操作清单（给项目所有者）

> 读者：零代码基础的项目所有者。本文只做**控制台点选**，不涉及写代码。
> 说明：下面四项我（工程师）无法在代码里完成，必须由你在 CloudBase 控制台点选。四项都做完，
> 登录/注册链路才能端到端跑通；少做任一项会出现“能开网页但登录不上/签不出票据”。
>
> 术语：**环境（envId）**＝你这套云端资源的编号；**票据**＝登录成功后云端发给本机的凭证。
> 文中 `{你的环境Id}` 指你自己的环境 ID，请自行替换，本文不写真实值（仓库会开源）。

---

## 第 1 步：开启“用户名密码登录”

- **在哪个菜单**：CloudBase 控制台 → 你的环境 → 左侧「身份认证 / 登录管理（Login Manage）」。
  直达：`https://tcb.cloud.tencent.com/dev?envId={你的环境Id}#/identity/login-manage`
- **点什么**：找到「用户名密码登录（Username / Password）」开关，打开（置为开启）。
- **出现什么算成功**：开关变成“已开启/绿色”。这一步是“登录会话能落到已登录角色”的前提
  （架构 §7「关于用户名密码登录」）。**注意**：本项目不依赖平台自带的用户名密码注册，
  注册仍走我们自己的云函数 kbRegister。

---

## 第 2 步：生成并注入“自定义登录私钥”

> 自定义登录＝用户身份由我们自建的账号表签发，云端据此发票据，所以需要一把签名私钥。
> **重要**：这把私钥绝不能进仓库（本项目 `.gitignore` 已挡住 `tcb_custom_login.json`）。

- **在哪个菜单**：控制台 → 你的环境 → 「身份认证 / 登录管理」页内找到「自定义登录（Custom Login）」区块。
- **点什么**：
  1. 点「生成私钥」，浏览器会下载一个文件，文件名形如 `tcb_custom_login.json`。
  2. 先把它**妥善保存到你自己的密码管理器/安全目录**（**不要**放进仓库；`.gitignore` 已挡住该文件名）。
  3. “怎么让云函数读到这把私钥”见**附录 A.2**：推荐直接把 JSON 内容填进云函数环境变量
     `TCB_CUSTOM_LOGIN_CREDENTIALS`；或把该文件放进 `kbLogin` / `kbRegister` 函数目录（随函数上传）。
     ⚠️ 注意：云函数在云上运行，**读不到你本机的 `F:\...`**，所以要按 A.2 的方式投递，而不是只留在本地。
- **出现什么算成功**：页面显示“已生成私钥/私钥已存在”，且你本地多出该 json 文件。
  此时 kbLogin / kbRegister 才能用 `createTicket` 签发票据。

---

## 第 3 步：配置 Web 安全域名白名单

- **在哪个菜单**：控制台 → 你的环境 → 「环境 / 安全配置 → Web 安全域名（安全域名白名单）」。
- **点什么**：把本地开发地址与将来正式域名加入白名单：
  - 本机开发：`localhost:5173`（架构 §10 第 1 步要求）
  - 正式部署后：你实际使用的域名（如 `你的域名.com`）
- **出现什么算成功**：列表里能看到这两条，且状态为“已生效”。
  否则浏览器会因域名不在白名单而拒绝调用云端接口。

---

## 第 4 步：取 Publishable Key（前端公钥）

- **在哪个菜单**：控制台 → 你的环境 → 「环境 / API 密钥（API Key）」。
  直达：`https://tcb.cloud.tencent.com/dev?envId={你的环境Id}#/env/apikey`
- **点什么**：在「Publishable Key（公开公钥）」处点「复制」（若无则点「新建」）。
- **出现什么算成功**：拿到一串以 `pk_` 或类似前缀开头的公钥。
  把它填进本机 `.env.local` 的 `VITE_PUBLISHABLE_KEY=`（**只填本地文件，绝不提交**）。
  该公钥只能读“被授权且有 RLS 放行”的行，即使泄露也拿不到 `login_hash` 等敏感列。

---

## 附录 A：给云函数注入环境变量（服务端凭据）

> 附录 A 不是上面四项“点一下就完”的开关，而是要**逐个云函数填环境变量**。必须做完，
> 否则云函数读不到账号表（`login_hash` / `kdf_salt` / `kdf_verifier` 刻意未对客户端开放）。
> 本附录每一步都给了“在哪个页面、点什么、出现什么算成功”，照做即可。
> **背景一句话**：云函数跑在云端，它不认识你本机的文件；所以凡是要用到的“文件/凭据”，
> 都得放进**云函数自己能读到的地方**（见 A.2）。

### A.0 本附录要注入的变量总表（先看清有几个）

| 变量名 | 值是什么 | 谁需要 |
|--------|----------|--------|
| `TCB_ENV` | 你的环境 ID（`{你的环境Id}`） | **全部 8 个函数** |
| `CLOUDBASE_API_KEY` | A.1 里新建的**服务端 API Key**（service_role） | **全部 8 个函数** |
| `TCB_CUSTOM_LOGIN_KEY_FILE` | 自定义登录私钥文件的**路径**（A.2） | 仅 `kbLogin`、`kbRegister` 需要；其余可不填 |
| `TCB_CUSTOM_LOGIN_CREDENTIALS` | 自定义登录私钥的**JSON 内容**（A.2 的替代方案） | 同上（二选一，不必都填） |

> 说明：`TCB_CUSTOM_LOGIN_KEY_FILE` 与 `TCB_CUSTOM_LOGIN_CREDENTIALS` 是**两种投递私钥的方式，二选一**即可。
> 嫌文件路径麻烦就用后者（直接把 json 内容粘进环境变量）。

### A.1 创建“服务端 API Key”（映射 service_role）

- **在哪个菜单**：控制台 → 你的环境 → 「环境 / API 密钥（API Key）」。
  直达：`https://tcb.cloud.tencent.com/dev?envId={你的环境Id}#/env/apikey`
- **点什么**：
  1. 找到「API Key（服务端密钥）」区域，点「新建」。
  2. 名称填 `keybox-cloudfunction`（便于日后识别），权限保持默认的服务端权限（service_role）。
  3. 创建后点「复制」，得到一串服务端密钥。
- **出现什么算成功**：列表里出现名为 `keybox-cloudfunction` 的一条，且你能复制到它的值。
  ⚠️ 这串值**只在创建时完整显示一次**，请立刻存到你自己的密码管理器；丢了就删掉重建。
- **不要**把它填进 `.env.local` 的 `VITE_` 前缀变量（那是会打进前端的），只用于 A.4 的云函数环境变量。

### A.2 生成“自定义登录私钥”，并放到云函数读得到的地方

> 为什么需要它：我们的用户身份是自己建的（`kb_users` 表），云端据此签发“登录票据”，这需要一把签名私钥。
> **关键认知**：云函数在云上运行，**读不到你本机的 `F:\...`**。私钥必须随函数“上传”或在环境变量里给它。

**第一步：生成私钥文件**
- **在哪个菜单**：控制台 → 你的环境 → 「身份认证 / 登录管理」页 → 「自定义登录（Custom Login）」区块。
- **点什么**：点「生成私钥」，浏览器会下载一个文件，文件名形如 `tcb_custom_login.json`。
- **出现什么算成功**：页面显示“已生成 / 私钥已存在”，且本地多出该文件。
- ⚠️ **此文件是私钥，绝不进仓库**（`.gitignore` 已挡住 `tcb_custom_login.json`）。

**第二步：把这把私钥交给云函数 —— 两种方式，任选其一**

- **方式一（推荐，最省事）：把 JSON 内容直接放进环境变量 `TCB_CUSTOM_LOGIN_CREDENTIALS`**
  1. 用记事本打开 `tcb_custom_login.json`，**全选复制**全部内容（是一整段以 `{` 开头、`}` 结尾的 JSON）。
  2. 到 A.4 的云函数环境变量里，新增 `TCB_CUSTOM_LOGIN_CREDENTIALS`，值粘贴这段 JSON。
  3. 只需给 `kbLogin`、`kbRegister` 两个函数加。
  > 若控制台的变量值输入框不接受多行，可看方式二。

- **方式二：把私钥文件放进函数目录，用路径引用**
  1. 把 `tcb_custom_login.json` 复制到**本机**的 `F:\KeyBox\cloudfunctions\kbLogin\` 与
     `F:\KeyBox\cloudfunctions\kbRegister\` 两个目录里（与该目录下已有的 `index.js` 并排）。
  2. 这样它会在**部署/上传函数时**一起上传到云端（注意：它仍在 `.gitignore` 保护下，不会被提交到仓库）。
  3. 给这两个函数加环境变量 `TCB_CUSTOM_LOGIN_KEY_FILE`，值填 `./tcb_custom_login.json`。
     （云函数会优先按这个路径找；找不到时会自动在**函数自己所在目录**找同名文件，所以方式二也稳。）
- **出现什么算成功**：`kbLogin` 登录成功时会返回票据；失败则返回 `TICKET_UNAVAILABLE`（见 A.5 对照表）。

### A.3 八个云函数各自的变量需求（逐条核对）

| 函数名（目录） | 用途 | `TCB_ENV` | `CLOUDBASE_API_KEY` | 自定义登录私钥 |
|----------------|------|:--:|:--:|:--:|
| `kbInitAdmin` | 首次初始化管理员（R01） | ✅ | ✅ | — |
| `kbInviteCreate` | 管理员生成邀请码（R02） | ✅ | ✅ | — |
| `kbInviteRevoke` | 作废邀请码（R02） | ✅ | ✅ | — |
| `kbRegister` | 用邀请码注册 + 签发登录票据（R03/R04/R22） | ✅ | ✅ | **✅ 必须** |
| `kbLogin` | 登录校验 + 签发登录票据（R05/R13） | ✅ | ✅ | **✅ 必须** |
| `kbGetMyRole` | 取本人角色/停用状态/密钥参数（R11/R26） | ✅ | ✅ | — |
| `kbSecretUpsert` | 写入一条密钥密文（R08/R15） | ✅ | ✅ | — |
| `kbSecretDelete` | 删除一条密钥（R15） | ✅ | ✅ | — |

> 若图省事，**8 个函数都注入前两个变量即可**；只有 `kbLogin` / `kbRegister` 额外需要私钥。
> 在前两个变量之外多注入私钥不影响其它函数（它们不会用到）。

### A.4 在控制台逐个注入（照做步骤）

- **函数列表页**：`https://tcb.cloud.tencent.com/dev?envId={你的环境Id}#/scf`
- **单个函数详情页**：`https://tcb.cloud.tencent.com/dev?envId={你的环境Id}#/scf/detail?id={函数名}&NameSpace={你的环境Id}`
  （把 `{函数名}` 换成 `kbInitAdmin`、`kbLogin` …… 逐个打开）

**逐函数操作（8 次，流程相同）：**
1. 打开该函数的详情页。
2. 找到「**函数配置 / 环境变量**」区块（有的版本在“配置”标签页里，或标为“环境变量”）。
3. 点「**编辑 / 添加环境变量**」，按 A.3 逐条「新增」键值对：
   - 键：`TCB_ENV`　值：`{你的环境Id}`
   - 键：`CLOUDBASE_API_KEY`　值：A.1 复制的服务端密钥
   - （仅 `kbLogin`、`kbRegister`）键：`TCB_CUSTOM_LOGIN_CREDENTIALS`（或 `TCB_CUSTOM_LOGIN_KEY_FILE`）
4. 点「**保存**」。若页面另有「**发布 / 更新配置 / 部署**」按钮，再点一次让配置对线上生效。
5. **对照“成功样式”**：保存后页面「环境变量」列表里应**看得到这些键名**（`TCB_ENV`、`CLOUDBASE_API_KEY` …）。
6. 回到函数列表，重复第 1~5 步，把 8 个函数都配好。

> ⚠️ **重要：是“新增/合并”，不是“整体覆盖”。** 有些控制台若整段替换环境变量，会**丢掉原有的其它变量**。
> 操作前先看一眼现有变量，确保新变量是**加**进去，而不是把已有的一起删掉。

### A.5 怎么确认“真的生效了”（不写代码也能看出来）

| 你看到的现象 / 返回字样 | 含义 |
|-------------------------|------|
| 云函数返回 `ENV_ID_MISSING` | 该函数的 `TCB_ENV` 没填对 |
| 云函数返回 `SERVICE_CREDENTIAL_MISSING` | 该函数的 `CLOUDBASE_API_KEY` 没填对 |
| 登录返回 `TICKET_UNAVAILABLE` | 私钥没给对（`kbLogin` / `kbRegister` 的 `TCB_CUSTOM_LOGIN_CREDENTIALS` 或路径不对） |
| 登录成功、紧接着能取到本人角色/密钥参数 | ✅ 附录 A 注入成功 |

- **最省事的验证**：登录成功后调一次 `kbGetMyRole`；只要**不再**出现上面两条 `...MISSING`，就说明前两个变量注入到位。
- **看日志**：控制台 → 「日志监控」`https://tcb.cloud.tencent.com/dev?envId={你的环境Id}#/logs`，
  选对应函数，能看到上面这些错误字样出现在调用日志里。

### A.6 安全提醒

> - `CLOUDBASE_API_KEY`（service_role）＝数据库万能钥匙，**只放云函数环境变量**；
>   一旦落到前端或仓库，等于全库失守，需**立即**在控制台吊销并重建。
> - `tcb_custom_login.json` / `TCB_CUSTOM_LOGIN_CREDENTIALS` 是签名私钥，同样只进云函数，**绝不进仓库、绝不发截图**。
> - 环境变量填完后，别把控制台页面截图外发（可能带明文密钥）。

---

## 做完后的自检（不写代码也能看出对错）

| 现象 | 说明哪一步没做 |
|------|----------------|
| 打开网页但一点登录就报“安全域名” | 第 3 步未做或不完整 |
| 登录报 `TICKET_UNAVAILABLE` | 第 2 步私钥未注入或路径不对 |
| 云函数返回 `SERVICE_CREDENTIAL_MISSING` | 附录 A 的 `CLOUDBASE_API_KEY` 未注入 |
| 云函数返回 `ENV_ID_MISSING` | 附录 A 的 `TCB_ENV` 未注入 |
| 前端启动即报缺少 `VITE_PUBLISHABLE_KEY` | 第 4 步未填 `.env.local` |
| 登录后仍读不到任何数据 | 第 1 步未开，或会话未落到已登录角色 |

---

## 附录 B：第 9 步「第二段」执行清单（本机打包，需先装工具链）

> **第一段（已完成）**只写配置与外观，**不需要装任何东西**。
> 下面是**第二段**——在**本机**产出可安装包，需要安装 Rust / Android 工具链（体积较大，约 1–2 GB）。
> **云端 CI 打包不需要这些**（见 `.github/workflows/`）：打 `v*` 标签后，`build-android` 出 apk、`build-desktop` 出 exe。
> 因此本段**装与不装都可以**，取决于是否需要在本机验证安装包。

### B.1 桌面端（Windows，Tauri）—— 需装 Rust

1. 安装 Rust：访问 `https://rustup.rs`，下载并运行 `rustup-init.exe`，一路默认。
   它会提示安装 **Visual Studio C++ 生成工具（MSVC）**；若未自动装，请手动安装
   “Visual Studio Build Tools 2022 → 使用 C++ 的桌面开发”。
2. 关掉并**重开终端**，验证：
   - `rustc --version` → 出现 `rustc 1.9x.x (...)` 即成功。
   - `cargo --version` → 出现 `cargo 1.9x.x (...)` 即成功。
3. 打包（在**项目根目录**执行）：
   - `npm run tauri build`
   - 首次会编译较久（约 5–20 分钟）。成功时最后会打印 `Finished` 与产物路径。
   - **预期产物**：
     - `src-tauri/target/release/bundle/msi/KeyBox_0.1.0_x64_*.msi`
     - `src-tauri/target/release/bundle/nsis/KeyBox_0.1.0_x64-setup.exe`
     - 免安装可执行文件：`src-tauri/target/release/keybox.exe`
   - 想先看效果而不打安装包：`npm run tauri dev`（会打开一个桌面窗口，指向本地 5173）。
4. 图标：`src-tauri/icons/` 现为 Tauri 默认图标。更换方法：备一张 1024×1024 PNG，运行
   `npm run tauri icon <你的logo.png>` 生成全套尺寸。（**待核实**：`icon` 子命令的确切参数以
   `npx tauri icon --help` 为准。）

### B.2 安卓端（可选，本机出 APK）—— 需装 Android SDK

> 一般**不必**在本机做：打 `v*` 标签让 `build-android` 工作流出包即可。若坚持本机：
1. 安装 Android Studio（含 SDK 与 platform-tools），并设置环境变量 `ANDROID_HOME`。
2. 同步与构建：
   - `npm run build`
   - `npx cap sync android`
   - `cd android`，然后 `./gradlew assembleDebug`（Windows 用 `gradlew.bat assembleDebug`）
   - **预期产物**：`android/app/build/outputs/apk/debug/app-debug.apk`
3. 出**正式签名**包还需 `android/key.properties` + keystore（格式见
   `.github/workflows/build-android.yml` 顶部注释）；未配置时只能出未签名 debug 包。

### B.3 用 GitHub Actions 出包（无需本机工具链）

- 打标签即云端出包：`git tag v0.1.0 && git push origin v0.1.0`。
- 或在 GitHub 仓库 → Actions → 选 `build-android` / `build-desktop` → **Run workflow**。
- 安卓签名所需的 4 个 secret（keystore 用 base64）见 `.github/workflows/build-android.yml` 顶部注释。

### B.4 「已核实 / 仍未核实」清单（2026-09-28 更新）

**已核实（实测）：**
- ✅ `tauri icon` 子命令：名称与参数已实测（`npx tauri icon --help`）——用法
  `npm run tauri icon [OPTIONS] [INPUT]`；`INPUT` 缺省 `./app-icon.png`（方形 PNG 或 SVG，需带透明），
  `-o/--output` 缺省为 `tauri.conf.json` 同级的 `icons/` 目录；`-p/--png` 可自定义尺寸组。
- ✅ `src-tauri/icons/` 确为 Tauri **默认模板图标**（含 `icon.ico`/`icon.icns`/`icon.png` 及一套
  `Square*Logo.png` / `StoreLogo.png`）；正式发布前应替换为项目自有图标（见 B.1 第 4 条）。

**仍未核实（写明原因，勿当结论）：**
- `npm run tauri build` 的确切产物文件名（含版本号/语言后缀）随 Tauri 版本可能微调；
  **本机未产出**（原因：本机缺 MSVC 链接器，见 B.5），**以首次成功构建的实际输出为准**。
- 未配置 `android/key.properties` 时 `./gradlew assembleRelease` 的行为（预期产出未签名的
  `app-release-unsigned.apk`，无法安装分发）；**本机未产出**（原因：本机未装 Android SDK），
  **以本机实测为准**。

### B.5 本机出包的先决条件（含**所有者手动**步骤）

> 本机 Rust 工具链已装（`rustc`/`cargo` **1.98.1**，`minimal` profile，见下方证据），但**缺 MSVC 链接器**，
> 故 `tauri build` 在链接阶段即失败、无法出 exe。
>
> **证据**：`rustc` 链接一个最小程序报
> `error: linking with link.exe failed ... note: you may need to install Visual Studio build tools with the "C++ build tools" workload`；
> 且本机无 `C:\Program Files\Microsoft Visual Studio` 目录、无 `vswhere.exe`。

1. **安装 MSVC「C++ 生成工具」（需所有者手动、需管理员权限，约 1–2 GB）**——逐条见本轮汇报清单。
2. 装好后在**项目根目录**执行 `npm run tauri build`；产物见 B.1。

---

## 附录 C：登不进去了怎么办？→ 见 `docs/RECOVERY.md`

> 如果管理员**忘了登录密码**、账号被误设成**停用/已删除**、或 `kb_users` 里**整行丢失**——
> 这些"账号登不进去"的情形，本文（控制台点选）都**解决不了**，请改看：
>
> 📄 **`docs/RECOVERY.md`（灾备救援手册）**。
>
> 它按场景（SS1–SS7）给出**本地救援脚本**的逐条操作（照做即可，零代码基础可完成）。
> ⚠️ 一句话红线（`RECOVERY.md` 开头有详述）：
> **救援只能恢复"账号能登录"；能否解密数据取决于你手上的 主密码 / 恢复码 / 备份，云端永远解不开。
> 主密码 + 恢复码 + 备份三者全丢 = 永久救不回。**

---

## 附录 D：一键下发脚本 `scripts/setup-cloud.js`（能自动化的部分）

> 目的（R27 开源可复现）：把控制台里**能脚本化**的部署动作固化成*一条可重复运行*的命令，
> 让 fork 本项目的人不必照着几十步手动点。**它是幂等的——重复运行不会报错、不会重复创建、不会覆盖既有策略。**

### D.1 脚本替你做什么（跑一遍即可）

| 脚本负责 | 说明 | 对应本文 |
|----------|------|----------|
| ① 下发**版本化迁移**（建表 + `REVOKE`/精确 `GRANT` + RLS 策略） | DDL 一律走**版本化迁移**（等价 `applyMigration`），**绝不**用 `execute` 跑 DDL；迁移以仓库 `cloudbase/migrations/` 为权威副本，按版本顺序执行 | 第 2 步（迁移部分） |
| ② 下发云函数 **invoke 规则** | 让注册/登录在**未登录**时也能调用云函数（函数内部各自做身份/权限自检）；已是期望值则跳过 | 第 2 步（云函数权限） |
| ③ 配置**安全域名白名单**（至少 `localhost:5173`） | 浏览器跨域 origin 白名单；已存在的不重复添加 | 第 3 步 |

**运行（在项目根目录）：**
```
node scripts/setup-cloud.js --dry-run     # 先看一眼"将要做什么"，不改任何东西
node scripts/setup-cloud.js               # 真正执行（幂等，可重复跑）
```

**凭据**：脚本只从 `.env.local` / 环境变量读，**绝不硬编码、绝不回显**。
- 环境 ID：`--env <envId>` 或 `TCB_ENV` / `ENV_ID` / `VITE_CLOUDBASE_ENV_ID`（取值方式见附录 A）。
- 可选 `CLOUDBASE_API_KEY`：用于 CloudBase CLI 的**免账号登录**；不填则使用你已 `tcb login` 的会话。
- 依赖官方 CLI：先 `npm i -g @cloudbase/cli` 并 `tcb login`。缺凭据时脚本会明确告诉你**缺哪个变量、去哪儿拿**。

### D.2 脚本**不能**替你做什么（这些**必须仍手工**）

> 下面几条**没有可脚本化的公开接口**（或属平台侧开关），`setup-cloud.js` **不会**、也**不能**代劳。
> 该清单与脚本实际能力**保持一致**——不多写、不少写。

| 必须手工的步骤 | 在哪儿做 | 对应本文 |
|----------------|----------|----------|
| **开启"用户名密码登录"开关** | 控制台 → 身份认证 / 登录管理 | 第 1 步 |
| **生成并注入"自定义登录私钥"** | 控制台生成 → 注入云函数环境变量 `TCB_CUSTOM_LOGIN_CREDENTIALS`（或按附录 A.2 放文件） | 第 2 步 / 附录 A.2 |
| **取 Publishable Key 填入 `.env.local`** | 控制台 → 环境 / API 密钥（复制 `VITE_PUBLISHABLE_KEY`） | 第 4 步 |
| **首次管理员初始化**（R01） | 在应用内跑 `kbInitAdmin` 手输首个管理员 | — |
| **可能的角色 / 资源策略复核** | 控制台权限页（PG 环境的**角色类**管理接口被平台拒绝，无法脚本化） | 附录 A（权限相关） |

> 结论：`setup-cloud.js` 覆盖"数据库地基 + 云函数可调用性 + 安全域名"三块；上面五条仍需你按本文手工完成。
> 两件事都做完，登录/注册链路才能端到端跑通。
