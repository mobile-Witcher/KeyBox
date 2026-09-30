/**
 * TopBar.tsx —— 顶栏（响应式：桌面三段式 / 移动端精简三件套）。
 *
 * 桌面（≥sm）：左=品牌，中=搜索胶囊，右=明暗一键 + 皮肤面板 + 安全 + 管理后台 + 退出 + 头像。
 * 移动端（<sm）：品牌图标 + 搜索胶囊 + 头像菜单——**所有功能收进头像下拉菜单**：
 *   深浅切换 / 安全（改主密码 / 备份 / 恢复码）/ 管理后台（仅管理员）/ 退出登录。
 *
 * 关键约束：
 *   - R19：搜索输入只用于【本机内存过滤】（vault.filterItems），不触发网络请求。
 *   - 颜色一律走主题令牌（--kb-*），本文件不出现硬编码色值。
 *   - 深浅切换同步 Android 状态栏图标颜色（Web 环境静默跳过）。
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

  // 点击菜单外 / 按 Esc 关闭
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
    if (Capacitor.isNativePlatform()) {
      const next = theme === "dark" ? "light" : "dark";
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
      {/* ── 左：品牌标识（移动端只留图标） ── */}
      <div className="flex shrink-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-kb-primary text-kb-primary-contrast"
        >
          <KeyIcon size={17} />
        </span>
        <span className="kb-heading hidden truncate text-[15px] font-semibold sm:block">KeyBox</span>
      </div>

      {/* ── 中：常驻搜索胶囊（占中间剩余宽度） ── */}
      <div className="relative min-w-0 flex-1">
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

      {/* ── 右：桌面端独立功能图标（小屏全部收进头像菜单） ── */}
      <div className="hidden shrink-0 items-center gap-0.5 sm:flex sm:gap-1">
        {onOpenAdmin ? (
          <TopIconButton label="管理后台" onClick={onOpenAdmin}>
            <UsersIcon size={18} />
          </TopIconButton>
        ) : null}
        {onOpenSecurity ? (
          <TopIconButton label="安全（改主密码 / 备份 / 恢复码）" onClick={onOpenSecurity}>
            <ShieldIcon size={18} />
          </TopIconButton>
        ) : null}
        {/* 外观选择（皮肤面板，用户端/管理端同一位置） */}
        <ThemeToggle />
        <TopIconButton label="退出登录" onClick={onSignOut}>
          <LogOutIcon size={18} />
        </TopIconButton>
      </div>

      {/* ── 账户头像（点击打开账户菜单：全端统一入口） ── */}
      <div className="relative shrink-0" ref={acctRef}>
        <button
          type="button"
          onClick={() => setAccountOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={accountOpen}
          title={`账户：${username}`}
          className="grid h-8 w-8 place-items-center rounded-full bg-kb-surface-2 text-xs font-semibold text-kb-text transition hover:bg-kb-surface-2 hover:ring-2 hover:ring-kb-primary"
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
            {/* 深浅切换（账户菜单内也有，与顶栏一键按钮等效） */}
            <MenuItem
              icon={isDark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
              label={isDark ? "切换到浅色模式" : "切换到深色模式"}
              onClick={flipColorScheme}
            />
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
    </header>
  );
}

function TopIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid h-9 w-9 place-items-center rounded-lg text-kb-muted transition hover:bg-kb-surface-2 hover:text-kb-text"
    >
      {children}
    </button>
  );
}
