/**
 * Vault.ets —— 密钥列表页（Phase 2：主题系统 + 一多断点版）。
 *
 * 响应式：媒体查询 600vp 分界——窄屏单列卡片；折叠屏展开/平板双列 Grid。
 * 主题：@StorageProp 驱动（skin/dark/wide 三键），colorsOf() 给出全套语义色；
 *       外观选择弹层可切 9 皮肤 × 明暗，全局即时生效。
 * 流程：RDB REST 拉本人密文（KB1）→ 本地解密渲染 → 增删改查（本机加密后上传）。
 */
import { router } from '@kit.ArkUI';
import { mediaquery } from '@kit.ArkUI';
import { pasteboard } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import {
  fetchSecretRows, insertSecretRow, updateSecretRow, deleteSecretRow
} from '../lib/kbapi';
import { kb1Decrypt, kb1Encrypt } from '../lib/kbcrypto';
import { getMasterKeyRaw, clearMasterKeyRaw, clearTokens } from '../lib/session';
import { colorsOf, SKINS, ThemeColors, SkinId, SkinDef, resolveDark } from '../lib/theme';
import { savePrefs } from '../lib/prefs';

const TAG: string = 'KeyBoxVault';

/** 一条密钥的明文字段（与 Web 端 SecretPlain 对齐；旧数据缺字段补空串）。 */
interface SecretPlain {
  site: string;
  url: string;
  website: string;
  model: string;
  key: string;
  note: string;
}

/** 列表渲染项。 */
class VaultItem {
  id: number = 0;
  site: string = '';
  url: string = '';
  website: string = '';
  model: string = '';
  key: string = '';
  note: string = '';
  tags: string[] = [];
  decryptError: boolean = false;
  decryptErrMsg: string = '';
}

function toPlain(p: Partial<SecretPlain> | null): SecretPlain {
  const s = p ?? {};
  return {
    site: typeof s.site === 'string' ? s.site : '',
    url: typeof s.url === 'string' ? s.url : '',
    website: typeof s.website === 'string' ? s.website : '',
    model: typeof s.model === 'string' ? s.model : '',
    key: typeof s.key === 'string' ? s.key : '',
    note: typeof s.note === 'string' ? s.note : ''
  };
}

@Entry
@Component
struct Vault {
  @StorageProp('skin') skin: string = 'default';
  @StorageProp('darkMode') darkMode: string = 'system';
  @StorageProp('systemDark') systemDark: boolean = false;
  @StorageProp('wide') isWide: boolean = false;
  @State items: VaultItem[] = [];
  @State loading: boolean = true;
  @State status: string = '';
  @State statusColor: string = '#64748b';
  @State dialogMode: string = '';
  @State editId: number = 0;
  @State fSite: string = '';
  @State fUrl: string = '';
  @State fWebsite: string = '';
  @State fModel: string = '';
  @State fKey: string = '';
  @State fNote: string = '';
  @State revealedKeys: string = '|';
  @State showAppearance: boolean = false;
  @State copyCountdown: number = 0;
  private copyTimerId: number = -1;
  private mqWide: mediaquery.MediaQueryListener | null = null;

  /** 当前皮肤的颜色集（随 skin/dark 变化自动刷新 UI）。 */
  c(): ThemeColors {
    return colorsOf(this.skin as SkinId, resolveDark(this.darkMode, this.systemDark));
  }

  aboutToAppear(): void {
    // 断点：≥600vp 视为宽屏（折叠屏展开/平板），双列
    this.mqWide = mediaquery.matchMediaSync('(min-width: 600vp)');
    this.mqWide.on('change', (result: mediaquery.MediaQueryResult) => {
      AppStorage.setOrCreate('wide', result.matches as boolean);
    });
    AppStorage.setOrCreate('wide', this.mqWide.matches as boolean);
    void this.load();
  }

  async load(): Promise<void> {
    const uid = AppStorage.get<string>('uid') ?? '';
    const accessToken = AppStorage.get<string>('accessToken') ?? '';
    const raw = getMasterKeyRaw() ?? new Uint8Array(0);
    this.loading = true;
    try {
      const rows = await fetchSecretRows(uid, accessToken);
      const items: VaultItem[] = [];
      for (const r of rows) {
        const it = new VaultItem();
        it.id = r.id;
        if (r.key_epoch !== (AppStorage.get<number>('keyEpoch') ?? 0)) {
          it.decryptError = true;
          it.decryptErrMsg = `密文代数 ${r.key_epoch} 与当前 ${AppStorage.get<number>('keyEpoch') ?? 0} 不一致`;
        } else {
          try {
            const p = toPlain(JSON.parse(await kb1Decrypt(raw, r.payload)) as Partial<SecretPlain>);
            it.site = p.site;
            it.url = p.url;
            it.website = p.website;
            it.model = p.model;
            it.key = p.key;
            it.note = p.note;
          } catch (e) {
            it.decryptError = true;
            it.decryptErrMsg = (e as Error).message;
            hilog.error(0x0000, TAG, 'decrypt row %{public}d failed: %{public}s',
              r.id, (e as Error).message);
          }
        }
        items.push(it);
      }
      this.items = items;
    } catch (e) {
      this.status = '加载失败：' + (e as Error).message;
      this.statusColor = this.c().danger;
    } finally {
      this.loading = false;
    }
  }

  isRevealed(id: number): boolean {
    return this.revealedKeys.indexOf('|' + id + '|') >= 0;
  }

  toggleReveal(id: number): void {
    if (this.isRevealed(id)) {
      this.revealedKeys = this.revealedKeys.split('|' + id + '|').join('|');
    } else {
      this.revealedKeys = this.revealedKeys + id + '|';
    }
  }

  copyText(text: string, tip: string): void {
    if (text === '') return;
    if (this.copyTimerId >= 0) {
      clearInterval(this.copyTimerId);
      this.copyTimerId = -1;
    }
    const systemPasteboard = pasteboard.getSystemPasteboard();
    const data = pasteboard.createData('text/plain', text);
    systemPasteboard.setData(data);
    this.copyCountdown = 30;
    this.status = '已复制：' + tip + '，30 秒后自动清空剪贴板';
    this.statusColor = this.c().success;
    let left = 30;
    this.copyTimerId = setInterval(() => {
      left -= 1;
      if (left > 0) {
        this.copyCountdown = left;
        this.status = '已复制：' + tip + '，' + left + ' 秒后自动清空剪贴板';
        return;
      }
      if (this.copyTimerId >= 0) {
        clearInterval(this.copyTimerId);
        this.copyTimerId = -1;
      }
      this.copyCountdown = 0;
      const empty = pasteboard.createData('text/plain', '');
      pasteboard.getSystemPasteboard().setData(empty);
      this.status = '剪贴板已自动清空';
    }, 1000);
  }

  openNew(): void {
    this.editId = 0;
    this.dialogMode = 'new';
    this.fSite = '';
    this.fUrl = '';
    this.fWebsite = '';
    this.fModel = '';
    this.fKey = '';
    this.fNote = '';
  }

  openEdit(it: VaultItem): void {
    this.editId = it.id;
    this.dialogMode = 'edit';
    this.fSite = it.site;
    this.fUrl = it.url;
    this.fWebsite = it.website;
    this.fModel = it.model;
    this.fKey = it.key;
    this.fNote = it.note;
  }

  closeDialog(): void {
    this.dialogMode = '';
  }

  busyGuard(on: boolean): void {
    this.loading = on;
  }

  async saveDialog(): Promise<void> {
    if (this.fSite.trim() === '') {
      this.status = '站点名不能为空';
      this.statusColor = this.c().danger;
      return;
    }
    if (this.fKey === '') {
      this.status = '密钥不能为空';
      this.statusColor = this.c().danger;
      return;
    }
    const uid = AppStorage.get<string>('uid') ?? '';
    const accessToken = AppStorage.get<string>('accessToken') ?? '';
    const raw = getMasterKeyRaw() ?? new Uint8Array(0);
    const keyEpoch = AppStorage.get<number>('keyEpoch') ?? 0;
    const plain: SecretPlain = {
      site: this.fSite.trim(),
      url: this.fUrl.trim(),
      website: this.fWebsite.trim(),
      model: this.fModel.trim(),
      key: this.fKey,
      note: this.fNote.trim()
    };
    this.busyGuard(true);
    try {
      const payload = await kb1Encrypt(raw, JSON.stringify(plain));
      if (this.editId === 0) {
        await insertSecretRow(payload, keyEpoch, accessToken);
      } else {
        await updateSecretRow(this.editId, payload, keyEpoch, accessToken);
      }
      this.closeDialog();
      await this.load();
      this.status = '已保存';
      this.statusColor = this.c().success;
    } catch (e) {
      this.status = '保存失败：' + (e as Error).message;
      this.statusColor = this.c().danger;
    } finally {
      this.busyGuard(false);
    }
  }

  async remove(it: VaultItem): Promise<void> {
    const accessToken = AppStorage.get<string>('accessToken') ?? '';
    this.busyGuard(true);
    try {
      await deleteSecretRow(it.id, accessToken);
      await this.load();
      this.status = '已删除：' + it.site;
      this.statusColor = this.c().success;
    } catch (e) {
      this.status = '删除失败：' + (e as Error).message;
      this.statusColor = this.c().danger;
    } finally {
      this.busyGuard(false);
    }
  }

  aboutToDisappear(): void {
    if (this.copyTimerId >= 0) {
      clearInterval(this.copyTimerId);
      this.copyTimerId = -1;
    }
  }

  signOut(): void {
    AppStorage.setOrCreate('uid', '');
    AppStorage.setOrCreate('accessToken', '');
    clearMasterKeyRaw();
    void clearTokens(); // 清持久化登录态
    router.replaceUrl({ url: 'pages/Index' });
  }

  build() {
    Stack() {
      Column() {
        // ── 顶栏 ──
        Row({ space: 10 }) {
          Text('KeyBox')
            .fontSize(18)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.c().text)
          Blank()
          Text('外观')
            .fontSize(13)
            .fontColor(this.c().muted)
            .onClick(() => {
              this.showAppearance = !this.showAppearance;
            })
          Text('退出登录')
            .fontSize(13)
            .fontColor(this.c().muted)
            .onClick(() => {
              this.signOut();
            })
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 10, bottom: 10 })

        // ── 工具行 ──
        Row() {
          Text('我的密钥')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.c().text)
          Blank()
          Button('+ 新增')
            .height(34)
            .fontSize(13)
            .backgroundColor(this.c().primary)
            .fontColor(this.c().primaryContrast)
            .onClick(() => {
              this.openNew();
            })
        }
        .width('100%')
        .padding({ left: 16, right: 16, bottom: 8 })

        if (this.status !== '') {
          Text(this.status)
            .fontSize(12)
            .fontColor(this.statusColor)
            .padding({ left: 16, right: 16 })
        }

        // ── 列表：窄屏单列 / 宽屏双列 ──
        if (this.loading && this.items.length === 0) {
          Column() {
            Text('加载中…').fontSize(13).fontColor(this.c().muted)
          }.width('100%').padding(40)
        } else if (this.items.length === 0) {
          Column() {
            Text('还没有密钥。点右上「+ 新增」开始。')
              .fontSize(13)
              .fontColor(this.c().muted)
          }.width('100%').padding(40)
        } else {
          Scroll() {
            Grid() {
              ForEach(this.items, (it: VaultItem) => {
                GridItem() {
                  this.SecretCard(it)
                }
              }, (it: VaultItem) => it.id.toString())
            }
            .columnsTemplate(this.isWide ? '1fr 1fr' : '1fr')
            .columnsGap(12)
            .rowsGap(12)
            .width('100%')
            .padding({ left: 16, right: 16, bottom: 24 })
          }
          .layoutWeight(1)
          .align(Alignment.Top)
          .scrollBar(BarState.Off)
        }
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.c().bg)
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])

      // ── 外观选择弹层 ──
      if (this.showAppearance) {
        Column() {
          Column({ space: 10 }) {
            Text('皮肤')
              .fontSize(13)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.c().muted)
            Scroll() {
              Column({ space: 6 }) {
                ForEach(SKINS, (s: SkinDef) => {
                  Row({ space: 8 }) {
                    Text(s.label)
                      .fontSize(14)
                      .fontColor(this.skin === s.id ? this.c().primary : this.c().text)
                    Blank()
                    Text(this.skin === s.id ? '✓' : '')
                      .fontSize(13)
                      .fontColor(this.c().primary)
                  }
                  .width('100%')
                  .padding(8)
                  .borderRadius(8)
                  .backgroundColor(this.skin === s.id ? this.c().surface2 : Color.Transparent)
                  .onClick(() => {
                    AppStorage.setOrCreate('skin', s.id);
                    void savePrefs(s.id, this.darkMode);
                  })
                }, (s: SkinDef) => s.id)
              }
              .width('100%')
            }
            .height(180)

            Text('明暗（默认跟随系统）')
              .fontSize(13)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.c().muted)
              .margin({ top: 4 })
            Row({ space: 6 }) {
              Button('跟随系统')
                .layoutWeight(1)
                .height(38)
                .fontSize(12)
                .backgroundColor(this.darkMode === 'system' ? this.c().primary : this.c().surface2)
                .fontColor(this.darkMode === 'system' ? this.c().primaryContrast : this.c().text)
                .onClick(() => {
                  AppStorage.setOrCreate('darkMode', 'system');
                  void savePrefs(this.skin, 'system');
                })
              Button('浅色')
                .layoutWeight(1)
                .height(38)
                .fontSize(12)
                .backgroundColor(this.darkMode === 'light' ? this.c().primary : this.c().surface2)
                .fontColor(this.darkMode === 'light' ? this.c().primaryContrast : this.c().text)
                .onClick(() => {
                  AppStorage.setOrCreate('darkMode', 'light');
                  void savePrefs(this.skin, 'light');
                })
              Button('深色')
                .layoutWeight(1)
                .height(38)
                .fontSize(12)
                .backgroundColor(this.darkMode === 'dark' ? this.c().primary : this.c().surface2)
                .fontColor(this.darkMode === 'dark' ? this.c().primaryContrast : this.c().text)
                .onClick(() => {
                  AppStorage.setOrCreate('darkMode', 'dark');
                  void savePrefs(this.skin, 'dark');
                })
            }
            .width('100%')

            Button('完成')
              .width('100%')
              .height(38)
              .backgroundColor(this.c().primary)
              .fontColor(this.c().primaryContrast)
              .onClick(() => {
                this.showAppearance = false;
              })
          }
          .alignItems(HorizontalAlign.Start)
          .width('86%')
          .padding(16)
          .backgroundColor(this.c().surface)
          .borderRadius(16)
        }
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .justifyContent(FlexAlign.Center)
        .onClick(() => {
          this.showAppearance = false;
        })
      }

      // ── 编辑/新增对话框 ──
      if (this.dialogMode !== '') {
        Column() {
          Scroll() {
            Column({ space: 10 }) {
              Text(this.dialogMode === 'new' ? '新增密钥' : '编辑密钥')
                .fontSize(16)
                .fontWeight(FontWeight.Medium)
                .fontColor(this.c().text)
              TextInput({ placeholder: '站点名（必填）', text: this.fSite })
                .height(42)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .onChange((v: string) => {
                  this.fSite = v;
                })
              TextInput({ placeholder: '接口地址（API URL）', text: this.fUrl })
                .height(42)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .onChange((v: string) => {
                  this.fUrl = v;
                })
              TextInput({ placeholder: '官网 / 控制台', text: this.fWebsite })
                .height(42)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .onChange((v: string) => {
                  this.fWebsite = v;
                })
              TextInput({ placeholder: '模型名（可多个）', text: this.fModel })
                .height(42)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .onChange((v: string) => {
                  this.fModel = v;
                })
              TextInput({ placeholder: '密钥（必填）', text: this.fKey })
                .height(42)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .onChange((v: string) => {
                  this.fKey = v;
                })
              TextInput({ placeholder: '备注（可选）', text: this.fNote })
                .height(42)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .onChange((v: string) => {
                  this.fNote = v;
                })
              Row({ space: 10 }) {
                Button('取消')
                  .layoutWeight(1)
                  .backgroundColor(this.c().surface2)
                  .fontColor(this.c().text)
                  .onClick(() => {
                    this.closeDialog();
                  })
                Button('保存')
                  .layoutWeight(1)
                  .backgroundColor(this.c().primary)
                  .fontColor(this.c().primaryContrast)
                  .onClick(() => {
                    void this.saveDialog();
                  })
              }
              .width('100%')
              .margin({ top: 6 })
            }
            .alignItems(HorizontalAlign.Start)
            .width('100%')
            .padding(18)
          }
          .width('92%')
          .constraintSize({ maxHeight: '86%' })
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

  @Builder
  SecretCard(it: VaultItem) {
    Column({ space: 8 }) {
      Row() {
        Text(it.site === '' ? '（未命名）' : it.site)
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.c().text)
          .layoutWeight(1)
        Text('复制站点')
          .fontSize(12)
          .fontColor(this.c().primary)
          .onClick(() => {
            this.copyText(it.site, it.site);
          })
      }
      .width('100%')

      if (it.decryptError) {
        Text('解密失败：' + it.decryptErrMsg)
          .fontSize(11)
          .fontColor(this.c().danger)
          .width('100%')
      }

      this.FieldRow('接口地址', it.url)
      this.FieldRow('官网', it.website)
      this.FieldRow('模型名', it.model)
      this.FieldRow('备注', it.note)

      Row({ space: 8 }) {
        Text('密钥')
          .fontSize(12)
          .fontColor(this.c().muted)
          .width(52)
        Text(this.isRevealed(it.id) ? it.key : '••••••••')
          .fontSize(12)
          .fontFamily('monospace')
          .fontColor(this.c().text)
          .layoutWeight(1)
          .maxLines(2)
        Text(this.isRevealed(it.id) ? '隐藏' : '显示')
          .fontSize(12)
          .fontColor(this.c().primary)
          .onClick(() => {
            this.toggleReveal(it.id);
          })
        Text('复制')
          .fontSize(12)
          .fontColor(this.isRevealed(it.id) ? this.c().primary : this.c().muted)
          .onClick(() => {
            if (this.isRevealed(it.id)) {
              this.copyText(it.key, it.site + ' 的密钥');
            }
          })
      }
      .width('100%')

      Row({ space: 10 }) {
        Button('编辑')
          .layoutWeight(1)
          .height(34)
          .fontSize(13)
          .backgroundColor(this.c().surface2)
          .fontColor(this.c().text)
          .onClick(() => {
            this.openEdit(it);
          })
        Button('删除')
          .layoutWeight(1)
          .height(34)
          .fontSize(13)
          .backgroundColor(this.c().danger)
          .fontColor(this.c().primaryContrast)
          .onClick(() => {
            void this.remove(it);
          })
      }
      .width('100%')
      .margin({ top: 4 })
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding(14)
    .backgroundColor(this.c().surface)
    .borderRadius(this.c().radiusCard)
    .border({ width: 0.5, color: this.c().border })
  }

  @Builder
  FieldRow(label: string, value: string) {
    if (value !== '') {
      Row({ space: 8 }) {
        Text(label)
          .fontSize(12)
          .fontColor(this.c().muted)
          .width(52)
        Text(value)
          .fontSize(12)
          .fontColor(this.c().text)
          .layoutWeight(1)
          .maxLines(1)
        Text('复制')
          .fontSize(12)
          .fontColor(this.c().primary)
          .onClick(() => {
            this.copyText(value, label);
          })
      }
      .width('100%')
    }
  }
}
