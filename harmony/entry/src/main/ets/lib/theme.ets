/**
 * theme.ets —— 9 皮肤 × 明暗 主题系统（从 Web 端 index.css 逐值移植）。
 *
 * 用法：
 *   AppStorage.setOrCreate('skin', 'paper');   // 切皮肤
 *   AppStorage.setOrCreate('dark', true);      // 切明暗
 *   组件内：@StorageProp('skin') skin: SkinId; @StorageProp('dark') isDark: boolean;
 *           private colors(): ThemeColors { return colorsOf(this.skin, this.isDark); }
 *   build() 里消费 this.colors().bg / .primary / .radiusCard ...
 */

export type SkinId =
  | 'default' | 'tech' | 'minimal' | 'paper'
  | 'cyber' | 'kawaii' | 'hacker' | 'solar' | 'sunset';

/** 语义色与外观令牌（与 Web 端 --kb-* 一一对应）。 */
export interface ThemeColors {
  bg: string;
  surface: string;
  surface2: string;
  text: string;
  muted: string;
  border: string;
  borderStrong: string;
  primary: string;
  primaryHover: string;
  primaryContrast: string;
  danger: string;
  success: string;
  warning: string;
  radius: number;
  radiusCard: number;
  fontSans: string;
  headingTracking: string;
}

/** 皮肤定义（含明暗两套颜色与展示信息）。 */
export interface SkinDef {
  id: SkinId;
  label: string;
  hint: string;
  light: ThemeColors;
  dark: ThemeColors;
}

const SANS_UI: string = '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
const SANS_SERIF: string = 'Georgia,"Songti SC","SimSun","Noto Serif CJK SC",serif';
const MONO: string = 'ui-monospace,"Cascadia Code",Consolas,"Sarasa Mono SC",Menlo,monospace';

export const SKINS: SkinDef[] = [
  {
    id: 'default', label: '精致克制', hint: '白/深蓝底，品牌靛蓝点缀',
    light: {
      bg: '#f8fafc', surface: '#ffffff', surface2: '#f1f5f9', text: '#0f172a',
      muted: '#5b6779', border: '#e5e8ee', borderStrong: '#cbd5e1',
      primary: '#4f46e5', primaryHover: '#4338ca', primaryContrast: '#ffffff',
      danger: '#dc2626', success: '#059669', warning: '#b45309',
      radius: 10, radiusCard: 16, fontSans: SANS_UI, headingTracking: '-0.01em'
    },
    dark: {
      bg: '#0b1120', surface: '#0f172a', surface2: '#16203a', text: '#e2e8f0',
      muted: '#94a3b8', border: '#1e293b', borderStrong: '#334155',
      primary: '#818cf8', primaryHover: '#a5b4fc', primaryContrast: '#0b1120',
      danger: '#f87171', success: '#34d399', warning: '#fbbf24',
      radius: 10, radiusCard: 16, fontSans: SANS_UI, headingTracking: '-0.01em'
    }
  },
  {
    id: 'tech', label: '现代科技感', hint: '深邃底色 + 发光层次',
    light: {
      bg: '#eef2fb', surface: '#ffffff', surface2: '#e8edfa', text: '#0d1424',
      muted: '#566178', border: '#d8e0f5', borderStrong: '#b9c6ea',
      primary: '#5b53e8', primaryHover: '#4b43d8', primaryContrast: '#ffffff',
      danger: '#e11d48', success: '#059669', warning: '#b45309',
      radius: 12, radiusCard: 18, fontSans: SANS_UI, headingTracking: '0.01em'
    },
    dark: {
      bg: '#070b16', surface: '#0e1526', surface2: '#131d33', text: '#e6ecff',
      muted: '#97a6c9', border: '#1e2b47', borderStrong: '#2e3f63',
      primary: '#818cf8', primaryHover: '#a5b4fc', primaryContrast: '#06101f',
      danger: '#fb7185', success: '#34d399', warning: '#fbbf24',
      radius: 12, radiusCard: 18, fontSans: SANS_UI, headingTracking: '0.01em'
    }
  },
  {
    id: 'minimal', label: '极简商务', hint: '无圆角无阴影，靠留白分层',
    light: {
      bg: '#ffffff', surface: '#ffffff', surface2: '#fafafa', text: '#111111',
      muted: '#8a8a8a', border: '#ececec', borderStrong: '#d4d4d4',
      primary: '#111111', primaryHover: '#2b2b2b', primaryContrast: '#ffffff',
      danger: '#b91c1c', success: '#15803d', warning: '#a16207',
      radius: 0, radiusCard: 0, fontSans: SANS_UI, headingTracking: '0.14em'
    },
    dark: {
      bg: '#0a0a0a', surface: '#111111', surface2: '#171717', text: '#f2f2f2',
      muted: '#8f8f8f', border: '#242424', borderStrong: '#3a3a3a',
      primary: '#f2f2f2', primaryHover: '#ffffff', primaryContrast: '#0a0a0a',
      danger: '#f87171', success: '#4ade80', warning: '#fbbf24',
      radius: 0, radiusCard: 0, fontSans: SANS_UI, headingTracking: '0.14em'
    }
  },
  {
    id: 'paper', label: '纸质档案感', hint: '米黄纸底 + 衬线字 + 红色套色',
    light: {
      bg: '#f4efe4', surface: '#fbf8f1', surface2: '#f7f2e8', text: '#241f16',
      muted: '#7a6f5b', border: '#ddd4c0', borderStrong: '#b9ad95',
      primary: '#8c2b22', primaryHover: '#7a251d', primaryContrast: '#f8f3e9',
      danger: '#9b2c1f', success: '#4f6b3a', warning: '#8a6a1f',
      radius: 2, radiusCard: 3, fontSans: SANS_SERIF, headingTracking: '0.06em'
    },
    dark: {
      bg: '#1c1710', surface: '#241e15', surface2: '#2b241a', text: '#ecd9b8',
      muted: '#b09a76', border: '#3d3324', borderStrong: '#5a4a33',
      primary: '#c9603f', primaryHover: '#d9764f', primaryContrast: '#1c1710',
      danger: '#e0704f', success: '#8aa86a', warning: '#d9a441',
      radius: 2, radiusCard: 3, fontSans: SANS_SERIF, headingTracking: '0.06em'
    }
  },
  {
    id: 'cyber', label: '赛博朋克', hint: '霓虹品红 + 电光青，暗底发光',
    light: {
      bg: '#f7f0fb', surface: '#ffffff', surface2: '#f1e6f8', text: '#14061f',
      muted: '#6b5a7a', border: '#e3cff0', borderStrong: '#c9a8e0',
      primary: '#d1007a', primaryHover: '#b00068', primaryContrast: '#ffffff',
      danger: '#e01b24', success: '#00a878', warning: '#b26a00',
      radius: 6, radiusCard: 10, fontSans: SANS_UI, headingTracking: '0.08em'
    },
    dark: {
      bg: '#07020f', surface: '#120820', surface2: '#1a0d2e', text: '#f5e9ff',
      muted: '#a08ec0', border: '#3a1f5e', borderStrong: '#5b2f8a',
      primary: '#ff2fb0', primaryHover: '#ff5cc4', primaryContrast: '#07020f',
      danger: '#ff4d6d', success: '#00e5a0', warning: '#ffd166',
      radius: 6, radiusCard: 10, fontSans: SANS_UI, headingTracking: '0.08em'
    }
  },
  {
    id: 'kawaii', label: '可爱风', hint: '粉白底 + 超大圆角 + 柔光',
    light: {
      bg: '#fff5f9', surface: '#ffffff', surface2: '#ffeaf3', text: '#4a2b3a',
      muted: '#9a7486', border: '#ffd6e8', borderStrong: '#ffb8d6',
      primary: '#ff7ab6', primaryHover: '#ff5aa5', primaryContrast: '#ffffff',
      danger: '#f0567a', success: '#4cc38a', warning: '#e0a13c',
      radius: 16, radiusCard: 24, fontSans: '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Nunito",sans-serif',
      headingTracking: '0.02em'
    },
    dark: {
      bg: '#2a1a24', surface: '#3a2431', surface2: '#472c3c', text: '#ffe3f0',
      muted: '#c9a2b6', border: '#5a3648', borderStrong: '#7d4a64',
      primary: '#ff9ac9', primaryHover: '#ffb8d9', primaryContrast: '#2a1a24',
      danger: '#ff90ac', success: '#7fd6ae', warning: '#f0c070',
      radius: 16, radiusCard: 24, fontSans: '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Nunito",sans-serif',
      headingTracking: '0.02em'
    }
  },
  {
    id: 'hacker', label: '极客终端', hint: '荧光绿黑屏 + 等宽字体 + 直角',
    light: {
      bg: '#f2f5f0', surface: '#ffffff', surface2: '#e8efe6', text: '#0f1a10',
      muted: '#4d6b50', border: '#cfe0cb', borderStrong: '#a8c4a2',
      primary: '#12772f', primaryHover: '#0d5f24', primaryContrast: '#ffffff',
      danger: '#b3261e', success: '#12772f', warning: '#8a6a1f',
      radius: 2, radiusCard: 3, fontSans: MONO, headingTracking: '0.06em'
    },
    dark: {
      bg: '#000000', surface: '#0a0f0a', surface2: '#101a10', text: '#7bf58a',
      muted: '#4fae5d', border: '#1c3a1f', borderStrong: '#2f5c34',
      primary: '#20ff5f', primaryHover: '#5cff8a', primaryContrast: '#000000',
      danger: '#ff5f5f', success: '#20ff5f', warning: '#ffd75f',
      radius: 2, radiusCard: 3, fontSans: MONO, headingTracking: '0.06em'
    }
  },
  {
    id: 'solar', label: '护眼自然', hint: '低饱和莫兰迪，久看不累',
    light: {
      bg: '#f4f0e6', surface: '#fbf8f1', surface2: '#ece7d9', text: '#3f4a44',
      muted: '#7a8577', border: '#dcd6c6', borderStrong: '#c2bca8',
      primary: '#2f6f5e', primaryHover: '#255a4c', primaryContrast: '#ffffff',
      danger: '#a8473c', success: '#4a7a52', warning: '#8f6f2a',
      radius: 8, radiusCard: 12, fontSans: SANS_UI, headingTracking: '0.01em'
    },
    dark: {
      bg: '#1e2318', surface: '#252c1e', surface2: '#2d3625', text: '#dfe6d5',
      muted: '#98a68c', border: '#38422d', borderStrong: '#4d5a3e',
      primary: '#8fbf7f', primaryHover: '#a8d199', primaryContrast: '#1e2318',
      danger: '#d98b7d', success: '#8fbf7f', warning: '#d4b165',
      radius: 8, radiusCard: 12, fontSans: SANS_UI, headingTracking: '0.01em'
    }
  },
  {
    id: 'sunset', label: '暖阳', hint: '暖橙渐层，明快有活力',
    light: {
      bg: '#fff4ec', surface: '#ffffff', surface2: '#ffead9', text: '#3d2517',
      muted: '#8a6852', border: '#f6dcc4', borderStrong: '#e8bd9a',
      primary: '#e2622a', primaryHover: '#c9501d', primaryContrast: '#ffffff',
      danger: '#c0392b', success: '#3f8f5f', warning: '#b07620',
      radius: 12, radiusCard: 18, fontSans: SANS_UI, headingTracking: '0.01em'
    },
    dark: {
      bg: '#1d1119', surface: '#271a22', surface2: '#33222c', text: '#f7e4dc',
      muted: '#c3a396', border: '#422c35', borderStrong: '#5c3f4a',
      primary: '#ff8a4c', primaryHover: '#ffa46f', primaryContrast: '#1d1119',
      danger: '#ff7a6b', success: '#7fc79a', warning: '#f0bb6a',
      radius: 12, radiusCard: 18, fontSans: SANS_UI, headingTracking: '0.01em'
    }
  }
];

export const DEFAULT_SKIN: SkinId = 'default';

/** 三态明暗解析：'system' 跟随系统，'light'/'dark' 手动锁定。 */
export function resolveDark(darkMode: string, systemDark: boolean): boolean {
  if (darkMode === 'light') return false;
  if (darkMode === 'dark') return true;
  return systemDark; // 'system'
}

/** 取某皮肤某明暗的颜色集；未知 id 回退 default。 */
export function colorsOf(id: SkinId, dark: boolean): ThemeColors {
  for (const s of SKINS) {
    if (s.id === id) {
      return dark ? s.dark : s.light;
    }
  }
  const d = SKINS[0];
  return dark ? d.dark : d.light;
}

/** 深色跟随系统：媒体查询在页面里监听后调用 setDark。 */
export function isSystemDark(): boolean {
  return false; // 占位：由页面用 mediaquery('(dark-mode: true)') 初始化
}
