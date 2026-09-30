/**
 * EntryAbility.ets —— 应用主入口（Stage 模型标准模板）。
 */
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';
import { initPrefs } from '../lib/prefs';
import { initAppearance } from '../lib/appearance';
import { initSession } from '../lib/session';
import { initPinStore } from '../lib/pinlock';
import { initBioStore } from '../lib/biometric';

const DOMAIN: number = 0x0000;
const TAG: string = 'KeyBoxEntry';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, TAG, '%{public}s', 'Ability onCreate');
    // 尽早恢复主题偏好（皮肤/明暗），保证首屏即正确外观
    void initPrefs(this.context);
    // 初始化登录态存储（Preferences，供"更新/重启后保持登录"使用）
    void initSession(this.context);
    // 初始化生物识别存档存储
    void initBioStore(this.context);
  }

  onDestroy(): void {
    hilog.info(DOMAIN, TAG, '%{public}s', 'Ability onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    hilog.info(DOMAIN, TAG, '%{public}s', 'Ability onWindowStageCreate');
    // 窗口建立后启动全局深色监听（媒体查询需要 UI 上下文）
    initAppearance();
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, TAG, 'loadContent failed: %{public}s', JSON.stringify(err));
        return;
      }
      hilog.info(DOMAIN, TAG, '%{public}s', 'loadContent pages/Index succeeded');
    });
  }

  onWindowStageDestroy(): void {
    hilog.info(DOMAIN, TAG, '%{public}s', 'Ability onWindowStageDestroy');
  }

  onForeground(): void {
    hilog.info(DOMAIN, TAG, '%{public}s', 'Ability onForeground');
  }

  onBackground(): void {
    hilog.info(DOMAIN, TAG, '%{public}s', 'Ability onBackground');
  }
}
