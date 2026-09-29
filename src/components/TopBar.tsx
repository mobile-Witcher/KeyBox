/**
 * TopBar.tsx —— 顶栏（架构 §5.1 线框）：搜索框（本地检索） + 当前用户 + 退出 + 外观选择。
 *
 * R19：搜索框的输入只用于【本机内存过滤】，绝不发往云端；本组件不触发任何网络请求。
 *
 * 响应式（2026-09-29 移动端适配）：
 *   - 小屏：内边距收紧、搜索框占满剩余宽度、次要文案换短词（"退出登录"→"退出"、"管理后台"→"后台"）、
 *     用户名隐藏
 *   - ≥sm：恢复完整文案与间距；≥md：显示用户名
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
    <header className="flex items-center gap-2 border-b border-kb-border px-3 py-2 sm:gap-4 sm:px-6 sm:py-3">
      <div className="shrink-0 font-semibold">KeyBox</div>
      <input
        type="search"
        value={searchValue}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="搜索站点 / 网址 / 标签（仅本机）"
        className="kb-input min-w-0 flex-1 py-1.5 md:max-w-md"
      />
      <div className="flex shrink-0 items-center gap-1 text-sm sm:gap-3">
        {onOpenAdmin ? (
          <button
            type="button"
            onClick={onOpenAdmin}
            title="管理后台"
            className="rounded px-2 py-1.5 text-kb-text hover:bg-kb-surface-2"
          >
            <span className="hidden sm:inline">管理后台</span>
            <span className="sm:hidden">后台</span>
          </button>
        ) : null}
        <span className="hidden text-kb-muted md:inline">{username}</span>
        <button
          type="button"
          onClick={onSignOut}
          title="退出登录"
          className="rounded px-2 py-1.5 text-kb-muted hover:bg-kb-surface-2"
        >
          <span className="hidden sm:inline">退出登录</span>
          <span className="sm:hidden">退出</span>
        </button>
        {/* 外观选择固定在右上角（用户端/管理端同一位置） */}
        <ThemeToggle />
      </div>
    </header>
  );
}
