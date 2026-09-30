/**
 * TagSidebar.tsx —— 分类/标签筛选（架构 §5.1，R18：多标签筛选、重命名、删除）。
 *
 * 桌面视图重设计（纯布局/视觉层）：
 *   - 桌面（≥768px）：收窄成 **56–64px 的图标栏**，【只显示图标不显示文字】，
 *     悬停用 title 提示分类名，选中态用色块高亮。
 *     每个分类配语义图标（全部=盒 / 常用=星 / 进入验证输入=盾 / 云平台=云 / aiport=柱状图），
 *     未命中的分类回落到通用「标签」图标——因为标签是用户自建的，无法穷举。
 *   - 标签管理（改名 / 删除，R18）**没有丢**：选中某个分类后，在其下方出现两个小图标按钮。
 *     （原实现是 hover 显示文字按钮，图标栏放不下文字，故改为「选中后显示图标」。）
 *   - 图标栏底部固定「设置」入口，可带角标提示安全操作在那里。
 *
 * 移动端（<768px）保持横向可滚动标签条：触屏没有 hover，且窄屏下 56px 竖栏太占宽度。
 *
 * 颜色一律走主题令牌；本文件不出现硬编码色值。
 */
import type { TagCount } from "../lib/vault";
import {
  BarChartIcon,
  BoxIcon,
  CloudIcon,
  PencilIcon,
  SettingsIcon,
  ShieldIcon,
  StarIcon,
  TagIcon,
  TrashIcon,
} from "./icons";

interface TagSidebarProps {
  totalCount: number;
  tags: TagCount[];
  activeTag: string | null;
  onSelect: (tag: string | null) => void;
  onRequestRename: (tag: string) => void;
  onRequestDelete: (tag: string) => void;
  /** 点击底部「设置」图标（滚动到安全面板）。 */
  onOpenSettings: () => void;
  /** true 时在设置图标上显示角标（有未完成的安全提醒）。 */
  settingsAttention?: boolean;
}

/**
 * 分类名 → 语义图标。
 * 说明：标签由用户自建，这里按**关键词包含**匹配已知分类，其余回落到通用标签图标，
 * 因此新增任意标签都不会白屏、也不会报错。
 */
function TagGlyph({ name }: { name: string }): JSX.Element {
  const n = name.toLowerCase();
  if (n.includes("常用")) return <StarIcon size={18} />;
  if (n.includes("验证") || n.includes("门禁")) return <ShieldIcon size={18} />;
  if (n.includes("云")) return <CloudIcon size={18} />;
  if (n.includes("port") || n.includes("端口")) return <BarChartIcon size={18} />;
  return <TagIcon size={18} />;
}

export default function TagSidebar({
  totalCount,
  tags,
  activeTag,
  onSelect,
  onRequestRename,
  onRequestDelete,
  onOpenSettings,
  settingsAttention = false,
}: TagSidebarProps): JSX.Element {
  const chipBase = "shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition";
  const chipOn = "border-kb-primary bg-kb-surface-2 font-medium text-kb-text";
  const chipOff = "border-kb-border text-kb-muted";

  /** 图标按钮基座（40×40，居中）。 */
  const railBtn = "grid h-10 w-10 place-items-center rounded-xl transition";
  const railOn = "bg-kb-surface-2 text-kb-primary";
  const railOff = "text-kb-muted hover:bg-kb-surface-2 hover:text-kb-text";

  return (
    <aside className="shrink-0 border-kb-border md:flex md:w-16 md:flex-col md:border-r md:py-3">
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

      {/* ── 桌面：窄图标栏 ── */}
      <div className="hidden md:flex md:flex-1 md:flex-col md:items-center">
        <nav className="flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => onSelect(null)}
            title={`全部密钥（${totalCount}）`}
            aria-label={`全部密钥（${totalCount}）`}
            className={`${railBtn} ${activeTag === null ? railOn : railOff}`}
          >
            <BoxIcon size={18} />
          </button>

          {tags.map((tag) => {
            const selected = activeTag === tag.name;
            return (
              <div key={tag.name} className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => onSelect(tag.name)}
                  title={`${tag.name}（${tag.count}）`}
                  aria-label={`${tag.name}（${tag.count}）`}
                  className={`${railBtn} ${selected ? railOn : railOff}`}
                >
                  <TagGlyph name={tag.name} />
                </button>
                {/* 选中后显示分类管理（R18）：图标栏放不下文字，故用图标 */}
                {selected ? (
                  <div className="mt-0.5 flex gap-0.5">
                    <button
                      type="button"
                      onClick={() => onRequestRename(tag.name)}
                      title={`重命名分类「${tag.name}」`}
                      aria-label={`重命名分类「${tag.name}」`}
                      className="grid h-5 w-5 place-items-center rounded text-kb-muted transition hover:bg-kb-surface-2 hover:text-kb-text"
                    >
                      <PencilIcon size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRequestDelete(tag.name)}
                      title={`删除分类「${tag.name}」`}
                      aria-label={`删除分类「${tag.name}」`}
                      className="grid h-5 w-5 place-items-center rounded text-kb-muted transition hover:bg-kb-surface-2 hover:text-red-600 dark:hover:text-red-400"
                    >
                      <TrashIcon size={12} />
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        {/* 底部固定：设置（安全操作入口） */}
        <div className="mt-auto pt-3">
          <button
            type="button"
            onClick={onOpenSettings}
            title="设置（改主密码 / 备份 / 恢复码）"
            aria-label="设置（改主密码 / 备份 / 恢复码）"
            className={`relative ${railBtn} ${railOff}`}
          >
            <SettingsIcon size={18} />
            {settingsAttention ? (
              <span
                aria-hidden="true"
                title="有未完成的安全提醒"
                className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-kb-primary"
              />
            ) : null}
          </button>
        </div>
      </div>
    </aside>
  );
}
