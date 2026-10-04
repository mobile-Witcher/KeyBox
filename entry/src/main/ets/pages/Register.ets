/**
 * Register.ets —— 独立注册页（R01/R03）两步向导。
 *
 * 第 1 步：手机号验证码登录（平台层，**未注册的号码也能登录**）
 * 第 2 步：邀请码（系统尚无用户时自动隐藏，走首次初始化）+ 主密码 → kbRegister / kbInitAdmin
 *
 * 为什么必须先登录：kbRegister 的 uid 由云函数从平台会话注入，没有会话就没有身份可开户。
 * 安全边界：主密码与主密钥**绝不离开设备**，只上传 kdf_salt 与 kdf_verifier（主密钥对固定串的 KB1 密文）。
 */
import { router } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { sendVerification, verifyCode, signIn } from '../lib/auth';
import { saveTokens } from '../lib/session';
import { probeActivation, registerRemote, initAdminRemote, KbFnEnvelope } from '../lib/kbapi';
import { deriveKeyRaw, kb1Encrypt } from '../lib/kbcrypto';
import { generateSaltB64 } from '../lib/kbrecovery';
import { colorsOf, SkinId, ThemeColors, resolveDark } from '../lib/theme';

const TAG: string = 'KeyBoxRegister';
const VERIFIER_PLAINTEXT: string = 'KeyBox-Verify';

@Entry
@Component
struct Register {
  @StorageProp('skin') skin: string = 'default';
  @StorageProp('darkMode') darkMode: string = 'system';
  @StorageProp('systemDark') systemDark: boolean = false;

  @State step: number = 1;
  @State phone: string = '';
  @State code: string = '';
  @State verificationId: string = '';
  @State inviteCode: string = '';
  @State needsInvite: boolean = true;
  @State password: string = '';
  @State confirm: string = '';
  @State status: string = '';
  @State statusColor: string = '#64748b';
  @State busy: boolean = false;

  private accessToken: string = '';

  c(): ThemeColors {
    return colorsOf(this.skin as SkinId, resolveDark(this.darkMode, this.systemDark));
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
    } catch (e) {
      this.status = '发送失败：' + (e as Error).message;
      this.statusColor = this.c().danger;
    } finally {
      this.busy = false;
    }
  }

  /** 第 1 步 → 第 2 步：验证码登录 + 探针决定是否需要邀请码。 */
  async verifyAndContinue(): Promise<void> {
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
    this.status = '验证中…';
    try {
      const token = await verifyCode(this.verificationId, this.code.trim());
      const session = await signIn(token);
      AppStorage.setOrCreate('uid', session.uid);
      AppStorage.setOrCreate('accessToken', session.accessToken);
      await saveTokens(session.accessToken, session.refreshToken, session.uid);
      this.accessToken = session.accessToken;

      const probe = await probeActivation(session.accessToken);
      if (probe.activated) {
        // 已经是激活账号：直接去解锁，不必再注册
        router.replaceUrl({ url: 'pages/Unlock' });
        return;
      }
      if (probe.status === 'disabled') {
        // 停用是管理员决定，不允许自助恢复
        this.status = '该账号已被管理员停用，请联系管理员。';
        this.statusColor = this.c().danger;
        return;
      }

      // 注意：软删（deleted）账号**允许重新开户**（服务端 kbRegister 已按 status 分流）。
      this.needsInvite = probe.initialized;
      this.step = 2;
      this.status = this.needsInvite
        ? '手机号验证成功，请填写邀请码并设置主密码。'
        : '系统尚无任何用户，你将成为首位管理员，请设置主密码。';
      this.statusColor = this.c().success;
      hilog.info(0x0000, TAG, 'step2 needsInvite=%{public}s', String(this.needsInvite));
    } catch (e) {
      this.status = '验证失败：' + (e as Error).message;
      this.statusColor = this.c().danger;
      hilog.error(0x0000, TAG, 'verify failed: %{public}s', (e as Error).message);
    } finally {
      this.busy = false;
    }
  }

  /** 第 2 步：生成主密钥材料并开户（kbRegister / kbInitAdmin）。 */
  async submit(): Promise<void> {
    if (this.needsInvite && this.inviteCode.trim() === '') {
      this.status = '请填写邀请码';
      this.statusColor = this.c().danger;
      return;
    }
    if (this.password.length < 8) {
      this.status = '主密码至少 8 位';
      this.statusColor = this.c().danger;
      return;
    }
    if (this.password !== this.confirm) {
      this.status = '两次输入的主密码不一致';
      this.statusColor = this.c().danger;
      return;
    }

    this.busy = true;
    this.status = '正在注册…';
    try {
      const salt = generateSaltB64();
      const raw = await deriveKeyRaw(this.password, salt);
      const verifier = await kb1Encrypt(raw, VERIFIER_PLAINTEXT);

      const env: KbFnEnvelope = this.needsInvite
        ? await registerRemote(this.inviteCode.trim(), salt, verifier, this.accessToken)
        : await initAdminRemote(salt, verifier, this.accessToken);

      if (!env.ok) {
        this.status = this.describeError(env.error);
        this.statusColor = this.c().danger;
        return;
      }

      this.status = '注册成功，请用刚设置的主密码解锁。';
      this.statusColor = this.c().success;
      hilog.info(0x0000, TAG, 'register ok');
      router.replaceUrl({ url: 'pages/Unlock' });
    } catch (e) {
      this.status = '注册失败：' + (e as Error).message;
      this.statusColor = this.c().danger;
      hilog.error(0x0000, TAG, 'register failed: %{public}s', (e as Error).message);
    } finally {
      this.busy = false;
    }
  }

  /** 云函数错误码 → 用户可读文案（与网页版 RegisterPage/InitPage 口径一致）。 */
  describeError(code: string): string {
    switch (code) {
      case 'INVALID_CODE':
        return '邀请码无效或已被使用，请向管理员索取新的邀请码';
      case 'LIMIT_REACHED':
        return '已达 20 人开户上限，请联系管理员';
      case 'ALREADY_INITIALIZED':
        return '系统已有用户，请改用邀请码激活';
      case 'ACCOUNT_DISABLED':
        return '该账号已被管理员停用，请联系管理员';
      case 'MISSING_KDF_PARAMS':
        return '主密码材料缺失，请重试';
      case 'MISSING_RECOVERY_PARAMS':
        return '恢复码参数不完整，请重试';
      case '':
        return '注册失败，请稍后重试';
      default:
        return '注册失败：' + code;
    }
  }

  @Builder
  fieldLabel(text: string) {
    Text(text)
      .fontSize(13)
      .fontColor(this.c().text)
  }

  build() {
    Scroll() {
      Column({ space: 14 }) {
        Text('注册 KeyBox')
          .fontSize(26)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.c().text)
        Text(this.step === 1
          ? '第 1 步：手机号验证码登录（未注册的号码也可登录）'
          : (this.needsInvite ? '第 2 步：邀请码 + 主密码' : '第 2 步：设置主密码（你将成为首位管理员）'))
          .fontSize(13)
          .fontColor(this.c().muted)

        if (this.step === 1) {
          Column({ space: 8 }) {
            this.fieldLabel('手机号')
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

            this.fieldLabel('验证码')
            TextInput({ placeholder: '6 位数字' })
              .type(InputType.Number)
              .width('100%')
              .height(44)
              .backgroundColor(this.c().surface)
              .fontColor(this.c().text)
              .onChange((value: string) => {
                this.code = value;
              })

            Button('验证并继续')
              .width('100%')
              .height(44)
              .backgroundColor(this.c().primary)
              .fontColor(this.c().primaryContrast)
              .enabled(!this.busy)
              .onClick(() => {
                void this.verifyAndContinue();
              })
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')
        } else {
          Column({ space: 8 }) {
            if (this.needsInvite) {
              this.fieldLabel('一次性邀请码')
              TextInput({ placeholder: '向管理员索取' })
                .width('100%')
                .height(44)
                .backgroundColor(this.c().surface)
                .fontColor(this.c().text)
                .onChange((value: string) => {
                  this.inviteCode = value;
                })
            }

            this.fieldLabel('主密码（至少 8 位，忘记无法找回）')
            TextInput({ placeholder: '用于派生密钥' })
              .type(InputType.Password)
              .width('100%')
              .height(44)
              .backgroundColor(this.c().surface)
              .fontColor(this.c().text)
              .onChange((value: string) => {
                this.password = value;
              })

            this.fieldLabel('确认主密码')
            TextInput({ placeholder: '再输一次' })
              .type(InputType.Password)
              .width('100%')
              .height(44)
              .backgroundColor(this.c().surface)
              .fontColor(this.c().text)
              .onChange((value: string) => {
                this.confirm = value;
              })

            Button('完成注册')
              .width('100%')
              .height(44)
              .backgroundColor(this.c().primary)
              .fontColor(this.c().primaryContrast)
              .enabled(!this.busy)
              .onClick(() => {
                void this.submit();
              })
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')
        }

        if (this.status !== '') {
          Text(this.status)
            .fontSize(13)
            .fontColor(this.statusColor)
        }

        Button('返回登录页')
          .width('100%')
          .height(44)
          .backgroundColor(this.c().surface)
          .fontColor(this.c().text)
          .enabled(!this.busy)
          .onClick(() => {
            router.replaceUrl({ url: 'pages/Index' });
          })
      }
      .width('100%')
      .constraintSize({ minHeight: '100%' })
      .justifyContent(FlexAlign.Center)
      .padding({ left: '8%', right: '8%' })
    }
    .backgroundColor(this.c().bg)
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
  }
}
