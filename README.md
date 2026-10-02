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

CI：`.github/workflows/build.yml`（windows-latest：restore → test → build）。

## 交付范围

- [x] 加密层（KB1 向量全绿，保持逐字节通过）
- [x] 手机验证码登录 + 倒计时 + 会话持久化 + 401 自动刷新
- [x] 主密码解锁 + Windows Hello 解锁（DPAPI 包裹 + 降级）
- [x] 密钥列表只读 + 复制护栏（30s 自动清空剪贴板）
- [x] 新增/编辑/删除（ContentDialog）+ 代数冲突提示
- [x] 本机搜索 + 分类过滤/重命名/删除
- [x] 双向同步 + 冲突裁决
- [ ] MSIX 打包（W5）


