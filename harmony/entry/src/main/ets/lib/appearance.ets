/**
 * appearance.ets —— 全局深色模式监听（跟随系统的基础设施）。
 *
 * 只监听一次系统深色状态，把实时值写入 AppStorage('systemDark')。
 * 页面根据 AppStorage('darkMode')（'system'|'light'|'dark'）决定是否采用该值——
 * 这样"跟随系统"与"手动锁定浅色/深色"三种模式可以共存。
 *
 * 必须在窗口创建之后调用（EntryAbility.onWindowStageCreate），媒体查询需要 UI 上下文。
 */
import { mediaquery } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';

const TAG: string = 'KeyBoxAppearance';

let mqDark: mediaquery.MediaQueryListener | null = null;

export function initAppearance(): void {
  if (mqDark !== null) return; // 全局只初始化一次
  mqDark = mediaquery.matchMediaSync('(dark-mode: true)');
  mqDark.on('change', (result: mediaquery.MediaQueryResult) => {
    AppStorage.setOrCreate('systemDark', result.matches as boolean);
  });
  AppStorage.setOrCreate('systemDark', mqDark.matches as boolean);
  hilog.info(0x0000, TAG, 'dark-mode listener ready');
}
