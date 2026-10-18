/**
 * SkinChrome.ets —— 鸿蒙端「壳层风格化」组件。
 *
 * 每个皮肤都有自己的可辨认外观（顶栏信息条 + 页头词标 + 图形标记）：
 *   hud       工业终端：INDUSTRIAL // KEYBOX，信号黄刻度 + ASSET BAY
 *   lab       实验档案：LAB // SPECIMEN BAY，莱茵青标记 + 十字准星 + SPECIMEN REGISTRY
 *   blueprint 蓝图海报：INDEX // KEYBOX（黑底反白 + 青字）+ 巨型 ARCHIVE + 青环
 *   mono      黑白档案：KEYBOX // ARCHIVE（黑底反白 + 朱红）+ 宽字距 ARCHIVE + 红斜块
 *   overprint 套印图录：KEYBOX // VAULT，钴蓝圆点 + 衬线 THE ARCHIVE
 *
 * 用法（页面顶部放一行即可）：
 *   SkinBar({ title: '密钥库' })
 *   SkinBar({ title: '登录', bleed: 32 })   // 页面根容器有左右 padding 时，传负边距实现全宽
 *   SkinWordmark({ count: 12 })
 *
 * 组件自己订阅 AppStorage(skin/darkMode/systemDark)，页面无需传色值。
 */
import { colorsOf, normalizeSkinId, resolveDark, SkinId, ThemeColors } from '../lib/theme';

/** 弹层/面板的边框色（每套皮肤不同：蓝图青、档案红、其余用主题强边框）。 */
export function sheetBorderColor(skin: string): string {
  const k: SkinId = normalizeSkinId(skin);
  if (k === 'blueprint') return '#0ae0f0';
  if (k === 'mono') return '#c8102e';
  if (k === 'hud') return '#a99c82';
  if (k === 'lab') return '#aab3ac';
  return '#9fada8';
}

/**
 * 分区标题：标记色竖条 + 标题（每套皮肤不同字重/字距）+ 右侧附加信息 + 细分隔线。
 * 用来替换页面里朴素的 Text('标题')，让每个层级的标题都有皮肤语言。
 */
@Component
export struct SkinSection {
  @Prop title: string = '';
  @Prop extra: string = '';
  @StorageProp('skin') skin: string = 'hud';
  @StorageProp('darkMode') darkMode: string = 'system';
  @StorageProp('systemDark') systemDark: boolean = false;

  private skinId(): SkinId {
    return normalizeSkinId(this.skin);
  }

  private c(): ThemeColors {
    return colorsOf(this.skinId(), resolveDark(this.darkMode, this.systemDark));
  }

  private tSize(): number {
    const k: SkinId = this.skinId();
    if (k === 'blueprint') return 18;
    if (k === 'overprint') return 16;
    if (k === 'mono') return 14;
    return 13;
  }

  private tWeight(): FontWeight {
    const k: SkinId = this.skinId();
    if (k === 'blueprint') return FontWeight.Bolder;
    if (k === 'mono') return FontWeight.Lighter;
    if (k === 'hud') return FontWeight.Bold;
    return FontWeight.Medium;
  }

  private tTrack(): number {
    const k: SkinId = this.skinId();
    if (k === 'mono') return 2.5;
    if (k === 'hud') return 1.2;
    if (k === 'blueprint') return 0.4;
    return 0.8;
  }

  build() {
    Column({ space: 6 }) {
      Row({ space: 8 }) {
        Text('')
          .width(3)
          .height(14)
          .backgroundColor(skinAccentColor(this.skin))
        Text(this.title)
          .fontSize(this.tSize())
          .fontWeight(this.tWeight())
          .fontFamily(this.c().fontSans)
          .letterSpacing(this.tTrack())
          .fontColor(this.c().text)
          .layoutWeight(1)
          .maxLines(1)
        if (this.extra.length > 0) {
          Text(this.extra)
            .fontSize(10)
            .letterSpacing(1)
            .fontColor(this.c().muted)
        }
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      Row()
        .width('100%')
        .height(1)
        .backgroundColor(this.c().border)
    }
    .width('100%')
    .padding({ top: 4, bottom: 2 })
    .alignItems(HorizontalAlign.Start)
  }
}

/** 皮肤标记色（供页面自定义装饰复用）。 */
export function skinAccentColor(skin: string): string {
  const k: SkinId = normalizeSkinId(skin);
  if (k === 'lab') return '#2fb6b0';
  if (k === 'blueprint') return '#0ae0f0';
  if (k === 'mono') return '#e0433c';
  if (k === 'overprint') return '#4c6fff';
  return '#f2c300';
}

/** 卡片左上角的小标尺文字（每套皮肤一张"卡片身份"）。 */
export function skinCardTag(skin: string): string {
  const k: SkinId = normalizeSkinId(skin);
  if (k === 'lab') return 'SPECIMEN';
  if (k === 'blueprint') return 'RECORD';
  if (k === 'mono') return 'ARCHIVE';
  if (k === 'overprint') return 'PLATE';
  return 'ASSET';
}

/**
 * 皮肤底纹：**位于页面最底层**（第一个 Stack 子节点），自带页面底色，
 * 卡片/输入框是不透明的，会把底纹盖住 —— 所以纹理只出现在页面空白处。
 *
 * 每套皮肤纹理不同：
 *   hud       工程图纸：双向网格（40 格，5–6%）
 *   lab       实验记录：只有横向刻度线（26 条）
 *   blueprint 蓝图：粗网格（20 格，10–12%）
 *   mono      纯净：无纹理
 *   overprint 图版：只要稀疏竖线（14 条）
 */
@Component
export struct SkinBackdrop {
  @StorageProp('skin') skin: string = 'hud';
  @StorageProp('darkMode') darkMode: string = 'system';
  @StorageProp('systemDark') systemDark: boolean = false;

  private idxAll: number[] = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39
  ];

  private skinId(): SkinId {
    return normalizeSkinId(this.skin);
  }

  private c(): ThemeColors {
    return colorsOf(this.skinId(), resolveDark(this.darkMode, this.systemDark));
  }

  private lineCount(): number {
    const k: SkinId = this.skinId();
    if (k === 'lab') return 26;
    if (k === 'blueprint') return 20;
    if (k === 'overprint') return 14;
    if (k === 'mono') return 0;
    return 40;
  }

  private idx(): number[] {
    return this.idxAll.slice(0, this.lineCount());
  }

  private wantV(): boolean {
    const k: SkinId = this.skinId();
    return k === 'hud' || k === 'blueprint' || k === 'overprint';
  }

  private wantH(): boolean {
    const k: SkinId = this.skinId();
    return k === 'hud' || k === 'lab' || k === 'blueprint';
  }

  private lineAlpha(): string {
    const dark: boolean = resolveDark(this.darkMode, this.systemDark);
    const k: SkinId = this.skinId();
    if (k === 'blueprint') return dark ? '#0AE0F018' : '#0A8FA11C';
    if (k === 'lab') return dark ? '#E8EDEA10' : '#10121410';
    if (k === 'overprint') return dark ? '#E8EDEA0E' : '#10141812';
    if (k === 'hud') return dark ? '#FFFFFF08' : '#15140F0A';
    return '#00000000';
  }

  private orn(): string {
    return skinAccentColor(this.skin);
  }

  build() {
    Stack() {
      if (this.wantV()) {
        Row() {
          ForEach(this.idx(), (i: number) => {
            Text('')
              .width(1)
              .height('100%')
              .backgroundColor(this.lineAlpha())
              .hitTestBehavior(HitTestMode.None)
          }, (i: number) => 'v' + i.toString())
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.SpaceBetween)
        .hitTestBehavior(HitTestMode.None)
      }
      if (this.wantH()) {
        Column() {
          ForEach(this.idx(), (i: number) => {
            Text('')
              .width('100%')
              .height(1)
              .backgroundColor(this.lineAlpha())
              .hitTestBehavior(HitTestMode.None)
          }, (i: number) => 'h' + i.toString())
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.SpaceBetween)
        .hitTestBehavior(HitTestMode.None)
      }

      // ── 主题专属装饰元素（每套不同，全部不拦截触摸）──
      if (this.skinId() === 'hud') {
        // 工业终端：四角 L 形角标 + 顶部信号刻度
        Stack({ alignContent: Alignment.TopStart }) {
          Text('')
            .width(24)
            .height(24)
            .border({ width: { top: 2, left: 2 }, color: this.orn() })
            .margin({ left: 12, top: 12 })
        }
        .width('100%')
        .height('100%')
        .opacity(0.5)
        .hitTestBehavior(HitTestMode.None)
        Stack({ alignContent: Alignment.BottomEnd }) {
          Text('')
            .width(24)
            .height(24)
            .border({ width: { bottom: 2, right: 2 }, color: this.orn() })
            .margin({ right: 12, bottom: 12 })
        }
        .width('100%')
        .height('100%')
        .opacity(0.5)
        .hitTestBehavior(HitTestMode.None)
      } else if (this.skinId() === 'lab') {
        // 实验档案：右上准星框 + 左下细圆环
        Stack({ alignContent: Alignment.TopEnd }) {
          Text('')
            .width(18)
            .height(18)
            .border({ width: 1, color: this.orn() })
            .margin({ right: 16, top: 16 })
        }
        .width('100%')
        .height('100%')
        .opacity(0.6)
        .hitTestBehavior(HitTestMode.None)
        Stack({ alignContent: Alignment.BottomStart }) {
          Text('')
            .width(46)
            .height(46)
            .borderRadius(23)
            .border({ width: 1, color: this.orn() })
            .margin({ left: 14, bottom: 14 })
        }
        .width('100%')
        .height('100%')
        .opacity(0.45)
        .hitTestBehavior(HitTestMode.None)
      } else if (this.skinId() === 'blueprint') {
        // 蓝图海报：右下大圆环 + 左上小方块
        Stack({ alignContent: Alignment.BottomEnd }) {
          Text('')
            .width(132)
            .height(132)
            .borderRadius(66)
            .border({ width: 1.5, color: this.orn() })
            .margin({ right: -26, bottom: -26 })
        }
        .width('100%')
        .height('100%')
        .opacity(0.5)
        .hitTestBehavior(HitTestMode.None)
        Stack({ alignContent: Alignment.TopStart }) {
          Text('')
            .width(26)
            .height(26)
            .border({ width: 1, color: this.orn() })
            .margin({ left: 14, top: 14 })
        }
        .width('100%')
        .height('100%')
        .opacity(0.55)
        .hitTestBehavior(HitTestMode.None)
      } else if (this.skinId() === 'mono') {
        // 黑白档案：左侧朱红竖栏 + 右下红色斜块
        Stack({ alignContent: Alignment.Start }) {
          Text('')
            .width(3)
            .height('100%')
            .backgroundColor(this.orn())
        }
        .width('100%')
        .height('100%')
        .opacity(0.75)
        .hitTestBehavior(HitTestMode.None)
        Stack({ alignContent: Alignment.BottomEnd }) {
          Text('')
            .width(16)
            .height(16)
            .backgroundColor(this.orn())
            .margin({ right: 14, bottom: 14 })
            .rotate({ angle: 45 })
        }
        .width('100%')
        .height('100%')
        .opacity(0.55)
        .hitTestBehavior(HitTestMode.None)
      } else {
        // 套印图录：钴蓝圆点 + 底部刻度条
        Stack({ alignContent: Alignment.TopEnd }) {
          Text('')
            .width(12)
            .height(12)
            .borderRadius(6)
            .backgroundColor(this.orn())
            .margin({ right: 16, top: 16 })
        }
        .width('100%')
        .height('100%')
        .opacity(0.7)
        .hitTestBehavior(HitTestMode.None)
        Stack({ alignContent: Alignment.BottomStart }) {
          Row({ space: 5 }) {
            ForEach(this.idxAll.slice(0, 10), (i: number) => {
              Text('')
                .width(4)
                .height(i % 3 === 0 ? 14 : 8)
                .backgroundColor(this.orn())
            }, (i: number) => 'b' + i.toString())
          }
          .margin({ left: 16, bottom: 16 })
        }
        .width('100%')
        .height('100%')
        .opacity(0.6)
        .hitTestBehavior(HitTestMode.None)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.c().bg)
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
    .hitTestBehavior(HitTestMode.None)
  }
}

/** 信息条：每套皮肤一句「眉标 + 元信息 + 页标」，左端带皮肤标记色。 */
@Component
export struct SkinBar {
  @Prop title: string = '';
  @Prop count: number = 0;
  /** 负边距像素：页面根容器有左右 padding 时传进来，条子即可顶到屏幕边缘。 */
  @Prop bleed: number = 0;
  @StorageProp('skin') skin: string = 'hud';
  @StorageProp('darkMode') darkMode: string = 'system';
  @StorageProp('systemDark') systemDark: boolean = false;

  private skinId(): SkinId {
    return normalizeSkinId(this.skin);
  }

  private c(): ThemeColors {
    return colorsOf(this.skinId(), resolveDark(this.darkMode, this.systemDark));
  }

  private kicker(): string {
    const k: SkinId = this.skinId();
    if (k === 'lab') return 'LAB // SPECIMEN BAY';
    if (k === 'blueprint') return 'INDEX // KEYBOX';
    if (k === 'mono') return 'KEYBOX // ARCHIVE';
    if (k === 'overprint') return 'KEYBOX // VAULT';
    return 'INDUSTRIAL // KEYBOX';
  }

  private meta(): string {
    const k: SkinId = this.skinId();
    if (k === 'lab') return 'SAMPLE KB-OP-0007 · REV 03';
    if (k === 'blueprint') return '01 / 01';
    if (k === 'mono') return 'SERIES 07 · NO. 0042';
    if (k === 'overprint') return 'RECORD · 06';
    return 'UNIT KB-07 · LINK STABLE';
  }

  /** 蓝图与黑白档案用反白条（黑底白字）。 */
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

  /** 皮肤标记色：信号黄 / 莱茵青 / 蓝图青 / 朱红 / 钴蓝。 */
  private accent(): string {
    const k: SkinId = this.skinId();
    if (k === 'lab') return '#2fb6b0';
    if (k === 'blueprint') return '#0ae0f0';
    if (k === 'mono') return '#e0433c';
    if (k === 'overprint') return '#4c6fff';
    return '#f2c300';
  }

  build() {
    Row({ space: 8 }) {
      Text('')
        .width(3)
        .height(12)
        .backgroundColor(this.accent())
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
    .margin({ left: -this.bleed, right: -this.bleed })
    .backgroundColor(this.barBg())
    .border({ width: { bottom: 1 }, color: this.c().borderStrong })
    .alignItems(VerticalAlign.Center)
  }
}

/** 页头词标：皮肤决定文案/字重/字距，右侧带一个皮肤专属图形标记。 */
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

  private accent(): string {
    const k: SkinId = this.skinId();
    if (k === 'lab') return '#2fb6b0';
    if (k === 'blueprint') return '#0ae0f0';
    if (k === 'mono') return '#e0433c';
    if (k === 'overprint') return '#4c6fff';
    return '#f2c300';
  }

  private countText(): string {
    const n: number = this.count;
    return (n < 10 ? '0' : '') + n + ' / ' + (n < 10 ? '0' : '') + n;
  }

  build() {
    Row({ space: 10 }) {
      // 左端皮肤标记：竖条（固定高度，绝不能用百分比——父容器是整屏 Column 时会按屏高算，撑爆页头）
      Text('')
        .width(3)
        .height(26)
        .backgroundColor(this.accent())

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
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      // 右端皮肤专属图形标记：刻度 / 准星 / 圆环 / 斜块 / 圆点
      if (this.skinId() === 'hud') {
        Row({ space: 2 }) {
          Text('').width(3).height(18).backgroundColor(this.accent())
          Text('').width(3).height(12).backgroundColor(this.accent())
          Text('').width(3).height(6).backgroundColor(this.accent())
        }
        .alignItems(VerticalAlign.Bottom)
      } else if (this.skinId() === 'lab') {
        Text('')
          .width(18)
          .height(18)
          .border({ width: 1, color: this.accent() })
      } else if (this.skinId() === 'blueprint') {
        Text('')
          .width(18)
          .height(18)
          .borderRadius(9)
          .border({ width: 1.5, color: this.accent() })
      } else if (this.skinId() === 'mono') {
        Text('')
          .width(10)
          .height(18)
          .backgroundColor(this.accent())
      } else {
        Text('')
          .width(14)
          .height(14)
          .borderRadius(7)
          .backgroundColor(this.accent())
      }
    }
    .width('100%')
    .padding({ left: 14, right: 14, top: 8, bottom: 10 })
    .alignItems(VerticalAlign.Center)
  }
}
