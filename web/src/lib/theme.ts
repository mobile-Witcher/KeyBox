/**
 * theme.ts —— 外观（**皮肤 × 明暗**）的单一真相来源。
 *
 * 两个正交维度：
 *   - 明暗：`light` | `dark`          → 落到 `<html class="dark">`（Tailwind darkMode:"class"）
 *   - 皮肤：5 种                        → 落到 `<html data-skin="...">`
 * 组合示例：工业终端·深色 = `<html data-skin="hud" class="dark">`。
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
  | "hud" // 工业终端
  | "lab" // 实验档案
  | "blueprint" // 蓝图海报
  | "mono" // 黑白档案
  | "overprint"; // 套印图录

/** localStorage 键（与 index.html 内联脚本一致）。 */
export const THEME_STORAGE_KEY = "keybox.theme";
export const SKIN_STORAGE_KEY = "keybox.skin";

/** 各皮肤 × 明暗的首屏底色（三方一致，见文件头说明）。 */
export const SKIN_BG: Record<Skin, Record<Theme, string>> = {
  hud: { light: "#ede6d6", dark: "#0e0f0f" },
  lab: { light: "#f4f6f4", dark: "#0b1012" },
  mono: { light: "#f7f7f5", dark: "#08090a" },
  blueprint: { light: "#e7eef1", dark: "#000000" },
  overprint: { light: "#edf1ee", dark: "#0b0f12" },
};

/** 可选皮肤清单（供外观选择器渲染；顺序即展示顺序）。 */
export const SKINS: Array<{ id: Skin; label: string; hint: string }> = [
  {
    id: "hud",
    label: "工业终端",
    hint: "石墨 HUD / 奶油纸双底，信号黄 + 全息青，全直角工业终端",
  },
  {
    id: "lab",
    label: "实验档案",
    hint: "骨白纸底 + 淡青，细双框与等宽编号，像实验记录本",
  },
  {
    id: "blueprint",
    label: "蓝图海报",
    hint: "纯黑 chrome + 青，蓝图网格与巨型词标",
  },
  {
    id: "mono",
    label: "黑白档案",
    hint: "近黑白 + 朱红角标，硬朗的档案秩序",
  },
  {
    id: "overprint",
    label: "套印图录",
    hint: "冷白纸 + 钴蓝圆盘 + 套印错位，细线图录",
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

/** 读取 URL 预览参数（`?skin=hud&theme=dark`）。用于演示/截图，不写回存储。 */
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

/** 解析首屏皮肤：URL 预览参数 > 存储 > hud（默认皮肤）。 */
export function resolveInitialSkin(): Skin {
  if (!hasWindow()) return "hud";
  const fromUrl = readUrlParam("skin");
  if (fromUrl && SKIN_IDS.indexOf(fromUrl as Skin) >= 0) return fromUrl as Skin;
  const stored = readStorage(SKIN_STORAGE_KEY);
  return SKIN_IDS.indexOf(stored as Skin) >= 0 ? (stored as Skin) : "hud";
}

// ---------------------------------------------------------------------------
// 全局 store（同屏多个开关状态一致）
// ---------------------------------------------------------------------------
let currentPreference: ThemePreference = "system";
let currentTheme: Theme = "light";
let currentSkin: Skin = "hud";
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
 * 兼容旧调用：仅按明暗取默认皮肤（hud）的底色。
 * 新代码请用 `SKIN_BG[skin][theme]`。
 */
export const THEME_BG: Record<Theme, string> = {
  light: SKIN_BG.hud.light,
  dark: SKIN_BG.hud.dark,
};
