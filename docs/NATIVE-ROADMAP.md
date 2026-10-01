# KeyBox 原生化路线图（C 路线：Windows WinUI 3 + Android Kotlin Compose）

> 状态：方案待确认。本文档是施工总纲，批准后按里程碑分批实施。
> 决策日期：2026-10-01。决策背景：鸿蒙端原生对齐（三批）验证了"原生体验天花板"的价值，用户决定 Windows 与 Android 同样原生化。

## 0. 终局架构

```
KeyBox（仓库，保留）
  ├─ 网页版（保留：API 契约参照系 + 应急入口，不再新增功能）
  ├─ Tauri exe（退役：被 WinUI 3 替代，Release 标记 deprecated）
  └─ src/lib/*（加密与 API 契约的唯一权威定义）
KeyBox-HarmonyOS（私有仓库，保留，ArkTS 原生）
KeyBox-Windows（新仓库，私有起步，C# / .NET 8 / WinUI 3）
KeyBox-Android（新仓库，私有起步，Kotlin / Jetpack Compose / Material 3）
```

最终形态：**Web + 三个原生端**。每次功能迭代的维护面：Web（契约）+ 三端各自实现 + 各自互通向量测试。

## 1. 加密契约移植（第一批次的核心，先于一切 UI）

### 1.1 算法映射

| 环节 | Web（权威定义） | Windows (.NET 8) | Android (Kotlin) |
|---|---|---|---|
| KDF | WebCrypto PBKDF2-SHA256, 600k 轮, 32 字节 | `Rfc2898DeriveBytes(password, salt, 600000, HashAlgorithmName.SHA256)`（**必须显式 SHA256**，默认是 SHA1） | `SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")` + `PBEKeySpec` |
| 对称 | WebCrypto AES-256-GCM | `System.Security.Cryptography.AesGcm`（.NET 5+ 内置） | `Cipher.getInstance("AES/GCM/NoPadding")` |
| 密文格式 | `KB1:<base64(iv‖ciphertext‖tag)>` | 同格式；注意 .NET `AesGcm` 的 tag 与 ciphertext 分离，拼回时**tag 追加在密文尾部**（与 WebCrypto 一致） | Java GCM 默认 tag 追加在密文尾部（与 WebCrypto 一致），`GCMParameterSpec(128, iv)` |
| verifier | 加密固定串 `KeyBox-Verify` 比对 | 同 | 同 |
| 恢复码盐 | 独立于 kdf_salt | 同 | 同 |

### 1.2 互通向量测试（每端的第一份代码）

以 `src/lib/harmonyInterop.test.ts` 的向量为唯一权威：
1. 测试密码 + 盐 → 派生密钥 hex 必须逐字节一致
2. 固定明文 + 密钥 → KB1 密文 base64 一致（含 iv 与 tag 位置）
3. KB1 密文 → 解密回原文一致
4. 恢复码向量（独立盐）

**未通过向量测试前，禁止写任何业务 UI。**

### 1.3 API 层（照鸿蒙 kbapi.ets 的 HTTP 契约移植）

- REST：`GET/POST/PATCH {API_BASE}/v1/rdb/rest/kb_secrets...`（PostgREST 风格，Bearer access_token）
- 云函数：`POST {API_BASE}/v1/functions/{name}`（Bearer access_token）——kbRotateMaster / kbInviteCreate / kbInviteRevoke / kbAdminDeleteUserData / kbGetMyRole / kbAckRecovery
- Auth：手机号+验证码登录、refresh_token 静默续期（端点在 tcb-api.tencentcloudapi.com，形态见 Web 端 auth 实现）
- Windows 用 `HttpClient`；Android 用 `OkHttp`（或 Ktor）

## 2. 功能基线（以鸿蒙端三批为对齐目标）

登录/验证码/会话持久化+静默续期 → 主密码解锁 → 密钥 CRUD（site/url/website/model/key/note/tags 全字段）→ 复制护栏（30s 清空）→ 本机搜索 → 分类过滤/管理 → 同步+冲突提示 → 安全面板（改主密码/恢复码/备份导入导出）→ 管理后台（邀请码/用户管理，仅管理员）。

各端额外原生能力：
- Windows：Windows Hello（生物解锁替代 PIN 的增强项）、系统托盘、全局快捷键、开机自启、原生通知
- Android：BiometricPrompt（指纹/面容）、系统分享、应用内更新、Material You 动态取色

## 3. 里程碑（每批交付可用增量，随时可止损）

### Android（先行——主力使用端，且 Kotlin/Compose 生态成熟度最高）

| 批 | 内容 | 里程碑验收 |
|---|---|---|
| A1 | 项目骨架（Compose/M3/主题令牌移植）+ 加密层+向量测试全绿 + 登录/验证码/会话持久化 | 能登录，重启免验证码 |
| A2 | 主密码解锁 + BiometricPrompt + PIN + 密钥列表只读（解密渲染） | 三层解锁可用，能看到明文 |
| A3 | CRUD + 编辑对话框 + 复制护栏 + 搜索 | 增删改查闭环 |
| A4 | 分类过滤/管理 + 同步/冲突 + 吸顶控制区 | 与网页功能对齐 |
| A5 | 安全面板（改主密码/恢复码）+ 备份导入导出 | 管理自给 |
| A6 | 管理后台 + 应用内更新 | 全功能对齐 |

### Windows（Android A1-A2 验证加密移植模式后启动）

| 批 | 内容 | 里程碑验收 |
|---|---|---|
| W1 | WinUI 3 骨架（Fluent/MVVM）+ 加密层+向量测试全绿 + 登录/会话 | 能登录 |
| W2 | 主密码解锁 + Windows Hello + 密钥列表只读 | 三层解锁可用 |
| W3 | CRUD + 搜索 + 分类 + 同步 | 与网页功能对齐 |
| W4 | 安全面板 + 备份 + 管理后台 | 全功能对齐 |
| W5 | Windows 集成（托盘/快捷键/自启/原生安装包 MSIX） | 原生分发 |

## 4. 工程与团队

- 每批 = 一名工程师（Agent）+ 我出施工图 + 我独立验证（构建 + 向量测试 + 特征抽查）——沿用鸿蒙三批的已验证流程。
- CI：`build-android.yml` 改造（gradle assembleRelease + 签名 secrets 已有）；新增 `build-windows.yml`（windows-latest runner + MSIX 打包）。
- 版本号策略：三原生端各自独立版本（Windows 0.1.0 / Android 0.1.0 起步），Release 统一 tag。

## 5. 风险与止损

| 风险 | 缓解 |
|---|---|
| .NET `AesGcm` 与 Java GCM 的 tag/iv 细节差异导致向量对不齐 | A1/W1 第一优先级就是向量测试；对不齐立即暴露，不影响已发布端 |
| 维护面 ×4（三原生 + Web） | 每批交付可用增量，任何批次后可止损（已发布端不受影响）；Web 冻结为契约参照系 |
| 证书误报（华为 WebView 特有）在原生端**自动消失**——原生 HTTP 栈无此问题 | — |
| 工程量：Android 六批 + Windows 五批 | 批内交付可用功能；批间顺序可按用户优先级调整 |

## 6. 需要所有者决策的点

1. 实施顺序：建议 **Android 先**（主力端、生态成熟）；Windows 在 A2 验证加密移植模式后启动
2. 仓库命名与可见性：KeyBox-Windows / KeyBox-Android 私有起步（沿用鸿蒙先例）
3. Tauri exe 的退役时点：建议 Android 全功能对齐后再标记 deprecated
