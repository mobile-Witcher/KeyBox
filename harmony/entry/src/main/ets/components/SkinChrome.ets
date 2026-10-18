/**
 * SkinChrome.ets —— 鸿蒙端「壳层风格化」组件。
 *
 * 每个皮肤都有自己的可辨认外观（对应 Web 端的顶栏信息条 + 页头词标）：
 *   hud       工业终端：INDUSTRIAL // KEYBOX · ASSET BAY
 *   lab       实验档案：LAB // SPECIMEN BAY · SPECIMEN REGISTRY
 *   blueprint 蓝图海报：INDEX 导航 · 巨型 ARCHIVE 词标（黑底反白条）
 *   mono      黑白档案：KEYBOX // ARCHIVE · 01 ARCHIVE（黑底反白条）
 *   overprint 套印图录：RECORD · THE ARCHIVE（衬线词标）
 *
 * 用法（页面顶部直接放一行即可）：
 *   SkinBar({ title: '密钥库' })
 *   SkinWordmark({ count: 12 })     // 只有需要大页头的页面才放
 *
 * 两个组件都自己订阅 AppStorage(skin/darkMode/systemDark)，页面无需传色值。
 */
import { colorsOf, normalizeSkinId, resolveDark, SkinId, ThemeColors } from '../lib/theme';

/** 信息条的皮肤化文案与配色。 */
@Component
export struct SkinBar {
  @Prop title: string = '';
  @Prop count: number = 0;
  @StorageProp('skin') skin: string = 'hud';
  @StorageProp('darkMode') darkMode: string = 'system';
  @StorageProp('systemDark') systemDark: boolean = false;

  private skinId(): SkinId {
    return normalizeSkinId(this.skin);
  }

  private c(): ThemeColors {
    return colorsOf(this.skinId(), resolveDark(this.darkMode, this.systemDark));
  }

  /** 左侧眉标（等宽大写，皮肤决定用词）。 */
  private kicker(): string {
    const k: SkinId = this.skinId();
    if (k === 'lab') return 'LAB // SPECIMEN BAY';
    if (k === 'blueprint') return 'INDEX // KEYBOX';
    if (k === 'mono') return 'KEYBOX // ARCHIVE';
    if (k === 'overprint') return 'KEYBOX // VAULT';
    return 'INDUSTRIAL // KEYBOX';
  }

  /** 右侧元信息（编号 / 计数 / 单位）。 */
  private meta(): string {
    const k: SkinId = this.skinId();
    if (k === 'lab') return 'SAMPLE KB-OP-0007 · REV 03';
    if (k === 'blueprint') return '01 / 01';
    if (k === 'mono') return 'SERIES 07 · NO. 0042';
    if (k === 'overprint') return 'RECORD · 06';
    return 'UNIT KB-07 · LINK STABLE';
  }

  /** 是否反白条（黑底白字）：蓝图与黑白档案用，其它用主题浅底。 */
  private hardBar(): boolean {
    const k: SkinId = this.skinId();
    return k === 'blueprint' || k === 'mono';
  }

  private barBg(): string {
    return this.hardBar() ? '#000000' : this.c().surface2;
  }

  private barFg(): string {
    if (!this.hardBar()) return this.c().muted;
    return this.skinId() === 'blueprint' ? '#0ae0f0' : '#e0433c';
  }

  private barTextFg(): string {
    return this.hardBar() ? '#f2f2f2' : this.c().text;
  }

  build() {
    Row({ space: 8 }) {
      Text(this.kicker())
        .fontSize(9)
        .letterSpacing(1.1)
        .fontColor(this.barFg())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
      Text(this.meta())
        .fontSize(9)
        .letterSpacing(1.1)
        .fontColor(this.hardBar() ? '#9aa3a6' : this.c().muted)
        .maxLines(1)
      if (this.title.length > 0) {
        Text(this.title)
          .fontSize(11)
          .fontColor(this.barTextFg())
          .margin({ left: 8 })
          .maxLines(1)
      }
    }
    .width('100%')
    .height(26)
    .padding({ left: 14, right: 14 })
    .backgroundColor(this.barBg())
    .border({ width: { bottom: 1 }, color: this.c().borderStrong })
    .alignItems(VerticalAlign.Center)
  }
}

/** 页头词标（巨型标题 + 计数），只在大页面用。 */
@Component
export struct SkinWordmark {
  @Prop count: number = 0;
  @StorageProp('skin') skin: string = 'hud';
  @StorageProp('darkMode') darkMode: string = 'system';
  @StorageProp('systemDark') systemDark: boolean = false;

  private skinId(): SkinId {
    return normalizeSkinId(this.skin);
  }

  private c(): ThemeColors {
    return colorsOf(this.skinId(), resolveDark(this.darkMode, this.systemDark));
  }

  private wordmark(): string {
    const k: SkinId = this.skinId();
    if (k === 'lab') return 'SPECIMEN REGISTRY';
    if (k === 'blueprint') return 'ARCHIVE';
    if (k === 'mono') return 'ARCHIVE';
    if (k === 'overprint') return 'THE ARCHIVE';
    return 'ASSET BAY';
  }

  private sub(): string {
    const k: SkinId = this.skinId();
    if (k === 'lab') return '标本登记 · 样本编号与周期';
    if (k === 'blueprint') return 'KEYBOX · ZERO-KNOWLEDGE VAULT';
    if (k === 'mono') return '01 · KEYBOX ARCHIVE';
    if (k === 'overprint') return '图录 · 索引与图版';
    return '工业终端 · 资产清单';
  }

  private wmSize(): number {
    const k: SkinId = this.skinId();
    if (k === 'blueprint') return 30;
    if (k === 'mono') return 24;
    if (k === 'lab') return 20;
    return 22;
  }

  private wmWeight(): FontWeight {
    const k: SkinId = this.skinId();
    if (k === 'blueprint') return FontWeight.Bolder;
    if (k === 'mono') return FontWeight.Lighter;
    if (k === 'lab') return FontWeight.Medium;
    return FontWeight.Bold;
  }

  private wmTracking(): number {
    const k: SkinId = this.skinId();
    if (k === 'mono') return 3.5;
    if (k === 'lab') return 1.4;
    if (k === 'overprint') return 0.6;
    if (k === 'blueprint') return 0.2;
    return 1.4;
  }

  build() {
    Column({ space: 3 }) {
      Text(this.wordmark())
        .fontSize(this.wmSize())
        .fontWeight(this.wmWeight())
        .fontColor(this.c().text)
        .letterSpacing(this.wmTracking())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%')
        .textAlign(TextAlign.Start)
      Row({ space: 8 }) {
        Text(this.sub())
          .fontSize(10)
          .letterSpacing(1)
          .fontColor(this.c().muted)
          .maxLines(1)
          .layoutWeight(1)
        if (this.count > 0) {
          Text(this.countText())
            .fontSize(11)
            .letterSpacing(1.2)
            .fontColor(this.c().primary)
        }
      }
      .width('100%')
    }
    .width('100%')
    .padding({ left: 14, right: 14, top: 6, bottom: 8 })
    .alignItems(HorizontalAlign.Start)
  }

  private countText(): string {
    const n: number = this.count;
    return (n < 10 ? '0' : '') + n + ' / ' + (n < 10 ? '0' : '') + n;
  }
}
