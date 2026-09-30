/**
 * pinlock.ets —— PIN 快捷解锁（主密钥的本地加密保管）。
 *
 * 原理：首次主密码解锁成功后，可用自设 PIN（4-6 位）把主密钥加密存本机：
 *   pin --PBKDF2(100k, 盐)--> 32B 密钥 --AES-256-GCM--> 主密钥密文（KBP: 前缀，格式同 KB1）
 * 之后打开 App 只需输 PIN 解出主密钥，不必再输长主密码。
 *
 * 安全模型（如实告知用户）：
 *   - PIN 包只存应用私有目录，其他应用不可读；
 *   - 设备丢失 + PIN 被猜中的风险由「错误 5 次自动销毁 PIN 包」缓解；
 *   - 主密码永远是最后防线：PIN 包被销毁/不可用时回退主密码解锁。
 */
import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { buffer, util } from '@kit.ArkTS';
import { kb1Encrypt, kb1Decrypt } from './kbcrypto';

const TAG: string = 'KeyBoxPin';
const PIN_STORE: string = 'keybox-pin';
const PIN_KEY_ALIAS: string = 'pin';
const PIN_ITERATIONS: number = 100000;
const KBP_PREFIX: string = 'KB1:'; // PIN 包复用 kb1Encrypt 输出格式

let pinPrefs: preferences.Preferences | null = null;

/** 初始化（EntryAbility.onCreate 调用；返回单例 Promise）。 */
export function initPinStore(context: common.Context): Promise<void> {
  return preferences.getPreferences(context, PIN_STORE)
    .then((p: preferences.Preferences) => {
      pinPrefs = p;
    })
    .catch((e: Error) => {
      hilog.warn(0x0000, TAG, 'pin store init failed: %{public}s', e.message);
    });
}

function randBytes(n: number): Uint8Array {
  return cryptoFramework.createRandom().generateRandomSync(n).data;
}

const b64Helper = new util.Base64Helper();

function derivePinKey(pin: string, saltB64: string): Promise<Uint8Array> {
  // 与主密钥同规范但独立轮数：PIN 组合少，靠轮数慢化本地爆破
  const spec: cryptoFramework.PBKDF2Spec = {
    algName: 'PBKDF2',
    password: pin,
    salt: b64Helper.decodeSync(saltB64),
    iterations: PIN_ITERATIONS,
    keySize: 32
  };
  const kdf = cryptoFramework.createKdf('PBKDF2|SHA256');
  return kdf.generateSecret(spec).then((secret) => secret.data);
}

/** 是否已设置 PIN 解锁。 */
export async function hasPinLock(): Promise<boolean> {
  if (pinPrefs === null) return false;
  const enc = (await pinPrefs.get(PIN_KEY_ALIAS, '')) as string;
  return enc.startsWith(KBP_PREFIX);
}

/** 保存 PIN 加密的主密钥包（主密码解锁成功后调用）。 */
export async function savePinLock(pin: string, masterKeyRaw: Uint8Array): Promise<void> {
  if (pinPrefs === null) {
    throw new Error('PIN 存储未初始化');
  }
  if (!/^\d{4,6}$/.test(pin)) {
    throw new Error('PIN 必须是 4-6 位数字');
  }
  const saltB64 = b64Helper.encodeToStringSync(randBytes(16));
  const pinKey = await derivePinKey(pin, saltB64);
  // 盐与密文一起落盘（解封时要用盐重派生 PIN 密钥）
  await pinPrefs.put('pinMeta', JSON.stringify({ salt: saltB64 } as PinMeta));
  // 主密钥原始字节 → base64 → 作为明文用 PIN 密钥加密（KBP: 格式，同 KB1 结构）
  const masterB64 = b64Helper.encodeToStringSync(masterKeyRaw);
  const enc = await kb1Encrypt(pinKey, masterB64);
  await pinPrefs.put(PIN_KEY_ALIAS, enc);
  await pinPrefs.flush();
  hilog.info(0x0000, TAG, 'pin lock saved');
}

/** 用 PIN 解出主密钥；错误返回 null（密码错/包损坏）。 */
export async function unlockWithPin(pin: string): Promise<Uint8Array | null> {
  if (pinPrefs === null) return null;
  const enc = (await pinPrefs.get(PIN_KEY_ALIAS, '')) as string;
  if (!enc.startsWith(KBP_PREFIX)) return null;
  try {
    // 从 KBP: 串里取盐：加密时的盐无法从密文分离——因此把盐存进记录
    const rec = JSON.parse((await pinPrefs.get('pinMeta', '{}')) as string) as PinMeta;
    const pinKey = await derivePinKey(pin, rec.salt);
    const masterB64 = await kb1Decrypt(pinKey, enc);
    const raw = b64Helper.decodeSync(masterB64);
    if (raw.length !== 32) return null;
    return raw;
  } catch {
    return null;
  }
}

interface PinMeta {
  salt: string;
}

/** 保存 PIN 时同时记录盐（解封时需要）。 */
export async function savePinMeta(saltB64: string): Promise<void> {
  if (pinPrefs === null) return;
  await pinPrefs.put('pinMeta', JSON.stringify({ salt: saltB64 } as PinMeta));
  await pinPrefs.flush();
}

/** 清除 PIN 包（连错 5 次 / 退出登录 / 手动关闭）。 */
export async function clearPinLock(): Promise<void> {
  if (pinPrefs === null) return;
  await pinPrefs.delete(PIN_KEY_ALIAS);
  await pinPrefs.delete('pinMeta');
  await pinPrefs.flush();
  hilog.info(0x0000, TAG, 'pin lock cleared');
}
