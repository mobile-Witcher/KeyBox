/**
 * theme.ts —— 外观（**皮肤 × 明暗**）的单一真相来源。
 *
 * 两个正交维度：
 *   - 明暗：`light` | `dark`          → 落到 `<html class="dark">`（Tailwind darkMode:"class"）
 *   - 皮肤：`default` | `tech` | `minimal` | `paper` → 落到 `<html data-skin="...">`
 * 组合示例：科技风·深色 = `<html data-skin="tech" class="dark">`。
 * 皮肤只改 index.css 里的语义变量，因此**新增皮肤不需要改任何组件**。
 *
 * 三个目标：① 手动切换 ② 记住选择（localStorage）③ 首屏不闪。
 *
 * ⚠️ 一致性约束：下面 `SKIN_BG` 的 8 个色值必须与
 *   - index.css 各皮肤块里的 `--kb-bg`
 *   - index.html `<head>` 内联脚本里的 BG 表
 *   三处完全一致，否则切换皮肤时会闪一下底色（FOUC）。
 */
export type Theme = "light" | "dark";
export type Skin = "default" | "tech" | "minimal" | "paper";

/** localStorage 键（`keybox.skin` 与 index.html 内联脚本一致）。 */
export const THEME_STORAGE_KEY = "keybox.theme";
export const SKIN_STORAGE_KEY = "keybox.skin";

/** 各皮肤 × 明暗的首屏底色（三方一致，见文件头说明）。 */
export const SKIN_BG: Record<Skin, Record<Theme, string>> = {
  default: { light: "#f8fafc", dark: "#0b1120" },
  tech: { light: "#eef2fb", dark: "#070b16" },
  minimal: { light: "#ffffff", dark: "#0a0a0a" },
  paper: { light: "#f4efe4", dark: "#1c1710" },
};

/** 可选皮肤清单（供外观选择器渲染；顺序即展示顺序）。 */
export const SKINS: Array<{ id: Skin; label: string; hint: string }> = [
  { id: "default", label: "精致克制", hint: "白/深蓝底，品牌靛蓝点缀，细边框小圆角" },
  { id: "tech", label: "现代科技感", hint: "深邃底色 + 发光层次，突出保险箱的科技感" },
  { id: "minimal", label: "极简商务", hint: "无圆角无阴影，靠留白与字距分层" },
  { id: "paper", label: "纸质档案感", hint: "米黄纸底 + 衬线字 + 红色套色，像纸质密钥簿" },
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

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 存储不可用：仅影响"记住选择"，不影响当前会话
  }
}

/** 解析首屏明暗：存储优先，其次系统偏好，最后浅色。 */
export function resolveInitialTheme(): Theme {
  if (!hasWindow()) return "light";
  const stored = readStorage(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** 解析首屏皮肤：存储优先，非法值回退 default。 */
export function resolveInitialSkin(): Skin {
  if (!hasWindow()) return "default";
  const stored = readStorage(SKIN_STORAGE_KEY);
  return SKIN_IDS.indexOf(stored as Skin) >= 0 ? (stored as Skin) : "default";
}

// ---------------------------------------------------------------------------
// 全局 store（同屏多个开关状态一致）
// ---------------------------------------------------------------------------
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
export function getSkin(): Skin {
  return currentSkin;
}

export function setTheme(next: Theme): void {
  currentTheme = next;
  paint();
  writeStorage(THEME_STORAGE_KEY, next);
  themeListeners.forEach((fn) => fn(next));
}

export function setSkin(next: Skin): void {
  currentSkin = next;
  paint();
  writeStorage(SKIN_STORAGE_KEY, next);
  skinListeners.forEach((fn) => fn(next));
}

/** 应用启动时调用：解析并落 DOM（与内联脚本结果一致，做一次幂等校正）。 */
export function initTheme(): void {
  currentTheme = resolveInitialTheme();
  currentSkin = resolveInitialSkin();
  paint();
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
 * 兼容旧调用：仅按明暗取底色。
 * 新代码请用 `SKIN_BG[skin][theme]`。
 */
export const THEME_BG: Record<Theme, string> = {
  light: SKIN_BG.default.light,
  dark: SKIN_BG.default.dark,
};
