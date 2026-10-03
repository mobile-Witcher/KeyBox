# KeyBox-Windows

KeyBox 四端（网页 / Windows / Android / HarmonyOS）端到端加密密钥保管箱的 **Windows 原生端**（替代原 Tauri 壳）。

- 语言 / 框架：C# / .NET 8 / **WinUI 3（Windows App SDK 1.5）**，MVVM（CommunityToolkit.Mvvm）
- 架构：`src/KeyBox.App`（WinUI 3 UI 壳） + `src/KeyBox.Core`（纯 .NET 类库：加密 / 网络 / 会话，不依赖 WinUI，可本地 `dotnet test`）
- 测试：`tests/KeyBox.Core.Tests`（xUnit）

## 加密互通（W1 核心交付物）

加密层与 Web 端 `src/lib/crypto.ts` / 鸿蒙端（`@kit.CryptoArchitectureKit`）**逐字节一致**，官方互通向量见
`F:\KeyBox\src\lib\harmonyInterop.test.ts`：

| 参数 | 值 |
| --- | --- |
| KDF | PBKDF2-HMAC-**SHA256**（⚠️ .NET 默认 SHA1，已显式指定） |
| 迭代 | 600000（下限 210000） |
| 盐 | 16 字节随机，base64 存储（`kb_users.kdf_salt`） |
| 对称 | AES-256-GCM |
| IV | 12 字节随机，内嵌密文 |
| 格式 | `KB1:` + base64( IV(12B) ‖ 密文 ‖ GCM 标签(16B) ) |

核心实现：`src/KeyBox.Core/Crypto/Kb1Crypto.cs`；向量测试：`tests/KeyBox.Core.Tests/CryptoVectorTests.cs`
（官方向量派生密钥 hex、Node 生成 KB1 的字节级互解、篡改/错钥拒绝）。

## 登录 / 会话

- 手机号验证码登录（照抄安卓 `AuthRepository.kt` / 鸿蒙 `auth.ets` 实测契约）：
  ① `POST /auth/v1/verification` → ② `POST /auth/v1/verification/verify` → ③ `POST /auth/v1/signin`；
  认证三步带 `Authorization: Bearer <publishable_key>` + `X-SDK-Version`。
- 静默续期：④ `POST /auth/v1/token`（**无 Authorization 头**，body 带 `client_id`/空 `client_secret`/`grant_type=refresh_token`），
  401 拦截器自动刷新重试一次（`AuthHttpHandler`）。
- 会话持久化：`%APPDATA%\KeyBox\session.json`（access/refresh/uid），重启免验证码。

## 本地配置（绝不入库）

敏感配置只存在于 **gitignore 的本地文件** `keys.json`（仓库根，或 `%APPDATA%\KeyBox\keys.json`，或环境变量
`KEYBOX_ENV_ID` / `KEYBOX_PUBLISHABLE_KEY`），由 `BuildConfig` 静态类按「环境变量 → keys.json」顺序读取。

```json
{ "ENV_ID": "...", "PUBLISHABLE_KEY": "..." }
```

## 密钥库 CRUD / 搜索 / 分类 / 同步（W3）

- **新增/编辑/删除**（ContentDialog 表单）：
  - 新增：`SecretCodec.serialize`（tags 空省略键）→ `EncryptToKb1` → `POST /v1/rdb/rest/kb_secrets`（key_epoch 当前）
  - 编辑：预填 → 重加密 → `PATCH /v1/rdb/rest/kb_secrets?id=eq.{id}`（key_epoch + updated_at 本机当前 ISO）
  - 删除：二次确认 → `DELETE /v1/rdb/rest/kb_secrets?id=eq.{id}`；site/key 必填、busy 禁用、**网络失败保留表单输入**
  - 409 / 代数冲突 → 「密钥代数已变化，请先同步」
- **本机搜索**：site/url/website/model/note/tags 小写包含（filterItems 逻辑），纯内存零网络；
  标题联动「我的密钥（可见/共 N）」；无匹配空态 + 清除按钮
- **分类过滤 + 管理**（R18）：工具栏下拉「全部密钥（N）」+各分类（N）；
  重命名/删除=逐条重加密 PATCH 上传，**失败收集后继续处理其余**；删除二次确认显示影响条数
- **双向同步 + 冲突**（照安卓 A4）：按 updated_at 比对（拉取/上传/冲突）；
  冲突对话框整体裁决「保留本机」=重加密上传 /「用服务端」=解密覆盖；未决冲突常驻提示条可点击
- 复制护栏（R25）、Windows Hello 解锁、401 自动刷新（W1/W2）保持不变

## 构建与测试

```bash
dotnet restore KeyBox-Windows.sln
dotnet test tests/KeyBox.Core.Tests/KeyBox.Core.Tests.csproj -c Release
dotnet build KeyBox-Windows.sln -c Release -p:Platform=x64
```

CI：`.github/workflows/build.yml`（windows-latest：`build-and-test` 做 restore/test/build；`package-msix` 产出 MSIX 制品）。

## 构建、测试与打包

```bash
# 测试 + 构建
dotnet test tests/KeyBox.Core.Tests/KeyBox.Core.Tests.csproj -c Release
dotnet build KeyBox-Windows.sln -c Release -p:Platform=x64

# MSIX 打包（未签名 sideload 包）
pwsh -File scripts/package-msix.ps1            # 产物：artifacts/KeyBox-0.1.0.0-x64.msix
```

> MSIX 打包用 Windows App SDK 单项目流程，`MakeAppx` / `SignTool` 来自
> `Microsoft.Windows.SDK.BuildTools` NuGet 包，**无需预装 Windows SDK**。

## 安装（未签名 sideload）

CI 产出的 MSIX **未签名**（仓库不保存任何证书）。Windows 要求包必须签名才能安装，
本地自签 + sideload 步骤：

```powershell
# 1) 创建自签证书（一次性；CN 必须与 Package.appxmanifest 的 Publisher=CN=KeyBox 一致）
$pw = "CN=KeyBox"
New-SelfSignedCertificate -Type Custom -Subject $pw -KeyUsage DigitalSignature `
  -FriendlyName "KeyBox MSIX" -CertStoreLocation Cert:\CurrentUser\My

# 2) 导出 .cer（安装端需信任同一证书）
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $pw } | Select-Object -First 1
Export-Certificate -Cert $cert -FilePath .\KeyBox.cer

# 3) 签名 MSIX（SignTool 来自 NuGet 包路径）
& "$env:USERPROFILE\.nuget\packages\microsoft.windows.sdk.buildtools\10.0.22621.756\bin\10.0.22621.0\x64\signtool.exe" `
  sign /fd SHA256 /a /f .\KeyBox.pfx /p <证书密码> .\artifacts\KeyBox-0.1.0.0-x64.msix

# 4) 安装（先双击 .cer 装到「受信任的根证书颁发机构」并重启资源管理器/注销，再装 MSIX）
Add-AppxPackage .\artifacts\KeyBox-0.1.0.0-x64.msix
```

不想折腾证书时，可直接跑未打包形态（功能等价，仅缺 MSIX 包身份）：

```bash
dotnet publish src/KeyBox.App/KeyBox.App.csproj -c Release -p:Platform=x64
# 运行 publish 目录下的 KeyBox.App.exe
```

> 包身份差异：有 MSIX 身份时原生通知（同步/冲突提醒）可用；未打包形态通知静默降级，其余功能不受影响。

## Windows 系统集成

| 项 | 注册方式 | 验证方式 |
| --- | --- | --- |
| 系统托盘 | `H.NotifyIcon.WinUI` 2.0.131（MainWindow 构造时创建，菜单：显示/隐藏/立即锁定/退出） | 启动后任务栏托盘出现图标；关闭窗口不退出而是隐藏到托盘 |
| 关闭窗口最小化到托盘 | `AppWindow.Closing` 拦截 + `Hide()`；设置面板可关（`settings.json`） | 关窗后进程仍在；托盘「显示」可恢复 |
| 全局快捷键 Ctrl+Shift+K | Win32 `RegisterHotKey` + `SetWindowSubclass` 钩 `WM_HOTKEY`；退出时 `UnregisterHotKey` | 任意应用按 Ctrl+Shift+K 唤起窗口；托盘「退出」后失效 |
| 开机自启 | 注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` | 设置面板开关；`reg query` 该键可见 `KeyBox` 值 |
| 原生通知 | `AppNotificationManager`（同步完成/冲突待处理） | 需 MSIX 包身份；未打包形态静默降级 |
| 窗口状态记忆 | `%APPDATA%\KeyBox\window.json` | 移动/缩放窗口后重启，位置尺寸还原；拔掉副屏会自动夹回主屏 |

## 交付范围

- [x] 加密层（KB1 向量全绿，保持逐字节通过）
- [x] 手机验证码登录 + 倒计时 + 会话持久化 + 401 自动刷新
- [x] 主密码解锁 + Windows Hello 解锁（DPAPI 包裹 + 降级）
- [x] 密钥列表只读 + 复制护栏（30s 自动清空剪贴板）
- [x] 新增/编辑/删除（ContentDialog）+ 代数冲突提示
- [x] 本机搜索 + 分类过滤/重命名/删除
- [x] 双向同步 + 冲突裁决
- [ ] MSIX 打包（W5）


