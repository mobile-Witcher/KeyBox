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

/** 弹层遮罩色（每套皮肤不同的压暗方式）。 */
export function scrimColor(skin: string): string {
  const k: SkinId = normalizeSkinId(skin);
  if (k === 'blueprint') return '#00000099';
  if (k === 'mono') return '#0000008C';
  if (k === 'hud') return '#15140F80';
  if (k === 'lab') return '#10121466';
  return '#0B0F1273';
}

/** 弹层出现/消失的过渡（每套皮肤不同的时长、曲线与位移方向）。 */
export function sheetTransition(skin: string): TransitionEffect {
  const k: SkinId = normalizeSkinId(skin);
  if (k === 'blueprint') {
    return TransitionEffect.OPACITY.animation({ duration: 160, curve: Curve.Friction })
      .combine(TransitionEffect.translate({ y: -10 }).animation({ duration: 160, curve: Curve.Friction }));
  }
  if (k === 'mono') {
    return TransitionEffect.OPACITY.animation({ duration: 120, curve: Curve.Sharp })
      .combine(TransitionEffect.translate({ x: 12 }).animation({ duration: 120, curve: Curve.Sharp }));
  }
  if (k === 'lab') {
    return TransitionEffect.OPACITY.animation({ duration: 220, curve: Curve.EaseOut })
      .combine(TransitionEffect.scale({ x: 0.98, y: 0.98 }).animation({ duration: 220, curve: Curve.EaseOut }));
  }
  if (k === 'overprint') {
    return TransitionEffect.OPACITY.animation({ duration: 260, curve: Curve.EaseInOut })
      .combine(TransitionEffect.translate({ y: 14 }).animation({ duration: 260, curve: Curve.EaseInOut }));
  }
  return TransitionEffect.OPACITY.animation({ duration: 150, curve: Curve.EaseOut })
    .combine(TransitionEffect.translate({ y: 8 }).animation({ duration: 150, curve: Curve.EaseOut }));
}

/** 弹层投影（套印皮肤用硬偏影，其余按皮肤给柔和投影）。 */
export function panelShadow(skin: string): ShadowOptions {
  const k: SkinId = normalizeSkinId(skin);
  if (k === 'overprint') {
    return { radius: 0, color: '#00000038', offsetX: 4, offsetY: 4 };
  }
  if (k === 'mono') {
    return { radius: 0, color: '#00000044', offsetX: 3, offsetY: 3 };
  }
  if (k === 'blueprint') {
    return { radius: 0, color: '#0AE0F030', offsetX: 0, offsetY: 2 };
  }
  if (k === 'lab') {
    return { radius: 18, color: '#10121426', offsetX: 0, offsetY: 6 };
  }
  return { radius: 12, color: '#15140F33', offsetX: 0, offsetY: 6 };
}

/**
 * 卡片外框：对应 Web 端各皮肤的卡片语汇
 *   hud       四角括号（1.5px 墨色，22px）
 *   lab       四角括号（1px 淡青）+ 右上小准星框
 *   blueprint 四角括号（2px 青）+ 右上圆环
 *   mono      四角括号（1px 朱红）+ 左上红色小方块
 *   overprint 右上钴蓝圆环（硬边）
 *
 * 用法：SkinCard() { 你的卡片内容 }   —— 括号层不拦截点击（hitTestBehavior None）
 */
@Component
export struct SkinCard {
  @BuilderParam content: () => void;
  @StorageProp('skin') skin: string = 'hud';
  @StorageProp('darkMode') darkMode: string = 'system';
  @StorageProp('systemDark') systemDark: boolean = false;

  private skinId(): SkinId {
    return normalizeSkinId(this.skin);
  }

  private c(): ThemeColors {
    return colorsOf(this.skinId(), resolveDark(this.darkMode, this.systemDark));
  }

  private bracketColor(): string {
    const k: SkinId = this.skinId();
    if (k === 'lab') return '#2fb6b0';
    if (k === 'blueprint') return '#0ae0f0';
    if (k === 'mono') return '#c8102e';
    if (k === 'overprint') return '#4c6fff';
    return this.c().text;
  }

  private bracketW(): number {
    const k: SkinId = this.skinId();
    if (k === 'blueprint') return 2;
    if (k === 'hud') return 1.5;
    return 1;
  }

  private bracketSize(): number {
    const k: SkinId = this.skinId();
    if (k === 'blueprint') return 20;
    return 16;
  }

  build() {
    Stack() {
      Column() {
        this.content()
      }
      .width('100%')

      // 四角括号
      Stack({ alignContent: Alignment.TopStart }) {
        Text('')
          .width(this.bracketSize())
          .height(this.bracketSize())
          .border({ width: { top: this.bracketW(), left: this.bracketW() }, color: this.bracketColor() })
      }
      .width('100%')
      .height('100%')
      .opacity(0.75)
      .hitTestBehavior(HitTestMode.None)

      Stack({ alignContent: Alignment.TopEnd }) {
        Text('')
          .width(this.bracketSize())
          .height(this.bracketSize())
          .border({ width: { top: this.bracketW(), right: this.bracketW() }, color: this.bracketColor() })
      }
      .width('100%')
      .height('100%')
      .opacity(0.75)
      .hitTestBehavior(HitTestMode.None)

      Stack({ alignContent: Alignment.BottomStart }) {
        Text('')
          .width(this.bracketSize())
          .height(this.bracketSize())
          .border({ width: { bottom: this.bracketW(), left: this.bracketW() }, color: this.bracketColor() })
      }
      .width('100%')
      .height('100%')
      .opacity(0.75)
      .hitTestBehavior(HitTestMode.None)

      Stack({ alignContent: Alignment.BottomEnd }) {
        Text('')
          .width(this.bracketSize())
          .height(this.bracketSize())
          .border({ width: { bottom: this.bracketW(), right: this.bracketW() }, color: this.bracketColor() })
      }
      .width('100%')
      .height('100%')
      .opacity(0.75)
      .hitTestBehavior(HitTestMode.None)

      // overprint：右上钴蓝圆环
      if (this.skinId() === 'overprint') {
        Stack({ alignContent: Alignment.TopEnd }) {
          Text('')
            .width(22)
            .height(22)
            .borderRadius(11)
            .border({ width: 1, color: '#4c6fff' })
            .margin({ right: 8, top: 8 })
        }
        .width('100%')
        .height('100%')
        .opacity(0.5)
        .hitTestBehavior(HitTestMode.None)
      }

      // mono：左上朱红小方块
      if (this.skinId() === 'mono') {
        Stack({ alignContent: Alignment.TopStart }) {
          Text('')
            .width(6)
            .height(6)
            .backgroundColor('#c8102e')
            .margin({ left: 6, top: 6 })
        }
        .width('100%')
        .height('100%')
        .opacity(0.8)
        .hitTestBehavior(HitTestMode.None)
      }
    }
    .width('100%')
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
  @StorageProp('skin') @Watch('onSkinChanged') skin: string = 'hud';
  @StorageProp('darkMode') darkMode: string = 'system';
  @StorageProp('systemDark') systemDark: boolean = false;

  private settings: RenderingContextSettings = new RenderingContextSettings(true);
  private ctx: CanvasRenderingContext2D = new CanvasRenderingContext2D(this.settings);

  private onSkinChanged(): void {
    this.drawTexture();
  }

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

  /** 纹理颜色（与 Web 端 --kb-grid / --kb-bp-grid 对齐）。 */
  private textureColor(): string {
    const dark: boolean = resolveDark(this.darkMode, this.systemDark);
    const k: SkinId = this.skinId();
    if (k === 'lab') return dark ? '#E8EDEA0D' : '#1012140E';
    if (k === 'mono') return dark ? '#F2F2F208' : '#0A0A0A0B';
    if (k === 'overprint') return dark ? '#E8EDEA0B' : '#1014180E';
    if (k === 'blueprint') return dark ? '#0AE0F014' : '#0A8FA118';
    return dark ? '#FFFFFF06' : '#15140F0E';
  }

  /** 逐像素绘制底纹，完全对齐 Web：hud 8px 网格 / lab 24px 点阵 / mono 3px 扫描线 / blueprint 32px 网格 / overprint 6px 网点。 */
  private drawTexture(): void {
    const w: number = this.ctx.width;
    const h: number = this.ctx.height;
    if (w <= 0 || h <= 0) return;
    const k: SkinId = this.skinId();
    const color: string = this.textureColor();
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.fillStyle = color;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1;
    if (k === 'lab') {
      for (let x = 0; x <= w; x += 24) {
        for (let y = 0; y <= h; y += 24) {
          this.ctx.fillRect(x, y, 1.5, 1.5);
        }
      }
    } else if (k === 'overprint') {
      for (let x = 0; x <= w; x += 6) {
        for (let y = 0; y <= h; y += 6) {
          this.ctx.fillRect(x, y, 1, 1);
        }
      }
    } else if (k === 'mono') {
      for (let y = 0; y <= h; y += 3) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, y);
        this.ctx.lineTo(w, y);
        this.ctx.stroke();
      }
    } else if (k === 'blueprint') {
      for (let x = 0; x <= w; x += 32) {
        this.ctx.beginPath();
        this.ctx.moveTo(x, 0);
        this.ctx.lineTo(x, h);
        this.ctx.stroke();
      }
      for (let y = 0; y <= h; y += 32) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, y);
        this.ctx.lineTo(w, y);
        this.ctx.stroke();
      }
    } else {
      for (let x = 0; x <= w; x += 8) {
        this.ctx.beginPath();
        this.ctx.moveTo(x, 0);
        this.ctx.lineTo(x, h);
        this.ctx.stroke();
      }
      for (let y = 0; y <= h; y += 8) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, y);
        this.ctx.lineTo(w, y);
        this.ctx.stroke();
      }
    }
  }

  private orn(): string {
    return skinAccentColor(this.skin);
  }

  build() {
    Stack() {
      Canvas(this.ctx)
        .width('100%')
        .height('100%')
        .backgroundColor(this.c().bg)
        .onReady(() => {
          this.drawTexture();
        })
        .onAreaChange(() => {
          this.drawTexture();
        })
        .hitTestBehavior(HitTestMode.None)

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

  /** 品牌块形状：hud/lab 描边方框、mono 实心方、blueprint 圆环、overprint 实心圆。 */
  private logoRadius(): number {
    const k: SkinId = this.skinId();
    return k === 'blueprint' || k === 'overprint' ? 7 : 0;
  }

  private logoFilled(): boolean {
    const k: SkinId = this.skinId();
    return k === 'mono' || k === 'overprint';
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
      // 品牌块：每套皮肤形状不同
      if (this.logoFilled()) {
        Text('')
          .width(14)
          .height(14)
          .borderRadius(this.logoRadius())
          .backgroundColor(this.accent())
      } else {
        Text('')
          .width(14)
          .height(14)
          .borderRadius(this.logoRadius())
          .border({ width: 1.5, color: this.accent() })
      }
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

/** 皮肤标记色（供页面自定义装饰复用）。 */
@Component
export struct SkinButton {
  @Prop label: string = '';
  @Prop kind: string = 'primary';
  @Prop disabled: boolean = false;
  @Prop btnHeight: number = 44;
  onTap: () => void = () => {};
  @StorageProp('skin') skin: string = 'hud';
  @StorageProp('darkMode') darkMode: string = 'system';
  @StorageProp('systemDark') systemDark: boolean = false;
  /** 按压态：触屏没有 hover，用缩放 + 压暗模拟 Web 的按钮反馈。 */
  @State private pressed: boolean = false;

  private skinId(): SkinId {
    return normalizeSkinId(this.skin);
  }

  private c(): ThemeColors {
    return colorsOf(this.skinId(), resolveDark(this.darkMode, this.systemDark));
  }

  private bg(): string {
    if (this.kind === 'danger') return this.c().danger;
    if (this.kind === 'ghost') return this.c().surface;
    return this.c().primary;
  }

  private fg(): string {
    if (this.kind === 'danger') return '#ffffff';
    if (this.kind === 'ghost') return this.c().text;
    return this.c().primaryContrast;
  }

  private track(): number {
    const k: SkinId = this.skinId();
    if (k === 'mono') return 1.6;
    if (k === 'blueprint') return 1.2;
    if (k === 'overprint') return 1.0;
    return 0.8;
  }

  build() {
    Text(this.label)
      .width('100%')
      .height(this.btnHeight)
      .textAlign(TextAlign.Center)
      .fontSize(13)
      .fontWeight(FontWeight.Medium)
      .letterSpacing(this.track())
      .fontColor(this.disabled ? this.c().muted : this.fg())
      .backgroundColor(this.disabled ? this.c().surface2 : this.bg())
      .borderRadius(this.c().radius)
      .border({ width: this.kind === 'ghost' ? 1 : 0, color: this.c().border })
      .opacity(this.disabled ? 0.6 : this.pressed ? 0.82 : 1)
      .scale({ x: this.pressed ? 0.985 : 1, y: this.pressed ? 0.985 : 1 })
      .animation({ duration: 90, curve: Curve.EaseOut })
      .onTouch((event: TouchEvent) => {
        if (this.disabled) return;
        if (event.type === TouchType.Down) {
          this.pressed = true;
        } else if (event.type === TouchType.Up || event.type === TouchType.Cancel) {
          this.pressed = false;
        }
      })
      .onClick(() => {
        if (!this.disabled) {
          this.onTap();
        }
      })
  }
}

/**
 * 手绘线性图标（24×24 逻辑坐标，Canvas 按 iconSize 等比缩放，笔画不会被压糊）。
 * name: users | shield | palette | logout
 */
@Component
export struct SkinIcon {
  @Prop iconName: string = 'logout';
  @Prop iconSize: number = 22;
  @Prop iconColor: string = '#000000';

  build() {
    if (this.iconName === 'sync') {
      // 圆形循环双箭头：两个反向圆形箭头并排
      Row() {
        Text('↺').fontSize(15).fontColor(this.iconColor)
        Text('↻').fontSize(15).fontColor(this.iconColor)
      }
      .width(24)
      .height(24)
      .justifyContent(FlexAlign.Center)
      .alignItems(VerticalAlign.Center)
      .hitTestBehavior(HitTestMode.None)
    } else {
      Text(this.glyph())
        .fontSize(20)
        .lineHeight(24)
        .height(24)
        .width(24)
        .fontColor(this.iconColor)
        .textAlign(TextAlign.Center)
        .hitTestBehavior(HitTestMode.None)
    }
  }

  private glyph(): string {
    if (this.iconName === 'users') return '☰';
    if (this.iconName === 'shield') return '⚿';
    if (this.iconName === 'palette') return '◐';
    return '⇥';
  }
}/** 图标按钮：32×32 方框 + 10 圆角 + 1px 皮肤边框，图标居中（18px）。 */
@Component
export struct SkinIconButton {
  @Prop iconName: string = 'logout';
  @Prop iconSize: number = 22;
  @Prop iconColor: string = '#000000';
  @Prop boxSize: number = 34;
  @Prop dot: boolean = false;
  onPick: () => void = () => {};
  @StorageProp('skin') skin: string = 'hud';
  @StorageProp('darkMode') darkMode: string = 'system';
  @StorageProp('systemDark') systemDark: boolean = false;

  private c(): ThemeColors {
    return colorsOf(normalizeSkinId(this.skin), resolveDark(this.darkMode, this.systemDark));
  }

  build() {
    Stack({ alignContent: Alignment.TopEnd }) {
      // 固定 30×30 矩形圆角，内容居中（尺寸写死，保证四个框一致）
      Column() {
        SkinIcon({ iconName: this.iconName, iconSize: this.iconSize, iconColor: this.iconColor })
      }
      .width(30)
      .height(30)
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.Center)
      .borderRadius(9)
      .border({ width: 1, color: this.c().border })
      .backgroundColor(this.c().bg)
      if (this.dot) {
        Text('')
          .width(6)
          .height(6)
          .borderRadius(3)
          .backgroundColor(this.c().warning)
          .margin({ top: 2, right: 2 })
          .hitTestBehavior(HitTestMode.None)
      }
    }
    .onClick(() => {
      this.onPick();
    })
  }
}