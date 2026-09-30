/**
 * prefs.ets —— 主题偏好持久化（皮肤/明暗，重启记忆）。
 *
 * 使用华为 preferences（键值存储，应用私有）。启动时由 EntryAbility 调 initPrefs
 * 把存储值刷进 AppStorage；切换主题时调 savePrefs 同步落盘。
 */
import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const TAG: string = 'KeyBoxPrefs';
const STORE_NAME: string = 'keybox-prefs';

let prefs: preferences.Preferences | null = null;

/** 启动时初始化：读取已保存的皮肤/明暗并刷入 AppStorage。 */
export async function initPrefs(context: common.Context): Promise<void> {
  try {
    prefs = await preferences.getPreferences(context, STORE_NAME);
    const skin = (await prefs.get('skin', 'default')) as string;
    const darkMode = (await prefs.get('darkMode', 'system')) as string;
    AppStorage.setOrCreate('skin', skin);
    AppStorage.setOrCreate('darkMode', darkMode);
    hilog.info(0x0000, TAG, 'prefs loaded: skin=%{public}s darkMode=%{public}s', skin, darkMode);
  } catch (e) {
    hilog.warn(0x0000, TAG, 'prefs load failed: %{public}s', (e as Error).message);
  }
}

/** 切换主题时持久化。 */
export async function savePrefs(skin: string, darkMode: string): Promise<void> {
  if (prefs === null) return;
  try {
    await prefs.put('skin', skin);
    await prefs.put('darkMode', darkMode);
    await prefs.flush();
  } catch (e) {
    hilog.warn(0x0000, TAG, 'prefs save failed: %{public}s', (e as Error).message);
  }
}
