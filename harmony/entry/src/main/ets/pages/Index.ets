/**
 * Index.ets —— 登录页（主题化版）。
 *
 * 流程：手机号 → 短信验证码 → 登录（拿到平台 uid）→ 存会话 → 跳主密码解锁页。
 */
import { router } from '@kit.ArkUI';
import { sendVerification, verifyCode, signIn, refreshSession } from '../lib/auth';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { loadTokens, saveTokens, clearTokens } from '../lib/session';
import { colorsOf, SkinId, ThemeColors, resolveDark } from '../lib/theme';
import { probeActivation } from '../lib/kbapi';

const TAG: string = 'KeyBoxIndex';

@Entry
@Component
struct Index {
  @StorageProp('skin') skin: string = 'default';
  @StorageProp('darkMode') darkMode: string = 'system';
  @StorageProp('systemDark') systemDark: boolean = false;
  @State phone: string = '';
  @State code: string = '';
  @State verificationId: string = '';
  @State status: string = '';
  @State statusColor: string = '#64748b';
  @State busy: boolean = false;
  @State uid: string = '';

  c(): ThemeColors {
    return colorsOf(this.skin as SkinId, resolveDark(this.darkMode, this.systemDark));
  }

  aboutToAppear(): void {
    // 有持久化登录态则静默续期并直接进解锁页（更新/重启不再要求重新收验证码）
    void this.restoreSession();
  }

  async restoreSession(): Promise<void> {
    const stored = await loadTokens();
    if (stored === null) return; // 无登录态：停在登录页
    this.busy = true;
    this.status = '正在恢复登录…';
    try {
      const session = await refreshSession(stored.refreshToken);
      AppStorage.setOrCreate('uid', session.uid);
      AppStorage.setOrCreate('accessToken', session.accessToken);
      await saveTokens(session.accessToken, session.refreshToken, session.uid);
      this.uid = session.uid;
      const probe = await probeActivation(session.accessToken);
      if (!probe.activated) {
        // R01/R03 门禁：平台手机号登录成功 ≠ 已开户。停用/已删除由服务端语义决定：
        //   disabled → 明确提示；其余（含 deleted 重新开户、从未注册）→ 引导去注册页
        this.status = probe.status === 'disabled'
          ? '该账号已被管理员停用，请联系管理员。'
          : '本账号尚未注册（或未完成激活），请点击下方「注册」完成邀请码激活。';
        this.statusColor = this.c().danger;
        hilog.info(0x0000, TAG, 'not activated: status=%{public}s initialized=%{public}s',
          probe.status, String(probe.initialized));
        return;
      }
      router.replaceUrl({ url: 'pages/Unlock' });
    } catch (e) {
      // refresh 失效：清掉旧登录态，留在登录页重新走验证码
      await clearTokens();
      // R95-2: 不再静默回到登录页——把原因告诉用户
      // （平台只保留已续期过的会话：本端从未续期过而其他设备登录时，refresh_token 会永久失效且重试无效）
      this.status = '该账号的登录态已在其他设备上失效，请重新登录。';
      this.statusColor = this.c().danger;
      hilog.warn(0x0000, TAG, 'restore failed: %{public}s', (e as Error).message);
    } finally {
      this.busy = false;
    }
  }

  async sendCode(): Promise<void> {
    if (this.phone.trim() === '') {
      this.status = '请输入手机号';
      this.statusColor = this.c().danger;
      return;
    }
    this.busy = true;
    this.status = '发送中…';
    try {
      this.verificationId = await sendVerification(this.phone);
      this.status = '验证码已发送，请查收短信';
      this.statusColor = this.c().success;
      hilog.info(0x0000, TAG, 'verification sent');
    } catch (e) {
      this.status = '发送失败：' + (e as Error).message;
      this.statusColor = this.c().danger;
      hilog.error(0x0000, TAG, 'send failed: %{public}s', (e as Error).message);
    } finally {
      this.busy = false;
    }
  }

  async login(): Promise<void> {
    if (this.verificationId === '') {
      this.status = '请先获取验证码';
      this.statusColor = this.c().danger;
      return;
    }
    if (this.code.trim() === '') {
      this.status = '请输入验证码';
      this.statusColor = this.c().danger;
      return;
    }
    this.busy = true;
    try {
      const verificationToken = await verifyCode(this.verificationId, this.code.trim());
      const session = await signIn(verificationToken);
      // 会话进 AppStorage（仅内存；安全考虑不持久化 token，重启需重新登录）
      AppStorage.setOrCreate('uid', session.uid);
      AppStorage.setOrCreate('accessToken', session.accessToken);
      await saveTokens(session.accessToken, session.refreshToken, session.uid);
      this.uid = session.uid;
      const probe = await probeActivation(session.accessToken);
      if (!probe.activated) {
        // R01/R03 门禁：平台手机号登录成功 ≠ 已开户。停用/已删除由服务端语义决定：
        //   disabled → 明确提示；其余（含 deleted 重新开户、从未注册）→ 引导去注册页
        this.status = probe.status === 'disabled'
          ? '该账号已被管理员停用，请联系管理员。'
          : '本账号尚未注册（或未完成激活），请点击下方「注册」完成邀请码激活。';
        this.statusColor = this.c().danger;
        hilog.info(0x0000, TAG, 'not activated: status=%{public}s initialized=%{public}s',
          probe.status, String(probe.initialized));
        return;
      }
      this.status = '登录成功，正在进入…';
      this.statusColor = this.c().success;
      hilog.info(0x0000, TAG, 'login ok, uid=%{public}s', session.uid);
      router.replaceUrl({ url: 'pages/Unlock' });
    } catch (e) {
      this.status = '登录失败：' + (e as Error).message;
      this.statusColor = this.c().danger;
      hilog.error(0x0000, TAG, 'login failed: %{public}s', (e as Error).message);
    } finally {
      this.busy = false;
    }
  }

  build() {
    Column({ space: 14 }) {
      Text('KeyBox')
        .fontSize(26)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.c().text)
      Text('鸿蒙原生客户端 · Phase 2')
        .fontSize(13)
        .fontColor(this.c().muted)

      Column({ space: 8 }) {
        Text('手机号')
          .fontSize(13)
          .fontColor(this.c().text)
        TextInput({ placeholder: '用于接收短信验证码' })
          .type(InputType.PhoneNumber)
          .width('100%')
          .height(44)
          .backgroundColor(this.c().surface)
          .fontColor(this.c().text)
          .onChange((value: string) => {
            this.phone = value;
          })

        Button('获取验证码')
          .width('100%')
          .height(44)
          .backgroundColor(this.c().primary)
          .fontColor(this.c().primaryContrast)
          .enabled(!this.busy)
          .onClick(() => {
            void this.sendCode();
          })
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')

      if (this.verificationId !== '') {
        Column({ space: 8 }) {
          Text('验证码')
            .fontSize(13)
            .fontColor(this.c().text)
          TextInput({ placeholder: '6 位数字' })
            .type(InputType.Number)
            .width('100%')
            .height(44)
            .backgroundColor(this.c().surface)
            .fontColor(this.c().text)
            .onChange((value: string) => {
              this.code = value;
            })
          Button('登录')
            .width('100%')
            .height(44)
            .backgroundColor(this.c().primary)
            .fontColor(this.c().primaryContrast)
            .enabled(!this.busy)
            .onClick(() => {
              void this.login();
            })
        }
        .alignItems(HorizontalAlign.Start)
        .width('100%')
      }

      Button('没有账号？注册')
        .width('100%')
        .height(44)
        .backgroundColor(this.c().surface)
        .fontColor(this.c().text)
        .enabled(!this.busy)
        .onClick(() => {
          router.replaceUrl({ url: 'pages/Register' });
        })

      if (this.status !== '') {
        Text(this.status)
          .fontSize(13)
          .fontColor(this.statusColor)
      }
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .padding({ left: '8%', right: '8%' })
    .backgroundColor(this.c().bg)
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
  }
}
