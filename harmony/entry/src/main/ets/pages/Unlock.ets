/**
 * Unlock.ets —— 解锁页（三模式：生物识别 / PIN / 主密码，主题化版）。
 *
 * 生物识别（优先）：HUKS 硬件密钥 + 指纹/面容门禁——主密钥密文用安全芯片密钥加密，
 *           解密必须通过生物认证（密钥在芯片内不可导出，安全性高于 PIN）。
 * PIN 模式：主密钥用 PIN 派生密钥加密存本机；连错 5 次销毁回退主密码。
 * 主密码模式：根防线，永远可用。
 * 首次主密码解锁成功后按设备能力引导设置（生物识别优先，不支持则 PIN，均可跳过）。
 */
import { router } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { deriveKeyRaw, kb1Decrypt } from '../lib/kbcrypto';
import { fetchMyKeyInfo } from '../lib/kbapi';
import { setMasterKeyRaw, getMasterKeyRaw } from '../lib/session';
import { initPinStore, hasPinLock, savePinLock, unlockWithPin, clearPinLock } from '../lib/pinlock';
import {
  initBioStore, hasBiometricLock, setupBiometric, unlockWithBiometric, getBioStatus
} from '../lib/biometric';
import { colorsOf, SkinId, ThemeColors, resolveDark } from '../lib/theme';
// warning 色经 c().warning 提供

const TAG: string = 'KeyBoxUnlock';
/** 与 Web 端 crypto.ts 的 VERIFIER_PLAINTEXT 一致——这是「解对了没」的判据。 */
const VERIFIER_PLAINTEXT: string = 'KeyBox-Verify';
const PBKDF2_ITERATIONS: number = 600000;
const PIN_MAX_FAILS: number = 5;

@Entry
@Component
struct Unlock {
  @StorageProp('skin') skin: string = 'default';
  @StorageProp('darkMode') darkMode: string = 'system';
  @StorageProp('systemDark') systemDark: boolean = false;
  @State mode: string = 'loading'; // 'loading' | 'bio' | 'pin' | 'password'
  @State hasPin: boolean = false;
  @State bioAvailable: boolean = false;
  @State bioReason: string = '';
  @State hasBioLock: boolean = false;
  @State pin: string = '';
  @State masterPassword: string = '';
  @State status: string = '';
  @State busy: boolean = false;
  @State pinFails: number = 0;
  @State showPinSetup: boolean = false;
  @State showBioSetup: boolean = false;
  @State pinNew: string = '';
  @State pinConfirm: string = '';
  @State pinSetupErr: string = '';
  @State bioSetupErr: string = '';

  c(): ThemeColors {
    return colorsOf(this.skin as SkinId, resolveDark(this.darkMode, this.systemDark));
  }

  aboutToAppear(): void {
    const context = getContext(this) as common.Context;
    void initPinStore(context)
      .then(() => initBioStore(context))
      .then(async () => {
        this.hasBioLock = await hasBiometricLock();
        const bio = await getBioStatus();
        this.bioAvailable = bio.available;
        this.bioReason = bio.reason;
        const has = await hasPinLock();
        // 模式选择：有生物识别包且设备支持 → bio；否则有 PIN → pin；否则主密码
        if (this.hasBioLock && this.bioAvailable) {
          this.mode = 'bio';
        } else if (has) {
          this.mode = 'pin';
        } else {
          this.mode = 'password';
        }
      })
      .catch(() => {
        this.mode = 'password';
      });
  }

  /** 生物识别解锁。 */
  async tryBio(): Promise<void> {
    this.busy = true;
    this.status = '';
    try {
      const raw = await unlockWithBiometric(); // 内部弹系统认证 UI
      if (raw === null) {
        this.status = '尚未设置生物识别解锁';
        return;
      }
      setMasterKeyRaw(raw);
      this.goVault();
    } catch (e) {
      this.status = (e as Error).message; // 取消/未通过/硬件错误
    } finally {
      this.busy = false;
    }
  }

  /** PIN 解锁。 */
  async tryPin(): Promise<void> {
    if (!/^\d{4,6}$/.test(this.pin)) {
      this.status = 'PIN 为 4-6 位数字';
      return;
    }
    this.busy = true;
    try {
      const raw = await unlockWithPin(this.pin);
      if (raw === null) {
        this.pinFails += 1;
        this.pin = '';
        if (this.pinFails >= PIN_MAX_FAILS) {
          await clearPinLock();
          this.hasPin = false;
          this.mode = 'password';
          this.status = `PIN 连错 ${PIN_MAX_FAILS} 次，已销毁快捷解锁，请用主密码解锁`;
        } else {
          this.status = `PIN 不正确（剩余 ${PIN_MAX_FAILS - this.pinFails} 次机会）`;
        }
        return;
      }
      setMasterKeyRaw(raw);
      this.goVault();
    } catch (e) {
      this.status = '解锁失败：' + (e as Error).message;
    } finally {
      this.busy = false;
    }
  }

  /** 主密码解锁。 */
  async unlockWithPassword(): Promise<void> {
    const uid = AppStorage.get<string>('uid') ?? '';
    const accessToken = AppStorage.get<string>('accessToken') ?? '';
    if (this.masterPassword === '') {
      this.status = '请输入主密码';
      return;
    }
    this.busy = true;
    this.status = '正在校验主密码…';
    try {
      const info = await fetchMyKeyInfo(uid, accessToken);
      if (info.status !== 'active') {
        throw new Error('账号已被停用');
      }
      const raw = await deriveKeyRaw(this.masterPassword, info.kdf_salt);
      let verifierPlain = '';
      try {
        verifierPlain = await kb1Decrypt(raw, info.kdf_verifier);
      } catch {
        verifierPlain = '';
      }
      if (verifierPlain !== VERIFIER_PLAINTEXT) {
        this.status = '主密码不正确。';
        return;
      }
      setMasterKeyRaw(raw);
      AppStorage.setOrCreate('keyEpoch', info.key_epoch);
      hilog.info(0x0000, TAG, 'unlock ok, keyEpoch=%{public}d', info.key_epoch);
      // 按设备能力引导设置快捷解锁：生物识别优先，不支持则 PIN
      if (!this.hasBioLock && this.bioAvailable) {
        this.showBioSetup = true;
        return;
      }
      const has = await hasPinLock();
      if (!has) {
        this.showPinSetup = true;
        return;
      }
      this.goVault();
    } catch (e) {
      this.status = '解锁失败：' + (e as Error).message;
    } finally {
      this.busy = false;
    }
  }

  /** 开启生物识别（弹系统认证并保存主密钥密文）。 */
  async enableBiometric(): Promise<void> {
    try {
      await setupBiometric(getMasterKeyRaw() ?? new Uint8Array(0));
      this.hasBioLock = true;
      this.bioAvailable = true;
      this.showBioSetup = false;
      this.goVault();
    } catch (e) {
      this.pinSetupErr = (e as Error).message;
      this.bioSetupErr = (e as Error).message;
    }
  }

  skipBioSetup(): void {
    this.showBioSetup = false;
    // 生物识别不可用/跳过 → 转 PIN 引导
    void hasPinLock().then((has: boolean) => {
      if (!has) {
        this.showPinSetup = true;
      } else {
        this.goVault();
      }
    });
  }

  /** 保存 PIN 并进入列表。 */
  async savePinSetup(): Promise<void> {
    if (!/^\d{4,6}$/.test(this.pinNew)) {
      this.pinSetupErr = 'PIN 必须是 4-6 位数字';
      return;
    }
    if (this.pinNew !== this.pinConfirm) {
      this.pinSetupErr = '两次输入的 PIN 不一致';
      return;
    }
    try {
      await savePinLock(this.pinNew, getMasterKeyRaw() ?? new Uint8Array(0));
      this.hasPin = true;
      this.showPinSetup = false;
      this.goVault();
    } catch (e) {
      this.pinSetupErr = (e as Error).message;
    }
  }

  skipPinSetup(): void {
    this.showPinSetup = false;
    this.goVault();
  }

  goVault(): void {
    router.replaceUrl({ url: 'pages/Vault' });
  }

  build() {
    Stack() {
      Column({ space: 14 }) {
        Text('KeyBox 解锁')
          .fontSize(22)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.c().text)

        // ── 生物识别模式 ──
        if (this.mode === 'bio') {
          Text('通过指纹 / 面容解锁')
            .fontSize(13)
            .fontColor(this.c().muted)
          Button('开始认证')
            .width('100%')
            .height(46)
            .backgroundColor(this.c().primary)
            .fontColor(this.c().primaryContrast)
            .enabled(!this.busy)
            .onClick(() => {
              void this.tryBio();
            })
          Text('使用 PIN 解锁 →')
            .fontSize(12)
            .fontColor(this.c().muted)
            .onClick(() => {
              this.mode = 'pin';
              this.status = '';
            })
          Text('使用主密码解锁 →')
            .fontSize(12)
            .fontColor(this.c().muted)
            .onClick(() => {
              this.mode = 'password';
              this.status = '';
            })
        }

        // ── PIN 模式 ──
        if (this.mode === 'pin') {
          Text('输入快捷 PIN')
            .fontSize(13)
            .fontColor(this.c().muted)
          TextInput({ placeholder: 'PIN（4-6 位数字）' })
            .type(InputType.Number)
            .width('100%')
            .height(44)
            .backgroundColor(this.c().surface)
            .fontColor(this.c().text)
            .onChange((value: string) => {
              this.pin = value;
            })
          Button(this.busy ? '校验中…' : '解锁')
            .width('100%')
            .height(44)
            .backgroundColor(this.c().primary)
            .fontColor(this.c().primaryContrast)
            .enabled(!this.busy)
            .onClick(() => {
              void this.tryPin();
            })
          if (this.bioAvailable && this.hasBioLock) {
            Text('使用指纹 / 面容解锁 →')
              .fontSize(12)
              .fontColor(this.c().muted)
              .onClick(() => {
                this.mode = 'bio';
                this.status = '';
              })
          }
          Text('使用主密码解锁 →')
            .fontSize(12)
            .fontColor(this.c().muted)
            .onClick(() => {
              this.mode = 'password';
              this.status = '';
              this.pin = '';
            })
        }

        // ── 主密码模式 ──
        if (this.mode === 'password') {
          TextInput({ placeholder: '主密码' })
            .type(InputType.Password)
            .width('100%')
            .height(44)
            .backgroundColor(this.c().surface)
            .fontColor(this.c().text)
            .onChange((value: string) => {
              this.masterPassword = value;
            })
          Button(this.busy ? '校验中…' : '解锁')
            .width('100%')
            .height(44)
            .backgroundColor(this.c().primary)
            .fontColor(this.c().primaryContrast)
            .enabled(!this.busy)
            .onClick(() => {
              void this.unlockWithPassword();
            })
          Text('主密码只在本机派生密钥，云端没有任何副本。')
            .fontSize(12)
            .fontColor(this.c().muted)
          if (!this.bioAvailable && this.bioReason !== '') {
            Text('生物识别不可用：' + this.bioReason)
              .fontSize(11)
              .fontColor(this.c().warning)
          }
        }

        if (this.mode === 'loading') {
          Text('加载中…').fontSize(13).fontColor(this.c().muted)
        }

        if (this.status !== '') {
          Text(this.status)
            .fontSize(13)
            .fontColor(this.c().danger)
        }
      }
      .width('100%')
      .height('100%')
      .justifyContent(FlexAlign.Center)
      .padding({ left: '8%', right: '8%' })
      .backgroundColor(this.c().bg)
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])

      // ── 生物识别设置引导（主密码解锁成功后，设备支持时优先弹这个） ──
      if (this.showBioSetup) {
        Column() {
          Column({ space: 10 }) {
            Text('开启指纹 / 面容解锁')
              .fontSize(16)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.c().text)
            Text('主密钥将由设备安全芯片保护，之后打开 App 只需验证指纹或面容。安全性高于 PIN。')
              .fontSize(12)
              .fontColor(this.c().muted)
            if (this.bioSetupErr !== '') {
              Text(this.bioSetupErr).fontSize(12).fontColor(this.c().danger)
            }
            Row({ space: 10 }) {
              Button('跳过')
                .layoutWeight(1)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .onClick(() => {
                  this.skipBioSetup();
                })
              Button('开启')
                .layoutWeight(1)
                .backgroundColor(this.c().primary)
                .fontColor(this.c().primaryContrast)
                .onClick(() => {
                  void this.enableBiometric();
                })
            }
            .width('100%')
            .margin({ top: 6 })
          }
          .alignItems(HorizontalAlign.Start)
          .width('86%')
          .padding(18)
          .backgroundColor(this.c().surface)
          .borderRadius(16)
        }
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .justifyContent(FlexAlign.Center)
      }

      // ── PIN 设置对话框（设备不支持生物识别时的引导） ──
      if (this.showPinSetup) {
        Column() {
          Column({ space: 10 }) {
            Text('设置快捷 PIN')
              .fontSize(16)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.c().text)
            Text('之后打开 App 只需输入 PIN，不必再输主密码。连错 5 次 PIN 将被销毁。')
              .fontSize(12)
              .fontColor(this.c().muted)
            TextInput({ placeholder: 'PIN（4-6 位数字）' })
              .type(InputType.Number)
              .height(42)
              .backgroundColor(this.c().surface2)
              .fontColor(this.c().text)
              .onChange((v: string) => {
                this.pinNew = v;
              })
            TextInput({ placeholder: '确认 PIN' })
              .type(InputType.Number)
              .height(42)
              .backgroundColor(this.c().surface2)
              .fontColor(this.c().text)
              .onChange((v: string) => {
                this.pinConfirm = v;
              })
            if (this.pinSetupErr !== '') {
              Text(this.pinSetupErr)
                .fontSize(12)
                .fontColor(this.c().danger)
            }
            Row({ space: 10 }) {
              Button('跳过')
                .layoutWeight(1)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .onClick(() => {
                  this.skipPinSetup();
                })
              Button('保存 PIN')
                .layoutWeight(1)
                .backgroundColor(this.c().primary)
                .fontColor(this.c().primaryContrast)
                .onClick(() => {
                  void this.savePinSetup();
                })
            }
            .width('100%')
            .margin({ top: 6 })
          }
          .alignItems(HorizontalAlign.Start)
          .width('86%')
          .padding(18)
          .backgroundColor(this.c().surface)
          .borderRadius(16)
        }
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .justifyContent(FlexAlign.Center)
      }
    }
    .width('100%')
    .height('100%')
  }
}
