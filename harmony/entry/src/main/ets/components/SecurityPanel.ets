/**
 * SecurityPanel.ets —— 安全面板（R21 改主密码 / R29 备份导出导入 / R28 恢复码状态）。
 *
 * 内容（照 Web 端 src/components/SecurityPanel.tsx 行为对齐）：
 *   - R28：恢复码「已抄下」确认（kbAckRecovery 写 recovery_ack_at）+ 未确认时持续提醒。
 *   - R29：导出全量密钥为明文 JSON 文件（@kit.CoreFileKit 文件选择器保存，导出前警告）；
 *           从文件导入（字段校验 normalize → 逐条用当前主密钥重加密 → insertSecretRow 上传）。
 *   - R21：改主密码——旧密码本机校验 → 全量旧 key 解密（一条失败整体中止）→ 新盐新 key 重加密
 *           → 恢复码重包裹（若已设）→ 单请求 kbRotateMaster（失败尽力回滚）→ 会话保持。
 *
 * 明文纪律：主密码/恢复码只在 @State 内存中短暂存在；成功/失败后立即清空；绝不写日志。
 * 主题：颜色一律走 --kb-* 语义令牌（c()），9 皮肤 × 深浅自动生效。
 */
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { buffer } from '@kit.ArkTS';
import { hilog } from '@kit.PerformanceAnalysisKit';
import {
  fetchSecretRows, insertSecretRow, fetchMyRole, rotateMasterRemote,
  ackRecoveryRemote, KbRotateItem
} from '../lib/kbapi';
import { kb1Decrypt, kb1Encrypt, deriveKeyRaw } from '../lib/kbcrypto';
import { generateSaltB64, normalizeRecoveryCode, wrapMasterKeyWithRecovery } from '../lib/kbrecovery';
import { setMasterKeyRaw, getMasterKeyRaw } from '../lib/session';
import { clearPinLock } from '../lib/pinlock';
import { clearBiometricLock } from '../lib/biometric';
import { colorsOf, SkinId, ThemeColors, resolveDark } from '../lib/theme';
import { SecretPlain, SecretWire, serializePlain, toPlain, toTags } from '../lib/secretcodec';

const TAG: string = 'KeyBoxSecurity';

/** 与 Web 端 crypto.ts 的 VERIFIER_PLAINTEXT 一致——「解对了没」的判据。 */
const VERIFIER_PLAINTEXT: string = 'KeyBox-Verify';
const IMPORT_MAX_BYTES: number = 10 * 1024 * 1024;

/** 凭据/密钥变更类操作的服务端既定行为提示（Web 端 SecurityPanel 同款文案，硬约束保留）。 */
const RELOGIN_CONFIRM_LINE: string =
  '此操作会使所有设备（含本机）退出登录，需要重新用手机号验证登录。';

/** 导出备份的单条明文记录（序列化用）。 */
class BackupItem {
  site: string = '';
  url: string = '';
  website: string = '';
  model: string = '';
  key: string = '';
  note: string = '';
  tags: string[] = [];
  updatedAt: string = '';
}

/** 导出备份文件根结构。 */
class BackupFile {
  app: string = 'KeyBox';
  version: number = 1;
  exportedAt: string = '';
  items: BackupItem[] = [];
}

@Component
export struct SecurityPanel {
  @StorageProp('skin') skin: string = 'default';
  @StorageProp('darkMode') darkMode: string = 'system';
  @StorageProp('systemDark') systemDark: boolean = false;
  /** 关闭面板（Vault 侧收起弹层）。 */
  onClose: () => void = () => {};
  /** 数据变更（改主密码成功 / 导入完成）后通知 Vault 重载列表。 */
  onDataChanged: () => void = () => {};

  @State busy: boolean = false;
  @State roleLoading: boolean = true;
  @State roleErr: string = '';
  @State panelErr: string = '';
  @State panelNotice: string = '';
  // kbGetMyRole 返回的密钥参数与恢复码状态
  @State kdfSalt: string = '';
  @State kdfVerifier: string = '';
  @State roleKeyEpoch: number = 0;
  @State recoverySalt: string = '';
  @State recoveryBlob: string = '';
  @State recoveryAckAt: string = '';
  // R21 表单
  @State oldPwd: string = '';
  @State newPwd: string = '';
  @State confirmPwd: string = '';
  @State recoveryCode: string = '';
  @State showRotateConfirm: boolean = false;
  @State showExportConfirm: boolean = false;

  c(): ThemeColors {
    return colorsOf(this.skin as SkinId, resolveDark(this.darkMode, this.systemDark));
  }

  aboutToAppear(): void {
    void this.refreshRole();
  }

  /** 拉取本人角色/密钥参数/恢复码状态（kbGetMyRole；recovery_* 仅回本人）。 */
  async refreshRole(): Promise<void> {
    const accessToken = AppStorage.get<string>('accessToken') ?? '';
    this.roleLoading = true;
    this.roleErr = '';
    try {
      const role = await fetchMyRole(accessToken);
      this.kdfSalt = role.kdfSalt;
      this.kdfVerifier = role.kdfVerifier;
      this.roleKeyEpoch = role.keyEpoch;
      this.recoverySalt = role.recoverySalt;
      this.recoveryBlob = role.recoveryBlob;
      this.recoveryAckAt = role.recoveryAckAt;
    } catch (e) {
      this.roleErr = (e as Error).message;
      hilog.error(0x0000, TAG, 'refreshRole failed: %{public}s', (e as Error).message);
    } finally {
      this.roleLoading = false;
    }
  }

  /** 本账号是否已设恢复码（salt 与 blob 成对）。 */
  hasRecovery(): boolean {
    return this.recoverySalt !== '' && this.recoveryBlob !== '';
  }

  // ── R28：确认已抄下恢复码 ──

  async handleAckRecovery(): Promise<void> {
    const accessToken = AppStorage.get<string>('accessToken') ?? '';
    this.busy = true;
    this.panelErr = '';
    this.panelNotice = '';
    try {
      await ackRecoveryRemote(accessToken);
      await this.refreshRole();
      this.panelNotice = '已记录：你已抄写并妥善保管恢复码。';
    } catch (e) {
      this.panelErr = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }

  // ── R29：导出（明文 JSON，文件选择器保存） ──

  async doExport(): Promise<void> {
    const uid = AppStorage.get<string>('uid') ?? '';
    const accessToken = AppStorage.get<string>('accessToken') ?? '';
    const raw = getMasterKeyRaw() ?? new Uint8Array(0);
    const keyEpoch = AppStorage.get<number>('keyEpoch') ?? 0;
    this.busy = true;
    this.showExportConfirm = false;
    this.panelErr = '';
    this.panelNotice = '';
    try {
      const rows = await fetchSecretRows(uid, accessToken);
      const file = new BackupFile();
      file.exportedAt = new Date().toISOString();
      let skipped = 0;
      for (const r of rows) {
        if (r.key_epoch !== keyEpoch) {
          skipped += 1;
          continue;
        }
        try {
          const w = JSON.parse(await kb1Decrypt(raw, r.payload)) as SecretWire;
          const p = toPlain(w);
          const it = new BackupItem();
          it.site = p.site;
          it.url = p.url;
          it.website = p.website;
          it.model = p.model;
          it.key = p.key;
          it.note = p.note;
          it.tags = toTags(w);
          it.updatedAt = r.updated_at;
          file.items.push(it);
        } catch (e) {
          skipped += 1; // 解密失败的条目跳过，不阻断导出
        }
      }
      if (file.items.length === 0) {
        this.panelErr = '没有可导出的密钥。';
        return;
      }
      // 系统文件选择器：用户选保存位置（无需存储权限）
      const saveOptions = new picker.DocumentSaveOptions();
      const now = new Date();
      const stamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}` +
        `${now.getDate().toString().padStart(2, '0')}-${now.getHours().toString().padStart(2, '0')}` +
        `${now.getMinutes().toString().padStart(2, '0')}`;
      saveOptions.newFileNames = [`keybox-export-${stamp}.json`];
      const docPicker = new picker.DocumentViewPicker();
      const uris = await docPicker.save(saveOptions);
      if (uris === undefined || uris.length === 0) {
        this.panelNotice = '已取消导出。';
        return;
      }
      const outFile = fs.openSync(uris[0],
        fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
      fs.writeSync(outFile.fd, JSON.stringify(file));
      fs.closeSync(outFile);
      this.panelNotice = `已导出 ${file.items.length} 条到 JSON 文件` +
        (skipped > 0 ? `（${skipped} 条解密失败已跳过）` : '') +
        '。明文文件，请妥善保管，建议用后尽快删除。';
    } catch (e) {
      this.panelErr = '导出失败：' + (e as Error).message;
      hilog.error(0x0000, TAG, 'export failed: %{public}s', (e as Error).message);
    } finally {
      this.busy = false;
    }
  }

  // ── R29：导入（文件选择器读取 → normalize 校验 → 逐条重加密上传） ──

  async doImport(): Promise<void> {
    const accessToken = AppStorage.get<string>('accessToken') ?? '';
    const raw = getMasterKeyRaw() ?? new Uint8Array(0);
    const keyEpoch = AppStorage.get<number>('keyEpoch') ?? 0;
    this.busy = true;
    this.panelErr = '';
    this.panelNotice = '';
    try {
      const selectOptions = new picker.DocumentSelectOptions();
      selectOptions.maxSelectNumber = 1;
      const docPicker = new picker.DocumentViewPicker();
      const uris = await docPicker.select(selectOptions);
      if (uris === undefined || uris.length === 0) {
        return; // 用户取消
      }
      const inFile = fs.openSync(uris[0], fs.OpenMode.READ_ONLY);
      const stat = fs.statSync(inFile.fd);
      if (stat.size > IMPORT_MAX_BYTES) {
        fs.closeSync(inFile);
        throw new Error('文件过大（超过 10MB），疑似不是 KeyBox 导出文件');
      }
      const buf = new ArrayBuffer(stat.size);
      fs.readSync(inFile.fd, buf);
      fs.closeSync(inFile);
      const text = buffer.from(new Uint8Array(buf).buffer).toString('utf-8');
      // 解析与字段校验（normalize 模式：非法字段补空/跳过）
      const root = JSON.parse(text) as Record<string, Object>;
      const rawItems = root['items'];
      if (rawItems === undefined || rawItems === null || !Array.isArray(rawItems)) {
        throw new Error('文件结构不是 KeyBox 导出（缺少 items 数组）');
      }
      const entries = rawItems as Object[];
      let imported = 0;
      let skipped = 0;
      for (let i = 0; i < entries.length; i++) {
        const entry: Object | null = entries[i];
        if (typeof entry !== 'object' || entry === null) {
          skipped += 1;
          continue;
        }
        const w = entry as SecretWire;
        const p: SecretPlain = toPlain(w);
        const tags: string[] = toTags(w);
        // 站点名与密钥是必填（与新增对话框一致），缺一跳过
        if (p.site.trim() === '' || p.key === '') {
          skipped += 1;
          continue;
        }
        const payload = await kb1Encrypt(raw, serializePlain(p, tags));
        await insertSecretRow(payload, keyEpoch, accessToken);
        imported += 1;
      }
      this.panelNotice = `已导入 ${imported} 条（${skipped} 条格式非法已跳过）。`;
      this.onDataChanged();
    } catch (e) {
      this.panelErr = '导入失败：' + (e as Error).message;
      hilog.error(0x0000, TAG, 'import failed: %{public}s', (e as Error).message);
    } finally {
      this.busy = false;
    }
  }

  // ── R21：改主密码 ──

  /** 表单校验（通过后弹确认框；实际执行在 doRotate）。 */
  handleChangeMaster(): void {
    this.panelErr = '';
    this.panelNotice = '';
    if (this.oldPwd === '' || this.newPwd === '') {
      this.panelErr = '请填写原主密码与新主密码。';
      return;
    }
    if (this.newPwd.length < 8) {
      this.panelErr = '新主密码至少 8 位。';
      return;
    }
    if (this.newPwd !== this.confirmPwd) {
      this.panelErr = '两次输入的新主密码不一致。';
      return;
    }
    if (this.hasRecovery() && this.recoveryCode.trim() === '') {
      this.panelErr = '本账号已设恢复码：请再次输入恢复码，以便用新主密钥重包裹（否则恢复码将失效）。';
      return;
    }
    this.showRotateConfirm = true;
  }

  /** R21 全流程（事务性：本地重加密未全部成功前不调 rotateMaster；失败尽力回滚）。 */
  async doRotate(): Promise<void> {
    const uid = AppStorage.get<string>('uid') ?? '';
    const accessToken = AppStorage.get<string>('accessToken') ?? '';
    const oldSalt = this.kdfSalt;
    const oldVerifier = this.kdfVerifier;
    this.busy = true;
    this.showRotateConfirm = false;
    this.panelErr = '';
    this.panelNotice = '';
    try {
      // ① 本机校验原主密码（解 kdf_verifier 比对固定串）
      const oldRaw = await deriveKeyRaw(this.oldPwd, oldSalt);
      let verifierPlain = '';
      try {
        verifierPlain = await kb1Decrypt(oldRaw, oldVerifier);
      } catch (e) {
        verifierPlain = '';
      }
      if (verifierPlain !== VERIFIER_PLAINTEXT) {
        this.panelErr = '原主密码不正确。';
        return;
      }
      // ② 拉取服务端全量并用旧 key 逐条解密；任何一条失败 → 整体中止（绝不半新半旧）
      const rows = await fetchSecretRows(uid, accessToken);
      const ids: number[] = [];
      const texts: string[] = [];
      for (const r of rows) {
        let text = '';
        try {
          text = await kb1Decrypt(oldRaw, r.payload);
        } catch (e) {
          this.panelErr =
            `改主密码已整体中止：第 ${r.id} 条密文无法用旧主密码解开。请确认主密码正确后再试。`;
          return;
        }
        ids.push(r.id);
        texts.push(text);
      }
      // ③ 新盐 → 新 key → 全量重加密（纯内存）
      const newSalt = generateSaltB64();
      const newRaw = await deriveKeyRaw(this.newPwd, newSalt);
      const items: KbRotateItem[] = [];
      for (let i = 0; i < ids.length; i++) {
        const payload = await kb1Encrypt(newRaw, texts[i]);
        const it: KbRotateItem = { id: ids[i], payload: payload };
        items.push(it);
      }
      // ④ 新校验串 + 可选恢复码重包裹（在提交前完成，失败即中止、服务端未动）
      const newVerifier = await kb1Encrypt(newRaw, VERIFIER_PLAINTEXT);
      let newBlob = '';
      if (this.hasRecovery()) {
        newBlob = await wrapMasterKeyWithRecovery(
          normalizeRecoveryCode(this.recoveryCode), this.recoverySalt, newSalt, newRaw);
      }
      // ⑤ 单请求提交整批重写（key_epoch+1 由服务端做）
      let newEpoch = 0;
      try {
        newEpoch = await rotateMasterRemote(newSalt, oldSalt, newVerifier, newBlob, items, accessToken);
      } catch (rotateErr) {
        // ⑥ 失败：用旧材料整批覆盖回云端（尽力而为；函数原子，通常无需回滚）
        try {
          const rollbackItems: KbRotateItem[] = [];
          for (const r of rows) {
            const it: KbRotateItem = { id: r.id, payload: r.payload };
            rollbackItems.push(it);
          }
          await rotateMasterRemote(oldSalt, oldSalt, oldVerifier, '', rollbackItems, accessToken);
        } catch (rollbackErr) {
          hilog.error(0x0000, TAG, 'rollback also failed: %{public}s', (rollbackErr as Error).message);
        }
        throw new Error('改主密码失败（已尝试回滚），主密码未变更，请稍后重试。原因：' +
          (rotateErr as Error).message);
      }
      // ⑦ 成功：更新内存主密钥与代数（会话保持，无需重新登录）；失效 PIN/生物解锁（包裹的是旧密钥）
      setMasterKeyRaw(newRaw);
      AppStorage.setOrCreate('keyEpoch', newEpoch);
      await clearPinLock();
      await clearBiometricLock();
      this.oldPwd = '';
      this.newPwd = '';
      this.confirmPwd = '';
      this.recoveryCode = '';
      this.panelNotice =
        `主密码已更新（密钥代数 → ${newEpoch}）。请用新主密码解锁。其他设备下次打开需要重新登录。`;
      await this.refreshRole();
      this.onDataChanged();
    } catch (e) {
      this.panelErr = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }

  build() {
    Stack() {
      // 遮罩（点击空白处关闭；busy 中不响应，防误触打断）
      Column() {
      }
      .width('100%')
      .height('100%')
      .backgroundColor('rgba(0,0,0,0.5)')
      .onClick(() => {
        if (!this.busy) {
          this.onClose();
        }
      })

      // 面板卡片
      Scroll() {
        Column({ space: 14 }) {
          Row() {
            Text('安全')
              .fontSize(16)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.c().text)
            Blank()
            Text('关闭')
              .fontSize(13)
              .fontColor(this.c().muted)
              .enabled(!this.busy)
              .onClick(() => {
                this.onClose();
              })
          }
          .width('100%')

          if (this.roleLoading) {
            Text('读取安全信息…').fontSize(12).fontColor(this.c().muted)
          }
          if (this.panelErr !== '') {
            Text(this.panelErr)
              .fontSize(12)
              .fontColor(this.c().danger)
              .width('100%')
          }
          if (this.panelNotice !== '') {
            Text(this.panelNotice)
              .fontSize(12)
              .fontColor(this.c().success)
              .width('100%')
          }

          // ── R28：恢复码状态 ──
          Column({ space: 8 }) {
            Text('恢复码（R28）')
              .fontSize(13)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.c().text)
            if (this.hasRecovery()) {
              if (this.recoveryAckAt === '') {
                Text('你还没有确认已抄下恢复码。恢复码用于在主密码遗忘时找回数据；若未妥善保管，将无法恢复。确认后此提醒会消失。')
                  .fontSize(12)
                  .fontColor(this.c().warning)
                  .width('100%')
                Button('我已抄下并自行保管')
                  .height(36)
                  .fontSize(13)
                  .backgroundColor(this.c().warning)
                  .fontColor(this.c().primaryContrast)
                  .enabled(!this.busy)
                  .onClick(() => {
                    void this.handleAckRecovery();
                  })
              } else {
                Text('恢复码已确认妥善保管。')
                  .fontSize(12)
                  .fontColor(this.c().success)
              }
            } else {
              Text('本账号尚未设置恢复码。恢复码在网页端注册 / 初始化账号时生成；遗忘主密码时可用它找回数据。')
                .fontSize(12)
                .fontColor(this.c().muted)
                .width('100%')
            }
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')

          Divider().color(this.c().border)

          // ── R29：备份导出 / 导入 ──
          Column({ space: 8 }) {
            Text('备份导出 / 导入（R29）')
              .fontSize(13)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.c().text)
            Text('导出为明文 JSON 文件（含全部密钥明文与接口地址），导入时逐条用当前主密钥重新加密上传。')
              .fontSize(11)
              .fontColor(this.c().muted)
              .width('100%')
            Row({ space: 10 }) {
              Button(this.busy ? '处理中…' : '导出备份')
                .layoutWeight(1)
                .height(36)
                .fontSize(13)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .enabled(!this.busy)
                .onClick(() => {
                  this.showExportConfirm = true; // 导出前明文警告
                })
              Button('导入备份')
                .layoutWeight(1)
                .height(36)
                .fontSize(13)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .enabled(!this.busy)
                .onClick(() => {
                  void this.doImport();
                })
            }
            .width('100%')
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')

          Divider().color(this.c().border)

          // ── R21：改主密码 ──
          Column({ space: 8 }) {
            Text('修改主密码（R21）')
              .fontSize(13)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.c().text)
            Text('本机会用原主密码逐条解密、用新主密码重加密后再整批提交；任何一条失败都会整体中止，不会产生「半新半旧」。')
              .fontSize(11)
              .fontColor(this.c().muted)
              .width('100%')
            Text('注意：' + RELOGIN_CONFIRM_LINE)
              .fontSize(11)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.c().warning)
              .width('100%')
            TextInput({ placeholder: '原主密码' })
              .type(InputType.Password)
              .height(40)
              .backgroundColor(this.c().surface2)
              .fontColor(this.c().text)
              .enabled(!this.busy)
              .onChange((v: string) => {
                this.oldPwd = v;
              })
            TextInput({ placeholder: '新主密码（至少 8 位）' })
              .type(InputType.Password)
              .height(40)
              .backgroundColor(this.c().surface2)
              .fontColor(this.c().text)
              .enabled(!this.busy)
              .onChange((v: string) => {
                this.newPwd = v;
              })
            TextInput({ placeholder: '确认新主密码' })
              .type(InputType.Password)
              .height(40)
              .backgroundColor(this.c().surface2)
              .fontColor(this.c().text)
              .enabled(!this.busy)
              .onChange((v: string) => {
                this.confirmPwd = v;
              })
            if (this.hasRecovery()) {
              TextInput({ placeholder: '恢复码（用于重包裹，保持其可用）' })
                .type(InputType.Normal)
                .height(40)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .enabled(!this.busy)
                .onChange((v: string) => {
                  this.recoveryCode = v;
                })
            }
            Button(this.busy ? '处理中…' : '修改主密码')
              .height(40)
              .fontSize(13)
              .backgroundColor(this.c().primary)
              .fontColor(this.c().primaryContrast)
              .enabled(!this.busy)
              .onClick(() => {
                this.handleChangeMaster();
              })
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')
        }
        .alignItems(HorizontalAlign.Start)
        .width('100%')
        .padding(18)
      }
      .width('90%')
      .constraintSize({ maxHeight: '88%' })
      .backgroundColor(this.c().surface)
      .borderRadius(this.c().radiusCard)
      .align(Alignment.Top)

      // ── 改主密码确认对话框（硬约束：保留「所有设备退出登录」提示） ──
      if (this.showRotateConfirm) {
        Column() {
          Column({ space: 12 }) {
            Text('确认修改主密码？')
              .fontSize(15)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.c().text)
            Text(`即将修改主密码：本机会用原主密码逐条解密、用新主密码重加密后整批提交。\n\n${RELOGIN_CONFIRM_LINE}\n\n确认继续？`)
              .fontSize(12)
              .fontColor(this.c().text)
            Row({ space: 10 }) {
              Button('取消')
                .layoutWeight(1)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .onClick(() => {
                  this.showRotateConfirm = false;
                })
              Button('确认')
                .layoutWeight(1)
                .backgroundColor(this.c().primary)
                .fontColor(this.c().primaryContrast)
                .onClick(() => {
                  void this.doRotate();
                })
            }
            .width('100%')
          }
          .alignItems(HorizontalAlign.Start)
          .width('86%')
          .padding(18)
          .backgroundColor(this.c().surface)
          .borderRadius(this.c().radiusCard)
        }
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .justifyContent(FlexAlign.Center)
        .align(Alignment.Center)
      }

      // ── 导出前明文警告确认对话框 ──
      if (this.showExportConfirm) {
        Column() {
          Column({ space: 12 }) {
            Text('确认导出备份？')
              .fontSize(15)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.c().text)
            Text('导出的是【明文】JSON 文件，包含全部密钥明文、接口地址等敏感信息。请妥善保管，导出后建议尽快删除。确认导出？')
              .fontSize(12)
              .fontColor(this.c().text)
            Row({ space: 10 }) {
              Button('取消')
                .layoutWeight(1)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .onClick(() => {
                  this.showExportConfirm = false;
                })
              Button('确认导出')
                .layoutWeight(1)
                .backgroundColor(this.c().primary)
                .fontColor(this.c().primaryContrast)
                .onClick(() => {
                  void this.doExport();
                })
            }
            .width('100%')
          }
          .alignItems(HorizontalAlign.Start)
          .width('86%')
          .padding(18)
          .backgroundColor(this.c().surface)
          .borderRadius(this.c().radiusCard)
        }
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .justifyContent(FlexAlign.Center)
        .align(Alignment.Center)
      }
    }
    .width('100%')
    .height('100%')
  }
}
