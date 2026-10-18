/**
 * theme.ets —— 5 皮肤 × 明暗 主题系统（与 Web 端 index.css 逐值对齐）。
 *
 * 皮肤（中性命名，与 Web 端 id 完全一致）：
 *   hud       工业终端：石墨 HUD / 奶油纸双底，信号黄 + 全息青，全直角
 *   lab       实验档案：骨白纸底 + 淡青，细双框与等宽编号
 *   blueprint 蓝图海报：纯黑 chrome + 青，蓝图网格与巨型词标
 *   mono      黑白档案：近黑白 + 朱红角标，硬朗档案秩序
 *   overprint 套印图录：冷白纸 + 钴蓝圆盘 + 套印错位
 *
 * 用法（与旧版一致，页面无需改动）：
 *   @StorageProp('skin') skin: string = 'hud';
 *   @StorageProp('darkMode') darkMode: string = 'system';
 *   @StorageProp('systemDark') systemDark: boolean = false;
 *   c(): ThemeColors { return colorsOf(this.skin as SkinId, resolveDark(this.darkMode, this.systemDark)); }
 *   build() 里消费 this.c().bg / .primary / .radiusCard ...
 */

export type SkinId = 'hud' | 'lab' | 'blueprint' | 'mono' | 'overprint';

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
const SANS_DISPLAY: string = '"HarmonyOS Sans SC","HarmonyOS Sans","PingFang SC","Microsoft YaHei",sans-serif';

export const SKINS: SkinDef[] = [
  {
    id: 'hud', label: '工业终端', hint: '石墨 HUD / 奶油纸双底，信号黄 + 全息青，全直角',
    light: {
      bg: '#ede6d6', surface: '#f6f0e2', surface2: '#e3dac6', text: '#15140f',
      muted: '#5e5747', border: '#c6bba3', borderStrong: '#a99c82',
      primary: '#1a1a17', primaryHover: '#000000', primaryContrast: '#f2c300',
      danger: '#b5342a', success: '#3c7a56', warning: '#8a6a1f',
      radius: 0, radiusCard: 0, fontSans: SANS_DISPLAY, headingTracking: '0.14em'
    },
    dark: {
      bg: '#0e0f0f', surface: '#1d2020', surface2: '#232626', text: '#f2f0e8',
      muted: '#8f8b7e', border: '#2a2d2a', borderStrong: '#3a3d3a',
      primary: '#f2c300', primaryHover: '#ffd83d', primaryContrast: '#141007',
      danger: '#e03a2f', success: '#57c08a', warning: '#ff7a1a',
      radius: 0, radiusCard: 0, fontSans: SANS_DISPLAY, headingTracking: '0.14em'
    }
  },
  {
    id: 'lab', label: '实验档案', hint: '骨白纸底 + 淡青，细双框与等宽编号',
    light: {
      bg: '#f4f6f4', surface: '#ffffff', surface2: '#e7eae6', text: '#101214',
      muted: '#6b7472', border: '#c9d0ca', borderStrong: '#aab3ac',
      primary: '#0e6e6b', primaryHover: '#0a5754', primaryContrast: '#ffffff',
      danger: '#c43333', success: '#3e8e5a', warning: '#a8640f',
      radius: 0, radiusCard: 0, fontSans: SANS_UI, headingTracking: '0.08em'
    },
    dark: {
      bg: '#0b1012', surface: '#121a1d', surface2: '#182226', text: '#e8edea',
      muted: '#8a9691', border: '#233034', borderStrong: '#38484d',
      primary: '#43d6cf', primaryHover: '#6fe6e1', primaryContrast: '#06110f',
      danger: '#e5605c', success: '#63b881', warning: '#f3c55a',
      radius: 0, radiusCard: 0, fontSans: SANS_UI, headingTracking: '0.08em'
    }
  },
  {
    id: 'blueprint', label: '蓝图海报', hint: '纯黑 chrome + 青，蓝图网格与巨型词标',
    light: {
      bg: '#e7eef1', surface: '#ffffff', surface2: '#dce6ea', text: '#0a0d0e',
      muted: '#5c6a70', border: '#c3d2d8', borderStrong: '#8fa3ab',
      primary: '#0a8fa1', primaryHover: '#07707f', primaryContrast: '#ffffff',
      danger: '#c8332b', success: '#1f7a5c', warning: '#8a6a12',
      radius: 4, radiusCard: 4, fontSans: SANS_DISPLAY, headingTracking: '0.02em'
    },
    dark: {
      bg: '#000000', surface: '#0b0e0f', surface2: '#12181a', text: '#f2f6f7',
      muted: '#8b979c', border: '#1f272a', borderStrong: '#39464b',
      primary: '#0ae0f0', primaryHover: '#4ff0f8', primaryContrast: '#001416',
      danger: '#ff5a4d', success: '#43d9a3', warning: '#f3c94a',
      radius: 4, radiusCard: 4, fontSans: SANS_DISPLAY, headingTracking: '0.02em'
    }
  },
  {
    id: 'mono', label: '黑白档案', hint: '近黑白 + 朱红角标，硬朗的档案秩序',
    light: {
      bg: '#f7f7f5', surface: '#ffffff', surface2: '#efefec', text: '#0a0a0a',
      muted: '#6a6e72', border: '#dcdcd8', borderStrong: '#b9bab6',
      primary: '#c8102e', primaryHover: '#a50d26', primaryContrast: '#ffffff',
      danger: '#b3261e', success: '#4a6b52', warning: '#8a6a1f',
      radius: 0, radiusCard: 0, fontSans: SANS_UI, headingTracking: '0.14em'
    },
    dark: {
      bg: '#08090a', surface: '#101113', surface2: '#16181a', text: '#f2f2f2',
      muted: '#8a8f94', border: '#26292c', borderStrong: '#3a3e42',
      primary: '#c8102e', primaryHover: '#e0223f', primaryContrast: '#ffffff',
      danger: '#e0433c', success: '#7fb08a', warning: '#e0c060',
      radius: 0, radiusCard: 0, fontSans: SANS_UI, headingTracking: '0.14em'
    }
  },
  {
    id: 'overprint', label: '套印图录', hint: '冷白纸 + 钴蓝圆盘 + 套印错位，细线图录',
    light: {
      bg: '#edf1ee', surface: '#ffffff', surface2: '#e3e9e6', text: '#101418',
      muted: '#5c6866', border: '#cbd5d1', borderStrong: '#9fada8',
      primary: '#2447c6', primaryHover: '#1b3aa8', primaryContrast: '#ffffff',
      danger: '#c0392b', success: '#2f7d5b', warning: '#9a6b12',
      radius: 0, radiusCard: 0, fontSans: SANS_SERIF, headingTracking: '0.02em'
    },
    dark: {
      bg: '#0b0f12', surface: '#11161a', surface2: '#171e23', text: '#e8edea',
      muted: '#8a9793', border: '#232c31', borderStrong: '#3a474d',
      primary: '#4c6fff', primaryHover: '#6c8bff', primaryContrast: '#ffffff',
      danger: '#e2665b', success: '#5fae86', warning: '#d8b368',
      radius: 0, radiusCard: 0, fontSans: SANS_SERIF, headingTracking: '0.02em'
    }
  }
];

export const DEFAULT_SKIN: SkinId = 'hud';

/** 旧版本存下的皮肤 id（含更早的 9 套）统一回落到默认皮肤，避免升级后空主题。 */
const LEGACY_SKIN_MAP: Record<string, SkinId> = {
  default: 'hud', endfield: 'hud',
  paper: 'mono', rhodes: 'mono',
  cyber: 'blueprint', arknights: 'blueprint', hacker: 'blueprint',
  tech: 'lab', rhine: 'lab', solar: 'lab',
  minimal: 'overprint', atlas: 'overprint', kawaii: 'hud', sunset: 'overprint'
};

/** 把存储里可能残留的旧 id 规范化成当前 5 个合法 id。 */
export function normalizeSkinId(raw: string): SkinId {
  const mapped: SkinId | undefined = LEGACY_SKIN_MAP[raw];
  if (mapped !== undefined) return mapped;
  for (const s of SKINS) {
    if (s.id === raw) return s.id;
  }
  return DEFAULT_SKIN;
}

/** 三态明暗解析：'system' 跟随系统，'light'/'dark' 手动锁定。 */
export function resolveDark(darkMode: string, systemDark: boolean): boolean {
  if (darkMode === 'light') return false;
  if (darkMode === 'dark') return true;
  return systemDark; // 'system'
}

/** 取某皮肤某明暗的颜色集；未知 id 回退默认皮肤。 */
export function colorsOf(id: SkinId, dark: boolean): ThemeColors {
  for (const s of SKINS) {
    if (s.id === id) {
      return dark ? s.dark : s.light;
    }
  }
  const d = SKINS[0];
  return dark ? d.dark : d.light;
}
