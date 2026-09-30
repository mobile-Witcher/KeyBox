/**
 * TopBar.tsx —— 顶栏（桌面视图重设计，纯布局/视觉层）。
 *
 * 三段式：左=品牌标识，中=常驻搜索胶囊，右=明暗一键 / 外观 / 账户菜单。
 *
 * 账户管理：头像点开下拉菜单，整合「安全（改主密码 / 备份 / 恢复码）」、
 *   「管理后台（仅管理员）」与「退出登录」——三个独立图标合并为一个入口。
 *
 * 一键深浅切换：顶栏最右的太阳/月亮按钮，单击即在深浅色间切换，
 *   并同步 Android 状态栏图标颜色（Web 环境静默跳过）。
 *
 * 关键约束：
 *   - R19：搜索输入只用于【本机内存过滤】（vault.filterItems），
 *     本组件不触发任何网络请求；title 里保留"不会发往云端"的说明。
 *   - 颜色一律走主题令牌；本文件不出现硬编码色值。
 *   - 功能入口一个都不少：管理后台（仅管理员）、安全、外观切换、退出登录全部保留，
 *     只是整合进账户菜单与一键切换按钮。
 *
 * 响应式：小屏隐藏品牌字标与次要图标间距；搜索框始终占满剩余宽度。
 */
import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import ThemeToggle from "./ThemeToggle";
import {
  KeyIcon,
  LogOutIcon,
  MoonIcon,
  SearchIcon,
  ShieldIcon,
  SunIcon,
  UsersIcon,
} from "./icons";
import { useAppearance } from "../hooks/useAppearance";

interface TopBarProps {
  username: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSignOut: () => void;
  /** 仅管理员传入：显示"管理后台"入口（第 8 步）。 */
  onOpenAdmin?: () => void;
  /** 点击"安全"（打开安全弹层：改主密码 / 加密备份 / 恢复码）。未解锁（无主密钥）时上层不传。 */
  onOpenSecurity?: () => void;
}

function MenuItem({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-kb-text transition hover:bg-kb-surface-2 ${
        danger ? "text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300" : ""
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export default function TopBar({
  username,
  searchValue,
  onSearchChange,
  onSignOut,
  onOpenAdmin,
  onOpenSecurity,
}: TopBarProps): JSX.Element {
  const avatarText = (Array.from(username.trim())[0] || "?").toUpperCase();
  const { theme, toggleTheme } = useAppearance();
  const isDark = theme === "dark";

  /** 账户菜单开关。 */
  const [accountOpen, setAccountOpen] = useState(false);
  const acctRef = useRef<HTMLDivElement | null>(null);

  // 点击菜单外 / 按 Esc 关闭（与 ThemeToggle 同一套交互约定）
  useEffect(() => {
    if (!accountOpen) return undefined;
    function onDocClick(e: MouseEvent): void {
      if (acctRef.current && !acctRef.current.contains(e.target as Node)) setAccountOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setAccountOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [accountOpen]);

  /** 一键切换深浅色，并同步 Android 状态栏图标颜色。 */
  const flipColorScheme = (): void => {
    toggleTheme();
    const next = theme === "dark" ? "light" : "dark";
    if (Capacitor.isNativePlatform()) {
      void StatusBar.setStyle({ style: next === "dark" ? Style.Dark : Style.Light }).catch(
        () => undefined,
      );
    }
  };

  return (
    <header
      className="sticky top-0 z-30 flex items-center gap-2 border-b border-kb-border bg-kb-surface px-3 py-2 sm:gap-4 sm:px-6 sm:py-2.5"
      style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
    >
      {/* ── 左：品牌标识（flex-1 与右侧功能组等宽 → 搜索严格居中） ── */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          aria-hidden="true"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-kb-primary text-kb-primary-contrast"
        >
          <KeyIcon size={17} />
        </span>
        <span className="kb-heading hidden truncate text-[15px] font-semibold sm:block">KeyBox</span>
      </div>

      {/* ── 中：常驻搜索胶囊（flex-1：占中间剩余宽度，不挤压左右两段） ── */}
      <div className="relative min-w-0 flex-1 sm:max-w-md md:max-w-lg">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-kb-muted"
        >
          <SearchIcon size={16} />
        </span>
        <input
          type="search"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索站点、接口地址、模型名…"
          title="仅在本机内存过滤，关键词不会发往云端"
          aria-label="搜索站点、接口地址、模型名"
          className="kb-input rounded-full py-1.5 pl-9 pr-3"
        />
      </div>

      {/* ── 右：一键深浅切换 + 外观 + 账户菜单（flex-1 justify-end → 贴最右） ── */}
      <div className="flex min-w-0 flex-1 shrink-0 items-center justify-end gap-0.5 sm:gap-1">
        {/* 一键切换深浅色（最顶部，单击即生效并同步状态栏图标） */}
        <button
          type="button"
          onClick={flipColorScheme}
          title={isDark ? "切换到浅色" : "切换到深色"}
          aria-label={isDark ? "切换到浅色" : "切换到深色"}
          className="grid h-9 w-9 place-items-center rounded-lg text-kb-muted transition hover:bg-kb-surface-2 hover:text-kb-text"
        >
          {isDark ? <SunIcon size={18} /> : <MoonIcon size={18} />}
        </button>

        {/* 外观面板（9 皮肤选择） */}
        <ThemeToggle />

        {/* 账户菜单（安全 / 管理后台 / 退出登录整合于此） */}
        <div className="relative" ref={acctRef}>
          <button
            type="button"
            onClick={() => setAccountOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            title={`账户：${username}`}
            className="ml-1 grid h-8 w-8 place-items-center rounded-full bg-kb-surface-2 text-xs font-semibold text-kb-text transition hover:bg-kb-surface-2 hover:ring-2 hover:ring-kb-primary"
          >
            {avatarText}
          </button>

          {accountOpen ? (
            <div className="kb-card-lg absolute right-0 z-40 mt-2 w-64 p-2" role="menu">
              {/* 头部：用户身份 */}
              <div className="flex items-center gap-3 px-2 py-2">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-kb-surface-2 text-sm font-semibold text-kb-text">
                  {avatarText}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-kb-text">{username}</div>
                  <div className="truncate text-xs text-kb-muted">已登录 · 数据端到端加密</div>
                </div>
              </div>
              <div className="my-1 border-t border-kb-border" />
              {onOpenSecurity ? (
                <MenuItem
                  icon={<ShieldIcon size={16} />}
                  label="安全（改主密码 / 备份 / 恢复码）"
                  onClick={() => {
                    setAccountOpen(false);
                    onOpenSecurity();
                  }}
                />
              ) : null}
              {onOpenAdmin ? (
                <MenuItem
                  icon={<UsersIcon size={16} />}
                  label="管理后台"
                  onClick={() => {
                    setAccountOpen(false);
                    onOpenAdmin();
                  }}
                />
              ) : null}
              <div className="my-1 border-t border-kb-border" />
              <MenuItem
                icon={<LogOutIcon size={16} />}
                label="退出登录"
                danger
                onClick={() => {
                  setAccountOpen(false);
                  onSignOut();
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
