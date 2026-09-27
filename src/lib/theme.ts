/**
 * theme.ts —— 夜间模式的单一真相来源（架构 §10 第 11 步，R24）。
 *
 * 三个目标：① 手动切换 ② 记住选择（localStorage）③ 首屏不闪白。
 *
 * 约定（务必与 index.html 的 <head> 内联脚本保持一致，脚本先于任何 CSS 执行以消除白闪）：
 *   - 存储键：`keybox.theme`，取值 "light" | "dark"。
 *   - 首屏实际主题：有存储值用存储值；无则跟随系统 `prefers-color-scheme`；再退化为浅色。
 *   - 主题落到 <html>：`dark` 类（Tailwind darkMode:"class"）+ `color-scheme` + 内联底色 THEME_BG。
 */
export type Theme = "light" | "dark";

/** localStorage 键（与 index.html 内联脚本一致）。 */
export const THEME_STORAGE_KEY = "keybox.theme";

/** 各主题的首屏底色（与 index.css 的 --kb-bg、index.html 内联脚本三处一致）。 */
export const THEME_BG: Record<Theme, string> = { light: "#f8fafc", dark: "#0b1120" };

function hasWindow(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/** 解析“首屏应使用的主题”：存储优先，其次系统，最后浅色。 */
export function resolveInitialTheme(): Theme {
  if (!hasWindow()) return "light";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // 隐私模式 / 存储被禁用：忽略，继续走系统偏好
  }
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** 把主题应用到 DOM（<html> 类 + color-scheme + 底色）。幂等。 */
export function applyTheme(theme: Theme): void {
  if (!hasWindow()) return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  root.style.backgroundColor = THEME_BG[theme];
}

function persist(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 存储不可用：仅影响“记住选择”，不影响当前会话
  }
}

// ---------------------------------------------------------------------------
// 极简全局 store：保证同屏出现多个开关时状态一致
// ---------------------------------------------------------------------------
let currentTheme: Theme = "light";
const listeners = new Set<(theme: Theme) => void>();

export function getTheme(): Theme {
  return currentTheme;
}

/** 切换/设置主题：更新 store + 落 DOM + 持久化 + 通知订阅者。 */
export function setTheme(next: Theme): void {
  currentTheme = next;
  applyTheme(next);
  persist(next);
  listeners.forEach((fn) => fn(next));
}

/** 应用启动时调用：解析初始主题并落 DOM（与内联脚本结果一致，做一次幂等校正）。 */
export function initTheme(): void {
  currentTheme = resolveInitialTheme();
  applyTheme(currentTheme);
}

export function subscribeTheme(fn: (theme: Theme) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
