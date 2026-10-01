/**
 * kbrecovery.ets —— R28 恢复码原语（鸿蒙端，与 Web 端 src/lib/crypto.ts 字节级对齐）。
 *
 * 算法规范（任何一侧改动必须同步另一侧与 r28Recovery 测试向量）：
 *   - 恢复码：32 字符标准 base32（无易混字符），分组展示为 XXXX-XXXX-…（8 组）
 *   - 派生：RK = PBKDF2-HMAC-SHA256(normalize(恢复码), recovery_salt, 600000 轮, 32B)
 *     —— 复用 kbcrypto.deriveKeyRaw（与主密钥同一派生原语，参数一致）
 *   - 包裹：`KBRC1:` + base64( IV(12B) ‖ AES-256-GCM(RK, masterKeyRaw) ‖ GCM tag(16B) )
 *   - recovery_salt 必须独立于 kdf_salt（入口强校验，与 Web 端 wrapMasterKeyWithRecovery 一致）
 *
 * 边界：恢复码明文只在本模块与一次性展示之间流转，绝不写日志、绝不进请求体（只传 blob）。
 */
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { util } from '@kit.ArkTS';
import { deriveKeyRaw } from './kbcrypto';

const RECOVERY_PREFIX: string = 'KBRC1:';
const KEY_SIZE: number = 32;
const IV_SIZE: number = 12;
const TAG_SIZE: number = 16;
const CODE_LENGTH: number = 32;
const GROUP_SIZE: number = 4;

/** RFC 4648 标准 base32 字母表（与 Web 端 BASE32_ALPHABET 一致）。 */
const BASE32_ALPHABET: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const b64Helper = new util.Base64Helper();

function b64ToU8(s: string): Uint8Array {
  return b64Helper.decodeSync(s);
}

function u8ToB64(d: Uint8Array): string {
  return b64Helper.encodeToStringSync(d);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function randomBytes(n: number): Uint8Array {
  const rand = cryptoFramework.createRandom();
  return rand.generateRandomSync(n).data;
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

/** 生成 16 字节随机盐并返回 base64（R21 新主密码盐 / R28 恢复码盐共用）。 */
export function generateSaltB64(): string {
  return u8ToB64(randomBytes(16));
}

/** 用拒绝采样生成无偏 base32 随机串（256 是 32 的整数倍，天然无偏，护栏保留）。 */
function randomBase32(length: number): string {
  const alphabetLen: number = BASE32_ALPHABET.length;
  const maxUnbiased: number = 256 - (256 % alphabetLen);
  let out: string = '';
  while (out.length < length) {
    const bufBytes = randomBytes(length - out.length + 8);
    for (let i = 0; i < bufBytes.length && out.length < length; i++) {
      if (bufBytes[i] < maxUnbiased) {
        out += BASE32_ALPHABET[bufBytes[i] % alphabetLen];
      }
    }
  }
  return out;
}

/** 生成恢复码原始串（32 字符、无分隔）。 */
export function generateRecoveryCodeRaw(): string {
  return randomBase32(CODE_LENGTH);
}

/** 把恢复码按 4 字符一组分组（XXXX-XXXX-…），便于抄写。 */
export function formatRecoveryCode(rawCode: string): string {
  const normalized: string = normalizeRecoveryCode(rawCode);
  const groups: string[] = [];
  for (let i = 0; i < normalized.length; i += GROUP_SIZE) {
    groups.push(normalized.substring(i, i + GROUP_SIZE));
  }
  return groups.join('-');
}

/** 规整用户输入的恢复码：去分隔符与空格、转大写，只保留 base32 字符。 */
export function normalizeRecoveryCode(input: string): string {
  let out: string = '';
  const upper = input.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    if (BASE32_ALPHABET.indexOf(upper[i]) >= 0) {
      out += upper[i];
    }
  }
  return out;
}

/**
 * 用恢复码把主密钥（原始 32 字节）包裹成 `KBRC1:` 串。
 * 入口强校验 recovery_salt 独立于 kdf_salt（与 Web 端一致）。
 */
export async function wrapMasterKeyWithRecovery(
  rawCode: string, recoverySaltB64: string, kdfSaltB64: string,
  masterKeyRaw: Uint8Array): Promise<string> {
  if (recoverySaltB64 === kdfSaltB64) {
    throw new Error('recovery_salt 必须独立于 kdf_salt（不得复用主密码派生盐）');
  }
  const code = normalizeRecoveryCode(rawCode);
  if (code.length !== CODE_LENGTH) {
    throw new Error('恢复码长度必须为 32 个 base32 字符');
  }
  const rk = await deriveKeyRaw(code, recoverySaltB64);
  const symKey = await genSymKey(rk);
  const iv = randomBytes(IV_SIZE);
  const cipher = cryptoFramework.createCipher('AES256|GCM|NoPadding');
  // 加密时 authTag 传空：tag 由 doFinal 输出尾部 16 字节携带（官方 FAQ 方案）
  await cipher.init(cryptoFramework.CryptoMode.ENCRYPT_MODE, symKey,
    gcmParams(iv, new Uint8Array(0)));
  const out = await cipher.doFinal({ data: masterKeyRaw });
  return RECOVERY_PREFIX + u8ToB64(concat(iv, out.data));
}

/**
 * 反向流程：用恢复码解开 `KBRC1:` 串，取回主密钥原始字节（32 字节）。
 * 恢复码输错或密文被改都会在此抛错（GCM 校验）。
 */
export async function unwrapMasterKeyWithRecovery(
  rawCode: string, recoverySaltB64: string, recoveryBlob: string): Promise<Uint8Array> {
  if (!recoveryBlob.startsWith(RECOVERY_PREFIX)) {
    throw new Error(`恢复码密文前缀不是 ${RECOVERY_PREFIX}`);
  }
  const code = normalizeRecoveryCode(rawCode);
  if (code.length !== CODE_LENGTH) {
    throw new Error('恢复码长度必须为 32 个 base32 字符');
  }
  const rk = await deriveKeyRaw(code, recoverySaltB64);
  const symKey = await genSymKey(rk);
  const all = b64ToU8(recoveryBlob.substring(RECOVERY_PREFIX.length));
  if (all.length < IV_SIZE + TAG_SIZE) {
    throw new Error('恢复码密文长度不足');
  }
  const iv = all.slice(0, IV_SIZE);
  const tag = all.slice(all.length - TAG_SIZE);
  const ct = all.slice(IV_SIZE, all.length - TAG_SIZE);
  const cipher = cryptoFramework.createCipher('AES256|GCM|NoPadding');
  await cipher.init(cryptoFramework.CryptoMode.DECRYPT_MODE, symKey, gcmParams(iv, tag));
  const pt = await cipher.doFinal({ data: ct });
  if (pt.data.length !== KEY_SIZE) {
    throw new Error('解回的主密钥长度非法');
  }
  return pt.data;
}
