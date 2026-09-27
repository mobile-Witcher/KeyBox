/**
 * ThemeToggle.tsx —— 夜间模式手动切换按钮（R24）。
 *
 * 固定在顶栏右上角；用户端（TopBar）与管理端（AdminPage 顶栏）使用同一个组件、同一位置。
 * 图标用内联 SVG（不引第三方图标库），随当前主题展示“太阳/月亮”。
 */
import { useTheme } from "../hooks/useTheme";

export default function ThemeToggle(): JSX.Element {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "切换到浅色模式" : "切换到深色模式";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-kb-border text-kb-muted transition-colors hover:bg-slate-100 hover:text-kb-text dark:hover:bg-slate-700"
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
