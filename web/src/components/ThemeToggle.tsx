/**
 * ThemeToggle.tsx —— 外观选择器（皮肤 × 明暗，R24 升级版；2026-10-18 增加「跟随系统」）。
 *
 * 固定在顶栏右上角；用户端（TopBar）与管理端（AdminPage 顶栏）共用同一组件。
 * 打开后可选：10 种皮肤 + 明暗三选一（浅色 / 深色 / 跟随系统）。
 * 风格：每个皮肤给出「三色预览条」，明暗用分段控件；图标全内联 SVG（不引第三方库）。
 * 交互：点击面板外或按 Esc 关闭。
 */
import { useEffect, useRef, useState } from "react";
import { useAppearance } from "../hooks/useAppearance";
import { SKINS, type Skin } from "../lib/theme";

export default function ThemeToggle(): JSX.Element {
  const { skin, preference, setSkin, setThemePreference } = useAppearance();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // 点击面板外 / 按 Esc 关闭
  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e: MouseEvent): void {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const currentSkinLabel = SKINS.find((s) => s.id === skin)?.label ?? "";

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="外观设置"
        aria-expanded={open}
        title="外观设置（皮肤与明暗）"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-kb-border text-kb-muted transition-colors hover:bg-kb-surface-2 hover:text-kb-text"
      >
        <PaletteIcon />
      </button>

      {open ? (
        <div className="kb-card-lg absolute right-0 z-30 mt-2 w-[23rem] max-w-[calc(100vw-2rem)] p-4">
          {/* 面板头：标题 + 当前皮肤 */}
          <div className="flex items-center gap-2 border-b border-kb-border pb-3">
            <span aria-hidden className="shrink-0 text-kb-muted">
              <PaletteIcon />
            </span>
            <span className="kb-heading text-[13px] font-semibold uppercase leading-none tracking-[0.18em] text-kb-text">
              外观
            </span>
            <span className="kb-hint ml-auto max-w-[9rem] truncate text-right">{currentSkinLabel}</span>
          </div>

          {/* 皮肤列表（不设分区标题：面板头已有「外观」，减少一行噪音） */}
          <div className="mt-3.5 max-h-[44vh] space-y-1.5 overflow-y-auto pr-1">
            {SKINS.map((s) => (
              <SkinOption
                key={s.id}
                id={s.id}
                label={s.label}
                hint={s.hint}
                active={skin === s.id}
                onPick={() => setSkin(s.id)}
              />
            ))}
          </div>

          {/* 明暗：三段式分段控件（分隔线取代原来的「明暗」标题行） */}
          <div className="mt-4 border-t border-kb-border" />
          <div
            role="group"
            aria-label="明暗模式"
            className="mt-3 grid grid-cols-3 gap-1.5 rounded-lg border border-kb-border p-1"
          >
            <ThemeChoice
              active={preference === "light"}
              onClick={() => setThemePreference("light")}
              icon={<SunIcon />}
              label="浅色"
            />
            <ThemeChoice
              active={preference === "dark"}
              onClick={() => setThemePreference("dark")}
              icon={<MoonIcon />}
              label="深色"
            />
            <ThemeChoice
              active={preference === "system"}
              onClick={() => setThemePreference("system")}
              icon={<SystemIcon />}
              label="跟随系统"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 单个皮肤选项：左侧三色预览条 + 名称 + 说明；选中态加左侧强调边与勾号。 */
function SkinOption({
  id,
  label,
  hint,
  active,
  onPick,
}: {
  id: Skin;
  label: string;
  hint: string;
  active: boolean;
  onPick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={
        "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition " +
        (active
          ? "border-kb-primary bg-kb-surface-2 shadow-sm"
          : "border-transparent hover:border-kb-border hover:bg-kb-surface-2")
      }
    >
      {/* 三色预览条：底 / 主色 / 强调色，比单色圆点更能看出皮肤气质 */}
      <span
        aria-hidden
        data-skin-swatch={id}
        className="flex h-9 w-11 shrink-0 overflow-hidden rounded border border-kb-border-strong"
      >
        {SKIN_PREVIEW[id].map((color, index) => (
          <span key={index} className="block h-full flex-1" style={{ background: color }} />
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-kb-text">{label}</span>
          {active ? <CheckIcon /> : null}
        </span>
        <span className="kb-hint mt-0.5 block leading-snug">{hint}</span>
      </span>
    </button>
  );
}

/** 明暗分段控件里的一项。 */
function ThemeChoice({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: JSX.Element;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "flex min-h-[40px] items-center justify-center gap-1.5 rounded-md px-1.5 text-xs font-medium transition " +
        (active
          ? "bg-kb-surface text-kb-primary ring-1 ring-kb-primary"
          : "text-kb-muted hover:bg-kb-surface-2 hover:text-kb-text")
      }
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

/** 各皮肤的三色预览（底 / 主色 / 强调），与 index.css 的令牌一致。 */
const SKIN_PREVIEW: Record<Skin, [string, string, string]> = {
  default: ["#f8fafc", "#4f46e5", "#0f172a"],
  tech: ["#eef2fb", "#5b53e8", "#7dd3fc"],
  minimal: ["#ffffff", "#111111", "#d4d4d4"],
  paper: ["#f4efe4", "#8c2b22", "#b9ad95"],
  cyber: ["#f7f0fb", "#d1007a", "#00c8ff"],
  kawaii: ["#fff5f9", "#ff7ab6", "#ffd6e8"],
  hacker: ["#000000", "#20ff5f", "#1c3a1f"],
  solar: ["#f4f0e6", "#2f6f5e", "#c2bca8"],
  sunset: ["#fff4ec", "#e2622a", "#ffb347"],
  endfield: ["#ede6d6", "#f2c300", "#1d2020"],
  rhine: ["#f4f6f4", "#0e6e6b", "#2fb6b0"],
  arknights: ["#08090a", "#c8102e", "#f2f2f2"],
  travel: ["#efe7d6", "#b4402b", "#2b2a24"],
  atlas: ["#edf1ee", "#2447c6", "#101418"],
};

function PaletteIcon(): JSX.Element {
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
      <circle cx="13.5" cy="6.5" r="1.5" />
      <circle cx="17.5" cy="10.5" r="1.5" />
      <circle cx="8.5" cy="7.5" r="1.5" />
      <circle cx="6.5" cy="12.5" r="1.5" />
      <path d="M12 2a10 10 0 0 0 0 20 2.5 2.5 0 0 0 2.5-2.5c0-.6-.2-1.1-.6-1.5-.4-.4-.6-.9-.6-1.5a2.5 2.5 0 0 1 2.5-2.5H18a4 4 0 0 0 4-4c0-4.4-4.5-8-10-8z" />
    </svg>
  );
}

function CheckIcon(): JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-kb-primary"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function SunIcon(): JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
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
      width="15"
      height="15"
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

/** 跟随系统：显示器图标。 */
function SystemIcon(): JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8.5 20h7M12 16v4" />
      <path d="M12 8.5a3.5 3.5 0 0 0 0 3.5" opacity="0.75" />
    </svg>
  );
}
