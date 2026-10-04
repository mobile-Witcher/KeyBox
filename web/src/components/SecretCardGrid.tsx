/**
 * SecretCardGrid.tsx —— 密钥卡片网格（桌面视图重设计，纯布局/视觉层）。
 *
 * 为什么单独一个文件而不是改 SecretTable：
 *   SecretTable 承载 R25（剪贴板 30 秒自动清空）与移动卡片形态，改动风险高；
 *   这里新增网格视图，由上层用「网格 / 列表」切换按钮二选一渲染，**两者共用同一份数据源与回调**，
 *   表格形态原样保留。
 *
 * 硬约束遵守：
 *   - 颜色一律走主题令牌（bg-kb-surface / text-kb-muted / text-kb-primary …），
 *     **本文件不出现任何硬编码色值**，9 套皮肤与深色模式自动生效。
 *   - 复制走 SecretTable 导出的 useClipboardGuard，R25 的倒计时与自动清空行为完全复用。
 *   - 不做任何网络请求；明文只在渲染里出现，不写日志。
 */
import { useState } from "react";
import { cellRef, copyNoticeText, useClipboardGuard } from "./SecretTable";
import type { SecretItem } from "../lib/vault";
import {
  CopyIcon,
  EditIcon,
  PlusIcon,
  SyncIcon,
  TrashIcon,
} from "./icons";

interface SecretCardGridProps {
  items: SecretItem[];
  onEdit: (item: SecretItem) => void;
  onDelete: (item: SecretItem) => void;
  /** 触发一次同步（与顶栏「同步」同一个动作）。 */
  onSync: () => void;
  /** 同步进行中（禁用按钮，避免连点）。 */
  syncing?: boolean;
  onAdd: () => void;
}

/**
 * 站点名徽章文字：中文取首字，西文取前两个字符。
 * 纯展示函数，不影响任何数据。
 */
export function initialsOf(site: string): string {
  const chars = Array.from(site.trim());
  if (chars.length === 0) return "?";
  const first = chars[0];
  // 西文（字母/数字）取前两字符更像品牌缩写；中日韩文字取单字即可
  if (/[A-Za-z0-9]/.test(first)) {
    return chars.slice(0, 2).join("").toUpperCase();
  }
  return first.toUpperCase();
}

/** 从接口地址取域名；解析失败则原样返回（不做任何网络请求，纯字符串处理）。 */
export function hostOf(url: string): string {
  if (!url) return "";
  try {
    return new URL(url).host || url;
  } catch {
    // 不是合法 URL（例如只填了 api.openai.com）→ 原样返回
    return url;
  }
}

/**
 * 密钥脱敏：长串保留前 7 + … + 后 4（形如 sk-c8ab…9f2e）；过短则全遮。
 * 明文完整值只在点击「复制」时才进剪贴板，界面上始终只显示脱敏串。
 */
export function maskKey(key: string): string {
  if (!key) return "未填写";
  if (key.length <= 12) return "•".repeat(Math.min(key.length, 8));
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

/**
 * 徽章色调：按分类名落到一个稳定的语义色上。
 * ⚠️ 主题只提供了 4 个语义色令牌（primary / success / warning / danger），
 *    **没有**「各语义色的浅色底」变量；为保证 9 套皮肤与深色模式下都可读，
 *    底色统一用 --kb-surface-2，靠**文字/图标色**区分分类（这 4 个色本就是按正文对比度调过的）。
 */
const TONES = ["text-kb-primary", "text-kb-success", "text-kb-warning", "text-kb-danger"] as const;

/** 由分类名稳定地选一个色调（同名恒得同色，重渲染不跳色）。 */
export function toneOf(category: string): string {
  let hash = 0;
  for (const ch of Array.from(category)) {
    hash = (hash + ch.codePointAt(0)!) % 9973;
  }
  return TONES[hash % TONES.length];
}

/** 所属分类：取第一个标签；无标签则「未分类」。 */
function categoryOf(item: SecretItem): string {
  const first = item.plain?.tags.find((t) => t.trim() !== "");
  return first || "未分类";
}

export default function SecretCardGrid({
  items,
  onEdit,
  onDelete,
  onSync,
  syncing = false,
  onAdd,
}: SecretCardGridProps): JSX.Element {
  const { copiedRef, remaining, copyField } = useClipboardGuard();

  return (
    <div>
      {remaining > 0 ? (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
        >
          {copyNoticeText(remaining)}
        </div>
      ) : null}

      {/* 自适应网格：窄屏单列、中屏两列、大屏三四列，卡片拉伸填满不留大片空白 */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        {items.map((item) => (
          <SecretCard
            key={item.id}
            item={item}
            copiedKey={copiedRef === cellRef(item.id, "key")}
            remaining={remaining}
            onCopyKey={() => void copyField(item, "key")}
            onEdit={() => onEdit(item)}
            onDelete={() => onDelete(item)}
            onSync={onSync}
            syncing={syncing}
          />
        ))}

        {/* 末尾的虚线「新增密钥」占位卡 */}
        <button
          type="button"
          onClick={onAdd}
          title="新增密钥"
          aria-label="新增密钥"
          className="group flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-kb-border-strong bg-kb-surface p-4 text-sm text-kb-muted transition hover:bg-kb-surface-2 hover:text-kb-text"
        >
          <span className="grid h-9 w-9 place-items-center rounded-full border border-dashed border-kb-border-strong text-kb-muted transition group-hover:text-kb-primary">
            <PlusIcon size={18} />
          </span>
          <span className="font-medium">新增密钥</span>
          {items.length === 0 ? (
            <span className="text-xs text-kb-muted">还没有密钥，点这里添加第一条</span>
          ) : null}
        </button>
      </div>
    </div>
  );
}

function SecretCard({
  item,
  copiedKey,
  remaining,
  onCopyKey,
  onEdit,
  onDelete,
  onSync,
  syncing,
}: {
  item: SecretItem;
  copiedKey: boolean;
  remaining: number;
  onCopyKey: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSync: () => void;
  syncing: boolean;
}): JSX.Element {
  const [hovered, setHovered] = useState(false);
  const plain = item.plain;
  const broken = item.decryptError || !plain;
  const category = categoryOf(item);
  const host = plain ? hostOf(plain.url) : "";
  const siteName = plain ? plain.site || "（未命名）" : "无法解密";

  return (
    <article
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="kb-card group flex flex-col gap-3 p-4 transition-shadow hover:shadow-[var(--kb-shadow-lg)]"
    >
      {/* ── 头部：品牌徽章 + 站点名 / 副标题 + 悬停出现的删除 ── */}
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-kb-border bg-kb-surface-2 text-sm font-semibold ${toneOf(
            category
          )}`}
        >
          {broken ? "!" : initialsOf(siteName)}
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold leading-5" title={siteName}>
            {siteName}
          </h3>
          <p className="mt-0.5 truncate text-xs text-kb-muted" title={host || undefined}>
            {broken ? (
              <span className="text-amber-600 dark:text-amber-400">主密码可能已更换</span>
            ) : (
              <>
                {host || "未填接口地址"}
                <span className="mx-1">·</span>
                {category}
              </>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={onDelete}
          title="删除这条密钥"
          aria-label="删除这条密钥"
          className={`shrink-0 rounded-md p-1 text-kb-muted transition hover:bg-kb-surface-2 hover:text-red-600 dark:hover:text-red-400 ${
            hovered ? "opacity-100" : "opacity-0"
          } focus-visible:opacity-100`}
        >
          <TrashIcon size={15} />
        </button>
      </div>

      {/* ── 模型名 chip ── */}
      {plain && plain.model ? (
        <div className="flex flex-wrap gap-1.5">
          <span className="kb-badge" title={plain.model}>
            {plain.model}
          </span>
          {item.pending ? (
            <span className="kb-badge" title="本机改动尚未上传">
              待同步
            </span>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <span className="kb-badge text-kb-muted">未填模型名</span>
          {item.pending ? (
            <span className="kb-badge" title="本机改动尚未上传">
              待同步
            </span>
          ) : null}
        </div>
      )}

      {/* ── 底部：脱敏密钥 + 三个图标操作 ── */}
      <div className="mt-auto flex items-center gap-2 border-t border-kb-border pt-3">
        <span
          className="kb-nums min-w-0 flex-1 truncate font-mono text-xs text-kb-muted"
          title={broken ? undefined : "已脱敏显示，点复制取完整值"}
        >
          {broken ? "—" : maskKey(plain.key)}
        </span>

        <IconButton
          label={copiedKey ? `已复制，${remaining}s 后清空` : "复制密钥"}
          onClick={onCopyKey}
          disabled={broken || !plain?.key}
          tone={copiedKey ? "text-kb-success" : undefined}
        >
          {copiedKey ? (
            <span className="kb-nums text-[10px] font-semibold leading-none">{remaining}s</span>
          ) : (
            <CopyIcon size={15} />
          )}
        </IconButton>

        <IconButton
          label={item.pending ? "同步（本条待上传）" : "同步"}
          onClick={onSync}
          disabled={syncing}
          tone={item.pending ? "text-kb-warning" : undefined}
        >
          <SyncIcon size={15} />
        </IconButton>

        <IconButton label="编辑" onClick={onEdit} disabled={broken}>
          <EditIcon size={15} />
        </IconButton>
      </div>
    </article>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  tone,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
      className={`shrink-0 rounded-md p-1.5 transition disabled:cursor-not-allowed disabled:opacity-30 ${
        tone ?? "text-kb-muted"
      } hover:bg-kb-surface-2 hover:text-kb-text`}
    >
      {children}
    </button>
  );
}
