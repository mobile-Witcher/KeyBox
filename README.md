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

## 主密码解锁 + Windows Hello（W2）

- **主密码解锁**：`UnlockService` 拉取 `GET /v1/rdb/rest/kb_users?select=kdf_salt,kdf_verifier,key_epoch&uid=eq.{uid}`
  （Bearer access_token）→ `DeriveKey` → `DecryptFromKb1(kdf_verifier) == "KeyBox-Verify"` → 主密钥进**内存单例**（`MasterKeySession`，绝不持久化）。
  失败只提示「主密码错误」，不暴露具体原因（网络/账号错误单独区分）。
- **Windows Hello 解锁**（替代安卓 BiometricPrompt）：
  - 首次主密码解锁成功后引导启用 → `UserConsentVerifier` 验证 → DPAPI（`ProtectedData`，CurrentUser 作用域）包裹主密钥 → `%APPDATA%\KeyBox\hello.bin`
  - 解锁页有包裹物时**优先弹 Windows Hello**，通过即解包直进密钥库（epoch 以服务端为准）；不可用/未通过自动降级主密码
- **密钥列表只读**：`GET /v1/rdb/rest/kb_secrets?select=id,payload,key_epoch,updated_at&owner_id=eq.{uid}&order=updated_at.desc`
  → 逐条解密 → 单列详情卡（站点名 + 域名·分类 + 脱敏密钥 `sk-c8ab…9f2e` + 复制）。
- **复制护栏**（照安卓 R25）：复制密钥后 30 秒倒计时，到点真正清空剪贴板；重复复制重置倒计时。
- 401 拦截器（W1 的 `AuthHttpHandler`）直接承载 RDB 请求：自动附加 Bearer 并静默续期重试。

## 构建与测试

```bash
dotnet restore KeyBox-Windows.sln
dotnet test tests/KeyBox.Core.Tests/KeyBox.Core.Tests.csproj -c Release
dotnet build KeyBox-Windows.sln -c Release -p:Platform=x64
```

CI：`.github/workflows/build.yml`（windows-latest：restore → test → build）。

## 交付范围

- [x] 加密层（KB1 向量全绿，35 项保持）
- [x] 手机验证码登录 + 倒计时 + 会话持久化 + 401 自动刷新
- [x] 主密码解锁（拉 KeyInfo + verifier 校验 + 内存单例）
- [x] Windows Hello 解锁（DPAPI 包裹 + 自动弹验证 + 降级主密码）
- [x] 密钥列表只读（解密渲染 + 复制护栏 30s 清空 + 刷新）
- [ ] 密钥编辑/删除/新增 + 完整同步（W3）
- [ ] MSIX 打包（W5）

