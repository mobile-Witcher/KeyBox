/**
 * TopBar.tsx —— 顶栏（桌面视图重设计，纯布局/视觉层）。
 *
 * 三段式：左=品牌标识，中=常驻搜索胶囊，右=安全 / 外观 / 管理后台 / 退出 / 用户头像。
 *
 * 关键约束：
 *   - R19：搜索输入只用于【本机内存过滤】（上层交给 vault.filterItems），
 *     本组件不触发任何网络请求；title 里保留"不会发往云端"的说明，避免用户误会。
 *   - 颜色一律走主题令牌；本文件不出现硬编码色值。
 *   - 功能入口一个都不少：管理后台（仅管理员）、安全、外观切换、退出登录全部保留，
 *     只是把文字换成了图标 + title 提示（窄屏空间更从容）。
 *     「安全」在移动端与桌面端都显示（打开安全弹层）。
 *
 * 响应式：小屏隐藏品牌字标与次要图标间距；搜索框始终占满剩余宽度。
 */
import ThemeToggle from "./ThemeToggle";
import { KeyIcon, LogOutIcon, SearchIcon, ShieldIcon, UsersIcon } from "./icons";

interface TopBarProps {
  username: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSignOut: () => void;
  /** 仅管理员传入：显示“管理后台”入口（第 8 步）。 */
  onOpenAdmin?: () => void;
  /** 点击“安全”（打开安全弹层：改主密码 / 加密备份 / 恢复码）。未解锁（无主密钥）时上层不传。 */
  onOpenSecurity?: () => void;
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

  return (
    <header
      className="sticky top-0 z-30 flex items-center gap-2 border-b border-kb-border bg-kb-surface px-3 py-2 sm:gap-4 sm:px-6 sm:py-2.5"
      style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
    >
      {/* ── 左：品牌标识 ── */}
      <div className="flex shrink-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="grid h-8 w-8 place-items-center rounded-lg bg-kb-primary text-kb-primary-contrast"
        >
          <KeyIcon size={17} />
        </span>
        <span className="kb-heading hidden text-[15px] font-semibold sm:block">KeyBox</span>
      </div>

      {/* ── 中：常驻搜索胶囊 ── */}
      <div className="relative min-w-0 flex-1 sm:max-w-xl">
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

      {/* ── 右：功能图标 + 头像 ── */}
      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
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
        {/* 外观选择（用户端/管理端同一位置） */}
        <ThemeToggle />
        <TopIconButton label="退出登录" onClick={onSignOut}>
          <LogOutIcon size={18} />
        </TopIconButton>
        <span
          title={username}
          className="ml-1 grid h-8 w-8 place-items-center rounded-full bg-kb-surface-2 text-xs font-semibold text-kb-text"
        >
          {avatarText}
        </span>
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
