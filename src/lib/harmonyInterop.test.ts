/**
 * harmonyInterop.test.ts —— Phase 0 实验 1：鸿蒙端加密管线互通性验证（2026-09-29）。
 *
 * 背景所有者决策：原生鸿蒙版与 Web 版【同账号互通】——同一手机号登录，解开同一份云端密文。
 * 因此鸿蒙端（@kit.CryptoArchitectureKit）必须实现与 src/lib/crypto.ts **完全一致**的算法规范：
 *
 *   派生：PBKDF2-HMAC-SHA256，600000 轮，16 字节随机盐（base64 存储），输出 32 字节
 *   加密：AES-256-GCM，12 字节随机 IV
 *   密文：`KB1:` + base64( IV ‖ ciphertext ‖ GCM tag )
 *
 * 本测试用 Node 的 crypto 模块扮演「鸿蒙参考实现」（标准算法、等价参数），
 * 与 crypto.ts 的 WebCrypto 实现**双向交叉加解密**；并固化官方测试向量——
 * 鸿蒙端开发时：先让派生函数输出与向量相同的 hex，再做整链路互通测试。
 *
 * ★ 本测试长期保留：任何一侧改动算法参数（轮数/盐长/格式）都必须同步另一侧并让本测试通过。
 */
import { describe, expect, it } from "vitest";
import nodeCrypto from "node:crypto";
import { deriveMasterKey, encryptString, decryptString } from "./crypto";

/** 模拟鸿蒙端：PBKDF2 派生（node:crypto；与 ArkTS CryptoArchitectureKit 等价参数）。 */
function harmonyDeriveRaw(
  password: string,
  saltB64: string,
  iterations: number
): Buffer {
  return nodeCrypto.pbkdf2Sync(
    Buffer.from(password, "utf8"),
    Buffer.from(saltB64, "base64"),
    iterations,
    32,
    "sha256"
  );
}

/** 模拟鸿蒙端：AES-256-GCM 加密，输出 `KB1:` + base64(IV‖CT‖TAG)。 */
function harmonyEncrypt(raw: Buffer, plaintext: string): string {
  const iv = nodeCrypto.randomBytes(12);
  const cipher = nodeCrypto.createCipheriv("aes-256-gcm", raw, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "KB1:" + Buffer.concat([iv, ct, tag]).toString("base64");
}

/** 模拟鸿蒙端：AES-256-GCM 解密 `KB1:` 串。 */
function harmonyDecrypt(raw: Buffer, kb1: string): string {
  const data = Buffer.from(kb1.slice("KB1:".length), "base64");
  const iv = data.subarray(0, 12);
  const tag = data.subarray(data.length - 16);
  const ct = data.subarray(12, data.length - 16);
  const decipher = nodeCrypto.createDecipheriv("aes-256-gcm", raw, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// 官方测试向量（Phase 0 固化；鸿蒙端先对派生密钥 hex，再做整链路互通）。
export const VECTOR = {
  password: "keybox-harmony-vector-2026",
  saltB64: "c2FsdDEyMzQ1Njc4OTAxMjM0NQ==", // "salt123456789012345" 的 base64（16 字节）
  iterations: 600000,
  /** 32 字节派生密钥的 hex（Phase 0 固化于 2026-09-29，此后不得变更）。 */
  derivedKeyHex: "b72f738df26e5ce18b7dc821b26b4ecee39dfa97b4b74f276adc6870c076a33d",
};

describe("Phase 0 实验 1：Web ↔ 鸿蒙 加密管线互通", () => {
  const PASSWORD = "correct-horse-battery-staple";
  const SALT_B64 = "YWJjZGVmZ2hpamtsbW5vcA=="; // "abcdefghijklmnop" 的 base64（16 字节）
  const ITERATIONS = 600000;
  const PLAIN = "KeyBox interoperability 模型名 gpt-4o 深入测试";

  it("双向派生一致：Web 与鸿蒙参考实现对同一密码/盐派生出完全相同的 32 字节密钥", async () => {
    const web = await deriveMasterKey(PASSWORD, SALT_B64, ITERATIONS);
    const harmony = harmonyDeriveRaw(PASSWORD, SALT_B64, ITERATIONS);
    expect(Buffer.from(web.raw).equals(harmony)).toBe(true);
  });

  it("Web 加密 → 鸿蒙解密 ✓", async () => {
    const mk = await deriveMasterKey(PASSWORD, SALT_B64, ITERATIONS);
    const kb1 = await encryptString(mk.key, PLAIN);
    expect(kb1.startsWith("KB1:")).toBe(true);
    const raw = harmonyDeriveRaw(PASSWORD, SALT_B64, ITERATIONS);
    expect(harmonyDecrypt(raw, kb1)).toBe(PLAIN);
  });

  it("鸿蒙加密 → Web 解密 ✓", async () => {
    const raw = harmonyDeriveRaw(PASSWORD, SALT_B64, ITERATIONS);
    const kb1 = harmonyEncrypt(raw, PLAIN);
    const mk = await deriveMasterKey(PASSWORD, SALT_B64, ITERATIONS);
    expect(await decryptString(mk.key, kb1)).toBe(PLAIN);
  });

  it("官方测试向量：派生密钥 hex（鸿蒙端开发以此为准）", async () => {
    const raw = harmonyDeriveRaw(VECTOR.password, VECTOR.saltB64, VECTOR.iterations);
    if (VECTOR.derivedKeyHex === "REPLACE_AFTER_FIRST_RUN") {
      // 首次运行：打印向量，由开发者固化进本文件
      console.log("[harmony-vector] derivedKeyHex =", raw.toString("hex"));
    } else {
      expect(raw.toString("hex")).toBe(VECTOR.derivedKeyHex);
    }
  });
});
