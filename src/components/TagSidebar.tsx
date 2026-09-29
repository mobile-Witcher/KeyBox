/**
 * TagSidebar.tsx —— 标签筛选（架构 §5.1，R18）：多标签筛选、重命名、删除。
 *
 * 响应式（2026-09-29 移动端适配）：
 *   - 桌面（≥768px）：左侧竖栏（宽 56），带标签管理（改名 / 删除，hover 出现）
 *   - 移动（<768px）：顶部**横向可滚动标签条**，只做筛选。
 *     理由：触屏没有 hover，改名/删除按钮无处安放；把这两个管理动作留给桌面端更可靠。
 *
 * 删除标签前由上层弹确认并提示「会影响几条记录」（count 由上层算出后传入 onRequestDelete）。
 * 本组件不做网络请求、不做持久化，只发意图给上层。
 */
import type { TagCount } from "../lib/vault";

interface TagSidebarProps {
  totalCount: number;
  tags: TagCount[];
  activeTag: string | null;
  onSelect: (tag: string | null) => void;
  onRequestRename: (tag: string) => void;
  onRequestDelete: (tag: string) => void;
}

export default function TagSidebar({
  totalCount,
  tags,
  activeTag,
  onSelect,
  onRequestRename,
  onRequestDelete,
}: TagSidebarProps): JSX.Element {
  const chipBase = "shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition";
  const chipOn = "border-kb-primary bg-kb-surface-2 font-medium text-kb-text";
  const chipOff = "border-kb-border text-kb-muted";

  return (
    <aside className="shrink-0 border-kb-border md:w-56 md:border-r md:p-4">
      {/* ── 移动端：横向标签条（可滚动） ── */}
      <div className="flex gap-2 overflow-x-auto border-b border-kb-border px-3 py-2 md:hidden">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`${chipBase} ${activeTag === null ? chipOn : chipOff}`}
        >
          全部 ({totalCount})
        </button>
        {tags.map((tag) => (
          <button
            key={tag.name}
            type="button"
            onClick={() => onSelect(tag.name)}
            className={`${chipBase} ${activeTag === tag.name ? chipOn : chipOff}`}
          >
            {tag.name} ({tag.count})
          </button>
        ))}
      </div>

      {/* ── 桌面：左侧竖栏 ── */}
      <div className="hidden md:block">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-kb-muted">标签</div>
        <ul className="space-y-1 text-sm">
          <li>
            <button
              type="button"
              onClick={() => onSelect(null)}
              className={`w-full rounded px-2 py-1 text-left ${
                activeTag === null
                  ? "bg-kb-surface-2 font-medium dark:bg-kb-surface-2"
                  : "hover:bg-kb-surface-2"
              }`}
            >
              全部 ({totalCount})
            </button>
          </li>
          {tags.map((tag) => (
            <li key={tag.name} className="group flex items-center">
              <button
                type="button"
                onClick={() => onSelect(tag.name)}
                className={`flex-1 truncate rounded px-2 py-1 text-left ${
                  activeTag === tag.name
                    ? "bg-kb-surface-2 font-medium dark:bg-kb-surface-2"
                    : "hover:bg-kb-surface-2"
                }`}
                title={tag.name}
              >
                {tag.name} ({tag.count})
              </button>
              <span className="ml-1 hidden gap-1 group-hover:flex">
                <button
                  type="button"
                  onClick={() => onRequestRename(tag.name)}
                  className="rounded px-1 text-xs text-kb-muted hover:bg-kb-surface-2"
                  title="重命名标签"
                >
                  改名
                </button>
                <button
                  type="button"
                  onClick={() => onRequestDelete(tag.name)}
                  className="rounded px-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                  title="删除标签"
                >
                  删除
                </button>
              </span>
            </li>
          ))}
        </ul>
        {tags.length === 0 ? (
          <p className="mt-3 text-xs text-kb-muted">还没有标签，在“新增/编辑密钥”里填写即可。</p>
        ) : null}
      </div>
    </aside>
  );
}
