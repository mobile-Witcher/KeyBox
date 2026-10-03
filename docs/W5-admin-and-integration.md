# Windows W5 批施工图（管理后台 + Windows 系统集成 · 收官批）

> 状态：待派工（W4 交付并验收后）
> 仓库：`F:\KeyBox-Windows`（C# / .NET 8 / WinUI 3）

## 契约来源（唯一权威）

| 来源 | 路径 | 用途 |
|---|---|---|
| 安卓已被验收的实现 | `F:\KeyBox-Android\app\src\main\java\com\keybox\app\ui\AdminScreen.kt` + `AdminViewModel.kt` | 直接移植的语义蓝本 |
| Web 契约 | `F:\KeyBox\src\lib\admin.ts` + `src\lib\api.ts` | 接口入参/返回 |
| Web 界面 | `F:\KeyBox\src\pages\AdminPage.tsx` | 交互与文案 |
| 云函数通道 | W4 将封装的 invokeFunction（与安卓 KbApi 同形） | 复用 |

## A 部分：管理后台（仅管理员）

### 1. 用户列表
- `POST /v1/rdb/rest/rpc/kb_admin_user_list`（Bearer access_token）—— **直连 RPC，不套云函数**
- 白名单字段：uid / username / status / created_at / item_count（无 role、无密文列）
- UI：ListView 卡片（用户名 + 状态胶囊 + uid 等宽小字 + 注册时间 + 条目数）+ 刷新按钮
- status 三态：active / disabled / deleted（deleted = 软删）

### 2. 邀请码（R02）
- 生成：invokeFunction("kbInviteCreate") → 码**展示一次**（等宽字体 + 背景块）+ 复制（**30s 自动清空剪贴板**，R25 同语义）
- 作废：kbInviteRevoke（二次确认）——**仅本次会话刚生成的码可作废**（kb_invites 对客户端零授权）
- 顶部「已开户 N / 上限 20」计数；满员琥珀提示条 + 禁用生成按钮（USER_LIMIT=20）

### 3. 用户停用 / 启用（R13）
- `PATCH /v1/rdb/rest/kb_users?uid=eq.{uid}`，**只提交 {status} 单列**（列级 GRANT(status) + RLS 兜底）
- 停用需二次确认（文案含「会话将在 ≤1 分钟内失效」）；启用直接执行
- 自己那一行不渲染停用/删除按钮（防呆）

### 4. 删除用户数据（R14）
- invokeFunction("kbAdminDeleteUserData")（唯一 service_role 路径）
- 二次确认含条目数 + 「不可撤销 / 置为 deleted」警示；`CANNOT_DELETE_SELF` 错误原样展示

### 权限与挂载
- `role === 'admin'` 才显示「管理」入口（复用安全面板同批的 fetchMyRole）；非 admin / 失败不显示
- ContentDialog 承载（照 W3 EditorFormControl 模式：UserControl + 每次新建）
- **界面纪律**：底栏常驻「管理员看不到任何人的密钥内容，仅可停用与删除」，全页无查看密钥入口

## B 部分：Windows 系统集成（W5 收尾，让原生端"像 Windows 应用"）

| 项 | 实现要点 |
|---|---|
| **系统托盘** | `H.NotifyIcon.WinUI` 或 Win32 `Shell_NotifyIcon` 包装；托盘菜单：显示/隐藏窗口、锁定、退出；关闭窗口默认最小化到托盘（可设置里改） |
| **全局快捷键** | `Windows.UI.Input` / Win32 `RegisterHotKey`（如 `Ctrl+Shift+K` 唤起窗口） |
| **开机自启** | 注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 或 `StartupTask`（MSIX 打包后推荐后者） |
| **原生通知** | `AppNotificationManager`（Windows App SDK）——同步完成/冲突待处理时通知 |
| **窗口状态记忆** | 记住窗口尺寸/位置到 `%APPDATA%\KeyBox\window.json`，下次打开还原 |
| **MSIX 打包** | `Windows Application Packaging Project` 或 `dotnet publish` + `MakeAppx`；CI 加 release 打包步骤；产物 `KeyBox-0.1.0-x64.msix` |
| **未签名 sideload 说明** | MSIX 需签名才能装；无证书时可提供「exe 直跑」或自签证书指引（写进 README） |

## 硬约束
1. `Kb1Crypto` 零改动（向量测试全绿保持）
2. 敏感值不入库；无新大依赖（托盘库若必需，选维护良好的小库并说明）
3. 全部复用 W1-W4 的 SessionManager / VaultService / 异常体系

## 验收标准（主理人独立复核）
- `dotnet test` 全绿（W1-W4 测试数不减少）；`dotnet build` 0 错误
- CI 全绿；compare API 验 `Kb1Crypto.cs` 零改动
- 特征抽查：kb_admin_user_list / kbInviteCreate / kbInviteRevoke / kbAdminDeleteUserData / status 三态 / 满员 20 / isSelf 防呆 / 管理员免责声明 / 托盘 / 快捷键 / 自启 / 窗口记忆 / MSIX 产物
- 汇报 commit + 文件清单 + 各集成项的注册方式与验证方式
