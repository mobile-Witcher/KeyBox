/**
 * session.ets —— 主密钥的内存级单例 + 登录态持久化。
 *
 * masterKeyRaw：Uint8Array（二进制）不放 AppStorage（有序列化退化风险），
 *   用模块级单例（ets 单 HAP 内同一实例）。生命周期：解锁成功写入，退出登录清空，绝不持久化。
 *
 * 登录态（refresh_token/uid）：持久化到应用私有 Preferences（其他应用不可读）。
 *   目的：App 更新（install -r）与重启后**保持登录状态**，无需重新收验证码。
 *   安全边界：最坏情况（设备被物理获取且私有存储被读）攻击者只能以账号身份看到
 *   密文列表——没有主密码依然解不开任何内容，端到端加密防线不受影响。
 *   退出登录时清除。
 */
import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const TAG: string = 'KeyBoxSession';

let masterKeyRaw: Uint8Array | null = null;
let sessionPrefs: preferences.Preferences | null = null;
let initPromise: Promise<void> | null = null;

export function setMasterKeyRaw(raw: Uint8Array): void {
  masterKeyRaw = new Uint8Array(raw); // 拷贝一份，避免外部清零影响
}

export function getMasterKeyRaw(): Uint8Array | null {
  return masterKeyRaw;
}

export function clearMasterKeyRaw(): void {
  masterKeyRaw = null;
}

/** 启动时初始化登录态存储（EntryAbility.onCreate 调用）。返回单例 Promise，读写前可安全 await。 */
export function initSession(context: common.Context): Promise<void> {
  if (initPromise === null) {
    initPromise = preferences.getPreferences(context, 'keybox-session')
      .then((p: preferences.Preferences) => {
        sessionPrefs = p;
      })
      .catch((e: Error) => {
        hilog.warn(0x0000, TAG, 'session prefs init failed: %{public}s', e.message);
      });
  }
  return initPromise;
}

async function ensureReady(): Promise<void> {
  if (initPromise !== null) {
    await initPromise;
  }
}

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  uid: string;
}

/** 登录成功后持久化登录态。 */
export async function saveTokens(accessToken: string, refreshToken: string, uid: string): Promise<void> {
  await ensureReady();
  if (sessionPrefs === null) return;
  try {
    await sessionPrefs.put('accessToken', accessToken);
    await sessionPrefs.put('refreshToken', refreshToken);
    await sessionPrefs.put('uid', uid);
    await sessionPrefs.flush();
  } catch (e) {
    hilog.warn(0x0000, TAG, 'saveTokens failed: %{public}s', (e as Error).message);
  }
}

/** 读取持久化的登录态；无则返回 null。 */
export async function loadTokens(): Promise<StoredSession | null> {
  await ensureReady();
  if (sessionPrefs === null) return null;
  try {
    const accessToken = (await sessionPrefs.get('accessToken', '')) as string;
    const refreshToken = (await sessionPrefs.get('refreshToken', '')) as string;
    const uid = (await sessionPrefs.get('uid', '')) as string;
    if (accessToken === '' || uid === '') return null;
    return { accessToken: accessToken, refreshToken: refreshToken, uid: uid };
  } catch (e) {
    hilog.warn(0x0000, TAG, 'loadTokens failed: %{public}s', (e as Error).message);
    return null;
  }
}

/** 退出登录/refresh 失效时清除。 */
export async function clearTokens(): Promise<void> {
  await ensureReady();
  if (sessionPrefs === null) return;
  try {
    await sessionPrefs.clear();
    await sessionPrefs.flush();
  } catch (e) {
    hilog.warn(0x0000, TAG, 'clearTokens failed: %{public}s', (e as Error).message);
  }
}
