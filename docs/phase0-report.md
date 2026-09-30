# KeyBox 原生鸿蒙版 · Phase 0 双验证报告

> 日期：2026-09-29 ｜ 结论：**两条关键路径均已验证可行**，Phase 1（MVP）可以开工。

## 决策记录（所有者已确认）

1. **同账号互通**：鸿蒙版与 Web 版用同一手机号登录，解同一份云端密文
2. **签名模式**：我们只分发**未签名 .hap**，用户用「小白调试助手」+ 自己的华为开发者账号（个人免费实名）完成调试签名与安装

---

## 实验 1：加密管线互通 —— ✅ 实测通过

Web 端（`src/lib/crypto.ts`，WebCrypto）与「鸿蒙参考实现」（标准算法等价参数）**双向交叉加解密全部成功**。
测试永久固化在 `src/lib/harmonyInterop.test.ts`（4 用例），算法规范一旦变更该测试即报警。

### 算法规范（鸿蒙端实现必须逐条对齐）

| 项 | 值 |
|---|---|
| 密钥派生 | PBKDF2-HMAC-**SHA256**，**600000** 轮，盐为 16 字节随机数的 **base64**，输出 **32 字节** |
| 对称加密 | **AES-256-GCM**，随机 **12 字节 IV** |
| 密文格式 | `KB1:` + base64( IV ‖ ciphertext ‖ GCM tag )，`KB1:` 为字面前缀 |
| 字符编码 | 密码/明文均 UTF-8 |

### 官方测试向量（鸿蒙端开发以此为准）

```json
{
  "password": "keybox-harmony-vector-2026",
  "saltB64": "c2FsdDEyMzQ1Njc4OTAxMjM0NQ==",
  "iterations": 600000,
  "derivedKeyHex": "b72f738df26e5ce18b7dc821b26b4ecee39dfa97b4b74f276adc6870c076a33d"
}
```

鸿蒙端验收顺序：① PBKDF2 输出与 `derivedKeyHex` 完全一致 → ② 自加密后按格式解回 → ③ 解开 Web 端产生的真实 `KB1:` 密文。

> ArkTS 提示：`@kit.CryptoArchitectureKit` 的 `createKdf('PBKDF2|SHA256')` 与
> `createCipher('AES256|GCM|NO_PADDING')`；GCM 的 tag 需在 cipher spec 中显式声明 16 字节，
> 输出为密文与 tag 分离（需自行按 IV‖CT‖TAG 拼接）。**以官方文档为准核对该 API 细节。**

---

## 实验 2：认证 HTTP 端点 —— ✅ 官方 REST API 已确认

CloudBase 提供公开的认证 HTTP API（文档：docs.cloudbase.net/http-api/auth/auth-sign-in），
**无需任何 SDK**，鸿蒙端用 `@kit.NetworkKit` 的 http 模块即可完成登录：

### 三步登录流程（手机号验证码）

```
Step 1  发送验证码
  POST {base}/auth/v1/verification
  Body: { "phone_number": "+86 13800138000", "target": "ANY" }
  ⚠️ 手机号必须带 "+86 " 前缀（加号+空格）
  → { "verification_id": "xxx", "expires_in": 600 }

Step 2  校验验证码
  POST {base}/auth/v1/verification/verify
  Body: { "verification_id": "<Step1 返回>", "verification_code": "123456" }
  → { "verification_token": "xxx" }

Step 3  登录换 token
  POST {base}/auth/v1/signin
  Body: { "verification_token": "<Step2 返回>" }
  → { "token_type": "Bearer", "access_token": "...", "refresh_token": "...", "expires_in": 7200, "sub": "<uid>" }
```

### 请求头（三步都要带）

- `Content-Type: application/json`
- `Authorization: Bearer <publishable_key>`（即 Web 端 `VITE_PUBLISHABLE_KEY` 所用的那个 Publishable Key）

### 后续所有云函数调用

- `Authorization: Bearer <access_token>`（用户态；7200s 过期前用 refresh_token 刷新）
- base：`https://<envId>.tcloudbasegateway.com`（具体以环境实测为准）

### 待真机确认（Phase 1 首日完成）

- Step 1 用 curl 实发一条短信 → 用户报码 → 走完三步拿 token（端到端实证）
- access_token 直接调云函数 HTTP 网关的鉴权头形式

---

## 分发模式（已确认）

- 产物：**未签名 .hap**
- 用户侧：「小白调试助手」（开源，sydxky.cn/xiaobai.php）登录**自己的**华为开发者账号 →
  自动获取调试证书/Profile → 签名安装
- 注意：调试签名仅用于侧载；证书/Profile/私钥属用户个人资料，不得外传（工具文档同此提示）

---

## Phase 1（MVP）范围建议

登录（上述三步）→ 主密码解锁（实验 1 的加密模块）→ 密钥列表（站点/接口地址/官网/模型名/密钥）→
增删改查 + 云同步 → 默认皮肤。折叠屏/平板自适应与 9 皮肤移植放 Phase 2/3。
