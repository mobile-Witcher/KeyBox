/**
 * ThemeToggle.tsx —— 外观选择器（皮肤 × 明暗，R24 升级版）。
 *
 * 固定在顶栏右上角；用户端（TopBar）与管理端（AdminPage 顶栏）共用同一组件。
 * 打开后可选：4 种皮肤（精致克制 / 现代科技感 / 极简商务 / 纸质档案感）+ 浅色/深色。
 * 图标用内联 SVG（不引第三方图标库）；点击面板外或按 Esc 关闭。
 */
import { useEffect, useRef, useState } from "react";
import { useAppearance } from "../hooks/useAppearance";
import { SKINS, type Skin } from "../lib/theme";

export default function ThemeToggle(): JSX.Element {
  const { theme, skin, setTheme, setSkin, toggleTheme } = useAppearance();
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

  const isDark = theme === "dark";

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
        <div className="kb-card-lg absolute right-0 z-30 mt-2 w-72 p-3">
          <p className="kb-heading text-xs font-medium uppercase text-kb-muted">皮肤</p>
          <div className="mt-2 space-y-1">
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

          <p className="kb-heading mt-3 border-t border-kb-border pt-3 text-xs font-medium uppercase text-kb-muted">
            明暗
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setTheme("light")}
              className={
                "kb-btn border text-sm " +
                (!isDark ? "border-kb-primary text-kb-primary" : "border-kb-border text-kb-muted")
              }
            >
              <SunIcon />
              浅色
            </button>
            <button
              type="button"
              onClick={() => setTheme("dark")}
              className={
                "kb-btn border text-sm " +
                (isDark ? "border-kb-primary text-kb-primary" : "border-kb-border text-kb-muted")
              }
            >
              <MoonIcon />
              深色
            </button>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            className="kb-hint mt-3 w-full text-left underline decoration-dotted hover:no-underline"
          >
            或直接切换到{isDark ? "浅色" : "深色"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 单个皮肤选项（选中态用左侧色条 + 勾号，而不是仅靠颜色差）。 */
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
        "flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition " +
        (active
          ? "border-kb-primary bg-kb-surface-2"
          : "border-transparent hover:border-kb-border hover:bg-kb-surface-2")
      }
    >
      <span
        aria-hidden
        data-skin-swatch={id}
        className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-kb-border-strong"
        style={{ background: SWATCH[id] }}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-kb-text">{label}</span>
          {active ? <CheckIcon /> : null}
        </span>
        <span className="kb-hint mt-0.5 block">{hint}</span>
      </span>
    </button>
  );
}

/** 各皮肤的代表色（用于选择器上的小圆点；与 index.css 的主色一致）。 */
const SWATCH: Record<Skin, string> = {
  default: "#4f46e5",
  tech: "linear-gradient(135deg,#7dd3fc,#818cf8 60%,#c084fc)",
  minimal: "#111111",
  paper: "#8c2a22",
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
