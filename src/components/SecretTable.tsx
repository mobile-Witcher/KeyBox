/**
 * SecretTable.tsx —— 密钥列表（第 6 步，R15 / R16；第 R25 条：剪贴板自动清空）。
 *
 * 关键交互（架构 §5.1 线框）：
 *   - 密钥列【默认遮掩为圆点】••••••••，点击“显示”才在本机展示明文；
 *   - “复制”只读本机内存里的明文写入系统剪贴板，【不经过任何上传】；
 *   - 复制后显示倒计时，到点【真正清空】系统剪贴板（R25）——避免明文密钥长期留在剪贴板；
 *   - 行内操作：显示 / 复制 / 编辑 / 删除。
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

/**
 * 复制按钮在“已复制”状态下的文案。
 * 未复制（或倒计时已归零）时显示“复制”；否则显示与倒计时一致的“Ns 后清空”。
 * 抽成纯函数便于测试“文案与倒计时数值一致”。
 */
export function copyButtonLabel(copiedId: number | null, itemId: number, remaining: number): string {
  if (copiedId !== itemId || remaining <= 0) return "复制";
  return `${remaining}s 后清空`;
}

/** 已复制后的页面临时提示文案（N 与倒计时一致）。 */
export function copyNoticeText(remaining: number): string {
  return `已复制到剪贴板，${remaining} 秒后自动清空。`;
}

/**
 * R25 剪贴板护栏：复制成功后启动秒级倒计时，**到点真正清空**系统剪贴板。
 *
 * 为什么需要它：一个管密钥的工具，剪贴板里长期留着明文密钥是真风险，而 UI 已经承诺会自动清空；
 *   **文案与行为必须一致——不许只提示不清空**。
 *
 * @param seconds 倒计时秒数（默认 {@link CLIPBOARD_CLEAR_SECONDS}）。
 * @returns `{ copiedId, remaining, copy, stop }`：当前已复制的行 id、剩余秒数、复制动作、手动停止。
 */
export function useClipboardGuard(seconds: number = CLIPBOARD_CLEAR_SECONDS): {
  copiedId: number | null;
  remaining: number;
  copy: (item: SecretItem) => Promise<void>;
  stop: () => void;
} {
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number>(0);
  const timerRef = useRef<number | null>(null);

  const stop = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const copy = useCallback(
    async (item: SecretItem): Promise<void> => {
      if (!item.plain) return;
      stop(); // 取消上一行的倒计时，避免多个计时器并存
      try {
        await navigator.clipboard.writeText(item.plain.key);
      } catch {
        // 剪贴板不可用（权限/非安全上下文）：不进入“已复制”状态，也不启动倒计时
        setCopiedId(null);
        setRemaining(0);
        return;
      }
      setCopiedId(item.id);
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
        setCopiedId(null);
        try {
          void navigator.clipboard.writeText("");
        } catch {
          /* 清空失败不致命：UI 已复位，用户可在界面上看到提示消失 */
        }
      }, 1000);
    },
    [seconds, stop]
  );

  return { copiedId, remaining, copy, stop };
}

export default function SecretTable({ items, onEdit, onDelete }: SecretTableProps): JSX.Element {
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const { copiedId, remaining, copy } = useClipboardGuard();

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
      {/* 桌面（≥768px）：表格形态 */}
      <div className="hidden overflow-x-auto rounded-xl border border-kb-border md:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-kb-surface-2 text-kb-muted dark:bg-kb-surface dark:text-kb-muted">
            <tr>
              <th className="px-3 py-2 font-medium">站点</th>
              <th className="px-3 py-2 font-medium">网址</th>
              <th className="px-3 py-2 font-medium">密钥</th>
              <th className="px-3 py-2 font-medium">备注</th>
              <th className="px-3 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const isRevealed = revealed.has(item.id);
              const plain = item.plain;
              return (
                <tr
                  key={item.id}
                  className="border-t border-kb-border align-top dark:border-kb-border"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{plain ? plain.site || "（未命名）" : "—"}</div>
                    {plain && plain.tags.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {plain.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded bg-kb-surface-2 px-1.5 py-0.5 text-xs text-kb-muted dark:bg-kb-surface-2 dark:text-kb-text"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </td>
                  <td className="max-w-[16rem] truncate px-3 py-2 text-kb-muted">
                    {plain ? plain.url : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {item.decryptError ? (
                      <span className="text-amber-600">无法解密（主密码可能已更换）</span>
                    ) : isRevealed ? (
                      <span className="break-all">{plain?.key}</span>
                    ) : (
                      <span className="tracking-widest">••••••••</span>
                    )}
                  </td>
                  <td className="max-w-[14rem] px-3 py-2 text-kb-muted">
                    {plain ? plain.note : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <button
                      type="button"
                      disabled={item.decryptError}
                      onClick={() => toggleReveal(item.id)}
                      className="mr-1 rounded px-2 py-1 text-xs text-kb-text hover:bg-kb-surface-2 disabled:opacity-40 dark:text-kb-text dark:hover:brightness-110"
                    >
                      {isRevealed ? "隐藏" : "显示"}
                    </button>
                    <button
                      type="button"
                      disabled={item.decryptError}
                      onClick={() => void copy(item)}
                      className="mr-1 rounded px-2 py-1 text-xs text-kb-text hover:bg-kb-surface-2 disabled:opacity-40 dark:text-kb-text dark:hover:brightness-110"
                    >
                      {copyButtonLabel(copiedId, item.id, remaining)}
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit(item)}
                      className="mr-1 rounded px-2 py-1 text-xs text-kb-text hover:bg-kb-surface-2 dark:text-kb-text dark:hover:brightness-110"
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

      {/* 移动端（<768px）：卡片形态 —— 表格在窄屏会横向溢出，卡片更符合触屏习惯。
          与表格共用同一份 revealed / copiedId 状态，所以两边的「显示」「复制」是同步的。 */}
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

              {plain ? (
                <div className="mt-2 truncate text-xs text-kb-muted">{plain.url}</div>
              ) : null}

              <div className="mt-2.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all font-mono text-xs">
                  {item.decryptError ? (
                    <span className="text-amber-600">无法解密（主密码可能已更换）</span>
                  ) : isRevealed ? (
                    plain?.key
                  ) : (
                    <span className="tracking-widest">••••••••</span>
                  )}
                </code>
                <button
                  type="button"
                  disabled={item.decryptError}
                  onClick={() => void copy(item)}
                  className="shrink-0 rounded-md border border-kb-border px-3 py-2 text-xs text-kb-text disabled:opacity-40"
                >
                  {copyButtonLabel(copiedId, item.id, remaining)}
                </button>
              </div>

              {plain && plain.note ? (
                <div className="mt-2 text-xs text-kb-muted">{plain.note}</div>
              ) : null}

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
