/**
 * recovery.ts —— R28 恢复码前端编排（纯本机，只调用 crypto.ts 原语）。
 *
 * 边界：
 *   - 本文件【不发任何网络请求】，只做“生成恢复材料 / 用恢复码解回主密钥 / 重包裹”。
 *   - 恢复码明文绝不出本文件之外（除一次性展示给用户）；绝不写进日志、绝不进任何请求体（只传 blob）。
 *   - recovery_salt 必须独立于 kdf_salt（由 crypto.wrapMasterKeyWithRecovery 入口强校验兜底）。
 */
import {
  PBKDF2_ITERATIONS,
  formatRecoveryCode,
  generateRecoveryCodeRaw,
  generateSaltB64,
  masterKeyFromRaw,
  unwrapMasterKeyWithRecovery,
  wrapMasterKeyWithRecovery,
  type MasterKey,
} from "./crypto";

/** 一次性恢复材料：分组展示码 + 分组前原始码 + 独立盐 + `KBRC1:` 包裹密文。 */
export interface RecoveryMaterial {
  /** 便于抄写的分组码（例如 XXXX-XXXX-…）。只应展示一次。 */
  code: string;
  /** 归一化后的原始恢复码（32 位 base32），用于派生恢复密钥。 */
  rawCode: string;
  /** 恢复码专用盐（base64），必须独立于 kdf_salt。 */
  recoverySaltB64: string;
  /** `KBRC1:` 包裹密文（用恢复密钥包裹主密钥所得）。 */
  recoveryBlob: string;
}

/**
 * 生成一套恢复材料：随机恢复码 + 独立盐 + 用恢复密钥包裹主密钥。
 * @param kdfSaltB64 账号主密码派生盐（用于强校验两个盐不相等；不参与派生）。
 */
export async function createRecoveryMaterial(
  masterKey: MasterKey,
  kdfSaltB64: string,
  iterations: number = PBKDF2_ITERATIONS
): Promise<RecoveryMaterial> {
  const rawCode = generateRecoveryCodeRaw();
  const recoverySaltB64 = generateSaltB64();
  const recoveryBlob = await wrapMasterKeyWithRecovery(
    rawCode,
    recoverySaltB64,
    kdfSaltB64,
    masterKey.raw,
    iterations
  );
  return { code: formatRecoveryCode(rawCode), rawCode, recoverySaltB64, recoveryBlob };
}

/**
 * 用恢复码解回主密钥（R28 遗留自救 + R21 改主密码时重包裹都需要）。
 * 恢复码输错或密文被改都会在此抛错（GCM 校验），调用方据此提示“恢复码无效”。
 */
export async function recoverMasterKey(
  recoveryCode: string,
  recoverySaltB64: string,
  recoveryBlob: string,
  iterations: number = PBKDF2_ITERATIONS
): Promise<MasterKey> {
  const raw = await unwrapMasterKeyWithRecovery(recoveryCode, recoverySaltB64, recoveryBlob, iterations);
  return masterKeyFromRaw(raw);
}

/**
 * 用【新主密钥】重包裹恢复码密文（改主密码后仍让原恢复码可用）。
 * 恢复码与 recovery_salt 不变，仅包裹对象换成新主密钥。
 */
export async function rewrapRecovery(
  recoveryCode: string,
  recoverySaltB64: string,
  newKdfSaltB64: string,
  newMasterKey: MasterKey,
  iterations: number = PBKDF2_ITERATIONS
): Promise<string> {
  return wrapMasterKeyWithRecovery(recoveryCode, recoverySaltB64, newKdfSaltB64, newMasterKey.raw, iterations);
}
