/**
 * SkinProbe.ets —— 临时自检页（仅用于验证，验证完从 main_pages / EntryAbility 移除）。
 *
 * 三项验证：
 *   ① 图标资源：Image($r('app.media.*')) / Image($rawfile(...)) / fillColor 着色是否可用
 *   ② 遮罩点阵：SkinScrim 在常态与「条件渲染弹层」里是否正常绘制（Canvas 首帧问题）
 *   ③ 行内按钮：SkinInlineBtn 在 Row + layoutWeight 组合下是否等宽、不撑破
 */
import { colorsOf, SkinId, ThemeColors, resolveDark, normalizeSkinId } from '../lib/theme';
import { SkinScrim, SkinInlineBtn, SkinIcon, SkinIconButton } from '../components/SkinChrome';

const SKIN_IDS: string[] = ['hud', 'lab', 'blueprint', 'mono', 'overprint'];
const SVG_ICONS: string[] = ['users', 'shield', 'palette', 'sync', 'logout'];

@Entry
@Component
struct SkinProbe {
  @StorageProp('skin') skin: string = 'hud';
  @StorageProp('darkMode') darkMode: string = 'system';
  @StorageProp('systemDark') systemDark: boolean = false;
  @State showOverlay: boolean = false;

  private c(): ThemeColors {
    return colorsOf(normalizeSkinId(this.skin), resolveDark(this.darkMode, this.systemDark));
  }

  private setSkin(v: string): void {
    AppStorage.setOrCreate('skin', v);
  }

  private setDark(v: boolean): void {
    AppStorage.setOrCreate('darkMode', v ? 'dark' : 'light');
  }

  @Builder
  SectionTitle(t: string) {
    Text(t)
      .fontSize(12)
      .fontWeight(FontWeight.Medium)
      .letterSpacing(1.2)
      .fontColor(this.c().muted)
      .width('100%')
      .margin({ top: 10, bottom: 2 })
  }

  @Builder
  ProbeIcon(name: string) {
    Column({ space: 3 }) {
      Image($r('app.media.' + name))
        .width(26)
        .height(26)
        .objectFit(ImageFit.Contain)
        .fillColor(this.c().text)
      Text(name)
        .fontSize(8)
        .fontColor(this.c().muted)
    }
  }

  build() {
    Stack() {
      Scroll() {
        Column({ space: 8 }) {
          Text('SKIN PROBE · 临时自检（验证后移除）')
            .fontSize(16)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.c().text)
            .width('100%')

          // ── 皮肤切换 ──
          this.SectionTitle('皮肤 / 明暗')
          Row({ space: 5 }) {
            ForEach(SKIN_IDS, (id: string) => {
              Text(id)
                .fontSize(10)
                .height(28)
                .layoutWeight(1)
                .textAlign(TextAlign.Center)
                .fontColor(this.skin === id ? this.c().primaryContrast : this.c().text)
                .backgroundColor(this.skin === id ? this.c().primary : this.c().surface)
                .borderRadius(this.c().radius)
                .border({ width: 1, color: this.c().border })
                .onClick(() => {
                  this.setSkin(id);
                })
            }, (id: string) => id)
          }
          .width('100%')
          Row({ space: 8 }) {
            Row() {
              SkinInlineBtn({
                label: '浅色', kind: 'ghost', btnHeight: 32, btnFontSize: 11,
                onTap: () => {
                  this.setDark(false);
                }
              })
            }.layoutWeight(1)
            Row() {
              SkinInlineBtn({
                label: '深色', kind: 'ghost', btnHeight: 32, btnFontSize: 11,
                onTap: () => {
                  this.setDark(true);
                }
              })
            }.layoutWeight(1)
          }
          .width('100%')

          // ── ① 图标资源 ──
          this.SectionTitle('① 图标资源：SVG($r) / PNG($r) / rawfile / fillColor')
          Row({ space: 12 }) {
            this.ProbeIcon('ic_users')
            this.ProbeIcon('ic_shield')
            this.ProbeIcon('ic_palette')
            this.ProbeIcon('ic_sync')
            this.ProbeIcon('ic_logout')
          }
          .width('100%')
          Row({ space: 12 }) {
            Column({ space: 3 }) {
              Image($r('app.media.ic_users_l')).width(26).height(26).objectFit(ImageFit.Contain)
              Text('PNG $r').fontSize(8).fontColor(this.c().muted)
            }
            Column({ space: 3 }) {
              Image($rawfile('ic_users_l.png')).width(26).height(26).objectFit(ImageFit.Contain)
              Text('rawfile').fontSize(8).fontColor(this.c().muted)
            }
            Column({ space: 3 }) {
              Image($r('app.media.icon')).width(26).height(26).objectFit(ImageFit.Contain)
              Text('icon.png').fontSize(8).fontColor(this.c().muted)
            }
            Column({ space: 3 }) {
              Image($r('app.media.ic_users')).width(26).height(26)
                .objectFit(ImageFit.Contain).fillColor(this.c().primary)
              Text('fillColor').fontSize(8).fontColor(this.c().muted)
            }
            Column({ space: 3 }) {
              Image($r('app.media.ic_users')).width(26).height(26)
                .objectFit(ImageFit.Contain).fillColor(this.c().danger)
              Text('fillColor2').fontSize(8).fontColor(this.c().muted)
            }
          }
          .width('100%')

          // ── ①b 组件级图标（SkinChrome.SkinIcon / SkinIconButton） ──
          this.SectionTitle('①b 组件级图标：SkinIcon / SkinIconButton（本轮已改 SVG）')
          Row({ space: 16 }) {
            SkinIcon({ iconName: 'users', iconSize: 22, iconColor: this.c().text })
            SkinIcon({ iconName: 'shield', iconSize: 22, iconColor: this.c().text })
            SkinIcon({ iconName: 'palette', iconSize: 22, iconColor: this.c().text })
            SkinIcon({ iconName: 'sync', iconSize: 22, iconColor: this.c().text })
            SkinIcon({ iconName: 'logout', iconSize: 22, iconColor: this.c().text })
          }
          .width('100%')
          Row({ space: 10 }) {
            SkinIconButton({
              iconName: 'users', iconSize: 22, iconColor: this.c().muted,
              onPick: () => {
              }
            })
            SkinIconButton({
              iconName: 'shield', iconSize: 22, iconColor: this.c().muted, dot: true,
              onPick: () => {
              }
            })
            SkinIconButton({
              iconName: 'palette', iconSize: 22, iconColor: this.c().muted,
              onPick: () => {
              }
            })
            SkinIconButton({
              iconName: 'logout', iconSize: 22, iconColor: this.c().muted,
              onPick: () => {
              }
            })
          }
          .width('100%')

          // ── ② 遮罩点阵（常驻小样） ──
          this.SectionTitle('② 遮罩点阵（SkinScrim 静态小样 200 高）')
          Stack() {
            SkinScrim()
            Column({ space: 4 }) {
              Text('面板示例').fontSize(13).fontColor(this.c().text)
              Text('遮罩 = 皮肤色 + 点阵').fontSize(10).fontColor(this.c().muted)
            }
            .padding(16)
            .backgroundColor(this.c().surface)
            .borderRadius(this.c().radiusCard)
          }
          .width('100%')
          .height(200)
          .clip(true)

          Row({ space: 8 }) {
            Row() {
              SkinInlineBtn({
                label: this.showOverlay ? '关闭条件渲染弹层' : '打开条件渲染弹层（Canvas 首帧测试）',
                kind: 'primary', btnHeight: 34, btnFontSize: 11,
                onTap: () => {
                  this.showOverlay = !this.showOverlay;
                }
              })
            }.layoutWeight(1)
          }
          .width('100%')

          // ── ③ 行内按钮 ──
          this.SectionTitle('③ 行内按钮：Row + layoutWeight 等宽')
          Row({ space: 10 }) {
            Row() {
              SkinInlineBtn({
                label: '取消', kind: 'ghost', btnHeight: 40, btnFontSize: 13,
                onTap: () => {
                }
              })
            }.layoutWeight(1)
            Row() {
              SkinInlineBtn({
                label: '保存', kind: 'primary', btnHeight: 40, btnFontSize: 13,
                onTap: () => {
                }
              })
            }.layoutWeight(1)
          }
          .width('100%')
          Row({ space: 10 }) {
            Row() {
              SkinInlineBtn({
                label: '编辑', kind: 'ghost', btnHeight: 34, btnFontSize: 12,
                onTap: () => {
                }
              })
            }.layoutWeight(1)
            Row() {
              SkinInlineBtn({
                label: '删除', kind: 'danger', btnHeight: 34, btnFontSize: 12,
                onTap: () => {
                }
              })
            }.layoutWeight(1)
          }
          .width('100%')
          Row({ space: 10 }) {
            Row() {
              SkinInlineBtn({
                label: '停用', kind: 'ghost', btnHeight: 30, btnFontSize: 11,
                onTap: () => {
                }
              })
            }.layoutWeight(1)
            Row() {
              SkinInlineBtn({
                label: '删除数据', kind: 'danger', btnHeight: 30, btnFontSize: 11,
                onTap: () => {
                }
              })
            }.layoutWeight(1)
            Row() {
              SkinInlineBtn({
                label: '禁用', kind: 'ghost', btnHeight: 30, btnFontSize: 11, disabled: true,
                onTap: () => {
                }
              })
            }.layoutWeight(1)
          }
          .width('100%')
          Row({ space: 10 }) {
            Row() {
              SkinInlineBtn({
                label: '跟随系统', kind: 'ghost', btnHeight: 34, btnFontSize: 11,
                onTap: () => {
                }
              })
            }.layoutWeight(1)
            Row() {
              SkinInlineBtn({
                label: '浅色', kind: 'primary', btnHeight: 34, btnFontSize: 11,
                onTap: () => {
                }
              })
            }.layoutWeight(1)
            Row() {
              SkinInlineBtn({
                label: '深色', kind: 'ghost', btnHeight: 34, btnFontSize: 11,
                onTap: () => {
                }
              })
            }.layoutWeight(1)
          }
          .width('100%')
        }
        .width('100%')
        .padding({ left: 14, right: 14, top: 14, bottom: 30 })
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .height('100%')
      .scrollBar(BarState.Off)

      // ── 条件渲染的全屏弹层（验证 Canvas 在 if 里的首帧绘制） ──
      if (this.showOverlay) {
        Stack() {
          SkinScrim()
          Column({ space: 10 }) {
            Text('条件渲染弹层').fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.c().text)
            Text('如果这一层没有点阵 => Canvas 在条件渲染里首帧失败，需要换 Text/Image 点阵方案。')
              .fontSize(11).fontColor(this.c().muted)
            Row({ space: 10 }) {
              Row() {
                SkinInlineBtn({
                  label: '关闭', kind: 'primary', btnHeight: 40,
                  onTap: () => {
                    this.showOverlay = false;
                  }
                })
              }.layoutWeight(1)
            }.width('100%')
          }
          .width('82%')
          .padding(18)
          .backgroundColor(this.c().surface)
          .border({ width: 1, color: this.c().borderStrong })
          .borderRadius(this.c().radiusCard)
          .shadow({ radius: 14, color: '#00000044', offsetX: 0, offsetY: 6 })
        }
        .width('100%')
        .height('100%')
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.c().bg)
  }
}
