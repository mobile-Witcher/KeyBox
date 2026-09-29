/**
 * SecretTable.tsx —— 密钥列表（第 6 步，R15 / R16；第 R25 条：剪贴板自动清空）。
 *
 * 2026-09-29 扩展：
 *   - 字段新增「官网 / 控制台」（website）与「模型名」（model），表格与移动卡片同步展示；
 *   - **每一列都有一键复制**（站点 / 接口地址 / 官网 / 模型名 / 密钥 / 备注）。
 *     复制护栏升级为【字段级】：copiedRef = "行id:字段名"，同一行不同字段互不干扰。
 *   - R25 语义完整保留：复制后倒计时，到点【真正写入空串清空剪贴板】。
 *
 * 响应式：≥768px 表格形态；<768px 卡片形态（两形态共用同一份状态）。
 * 明文只在本组件的渲染里出现，不写日志、不发网络请求。
 */
import { useCallback, useRef, useState } from "react";
import type { SecretItem } from "../lib/vault";

interface SecretTableProps {
  items: SecretItem[];
  onEdit: (item: SecretItem) => void;
  onDelete: (item: SecretItem) => void;
}

/** 复制后自动清空剪贴板的等待秒数（R25）。**文案与行为都以它为准**。 */
export const CLIPBOARD_CLEAR_SECONDS = 30;

/** 可一键复制的字段。 */
export type CopyableField = "site" | "url" | "website" | "model" | "key" | "note";

/** 字段级复制凭据：`"行id:字段名"`，用来判断"哪个按钮处于已复制状态"。 */
export function cellRef(id: number, field: CopyableField): string {
  return `${id}:${field}`;
}

/**
 * 复制按钮在“已复制”状态下的文案。
 * 未复制（或倒计时已归零）时显示“复制”；否则显示与倒计时一致的“Ns 后清空”。
 * 抽成纯函数便于测试“文案与倒计时数值一致”。
 */
export function copyButtonLabel(copiedRef: string | null, ref: string, remaining: number): string {
  if (copiedRef !== ref || remaining <= 0) return "复制";
  return `${remaining}s 后清空`;
}

/** 已复制后的页面临时提示文案（N 与倒计时一致）。 */
export function copyNoticeText(remaining: number): string {
  return `已复制到剪贴板，${remaining} 秒后自动清空。`;
}

/**
 * R25 剪贴板护栏（字段级版）：复制某行某字段后启动秒级倒计时，**到点真正清空**系统剪贴板。
 *
 * @param seconds 倒计时秒数（默认 {@link CLIPBOARD_CLEAR_SECONDS}）。
 * @returns `{ copiedRef, remaining, copyField, stop }`。
 */
export function useClipboardGuard(seconds: number = CLIPBOARD_CLEAR_SECONDS): {
  copiedRef: string | null;
  remaining: number;
  copyField: (item: SecretItem, field: CopyableField) => Promise<void>;
  stop: () => void;
} {
  const [copiedRef, setCopiedRef] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number>(0);
  const timerRef = useRef<number | null>(null);

  const stop = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const copyField = useCallback(
    async (item: SecretItem, field: CopyableField): Promise<void> => {
      const text = item.plain ? item.plain[field] : "";
      if (!text) return; // 空值不复制，也不进入“已复制”状态
      stop(); // 取消上一份倒计时，避免多个计时器并存
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // 剪贴板不可用（权限/非安全上下文）：不进入“已复制”状态，也不启动倒计时
        setCopiedRef(null);
        setRemaining(0);
        return;
      }
      setCopiedRef(cellRef(item.id, field));
      setRemaining(seconds);
      let left = seconds;
      timerRef.current = window.setInterval(() => {
        left -= 1;
        if (left > 0) {
          setRemaining(left);
          return;
        }
        // 到点：停表 + 清空剪贴板 + 复位 UI（顺序保证即便清空失败 UI 也会复位）
        stop();
        setRemaining(0);
        setCopiedRef(null);
        try {
          void navigator.clipboard.writeText("");
        } catch {
          /* 清空失败不致命：UI 已复位，用户可在界面上看到提示消失 */
        }
      }, 1000);
    },
    [seconds, stop]
  );

  return { copiedRef, remaining, copyField, stop };
}

/** 单元格：值 + 一键复制（复制中显示剩余秒数）。 */
function Cell({
  value,
  mono,
  copied,
  remaining,
  onCopy,
  testId,
}: {
  value: string;
  mono?: boolean;
  copied: boolean;
  remaining: number;
  onCopy: () => void;
  testId: string;
}): JSX.Element {
  const empty = value === "";
  return (
    <div className="flex items-center gap-1">
      <span
        className={
          (mono ? "font-mono " : "") + "min-w-0 flex-1 truncate" + (empty ? " text-kb-muted" : "")
        }
        title={value}
      >
        {empty ? <span className="text-kb-muted">—</span> : value}
      </span>
      <button
        type="button"
        data-testid={testId}
        disabled={empty}
        onClick={onCopy}
        title={empty ? "该字段为空" : "复制"}
        className={
          "shrink-0 rounded p-1 transition disabled:cursor-not-allowed disabled:opacity-30 " +
          (copied ? "text-kb-success" : "text-kb-muted hover:bg-kb-surface-2 hover:text-kb-text")
        }
      >
        {copied ? (
          <span className="kb-nums text-[10px] font-semibold leading-none">{remaining}s</span>
        ) : (
          <CopyIcon />
        )}
      </button>
    </div>
  );
}

function CopyIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

export default function SecretTable({ items, onEdit, onDelete }: SecretTableProps): JSX.Element {
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const { copiedRef, remaining, copyField } = useClipboardGuard();

  function toggleReveal(id: number): void {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-kb-border-strong p-10 text-center text-sm text-kb-muted dark:border-kb-border-strong">
        还没有密钥。点上面的「+ 新增密钥」开始。
      </div>
    );
  }

  return (
    <div>
      {remaining > 0 ? (
        <div
          role="status"
          aria-live="polite"
          className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
        >
          {copyNoticeText(remaining)}
        </div>
      ) : null}

      {/* ══════════ 桌面（≥768px）：表格形态 ══════════ */}
      <div className="hidden overflow-x-auto rounded-xl border border-kb-border md:block">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="bg-kb-surface-2 text-kb-muted dark:bg-kb-surface dark:text-kb-muted">
            <tr>
              <th className="px-3 py-2 font-medium">站点</th>
              <th className="px-3 py-2 font-medium">接口地址</th>
              <th className="px-3 py-2 font-medium">官网</th>
              <th className="px-3 py-2 font-medium">模型名</th>
              <th className="px-3 py-2 font-medium">密钥</th>
              <th className="px-3 py-2 font-medium">备注</th>
              <th className="px-3 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const isRevealed = revealed.has(item.id);
              const plain = item.plain;
              const disabled = !plain || item.decryptError;
              return (
                <tr
                  key={item.id}
                  className="border-t border-kb-border align-top dark:border-kb-border"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <div className="min-w-0">
                        <div className="max-w-[10rem] truncate font-medium">
                          {plain ? plain.site || "（未命名）" : "—"}
                        </div>
                        {plain && plain.tags.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {plain.tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded bg-kb-surface-2 px-1.5 py-0.5 text-xs text-kb-muted"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        data-testid={`copy-${item.id}-site`}
                        disabled={disabled || !plain?.site}
                        onClick={() => void copyField(item, "site")}
                        title="复制站点名"
                        className="shrink-0 rounded p-1 text-kb-muted transition hover:bg-kb-surface-2 hover:text-kb-text disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <CopyIcon />
                      </button>
                    </div>
                  </td>
                  <td className="max-w-[14rem] px-3 py-2">
                    <Cell
                      value={plain ? plain.url : "—"}
                      copied={copiedRef === cellRef(item.id, "url")}
                      remaining={remaining}
                      onCopy={() => void copyField(item, "url")}
                      testId={`copy-${item.id}-url`}
                    />
                  </td>
                  <td className="max-w-[12rem] px-3 py-2">
                    <Cell
                      value={plain ? plain.website : "—"}
                      copied={copiedRef === cellRef(item.id, "website")}
                      remaining={remaining}
                      onCopy={() => void copyField(item, "website")}
                      testId={`copy-${item.id}-website`}
                    />
                  </td>
                  <td className="max-w-[10rem] px-3 py-2">
                    <Cell
                      value={plain ? plain.model : "—"}
                      copied={copiedRef === cellRef(item.id, "model")}
                      remaining={remaining}
                      onCopy={() => void copyField(item, "model")}
                      testId={`copy-${item.id}-model`}
                    />
                  </td>
                  <td className="max-w-[12rem] px-3 py-2">
                    <div className="flex items-center gap-1">
                      <span className="min-w-0 flex-1 font-mono text-kb-muted">
                        {item.decryptError ? (
                          <span className="text-amber-600">无法解密（主密码可能已更换）</span>
                        ) : isRevealed ? (
                          <span className="break-all text-kb-text">{plain?.key}</span>
                        ) : (
                          <span className="tracking-widest">••••••••</span>
                        )}
                      </span>
                      <button
                        type="button"
                        disabled={item.decryptError}
                        onClick={() => toggleReveal(item.id)}
                        className="shrink-0 rounded p-1 text-xs text-kb-text hover:bg-kb-surface-2 disabled:opacity-40"
                      >
                        {isRevealed ? "隐藏" : "显示"}
                      </button>
                      <button
                        type="button"
                        data-testid={`copy-${item.id}-key`}
                        disabled={item.decryptError || !isRevealed}
                        onClick={() => void copyField(item, "key")}
                        title={isRevealed ? "复制密钥" : "先点「显示」再复制"}
                        className="shrink-0 rounded p-1 text-kb-muted transition hover:bg-kb-surface-2 hover:text-kb-text disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <CopyIcon />
                      </button>
                    </div>
                  </td>
                  <td className="max-w-[10rem] px-3 py-2">
                    <Cell
                      value={plain ? plain.note : "—"}
                      copied={copiedRef === cellRef(item.id, "note")}
                      remaining={remaining}
                      onCopy={() => void copyField(item, "note")}
                      testId={`copy-${item.id}-note`}
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <button
                      type="button"
                      disabled={item.decryptError}
                      onClick={() => onEdit(item)}
                      className="mr-1 rounded px-2 py-1 text-xs text-kb-text hover:bg-kb-surface-2 disabled:opacity-40"
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(item)}
                      className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ══════════ 移动端（<768px）：卡片形态（共用同一份状态） ══════════ */}
      <div className="space-y-3 md:hidden">
        {items.map((item) => {
          const isRevealed = revealed.has(item.id);
          const plain = item.plain;
          return (
            <div key={item.id} className="kb-card p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {plain ? plain.site || "（未命名）" : "—"}
                  </div>
                  {plain && plain.tags.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {plain.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-kb-surface-2 px-1.5 py-0.5 text-xs text-kb-muted"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={item.decryptError}
                  onClick={() => toggleReveal(item.id)}
                  className="shrink-0 rounded-md border border-kb-border px-3 py-2 text-xs text-kb-text disabled:opacity-40"
                >
                  {isRevealed ? "隐藏" : "显示"}
                </button>
              </div>

              <dl className="mt-2.5 space-y-1.5 text-xs">
                {(
                  [
                    ["接口地址", plain?.url, "url"],
                    ["官网", plain?.website, "website"],
                    ["模型名", plain?.model, "model"],
                    ["备注", plain?.note, "note"],
                  ] as Array<[string, string | undefined, CopyableField]>
                ).map(([label, value, field]) =>
                  value ? (
                    <div key={field} className="flex items-center gap-2">
                      <dt className="w-14 shrink-0 text-kb-muted">{label}</dt>
                      <dd className="min-w-0 flex-1 truncate text-kb-text">{value}</dd>
                      <button
                        type="button"
                        data-testid={`copy-${item.id}-${field}`}
                        onClick={() => void copyField(item, field)}
                        className={
                          "shrink-0 rounded p-1 transition " +
                          (copiedRef === cellRef(item.id, field)
                            ? "text-kb-success"
                            : "text-kb-muted hover:bg-kb-surface-2 hover:text-kb-text")
                        }
                      >
                        {copiedRef === cellRef(item.id, field) ? (
                          <span className="kb-nums text-[10px] font-semibold">{remaining}s</span>
                        ) : (
                          <CopyIcon />
                        )}
                      </button>
                    </div>
                  ) : null
                )}
                <div className="flex items-center gap-2">
                  <dt className="w-14 shrink-0 text-kb-muted">密钥</dt>
                  <dd className="min-w-0 flex-1 break-all font-mono text-kb-text">
                    {item.decryptError ? (
                      <span className="text-amber-600">无法解密（主密码可能已更换）</span>
                    ) : isRevealed ? (
                      plain?.key
                    ) : (
                      <span className="tracking-widest">••••••••</span>
                    )}
                  </dd>
                  <button
                    type="button"
                    data-testid={`copy-${item.id}-key`}
                    disabled={item.decryptError || !isRevealed}
                    onClick={() => void copyField(item, "key")}
                    className="shrink-0 rounded p-1 text-kb-muted transition hover:bg-kb-surface-2 hover:text-kb-text disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <CopyIcon />
                  </button>
                </div>
              </dl>

              <div className="mt-3 flex gap-2 border-t border-kb-border pt-2.5">
                <button
                  type="button"
                  onClick={() => onEdit(item)}
                  className="flex-1 rounded-md border border-kb-border py-2 text-xs text-kb-text"
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(item)}
                  className="flex-1 rounded-md border border-red-200 py-2 text-xs text-red-600 dark:border-red-900 dark:text-red-400"
                >
                  删除
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
