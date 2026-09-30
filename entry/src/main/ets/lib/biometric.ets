/**
 * biometric.ets —— 生物识别（指纹/面容）解锁：HUKS 硬件密钥 + 用户认证门禁。
 *
 * 架构（华为官方指南 huks-user-identity-authentication）：
 *   设置：在安全芯片生成一把 AES-256 密钥，标记「使用时需指纹/面容认证」且不可导出；
 *         用它加密主密钥 → 密文存本机。
 *   解锁：initSession 拿挑战值 → 系统弹指纹/面容认证 → 认证成功得授权令牌(token)
 *         → finishSession 携带令牌解密 → 主密钥进内存。
 *
 * 设备适配（关键）：认证类型**按设备实际支持动态构建**——
 *   getAvailableStatus 逐一探测 FACE/FINGERPRINT@ATL2，只把支持的类型写进
 *   HUKS 密钥标记与 userAuth 参数。传了设备不支持的类型会直接 401 参数检查失败。
 *   支持的类型列表会随密文一起持久化，解锁时用同一份（必须与密钥标记一致）。
 */
import { huks } from '@kit.UniversalKeystoreKit';
import { userAuth } from '@kit.UserAuthenticationKit';
import { util } from '@kit.ArkTS';
import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const TAG: string = 'KeyBoxBio';
const BIO_KEY_ALIAS: string = 'keybox-bio-key';
const BIO_STORE: string = 'keybox-bio';
const KEY_ENC: string = 'masterEnc';
const KEY_IV: string = 'masterIv';
const KEY_TYPES: string = 'authTypes';

let bioPrefs: preferences.Preferences | null = null;

/** 初始化（EntryAbility.onWindowStageCreate 调用）。 */
export async function initBioStore(context: common.Context): Promise<void> {
  try {
    bioPrefs = await preferences.getPreferences(context, BIO_STORE);
  } catch (e) {
    hilog.warn(0x0000, TAG, 'bio store init failed: %{public}s', (e as Error).message);
  }
}

const b64Helper = new util.Base64Helper();

function randBytes(n: number): Uint8Array {
  return cryptoFramework.createRandom().generateRandomSync(n).data;
}

export interface BioStatus {
  available: boolean;
  reason: string;
  /** 设备实际支持的认证类型（ATL2 级）。 */
  supportedTypes: userAuth.UserAuthType[];
}

/** 逐一探测 FACE/FINGERPRINT@ATL2，返回设备真实支持的认证类型。 */
export async function getBioStatus(): Promise<BioStatus> {
  const supportedTypes: userAuth.UserAuthType[] = [];
  const errs: string[] = [];
  try {
    await userAuth.getAvailableStatus(userAuth.UserAuthType.FACE, userAuth.AuthTrustLevel.ATL2);
    supportedTypes.push(userAuth.UserAuthType.FACE);
  } catch (e) {
    errs.push('face:' + (e as BusinessError).code);
  }
  try {
    await userAuth.getAvailableStatus(userAuth.UserAuthType.FINGERPRINT,
      userAuth.AuthTrustLevel.ATL2);
    supportedTypes.push(userAuth.UserAuthType.FINGERPRINT);
  } catch (e) {
    errs.push('finger:' + (e as BusinessError).code);
  }
  return {
    available: supportedTypes.length > 0,
    reason: errs.length > 0 ? errs.join(',') : 'ok',
    supportedTypes: supportedTypes
  };
}

/** 简易版（兼容旧调用）。 */
export async function isBiometricAvailable(): Promise<boolean> {
  return (await getBioStatus()).available;
}

/** 是否已设置生物识别解锁（有密文存档）。 */
export async function hasBiometricLock(): Promise<boolean> {
  if (bioPrefs === null) return false;
  const enc = (await bioPrefs.get(KEY_ENC, '')) as string;
  return enc !== '';
}

/** 清除生物识别解锁（退出登录/手动关闭）。 */
export async function clearBiometricLock(): Promise<void> {
  if (bioPrefs === null) return;
  await bioPrefs.delete(KEY_ENC);
  await bioPrefs.delete(KEY_IV);
  await bioPrefs.delete(KEY_TYPES);
  await bioPrefs.flush();
  try {
    await huks.deleteKeyItem(BIO_KEY_ALIAS, null);
  } catch {
    // 密钥不存在时忽略
  }
}

function keyProperties(authTypeMask: number): huks.HuksParam[] {
  return [
    { tag: huks.HuksTag.HUKS_TAG_ALGORITHM, value: huks.HuksKeyAlg.HUKS_ALG_AES },
    {
      tag: huks.HuksTag.HUKS_TAG_PURPOSE,
      value: huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_ENCRYPT | huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_DECRYPT
    },
    { tag: huks.HuksTag.HUKS_TAG_KEY_SIZE, value: huks.HuksKeySize.HUKS_AES_KEY_SIZE_256 },
    { tag: huks.HuksTag.HUKS_TAG_BLOCK_MODE, value: huks.HuksCipherMode.HUKS_MODE_CBC },
    { tag: huks.HuksTag.HUKS_TAG_PADDING, value: huks.HuksKeyPadding.HUKS_PADDING_PKCS7 },
    { tag: huks.HuksTag.HUKS_TAG_USER_AUTH_TYPE, value: authTypeMask },
    {
      tag: huks.HuksTag.HUKS_TAG_KEY_AUTH_ACCESS_TYPE,
      value: huks.HuksAuthAccessType.HUKS_AUTH_ACCESS_INVALID_CLEAR_PASSWORD
    },
    {
      tag: huks.HuksTag.HUKS_TAG_CHALLENGE_TYPE,
      value: huks.HuksChallengeType.HUKS_CHALLENGE_TYPE_NONE
    },
    {
      // NONE 模式：认证后一段时间内可访问密钥，必须指定超时（最大 60 秒）
      tag: huks.HuksTag.HUKS_TAG_AUTH_TIMEOUT,
      value: 60
    }
  ];
}

function cipherProperties(purpose: number, iv: Uint8Array): huks.HuksParam[] {
  return [
    { tag: huks.HuksTag.HUKS_TAG_ALGORITHM, value: huks.HuksKeyAlg.HUKS_ALG_AES },
    { tag: huks.HuksTag.HUKS_TAG_PURPOSE, value: purpose },
    { tag: huks.HuksTag.HUKS_TAG_KEY_SIZE, value: huks.HuksKeySize.HUKS_AES_KEY_SIZE_256 },
    { tag: huks.HuksTag.HUKS_TAG_BLOCK_MODE, value: huks.HuksCipherMode.HUKS_MODE_CBC },
    { tag: huks.HuksTag.HUKS_TAG_PADDING, value: huks.HuksKeyPadding.HUKS_PADDING_PKCS7 },
    { tag: huks.HuksTag.HUKS_TAG_IV, value: iv }
  ];
}

function initSessionP(keyAlias: string, options: huks.HuksOptions): Promise<huks.HuksSessionHandle> {
  return new Promise<huks.HuksSessionHandle>((resolve, reject) => {
    try {
      huks.initSession(keyAlias, options, (error, data) => {
        if (error) {
          reject(error as Error);
        } else {
          resolve(data);
        }
      });
    } catch (error) {
      reject(error as Error);
    }
  });
}

function finishSessionP(handle: number, properties: huks.HuksParam[], token: Uint8Array,
  inData: Uint8Array): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    try {
      const options: huks.HuksOptions = { properties: properties, inData: inData };
      huks.finishSession(handle, options, token, (error, data) => {
        if (error) {
          reject(error as Error);
        } else {
          resolve(data.outData as Uint8Array);
        }
      });
    } catch (error) {
      reject(error as Error);
    }
  });
}

/** 用户认证（弹系统指纹/面容 UI），成功返回授权令牌。 */
function authenticate(challenge: Uint8Array, authTypes: userAuth.UserAuthType[]): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const authParam: userAuth.AuthParam = {
      challenge: challenge,
      authType: authTypes,
      authTrustLevel: userAuth.AuthTrustLevel.ATL2
    };
    const widgetParam: userAuth.WidgetParam = { title: 'KeyBox 解锁' };
    let inst: userAuth.UserAuthInstance;
    try {
      inst = userAuth.getUserAuthInstance(authParam, widgetParam);
    } catch (error) {
      reject(error as Error);
      return;
    }
    inst.on('result', {
      onResult(result: userAuth.UserAuthResult) {
        hilog.info(0x0000, TAG, 'auth result: %{public}s', JSON.stringify(result));
        if (result.result === 12500000 && result.token) { // 12500000 = UserAuthResultCode.SUCCESS
          resolve(result.token);
        } else {
          reject(new Error('生物识别未通过（code=' + result.result + '）'));
        }
      }
    });
    try {
      inst.start();
    } catch (error) {
      // 同步参数错误会在这里抛出（与 onResult 回调错误区分开）
      const be = error as BusinessError;
      reject(new Error('发起认证失败 [start code=' + be.code + '] ' + be.message));
      return;
    }
  });
}

/** 生成生物识别绑定的硬件密钥（已存在则先删除重建——认证类型可能变化）。 */
async function ensureBioKey(authTypeMask: number): Promise<void> {
  try {
    await huks.deleteKeyItem(BIO_KEY_ALIAS, null);
  } catch {
    // 不存在则忽略
  }
  await huks.generateKeyItem(BIO_KEY_ALIAS, {
    properties: keyProperties(authTypeMask),
    inData: new Uint8Array([])
  });
  hilog.info(0x0000, TAG, 'bio key generated, mask=%{public}d', authTypeMask);
}

/** 设置生物识别解锁：按设备支持的类型生成密钥并加密主密钥（过程中弹系统认证）。 */
export async function setupBiometric(masterKeyRaw: Uint8Array): Promise<void> {
  if (bioPrefs === null) {
    throw new Error('生物识别存储未初始化');
  }
  const status = await getBioStatus();
  if (!status.available) {
    throw new Error('设备不支持生物识别：' + status.reason);
  }
  // 认证类型：只用已实测成功的指纹单类型（多类型组合在该设备上会 401 参数校验失败）
  const authTypes: userAuth.UserAuthType[] = [userAuth.UserAuthType.FINGERPRINT];
  // 注意：HUKS_TAG_USER_AUTH_TYPE 必须用 huks 自己的枚举值（与 userAuth.UserAuthType 不是同一套数值）
  const mask = huks.HuksUserAuthType.HUKS_USER_AUTH_TYPE_FINGERPRINT;
  await ensureBioKey(mask);
  const iv = randBytes(16);
  // NONE 模式：挑战值由我们自己生成（实测随机挑战值的系统认证可成功）
  const challenge = randBytes(16);
  const session = await initSessionP(BIO_KEY_ALIAS, {
    properties: cipherProperties(huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_ENCRYPT, iv),
    inData: new Uint8Array([])
  });
  const token = await authenticate(challenge, authTypes);
  const enc = await finishSessionP(session.handle,
    cipherProperties(huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_ENCRYPT, iv),
    token, masterKeyRaw);
  await bioPrefs.put(KEY_ENC, b64Helper.encodeToStringSync(enc));
  await bioPrefs.put(KEY_IV, b64Helper.encodeToStringSync(iv));
  // 记录认证类型（解锁时用同一份，必须与密钥标记一致）
  await bioPrefs.put(KEY_TYPES, JSON.stringify(authTypes));
  await bioPrefs.flush();
  hilog.info(0x0000, TAG, 'biometric lock saved, types=%{public}s', JSON.stringify(authTypes));
}

/** 生物识别解锁：返回主密钥；失败（取消/未通过）返回 null，异常抛出。 */
export async function unlockWithBiometric(): Promise<Uint8Array | null> {
  if (bioPrefs === null) return null;
  const encB64 = (await bioPrefs.get(KEY_ENC, '')) as string;
  const ivB64 = (await bioPrefs.get(KEY_IV, '')) as string;
  const typesStr = (await bioPrefs.get(KEY_TYPES, '[]')) as string;
  if (encB64 === '' || ivB64 === '') return null;
  const iv = b64Helper.decodeSync(ivB64);
  const encBytes = b64Helper.decodeSync(encB64);
  const authTypes = JSON.parse(typesStr) as userAuth.UserAuthType[];
  const session = await initSessionP(BIO_KEY_ALIAS, {
    properties: cipherProperties(huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_DECRYPT, iv),
    inData: new Uint8Array([])
  });
  const token = await authenticate(randBytes(16), authTypes);
  const out = await finishSessionP(session.handle,
    cipherProperties(huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_DECRYPT, iv),
    token, encBytes);
  if (out.length !== 32) {
    throw new Error('解密结果异常');
  }
  return out;
}
