/**
 * TagSidebar.tsx —— 左栏标签（架构 §5.1，R18）：多标签筛选、重命名、删除。
 *
 * 删除标签前由上层弹确认并提示“会影响几条记录”（count 由上层算出后传入 onRequestDelete）。
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
  return (
    <aside className="w-56 shrink-0 border-r border-kb-border p-4 dark:border-kb-border">
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
    </aside>
  );
}
