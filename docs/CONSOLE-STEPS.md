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
  2. 把该文件放到**服务器/云函数能读到、但不在仓库里**的位置（例如本机 `F:\KeyBox-secrets\tcb_custom_login.json`）。
  3. 在云函数的环境变量里，把它的路径写进 `TCB_CUSTOM_LOGIN_KEY_FILE`（见文末附录）。
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

## 附录 A：云函数侧还需要两个环境变量（服务端凭据）

> 这一步不是上面四项控制台点选，而是**为云函数注入环境变量**，但同样必须做，否则云函数
> 读不到账号表（`login_hash` / `kdf_salt` / `kdf_verifier` 刻意未对客户端开放）。

1. **创建服务端 API Key**：控制台 → 环境 → 「API 密钥」页 → 新建一个 **API Key（服务端密钥，映射 service_role）**，
   名称建议 `keybox-cloudfunction`。复制其值。
2. **注入到 6 个云函数的环境变量**（`kbInitAdmin` / `kbInviteCreate` / `kbInviteRevoke` / `kbRegister` / `kbLogin` / `kbGetMyRole`）：
   - `TCB_ENV` = `{你的环境Id}`（云函数据此拼接 PG 网关地址）
   - `CLOUDBASE_API_KEY` = 上一步复制的服务端 API Key（**service_role，绕过 RLS，绝不能进前端**）
   - `TCB_CUSTOM_LOGIN_KEY_FILE` = 第 2 步那个私钥文件在运行时可读到的路径
3. **成功判据**：随便调一次 `kbGetMyRole`（登录后），若不报 `SERVICE_CREDENTIAL_MISSING` / `ENV_ID_MISSING` 即注入成功。

> 安全提醒：`CLOUDBASE_API_KEY`（service_role）等于数据库万能钥匙，只放云函数环境变量；
> 一旦落到前端或仓库，等于全库失守，需立即在控制台吊销并重建。

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
