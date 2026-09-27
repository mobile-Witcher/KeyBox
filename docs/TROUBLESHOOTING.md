# KeyBox 排障手册（TROUBLESHOOTING）

> 读者：零代码基础的项目所有者 / 部署者。每个问题都按 **现象 → 原因 → 解决办法** 写，
> 解决办法都给**一条可整行复制**的命令。命令里的路径按你本机实际情况替换。
>
> 本手册直接服务于 R27「开源部署可复现」：别人 fork 本项目后大概率会踩到下面的坑。

---

## 问题 1：`npm install` 报错，或装完却跑不起来（Windows 下 esbuild / rollup 的原生模块缺失）

### 现象

**现象 A（安装当场报错）**：执行 `npm install` 后，末尾出现类似：

```
npm error code 1
npm error path F:\KeyBox\node_modules\esbuild
npm error command failed
npm error command C:\WINDOWS\system32\cmd.exe /d /s /c node install.js
npm error <ref *1> Error: spawnSync ...\node.exe EBUSY
npm error     errno: -4082,
npm error     code: 'EBUSY',
```

**现象 B（安装“成功”了，但一跑命令就报模块找不到）**：执行 `npm test` 或 `npm run build` 时出现：

```
Error: Cannot find module @rollup/rollup-win32-x64-msvc.
npm has a bug related to optional dependencies (https://github.com/npm/cli/issues/4828).
Please try `npm i` again after removing both package-lock.json and node_modules directory.
```

或报找不到 `@esbuild/win32-x64`。

### 原因（说人话）

1. **esbuild / rollup 这类工具不是纯 JavaScript**，它们带一个“针对你操作系统的原生小程序”（Windows 上是一个 `.exe`）。
   npm 会通过“可选依赖（optional dependencies）”自动挑对你系统的那一份。
2. **npm 有个已知缺陷**（官方 issue #4828）：在某些情况下，那个针对 Windows 的原生包**会被漏装**，
   而你看到的却不是“漏装”，而是稍后一运行就报“模块找不到”。
3. **现象 A 的 `EBUSY`**：Windows 上安装脚本要临时调用一次 `node.exe` 自检版本，
   但该文件**当时正被杀毒软件/系统占用**（busy＝被占用），于是这一步失败，进而连锁导致原生包没装全。
   这是**环境问题，不是项目代码问题**；重试一次往往就过了。

### 解决办法（一条命令，可整行复制）

在项目根目录（有 `package.json` 的那一层）打开终端，执行：

```
npm install --no-save @rollup/rollup-win32-x64-msvc@4.63.5 @esbuild/win32-x64@0.21.5
```

> 说明：这两条就是现象 B 里“找不到”的那两个包。`--no-save` 表示只补装、不改动 `package.json`
> （它们的版本号要和项目里 rollup / esbuild 的版本对上；本项目的可用组合就是上面这两个版本）。
> 装完**不需要**再跑别的命令，直接继续下一步验证即可。

若上面命令也报 `EBUSY`，先**临时关闭杀毒软件实时防护**（或把项目目录加进白名单），
再重试；仍不行就**重开一个终端**再执行一次。

### 怎么算修好了

依次执行下面两条，两条都通过即修好：

```
npm test
```

期望看到（大意）：`Test Files 1 passed`、`Tests 13 passed`。

```
npm run build
```

期望看到（大意）：`✓ built in ...`，并在 `dist/` 目录下生成 `index.html` 与 `assets/`。

两条都通过，说明前端可以正常开发与打包。

### 为什么不干脆删掉 node_modules 重装

官方提示里写了“删掉 node_modules 和 package-lock.json 再 `npm i`”，这条**理论上可行**，
但在 Windows 上删除上万个文件又慢、又容易被占用锁住，还可能触发本仓库/系统对“批量删除”的保护。
**先试上面的补装命令**，它只装缺的两个小包，几秒钟就好；只有在补装也无效时，才考虑彻底删库重装。

---

## 问题 2：打开网页后一点登录就报“安全域名 / 域名未授权”

- **现象**：网页能打开，但登录或注册时报域名相关错误。
- **原因**：CloudBase 要求把访问你网页的域名（开发时是 `localhost:5173`）加入白名单，否则拒绝调用云端接口。
- **解决**：见 `docs/CONSOLE-STEPS.md` 第 3 步（配置 Web 安全域名白名单）。

### 常见“卡在哪一步”速查

| 现象 | 大概率原因 | 去哪看 |
|------|-----------|--------|
| 前端启动即报缺少 `VITE_PUBLISHABLE_KEY` | 没填 `.env.local` | `docs/CONSOLE-STEPS.md` 第 4 步 |
| 登录报 `TICKET_UNAVAILABLE` | 自定义登录私钥没注入 | `docs/CONSOLE-STEPS.md` 第 2 步 |
| 云函数返回 `SERVICE_CREDENTIAL_MISSING` / `ENV_ID_MISSING` | 云函数环境变量没配 | `docs/CONSOLE-STEPS.md` 附录 A |
| 登录后读不到任何数据 | 用户名密码登录没开 / 会话角色不对 | `docs/CONSOLE-STEPS.md` 第 1 步 |

---

## 附：本手册的维护约定

- 每遇到一个“别人 fork 后也会踩”的坑，就新开一节，保持 **现象 → 原因 → 一条命令 / 明确指引** 的结构。
- 涉及密钥、环境 ID、私钥文件的内容**一律不写进本手册**，只写“去哪点、点完看到什么算成功”。
