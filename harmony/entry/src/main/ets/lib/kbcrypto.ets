/**
 * kbcrypto.ets —— KB1 加解密（与 Web 端 src/lib/crypto.ts 字节级对齐）。
 *
 * 算法规范（与 src/lib/harmonyInterop.test.ts 的测试向量绑定，任何一侧改动必须同步）：
 *   派生：PBKDF2-HMAC-SHA256，600000 轮，盐 = 16 字节随机数的 base64，输出 32 字节
 *   加密：AES-256-GCM，随机 12 字节 IV，无 aad
 *   密文：`KB1:` + base64( IV ‖ ciphertext ‖ GCM tag(16B) )
 *
 * API 用法来源：华为官方文档（2026-09 读）
 *   - PBKDF2: crypto-key-derivation-using-pbkdf2（PBKDF2Spec.password 直传 UTF-8 原文）
 *   - GCM 无 aad/authTag 跨平台场景: faqs-crypto-architecture-42
 *     （加密时 aad/authTag 传空，doFinal 输出尾部 16 字节即 tag；解密时 tag 从密文尾部取出）
 */
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { buffer, util } from '@kit.ArkTS';

const KB1_PREFIX: string = 'KB1:';
const PBKDF2_ITERATIONS: number = 600000;
const KEY_SIZE: number = 32;

const b64Helper = new util.Base64Helper();

function b64ToU8(s: string): Uint8Array {
  return b64Helper.decodeSync(s);
}

function u8ToB64(d: Uint8Array): string {
  return b64Helper.encodeToStringSync(d);
}

function strToU8(s: string): Uint8Array {
  return new Uint8Array(buffer.from(s, 'utf-8').buffer);
}

function u8ToStr(d: Uint8Array): string {
  return buffer.from(d.buffer).toString('utf-8');
}

function randomBytes(n: number): Uint8Array {
  const rand = cryptoFramework.createRandom();
  return rand.generateRandomSync(n).data;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** 由主密码 + 盐（base64）派生 32 字节主密钥。 */
export async function deriveKeyRaw(password: string, saltB64: string): Promise<Uint8Array> {
  const spec: cryptoFramework.PBKDF2Spec = {
    algName: 'PBKDF2',
    password: password, // 官方要求：UTF-8 原文直传，勿传 base64/hex
    salt: b64ToU8(saltB64),
    iterations: PBKDF2_ITERATIONS,
    keySize: KEY_SIZE
  };
  const kdf = cryptoFramework.createKdf('PBKDF2|SHA256');
  const secret = await kdf.generateSecret(spec);
  return secret.data;
}

async function genSymKey(raw: Uint8Array): Promise<cryptoFramework.SymKey> {
  const generator = cryptoFramework.createSymKeyGenerator('AES256');
  return await generator.convertKey({ data: raw } as cryptoFramework.DataBlob);
}

function gcmParams(iv: Uint8Array, tag: Uint8Array): cryptoFramework.GcmParamsSpec {
  return {
    iv: { data: iv },
    aad: { data: new Uint8Array(0) },
    authTag: { data: tag },
    algName: 'GcmParamsSpec'
  } as cryptoFramework.GcmParamsSpec;
}

/** 加密为 `KB1:` 密文串（与 Web 端 encryptString 输出逐字节同格式）。 */
export async function kb1Encrypt(rawKey: Uint8Array, plaintext: string): Promise<string> {
  const symKey = await genSymKey(rawKey);
  const iv = await randomBytes(12);
  const cipher = cryptoFramework.createCipher('AES256|GCM|NoPadding');
  // 加密时 authTag 传空：tag 由 doFinal 输出尾部 16 字节携带（官方 FAQ 方案）
  await cipher.init(cryptoFramework.CryptoMode.ENCRYPT_MODE, symKey,
    gcmParams(iv, new Uint8Array(0)));
  const out = await cipher.doFinal({ data: strToU8(plaintext) });
  return KB1_PREFIX + u8ToB64(concat(iv, out.data));
}

/** 解开 `KB1:` 密文串（tag 取密文尾部 16 字节）。失败（密码错/数据被改）会抛异常。 */
export async function kb1Decrypt(rawKey: Uint8Array, kb1: string): Promise<string> {
  if (!kb1.startsWith(KB1_PREFIX)) {
    throw new Error('KB1 密文前缀不匹配');
  }
  const all = b64ToU8(kb1.slice(KB1_PREFIX.length));
  if (all.length < 12 + 16) {
    throw new Error('KB1 密文长度不足');
  }
  const iv = all.slice(0, 12);
  const tag = all.slice(all.length - 16);
  const ct = all.slice(12, all.length - 16);
  const symKey = await genSymKey(rawKey);
  const cipher = cryptoFramework.createCipher('AES256|GCM|NoPadding');
  await cipher.init(cryptoFramework.CryptoMode.DECRYPT_MODE, symKey, gcmParams(iv, tag));
  const pt = await cipher.doFinal({ data: ct });
  return u8ToStr(pt.data);
}
