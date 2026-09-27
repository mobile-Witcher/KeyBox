/**
 * crypto.test.ts —— 加密层单元测试（架构 §10 第 5 步验收项）。
 *
 * 纪律（硬约束 4）：
 *   - 测试密码/恢复码一律“随机生成”，绝不写死任何字面量密码或密钥。
 *   - 测试只断言行为（派生差异、校验成功/失败、还原一致），不落任何密钥到文件。
 *
 * 迭代次数：为让测试在可接受时间内跑完，这里显式使用下限 PBKDF2_ITERATIONS_MIN（210000），
 * 与生产默认值 600000 属于同一代码路径（仅次数不同），不影响原语正确性验证。
 */
import { describe, expect, it } from "vitest";
import {
  PBKDF2_ITERATIONS_MIN,
  RECOVERY_PREFIX,
  buildBackup,
  createKeyVerifier,
  decryptString,
  deriveMasterKey,
  deriveRecoveryKeyRaw,
  encryptString,
  formatRecoveryCode,
  generateRecoveryCode,
  generateSaltB64,
  masterKeyFromRaw,
  normalizeRecoveryCode,
  openBackup,
  randomBytes,
  unwrapMasterKeyWithRecovery,
  verifyMasterPassword,
  wrapMasterKeyWithRecovery,
  type BackupItem,
} from "./crypto";

const ITER = PBKDF2_ITERATIONS_MIN;

/** 生成随机测试密码：32 字节随机数转 base64。随机来源是平台标准熵源。 */
function randomPassword(): string {
  let binary = "";
  const bytes = randomBytes(32);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

describe("PBKDF2 主密钥派生", () => {
  it("同一主密码、不同盐 → 派生结果不同（R06）", async () => {
    const password = randomPassword();
    const saltA = generateSaltB64();
    const saltB = generateSaltB64();
    expect(saltA).not.toEqual(saltB);

    const mkA = await deriveMasterKey(password, saltA, ITER);
    const mkB = await deriveMasterKey(password, saltB, ITER);

    expect(Array.from(mkA.raw)).not.toEqual(Array.from(mkB.raw));
  });

  it("同一主密码、同一盐 → 派生结果一致（幂等）", async () => {
    const password = randomPassword();
    const salt = generateSaltB64();
    const mk1 = await deriveMasterKey(password, salt, ITER);
    const mk2 = await deriveMasterKey(password, salt, ITER);
    expect(Array.from(mk1.raw)).toEqual(Array.from(mk2.raw));
  });
});

describe("主密码校验（kdf_verifier）", () => {
  it("正确主密码能解开 kdf_verifier（R10 验收）", async () => {
    const password = randomPassword();
    const salt = generateSaltB64();
    const mk = await deriveMasterKey(password, salt, ITER);
    const verifier = await createKeyVerifier(mk);

    expect(verifier.startsWith("KB1:")).toBe(true);
    await expect(verifyMasterPassword(password, salt, verifier, ITER)).resolves.toBe(true);
  });

  it("错误主密码失败（R10 验收）", async () => {
    const password = randomPassword();
    const wrong = randomPassword();
    expect(wrong).not.toEqual(password);

    const salt = generateSaltB64();
    const mk = await deriveMasterKey(password, salt, ITER);
    const verifier = await createKeyVerifier(mk);

    await expect(verifyMasterPassword(wrong, salt, verifier, ITER)).resolves.toBe(false);
  });

  it("verifier 被篡改 → 校验失败（GCM 完整性）", async () => {
    const password = randomPassword();
    const salt = generateSaltB64();
    const mk = await deriveMasterKey(password, salt, ITER);
    const verifier = await createKeyVerifier(mk);

    // 最后 4 个 base64 字符改成别的合法字符
    const tampered = verifier.slice(0, -4) + (verifier.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expect(verifyMasterPassword(password, salt, tampered, ITER)).resolves.toBe(false);
  });
});

describe("密钥条目加解密（KB1）", () => {
  it("加解密往返一致，且同明文两次密文不同（随机 IV）", async () => {
    const mk = await deriveMasterKey(randomPassword(), generateSaltB64(), ITER);
    const plaintext = JSON.stringify({ site: "openai", url: "https://api.openai", key: randomPassword() });

    const c1 = await encryptString(mk.key, plaintext);
    const c2 = await encryptString(mk.key, plaintext);

    expect(c1.startsWith("KB1:")).toBe(true);
    expect(c1).not.toEqual(c2); // 每次随机 IV，密文必不同
    await expect(decryptString(mk.key, c1)).resolves.toBe(plaintext);
    await expect(decryptString(mk.key, c2)).resolves.toBe(plaintext);
  });

  it("密文被篡改 → 解密失败", async () => {
    const mk = await deriveMasterKey(randomPassword(), generateSaltB64(), ITER);
    const c = await encryptString(mk.key, "hello");
    const body = c.slice(4);
    const tampered = "KB1:" + body.slice(0, -2) + (body.endsWith("AA") ? "BB" : "AA");
    await expect(decryptString(mk.key, tampered)).rejects.toBeTruthy();
  });
});

describe("R28 恢复码原语", () => {
  it("恢复码为 32 字符 base32、分组展示，且规整化可还原", () => {
    const shown = generateRecoveryCode();
    const normalized = normalizeRecoveryCode(shown);
    expect(normalized).toHaveLength(32);
    expect(normalized).toMatch(/^[A-Z2-7]{32}$/);
    expect(formatRecoveryCode(normalized)).toEqual(shown);
  });

  it("恢复码能解出主密钥（R28 验收）", async () => {
    const password = randomPassword();
    const kdfSalt = generateSaltB64();
    const mk = await deriveMasterKey(password, kdfSalt, ITER);

    // 独立 recovery_salt，绝不复用 kdf_salt
    const recoverySalt = generateSaltB64();
    expect(recoverySalt).not.toEqual(kdfSalt);

    const recoveryCode = generateRecoveryCode();
    const blob = await wrapMasterKeyWithRecovery(recoveryCode, recoverySalt, mk.raw, ITER);
    expect(blob.startsWith(RECOVERY_PREFIX)).toBe(true);

    const recoveredRaw = await unwrapMasterKeyWithRecovery(recoveryCode, recoverySalt, blob, ITER);
    expect(Array.from(recoveredRaw)).toEqual(Array.from(mk.raw));

    // 解出的原始密钥确实能解开原主密钥加密的内容
    const cipher = await encryptString(mk.key, "secret-value");
    const rebuilt = await masterKeyFromRaw(recoveredRaw);
    await expect(decryptString(rebuilt.key, cipher)).resolves.toBe("secret-value");
  });

  it("错误恢复码无法解出主密钥", async () => {
    const mk = await deriveMasterKey(randomPassword(), generateSaltB64(), ITER);
    const recoverySalt = generateSaltB64();
    const rightCode = generateRecoveryCode();
    const blob = await wrapMasterKeyWithRecovery(rightCode, recoverySalt, mk.raw, ITER);

    let wrongCode = generateRecoveryCode();
    while (normalizeRecoveryCode(wrongCode) === normalizeRecoveryCode(rightCode)) {
      wrongCode = generateRecoveryCode();
    }
    await expect(
      unwrapMasterKeyWithRecovery(wrongCode, recoverySalt, blob, ITER)
    ).rejects.toBeTruthy();
  });

  it("恢复码长度不足时拒绝派生", async () => {
    await expect(deriveRecoveryKeyRaw("SHORT", generateSaltB64(), ITER)).rejects.toBeTruthy();
  });
});

describe("R29 备份编解码", () => {
  it("备份文件能还原（R29 验收）", async () => {
    const password = randomPassword();
    const kdfSalt = generateSaltB64();
    const mk = await deriveMasterKey(password, kdfSalt, ITER);
    const verifier = await createKeyVerifier(mk);

    const items: BackupItem[] = [
      { id: 1, payload: await encryptString(mk.key, JSON.stringify({ site: "a", key: randomPassword() })), keyEpoch: 0 },
      { id: 2, payload: await encryptString(mk.key, JSON.stringify({ site: "b", key: randomPassword() })), keyEpoch: 0 },
    ];

    const backup = await buildBackup(mk, {
      items,
      kdfSalt,
      kdfVerifier: verifier,
      keyEpoch: 0,
    });
    expect(backup.startsWith("KBBK1:")).toBe(true);

    // 备份文件用文本形态看不含任何明文字段名（整块密文）
    expect(backup).not.toContain("site");

    const restored = await openBackup(mk, backup);
    expect(restored.version).toBe(1);
    expect(restored.kdfSalt).toBe(kdfSalt);
    expect(restored.kdfVerifier).toBe(verifier);
    expect(restored.items).toHaveLength(2);
    expect(restored.items.map((i) => i.id)).toEqual([1, 2]);

    // 还原后的 payload 能用同一主密钥解开，内容与导出时一致
    const first = await decryptString(mk.key, restored.items[0].payload);
    expect(JSON.parse(first).site).toBe("a");
  });

  it("主密码不对（另一把主密钥）无法打开备份", async () => {
    const mk = await deriveMasterKey(randomPassword(), generateSaltB64(), ITER);
    const otherMk = await deriveMasterKey(randomPassword(), generateSaltB64(), ITER);
    const backup = await buildBackup(mk, {
      items: [],
      kdfSalt: generateSaltB64(),
      kdfVerifier: "KB1:xxxx",
      keyEpoch: 0,
    });
    await expect(openBackup(otherMk, backup)).rejects.toBeTruthy();
  });
});
