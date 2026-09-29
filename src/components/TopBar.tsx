/**
 * TopBar.tsx —— 顶栏（架构 §5.1 线框）：搜索框（本地检索） + 当前用户 + 退出 + 主题切换。
 *
 * R19：搜索框的输入只用于【本机内存过滤】，绝不发往云端；本组件不触发任何网络请求。
 */
import ThemeToggle from "./ThemeToggle";

interface TopBarProps {
  username: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSignOut: () => void;
  /** 仅管理员传入：显示“管理后台”入口（第 8 步）。 */
  onOpenAdmin?: () => void;
}

export default function TopBar({
  username,
  searchValue,
  onSearchChange,
  onSignOut,
  onOpenAdmin,
}: TopBarProps): JSX.Element {
  return (
    <header className="flex items-center gap-4 border-b border-kb-border px-6 py-3 dark:border-kb-border">
      <div className="font-semibold">KeyBox</div>
      <input
        type="search"
        value={searchValue}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="搜索站点 / 网址 / 标签（仅本机）"
        className="ml-2 w-full max-w-md rounded-lg border border-kb-border-strong bg-white px-3 py-1.5 text-sm outline-none focus:border-kb-border-strong focus:ring-2 focus:ring-kb-border dark:border-kb-border-strong dark:kb-btn-primary"
      />
      <div className="ml-auto flex items-center gap-3 text-sm">
        {onOpenAdmin ? (
          <button
            type="button"
            onClick={onOpenAdmin}
            className="rounded px-2 py-1 text-kb-text hover:bg-kb-surface-2 dark:text-kb-text dark:hover:brightness-110"
          >
            管理后台
          </button>
        ) : null}
        <span className="text-kb-muted">{username}</span>
        <button
          type="button"
          onClick={onSignOut}
          className="rounded px-2 py-1 text-kb-muted hover:bg-kb-surface-2 dark:text-kb-muted dark:hover:brightness-110"
        >
          退出登录
        </button>
        {/* 主题切换固定在右上角（用户端/管理端同一位置） */}
        <ThemeToggle />
      </div>
    </header>
  );
}
