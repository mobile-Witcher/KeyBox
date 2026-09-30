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
 *   - 图标栏底部固定「安全」入口（打开安全弹层），可带角标提示。
 *
 * 移动端（<768px）：横向标签条改为**下拉选择器**——
 *   收起态显示当前选中项（默认「全部密钥（N）」），点击展开菜单列出「全部」+ 各分类（带条数），
 *   选中后收起。固顶行为（sticky top-[52px]）与桌面图标栏都不受影响。
 *   分类管理（改名/删除）仍只放桌面端：下拉项是「选择器」语义，混入破坏性动作易误触。
 *
 * 颜色一律走主题令牌；本文件不出现硬编码色值。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { TagCount } from "../lib/vault";
import {
  BarChartIcon,
  BoxIcon,
  ChevronDownIcon,
  CloudIcon,
  PencilIcon,
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
  /** 点击底部「安全」图标（打开安全弹层）。 */
  onOpenSecurity: () => void;
  /** true 时在安全图标上显示角标（有未完成的安全提醒）。 */
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
  onOpenSecurity,
  settingsAttention = false,
}: TagSidebarProps): JSX.Element {
  /** 图标按钮基座（40×40，居中）。 */
  const railBtn =
    "flex h-10 w-full items-center gap-3 rounded-xl px-2.5 transition md:justify-center lg:justify-start";
  const railOn = "bg-kb-surface-2 text-kb-primary";
  const railOff = "text-kb-muted hover:bg-kb-surface-2 hover:text-kb-text";

  return (
    <aside className="hidden shrink-0 border-kb-border md:block md:w-16 md:border-r md:py-3 lg:w-56 lg:py-4">
      {/* ── 桌面侧栏：md 收窄为图标栏，lg 起展开为图标+文字（屏宽自适应） ── */}
      <div className="hidden md:flex md:flex-1 md:flex-col">
        <nav className="flex flex-col items-stretch gap-1 px-2">
          <button
            type="button"
            onClick={() => onSelect(null)}
            title={`全部密钥（${totalCount}）`}
            aria-label={`全部密钥（${totalCount}）`}
            className={`${railBtn} ${activeTag === null ? railOn : railOff}`}
          >
            <BoxIcon size={18} />
            <span className="hidden flex-1 text-left text-sm lg:inline">全部密钥</span>
            <span className="hidden text-xs lg:inline">{totalCount}</span>
          </button>

          {tags.map((tag) => {
            const selected = activeTag === tag.name;
            return (
              <div key={tag.name} className="flex flex-col">
                <button
                  type="button"
                  onClick={() => onSelect(tag.name)}
                  title={`${tag.name}（${tag.count}）`}
                  aria-label={`${tag.name}（${tag.count}）`}
                  className={`${railBtn} ${selected ? railOn : railOff}`}
                >
                  <TagGlyph name={tag.name} />
                  <span className="hidden flex-1 truncate text-left text-sm lg:inline">{tag.name}</span>
                  <span className="hidden text-xs lg:inline">{tag.count}</span>
                </button>
                {/* 选中后显示分类管理（R18） */}
                {selected ? (
                  <div className="mt-0.5 flex gap-0.5 lg:justify-end">
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

        {/* 底部固定：安全（打开安全弹层：改主密码 / 备份 / 恢复码） */}
        <div className="mt-auto pt-3">
          <button
            type="button"
            onClick={onOpenSecurity}
            title="安全（改主密码 / 备份 / 恢复码）"
            aria-label="安全（改主密码 / 备份 / 恢复码）"
            className={`relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-kb-muted transition hover:bg-kb-surface-2 hover:text-kb-text ${railOff}`}
          >
            <ShieldIcon size={18} />
            <span className="hidden text-sm lg:inline">安全</span>
            {settingsAttention ? (
              <span
                aria-hidden="true"
                title="有未完成的安全提醒"
                className="absolute right-2 top-2 h-2 w-2 rounded-full bg-kb-primary"
              />
            ) : null}
          </button>
        </div>
      </div>
    </aside>
  );
}

/**
 * 移动端分类下拉选择器。
 *
 * 交互与可访问性（不引入新依赖）：
 *   - 收起态是 button（aria-expanded / aria-haspopup="listbox"），显示当前选中项；
 *   - 展开后是 role="listbox" 菜单，方向键上下移动、Home/End 首尾、Enter/空格选中、
 *     Esc 关闭并还焦点给触发按钮；点击菜单外任意处也会收起；
 *   - 菜单最高 60vh 内部滚动，分类再多也不会撑破 320px 小屏。
 *
 * 只发意图（onSelect），不做任何数据逻辑——筛选仍由上层 activeTag / filterItems 完成。
 */
export function MobileTagSelect({
  totalCount,
  tags,
  activeTag,
  onSelect,
}: {
  totalCount: number;
  tags: TagCount[];
  activeTag: string | null;
  onSelect: (tag: string | null) => void;
}): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  /** 键盘导航的活动项下标（0 = 「全部」）。 */
  const [active, setActive] = useState<number>(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  /** 菜单选项：「全部」+ 各分类（含条数徽章）。 */
  const options = useMemo<Array<{ label: string; tag: string | null; count: number }>>(
    () => [
      { label: "全部密钥", tag: null, count: totalCount },
      ...tags.map((t) => ({ label: t.name, tag: t.name, count: t.count })),
    ],
    [totalCount, tags]
  );

  const selectedIndex = options.findIndex((o) => o.tag === activeTag);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : options[0];

  // 展开时：活动项定位到当前选中项；点菜单外收起
  useEffect(() => {
    if (!open) return;
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    const onPointerDown = (e: PointerEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, selectedIndex]);

  // 菜单展开或活动项变化后，把焦点移到活动项（键盘可达）
  useEffect(() => {
    if (open) optionRefs.current[active]?.focus();
  }, [open, active]);

  function choose(tag: string | null): void {
    onSelect(tag);
    setOpen(false);
    btnRef.current?.focus();
  }

  function onButtonKeyDown(e: React.KeyboardEvent<HTMLButtonElement>): void {
    if (open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  }

  function onMenuKeyDown(e: React.KeyboardEvent<HTMLUListElement>): void {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => (i + 1) % options.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => (i - 1 + options.length) % options.length);
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(options[active].tag);
        break;
      case "Escape":
      case "Tab":
        e.preventDefault();
        setOpen(false);
        btnRef.current?.focus();
        break;
      default:
        break;
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onButtonKeyDown}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls="mobile-tag-listbox"
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-kb-border bg-kb-surface px-3 py-2 text-sm text-kb-text transition hover:bg-kb-surface-2"
      >
        <span className="min-w-0 truncate font-medium">
          {selected.label}（{selected.count}）
        </span>
        <ChevronDownIcon
          size={16}
          className={`shrink-0 text-kb-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <ul
          id="mobile-tag-listbox"
          role="listbox"
          aria-label="选择分类"
          onKeyDown={onMenuKeyDown}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[60vh] overflow-y-auto rounded-xl border border-kb-border bg-kb-surface py-1 shadow-[var(--kb-shadow-lg)]"
        >
          {options.map((option, i) => {
            const isSelected = option.tag === activeTag;
            return (
              <li key={option.label} role="none">
                <button
                  ref={(el) => {
                    optionRefs.current[i] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={-1}
                  onClick={() => choose(option.tag)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition ${
                    isSelected
                      ? "bg-kb-surface-2 font-medium text-kb-primary"
                      : "text-kb-text hover:bg-kb-surface-2"
                  }`}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  <span className="kb-badge shrink-0 kb-nums">{option.count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
