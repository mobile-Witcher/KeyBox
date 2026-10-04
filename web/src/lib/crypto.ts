/**
 * crypto.ts —— KeyBox 客户端加解密（架构 §6 的唯一落地实现，也是唯一接触密钥的文件）。
 *
 * 硬约束 3：只用 WebCrypto 标准库（crypto.subtle），禁止自研算法，也不自己实现 AES/PBKDF2。
 *
 * 参数（架构 §6 参数表，逐条对应）：
 *   - 派生算法：PBKDF2-HMAC-SHA256（NIST 认可的标准 KDF）
 *   - 随机盐：16 字节，每账号一份，存 kb_users.kdf_salt
 *   - 迭代次数：600000（OWASP 量级）；桌面实测超 1 秒可降，但下限 210000
 *   - 对称加密：AES-256-GCM（自带防篡改校验）
 *   - IV：每次加密随机 12 字节，内嵌在密文里
 *   - 密文格式：`KB1:` + base64( IV(12B) ‖ 密文 ‖ GCM 标签 )
 *
 * R28 恢复码原语（本轮只做加密层，界面入口留到第 6/7 步）：
 *   - 恢复码：32 字符标准 base32，分组便于抄写
 *   - 独立 recovery_salt（不得复用 kdf_salt）
 *   - RK = PBKDF2(恢复码, recovery_salt)
 *   - recoveryBlob = `KBRC1:` + base64( IV ‖ AES-GCM(RK, MK) )
 *   - 以及用恢复码解锁 MK 的反向流程
 *
 * R29 备份导出编解码：
 *   - `KBBK1:` + base64( IV ‖ AES-GCM(MK, JSON) )
 *   - JSON 含导出时间、全部 payload 密文与 key_epoch、kdf_salt、kdf_verifier
 *   - 本轮只做编解码与加解密函数（导入/导出界面留到后续步骤）
 */

/** 生产迭代次数（架构 §6）。 */
export const PBKDF2_ITERATIONS = 600000;
/** 迭代次数下限（架构 §6：为流畅降速也不得低于此值）。 */
export const PBKDF2_ITERATIONS_MIN = 210000;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const GCM_KEY_BITS = 256;
const IV_PLUS_CT_MIN = IV_BYTES + 16; // IV + 至少 16 字节 GCM 标签

/** 主密钥校验用的固定串（架构 §6.1 第 3 步）。它不是密钥，只是“解对了没”的判据。 */
export const VERIFIER_PLAINTEXT = "KeyBox-Verify";

export const SECRET_PREFIX = "KB1:";
export const RECOVERY_PREFIX = "KBRC1:";
export const BACKUP_PREFIX = "KBBK1:";

/** RFC 4648 标准 base32 字母表（去掉易混字符）。 */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const RECOVERY_CODE_LENGTH = 32;
const RECOVERY_GROUP_SIZE = 4;

/** 主密钥：CryptoKey 用于加解密，raw 字节用于被恢复码包裹与生成备份。 */
export interface MasterKey {
  key: CryptoKey;
  raw: Uint8Array;
}

// ---------------------------------------------------------------------------
// 字节 / base64 工具（不涉及任何算法创新，仅做编码转换）
// ---------------------------------------------------------------------------

/** 生成 n 字节密码学随机数（crypto.getRandomValues 是平台标准熵源）。 */
export function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** Uint8Array → base64。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** base64 → Uint8Array。 */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * 把 Uint8Array 交给 WebCrypto。
 * 说明：较新的 TypeScript DOM lib 把 BufferSource 收窄为“ArrayBuffer 背书的视图”，
 * 而我们的数组来自 getRandomValues / .slice()，运行时都是 ArrayBuffer 背书；此处仅做类型适配，
 * 不改变任何字节内容，也不涉及算法实现。
 */
function buf(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

/** 拼接多个字节数组。 */
function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// PBKDF2 派生
// ---------------------------------------------------------------------------

/** 用 PBKDF2-HMAC-SHA256 把密码/恢复码派生成 32 字节。 */
async function pbkdf2(
  secret: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error("迭代次数必须为正整数");
  }
  const baseKey = await crypto.subtle.importKey(
    "raw",
    buf(new TextEncoder().encode(secret)),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: buf(salt), iterations, hash: "SHA-256" },
    baseKey,
    GCM_KEY_BITS
  );
  return new Uint8Array(bits);
}

/** 由 32 字节原始密钥导入为 AES-GCM CryptoKey（不可导出，减少泄露面）。 */
async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", buf(raw), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

// ---------------------------------------------------------------------------
// AES-256-GCM 加解密（核心）
// ---------------------------------------------------------------------------

/** AES-GCM 加密，返回 IV‖密文（WebCrypto 的输出已包含 GCM 标签）。 */
async function aesGcmEncrypt(
  key: CryptoKey,
  plaintext: Uint8Array
): Promise<Uint8Array> {
  const iv = randomBytes(IV_BYTES);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: buf(iv) },
    key,
    buf(plaintext)
  );
  return concatBytes(iv, new Uint8Array(cipher));
}

/** AES-GCM 解密，入参为 IV‖密文（含标签）。 */
async function aesGcmDecrypt(key: CryptoKey, boxed: Uint8Array): Promise<Uint8Array> {
  if (boxed.length < IV_PLUS_CT_MIN) {
    throw new Error("密文长度不足，疑似被截断");
  }
  const iv = boxed.slice(0, IV_BYTES);
  const cipher = boxed.slice(IV_BYTES);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: buf(iv) },
    key,
    buf(cipher)
  );
  return new Uint8Array(plain);
}

// ---------------------------------------------------------------------------
// 对外：主密钥派生 / 校验 / 密文串
// ---------------------------------------------------------------------------

/** 生成 16 字节随机盐并返回 base64（存 kb_users.kdf_salt）。 */
export function generateSaltB64(): string {
  return bytesToBase64(randomBytes(SALT_BYTES));
}

/** 由主密码 + 盐派生主密钥（架构 §6.1 第 2 步；结果只应活在内存）。 */
export async function deriveMasterKey(
  password: string,
  saltB64: string,
  iterations: number = PBKDF2_ITERATIONS
): Promise<MasterKey> {
  if (!password) throw new Error("主密码不能为空");
  const raw = await pbkdf2(password, base64ToBytes(saltB64), iterations);
  const key = await importAesKey(raw);
  return { key, raw };
}

/** 直接用派生出的 32 字节原始密钥构造 MasterKey（恢复码/备份还原路径用）。 */
export async function masterKeyFromRaw(raw: Uint8Array): Promise<MasterKey> {
  const copy = new Uint8Array(raw); // 拷贝，避免外部持有可变的同一底层缓冲
  const key = await importAesKey(copy);
  return { key, raw: copy };
}

/** 把明文字符串加密成 `KB1:` 串（用于 payload）。 */
export async function encryptString(key: CryptoKey, plaintext: string): Promise<string> {
  const boxed = await aesGcmEncrypt(key, new TextEncoder().encode(plaintext));
  return SECRET_PREFIX + bytesToBase64(boxed);
}

/** 解开 `KB1:` 串；前缀不对或密文被改都会失败（GCM 自带完整性校验）。 */
export async function decryptString(key: CryptoKey, kb1: string): Promise<string> {
  if (!kb1.startsWith(SECRET_PREFIX)) {
    throw new Error(`密文前缀不是 ${SECRET_PREFIX}`);
  }
  const boxed = base64ToBytes(kb1.slice(SECRET_PREFIX.length));
  const plain = await aesGcmDecrypt(key, boxed);
  return new TextDecoder().decode(plain);
}

/** 生成 kdf_verifier：用主密钥加密固定串（不含任何真实密钥）。 */
export async function createKeyVerifier(masterKey: MasterKey): Promise<string> {
  return encryptString(masterKey.key, VERIFIER_PLAINTEXT);
}

/**
 * 本机校验主密码是否正确：解 kdf_verifier 能解出固定串即正确（架构 §6.2）。
 * 失败一律返回 false，不抛出细节，避免把“为什么失败”暴露给日志。
 */
export async function verifyMasterPassword(
  password: string,
  saltB64: string,
  verifier: string,
  iterations: number = PBKDF2_ITERATIONS
): Promise<boolean> {
  try {
    const mk = await deriveMasterKey(password, saltB64, iterations);
    const plain = await decryptString(mk.key, verifier);
    return plain === VERIFIER_PLAINTEXT;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// R28 恢复码原语
// ---------------------------------------------------------------------------

/** 用拒绝采样生成无偏的 base32 随机串（不做取模压缩，避免分布偏斜）。 */
function randomBase32(length: number): string {
  const alphabetLen = BASE32_ALPHABET.length; // 32
  const maxUnbiased = 256 - (256 % alphabetLen); // 256 是 32 的整数倍，故此处恒为 256
  let out = "";
  while (out.length < length) {
    const buf = randomBytes(length - out.length + 8);
    for (let i = 0; i < buf.length && out.length < length; i += 1) {
      if (buf[i] < maxUnbiased) {
        out += BASE32_ALPHABET[buf[i] % alphabetLen];
      }
    }
  }
  return out;
}

/** 生成恢复码原始串（32 字符、无分隔）。 */
export function generateRecoveryCodeRaw(): string {
  return randomBase32(RECOVERY_CODE_LENGTH);
}

/** 把恢复码按 4 字符一组分组，便于抄写，例如 XXXX-XXXX-…（8 组）。 */
export function formatRecoveryCode(rawCode: string): string {
  const groups: string[] = [];
  const normalized = rawCode.toUpperCase().replace(/[^A-Z2-7]/g, "");
  for (let i = 0; i < normalized.length; i += RECOVERY_GROUP_SIZE) {
    groups.push(normalized.slice(i, i + RECOVERY_GROUP_SIZE));
  }
  return groups.join("-");
}

/** 规整用户输入的恢复码：去分隔符、转大写，容忍空格与连字符。 */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

/** 生成“可直接展示给用户”的恢复码（含分组）。 */
export function generateRecoveryCode(): string {
  return formatRecoveryCode(generateRecoveryCodeRaw());
}

/** 由恢复码 + 独立 recovery_salt 派生恢复密钥 RK（32 字节）。 */
export async function deriveRecoveryKeyRaw(
  recoveryCode: string,
  recoverySaltB64: string,
  iterations: number = PBKDF2_ITERATIONS
): Promise<Uint8Array> {
  const code = normalizeRecoveryCode(recoveryCode);
  if (code.length !== RECOVERY_CODE_LENGTH) {
    throw new Error("恢复码长度必须为 32 个 base32 字符");
  }
  return pbkdf2(code, base64ToBytes(recoverySaltB64), iterations);
}

/**
 * 用恢复码把主密钥（原始字节）包裹成 `KBRC1:` 串。
 *
 * 入口**强校验**：`recoverySalt` 必须独立于 `kdf_salt`（架构 §6 要求，不得复用）。
 * 早先这里只把“两盐不同”当作调用方口头契约（A4 复核发现）；现改为**函数入口显式校验并抛错**，
 * 避免将来接 R28 恢复码 UI 时误把 kdf_salt 拿来当 recovery_salt，导致恢复码安全性退化。
 *
 * @param kdfSaltB64 账号的主密码派生盐（kb_users.kdf_salt，base64）。**仅用于与 recoverySalt 做不同性校验，不参与派生。**
 */
export async function wrapMasterKeyWithRecovery(
  recoveryCode: string,
  recoverySaltB64: string,
  kdfSaltB64: string,
  masterKeyRaw: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS
): Promise<string> {
  if (recoverySaltB64 === kdfSaltB64) {
    throw new Error("recovery_salt 必须独立于 kdf_salt（不得复用主密码派生盐）");
  }
  const rk = await deriveRecoveryKeyRaw(recoveryCode, recoverySaltB64, iterations);
  const rkKey = await importAesKey(rk);
  const boxed = await aesGcmEncrypt(rkKey, masterKeyRaw);
  return RECOVERY_PREFIX + bytesToBase64(boxed);
}

/**
 * 反向流程：用恢复码解开 `KBRC1:` 串，取回主密钥原始字节。
 * 恢复码输错或密文被改都会在此失败（GCM 校验），调用方据此提示“恢复码无效”。
 */
export async function unwrapMasterKeyWithRecovery(
  recoveryCode: string,
  recoverySaltB64: string,
  recoveryBlob: string,
  iterations: number = PBKDF2_ITERATIONS
): Promise<Uint8Array> {
  if (!recoveryBlob.startsWith(RECOVERY_PREFIX)) {
    throw new Error(`恢复码密文前缀不是 ${RECOVERY_PREFIX}`);
  }
  const rk = await deriveRecoveryKeyRaw(recoveryCode, recoverySaltB64, iterations);
  const rkKey = await importAesKey(rk);
  const boxed = base64ToBytes(recoveryBlob.slice(RECOVERY_PREFIX.length));
  return aesGcmDecrypt(rkKey, boxed);
}

// ---------------------------------------------------------------------------
// R29 备份编解码
// ---------------------------------------------------------------------------

/** 备份中的单条记录（payload 已是 KB1 密文，不含明文）。 */
export interface BackupItem {
  id: number;
  payload: string;
  keyEpoch: number;
}

/** 备份文件解开后的明文结构（仍只含密文 payload）。 */
export interface BackupPlain {
  version: 1;
  exportedAt: string;
  keyEpoch: number;
  kdfSalt: string;
  kdfVerifier: string;
  items: BackupItem[];
}

/** 生成加密备份文件：`KBBK1:` + base64( IV ‖ AES-GCM(MK, JSON) )。 */
export async function buildBackup(
  masterKey: MasterKey,
  input: {
    items: BackupItem[];
    kdfSalt: string;
    kdfVerifier: string;
    keyEpoch: number;
    exportedAt?: string;
  }
): Promise<string> {
  const plain: BackupPlain = {
    version: 1,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    keyEpoch: input.keyEpoch,
    kdfSalt: input.kdfSalt,
    kdfVerifier: input.kdfVerifier,
    items: input.items.map((item) => ({
      id: item.id,
      payload: item.payload,
      keyEpoch: item.keyEpoch,
    })),
  };
  const boxed = await aesGcmEncrypt(
    masterKey.key,
    new TextEncoder().encode(JSON.stringify(plain))
  );
  return BACKUP_PREFIX + bytesToBase64(boxed);
}

/** 用主密钥解开备份文件，返回明文结构；文件被改或主密码不对都会失败。 */
export async function openBackup(masterKey: MasterKey, backup: string): Promise<BackupPlain> {
  if (!backup.startsWith(BACKUP_PREFIX)) {
    throw new Error(`备份文件前缀不是 ${BACKUP_PREFIX}`);
  }
  const boxed = base64ToBytes(backup.slice(BACKUP_PREFIX.length));
  const plain = await aesGcmDecrypt(masterKey.key, boxed);
  const parsed = JSON.parse(new TextDecoder().decode(plain)) as BackupPlain;
  if (parsed.version !== 1 || !Array.isArray(parsed.items)) {
    throw new Error("备份文件结构非法");
  }
  return parsed;
}
