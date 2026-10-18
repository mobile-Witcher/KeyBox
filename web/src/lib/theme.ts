/**
 * theme.ts —— 外观（**皮肤 × 明暗**）的单一真相来源。
 *
 * 两个正交维度：
 *   - 明暗：`light` | `dark`          → 落到 `<html class="dark">`（Tailwind darkMode:"class"）
 *   - 皮肤：9 种                        → 落到 `<html data-skin="...">`
 * 组合示例：赛博朋克·深色 = `<html data-skin="cyber" class="dark">`。
 * 皮肤只改 index.css 里的语义变量，因此**新增皮肤不需要改任何组件**。
 *
 * 三个目标：① 手动切换 ② 记住选择（localStorage）③ 首屏不闪。
 *
 * ⚠️ 一致性约束：下面 `SKIN_BG` 的色值必须与
 *   - index.css 各皮肤块里的 `--kb-bg`
 *   - index.html `<head>` 内联脚本里的 BG 表
 *   三处完全一致，否则切换皮肤时会闪一下底色（FOUC）。
 */
export type Theme = "light" | "dark";

/**
 * 明暗**偏好**：比 Theme 多一个 "system"（跟随系统/浏览器）。
 * 存储里存偏好；实际落到 DOM 的仍是 Theme（system 会被解析成当前系统深浅）。
 */
export type ThemePreference = Theme | "system";

export type Skin =
  | "default" // 精致克制
  | "tech" // 现代科技感
  | "minimal" // 极简商务
  | "paper" // 纸质档案感
  | "cyber" // 赛博朋克
  | "kawaii" // 可爱风
  | "hacker" // 极客终端
  | "solar" // 护眼自然
  | "sunset" // 暖阳
  | "endfield" // 终末地 · 现场终端
  | "rhine" // 莱茵生命 · 无菌档案
  | "arknights" // 明日方舟 · 官网
  | "travel" // 众生行记 · 旅行手账
  | "atlas"; // 众生行记 · 套印图录

/** localStorage 键（与 index.html 内联脚本一致）。 */
export const THEME_STORAGE_KEY = "keybox.theme";
export const SKIN_STORAGE_KEY = "keybox.skin";

/** 各皮肤 × 明暗的首屏底色（三方一致，见文件头说明）。 */
export const SKIN_BG: Record<Skin, Record<Theme, string>> = {
  default: { light: "#f8fafc", dark: "#0b1120" },
  tech: { light: "#eef2fb", dark: "#070b16" },
  minimal: { light: "#ffffff", dark: "#0a0a0a" },
  paper: { light: "#f4efe4", dark: "#1c1710" },
  cyber: { light: "#f7f0fb", dark: "#07020f" },
  kawaii: { light: "#fff5f9", dark: "#2a1a24" },
  hacker: { light: "#f2f5f0", dark: "#000000" },
  solar: { light: "#f4f0e6", dark: "#1e2318" },
  sunset: { light: "#fff4ec", dark: "#1d1119" },
  endfield: { light: "#ede6d6", dark: "#0e0f0f" },
  rhine: { light: "#f4f6f4", dark: "#0b1012" },
  arknights: { light: "#f7f7f5", dark: "#08090a" },
  travel: { light: "#efe7d6", dark: "#171310" },
  atlas: { light: "#edf1ee", dark: "#0b0f12" },
};

/** 可选皮肤清单（供外观选择器渲染；顺序即展示顺序）。 */
export const SKINS: Array<{ id: Skin; label: string; hint: string }> = [
  { id: "default", label: "精致克制", hint: "白/深蓝底，品牌靛蓝点缀，细边框小圆角" },
  { id: "tech", label: "现代科技感", hint: "深邃底色 + 发光层次，突出保险箱的科技感" },
  { id: "minimal", label: "极简商务", hint: "无圆角无阴影，靠留白与字距分层" },
  { id: "paper", label: "纸质档案感", hint: "米黄纸底 + 衬线字 + 红色套色，像纸质密钥簿" },
  { id: "cyber", label: "赛博朋克", hint: "霓虹品红 + 电光青，暗底发光，最张扬" },
  { id: "kawaii", label: "可爱风", hint: "粉白底 + 超大圆角 + 柔光，圆润讨喜" },
  { id: "hacker", label: "极客终端", hint: "荧光绿字黑屏 + 等宽字体，终端味十足" },
  { id: "solar", label: "护眼自然", hint: "低饱和莫兰迪，长时间看最不累眼" },
  { id: "sunset", label: "暖阳", hint: "暖橙渐层，明快温暖有活力" },
  {
    id: "endfield",
    label: "终末地 · 现场终端",
    hint: "石墨 HUD / 奶油纸双底，信号黄 + 全息青，全直角工业终端",
  },
  {
    id: "rhine",
    label: "莱茵生命 · 无菌档案",
    hint: "骨白纸底 + 莱茵青，细双框与等宽编号，像实验记录本",
  },
  {
    id: "arknights",
    label: "明日方舟 · 官网",
    hint: "近黑白 + 血红点缀，细线角标与杂志式留白，克制而锋利",
  },
  {
    id: "travel",
    label: "众生行记 · 旅行手账",
    hint: "旧纸底 + 朱砂邮戳 + 虚线票根，像一册正在途中的行记",
  },
  {
    id: "atlas",
    label: "众生行记 · 套印图录",
    hint: "冷白纸 + 钴蓝圆盘 + 套印错位，细线圆环与坐标刻度的图录秩序",
  },
];

const SKIN_IDS: Skin[] = SKINS.map((s) => s.id);

function hasWindow(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 读取 URL 预览参数（`?skin=endfield&theme=dark`）。用于演示/截图，不写回存储。 */
function readUrlParam(key: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 存储不可用：仅影响"记住选择"，不影响当前会话
  }
}

/** 读取系统深浅偏好（无法判断时按浅色）。 */
export function systemPreferredTheme(): Theme {
  if (!hasWindow()) return "light";
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** 解析首屏明暗偏好：URL 预览参数 > 存储 > system（跟随系统）。 */
export function resolveInitialPreference(): ThemePreference {
  if (!hasWindow()) return "system";
  const fromUrl = readUrlParam("theme");
  if (fromUrl === "light" || fromUrl === "dark" || fromUrl === "system") return fromUrl;
  const stored = readStorage(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

/** 兼容旧调用：返回首屏**有效**明暗（不返回 "system"）。 */
export function resolveInitialTheme(): Theme {
  const pref = resolveInitialPreference();
  return pref === "system" ? systemPreferredTheme() : pref;
}

/** 解析首屏皮肤：URL 预览参数 > 存储 > default。 */
export function resolveInitialSkin(): Skin {
  if (!hasWindow()) return "default";
  const fromUrl = readUrlParam("skin");
  if (fromUrl && SKIN_IDS.indexOf(fromUrl as Skin) >= 0) return fromUrl as Skin;
  const stored = readStorage(SKIN_STORAGE_KEY);
  return SKIN_IDS.indexOf(stored as Skin) >= 0 ? (stored as Skin) : "default";
}

// ---------------------------------------------------------------------------
// 全局 store（同屏多个开关状态一致）
// ---------------------------------------------------------------------------
let currentPreference: ThemePreference = "system";
let currentTheme: Theme = "light";
let currentSkin: Skin = "default";
const themeListeners = new Set<(theme: Theme) => void>();
const skinListeners = new Set<(skin: Skin) => void>();

/** 把当前"明暗 + 皮肤"刷到 DOM（幂等）。 */
function paint(): void {
  if (!hasWindow()) return;
  const root = document.documentElement;
  root.classList.toggle("dark", currentTheme === "dark");
  root.dataset.skin = currentSkin;
  root.style.colorScheme = currentTheme;
  // 首屏过渡底色：与 index.css 的 --kb-bg 一一对应（见文件头一致性约束）
  root.style.backgroundColor = SKIN_BG[currentSkin][currentTheme];
}

export function getTheme(): Theme {
  return currentTheme;
}

/** 当前明暗**偏好**（可能是 "system"）。 */
export function getThemePreference(): ThemePreference {
  return currentPreference;
}
export function getSkin(): Skin {
  return currentSkin;
}

/** 落一次偏好：system → 解析成当前系统深浅；paint 后广播**有效**明暗。 */
function applyThemePreference(next: ThemePreference, persist: boolean): void {
  currentPreference = next;
  currentTheme = next === "system" ? systemPreferredTheme() : next;
  paint();
  if (persist) writeStorage(THEME_STORAGE_KEY, next);
  themeListeners.forEach((fn) => fn(currentTheme));
}

/** 设置明暗偏好（light / dark / system）。 */
export function setThemePreference(next: ThemePreference): void {
  applyThemePreference(next, true);
}

/** 兼容旧调用：等价于设置一个明确的 light/dark 偏好。 */
export function setTheme(next: Theme): void {
  applyThemePreference(next, true);
}

export function setSkin(next: Skin): void {
  currentSkin = next;
  paint();
  writeStorage(SKIN_STORAGE_KEY, next);
  skinListeners.forEach((fn) => fn(next));
}

/** 应用启动时调用：解析并落 DOM（与内联脚本结果一致，做一次幂等校正）。 */
export function initTheme(): void {
  currentSkin = resolveInitialSkin();
  applyThemePreference(resolveInitialPreference(), false);

  // 偏好为 system 时，跟随浏览器/系统的深浅实时切换
  if (!hasWindow() || typeof window.matchMedia !== "function") return;
  try {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => {
      if (currentPreference === "system") applyThemePreference("system", false);
    };
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
    } else if (typeof mq.addListener === "function") {
      mq.addListener(onChange);
    }
  } catch {
    // 跟随系统不可用：保持当前有效明暗即可
  }
}

export function subscribeTheme(fn: (theme: Theme) => void): () => void {
  themeListeners.add(fn);
  return () => {
    themeListeners.delete(fn);
  };
}

export function subscribeSkin(fn: (skin: Skin) => void): () => void {
  skinListeners.add(fn);
  return () => {
    skinListeners.delete(fn);
  };
}

/**
 * 兼容旧调用：仅按明暗取默认皮肤的底色。
 * 新代码请用 `SKIN_BG[skin][theme]`。
 */
export const THEME_BG: Record<Theme, string> = {
  light: SKIN_BG.default.light,
  dark: SKIN_BG.default.dark,
};
