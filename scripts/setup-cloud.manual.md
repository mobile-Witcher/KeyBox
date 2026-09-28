# setup-cloud.js 手工操作清单（脚本跑不通时的兜底）

> 读者：零代码基础的部署者。本文是 `scripts/setup-cloud.js` 的**兜底**——当脚本因网络 / CLI / 权限
> 等原因跑不通时，照本文**逐步手工**完成同样的事。
>
> **单一事实源（本文不复制其内容，只指路）**：
> - 脚本**能做 / 不能做**的边界 → `docs/CONSOLE-STEPS.md` **附录 D.2**；
> - invoke **档位**与**两条必验** → `docs/CONSOLE-STEPS.md` **附录 D.3**。
> 出现冲突时，**以 `docs/CONSOLE-STEPS.md` 为准**。

## 1. 脚本三步 ↔ 手工对应（逐步对齐）

| 脚本步骤（自动） | 跑不通时的手工做法 | 去哪做 |
|------------------|--------------------|--------|
| ① **版本化迁移**下发（建表 + `REVOKE`/`GRANT` + RLS） | 按**版本号升序**逐条执行 `cloudbase/migrations/*.sql`（**DDL 绝不走 `execute`**；文件名与 `migrationVersion` 必须一致，否则 fail-closed） | `docs/CONSOLE-STEPS.md` 第 2 步（迁移部分） |
| ② 云函数 **invoke 规则**下发 | 控制台权限页设置；或手敲 `tcb permission set function --level custom --rule '…' -e <你的环境Id> --yes` | `docs/CONSOLE-STEPS.md` **附录 D.3** |
| ③ **安全域名白名单**（≥ `localhost:5173`） | 控制台 → 环境 / 安全配置 → Web 安全域名，手动加入 | `docs/CONSOLE-STEPS.md` 第 3 步 |
| —（脚本**不做**） | 开启用户名密码登录 / 注入自定义登录私钥 / 取 Publishable Key / 首次管理员初始化 / 角色策略复核 | `docs/CONSOLE-STEPS.md` **附录 D.2**（五条必须手工） |

## 2. 脚本跑不通的常见原因（先看这几条）

| 现象 | 原因 | 处理 |
|------|------|------|
| 提示"未找到 `tcb`"（脚本会给三步补救） | 未安装官方 CLI | `npm i -g @cloudbase/cli` → `tcb --version`（需 **≥ 3.0.0**）→ `tcb login` |
| 子命令报错、疑似参数名不对（脚本会提示"可能是 CLI 版本差异"） | CLI 版本漂移 | 先 `tcb --version`，再核对 `tcb <子命令> --help`（`-e` 与 `--env-id` 是**等价**写法） |
| 缺环境 ID / API Key | 未配 `.env.local` | 见 `docs/CONSOLE-STEPS.md` **附录 A** 与仓库根 `.env.example`（**凭据绝不进仓库、绝不外发**） |
| 其它安装 / 工具链问题（`npm install`、原生模块缺失等） | 环境问题，非本项目代码问题 | 见 `docs/TROUBLESHOOTING.md` 问题 1 |

## 3. 配完必验（两条，缺一不可）

1. **登录前**能调 `kbInitAdmin` / `kbRegister` / `kbLogin`（这三条断了会表现为"打不开 / 注册不了"，**极难排查**）；
2. **登录后**能调 `kbGetMyRole`。

> 档位选择（默认通配 / 收紧档位①②）、失败模式、以及何时收紧或回退，见 `docs/CONSOLE-STEPS.md` **附录 D.3**。

## 4. 忘密码 / 账号失联？

本文只讲**部署**。**账号登不进去**（忘了登录密码、被误设停用 / 软删、`kb_users` 整行丢失）→
见 `docs/RECOVERY.md`（灾备救援手册，随附本地救援脚本 `scripts/rescue-admin.js`）。
