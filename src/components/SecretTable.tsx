/**
 * SecretTable.tsx —— 密钥列表（第 6 步，R15 / R16）。
 *
 * 关键交互（架构 §5.1 线框）：
 *   - 密钥列【默认遮掩为圆点】••••••••，点击“显示”才在本机展示明文；
 *   - “复制”只读本机内存里的明文写入系统剪贴板，【不经过任何上传】；
 *   - 行内操作：显示 / 复制 / 编辑 / 删除。
 * 明文只在本组件的渲染里出现，不写日志、不发网络请求。
 */
import { useState } from "react";
import type { SecretItem } from "../lib/vault";

interface SecretTableProps {
  items: SecretItem[];
  onEdit: (item: SecretItem) => void;
  onDelete: (item: SecretItem) => void;
}

export default function SecretTable({ items, onEdit, onDelete }: SecretTableProps): JSX.Element {
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [copiedId, setCopiedId] = useState<number | null>(null);

  function toggleReveal(id: number): void {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function copySecret(item: SecretItem): Promise<void> {
    if (!item.plain) return;
    try {
      await navigator.clipboard.writeText(item.plain.key);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId((cur) => (cur === item.id ? null : cur)), 2000);
    } catch {
      setCopiedId(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-600">
        还没有密钥。点上面的「+ 新增密钥」开始。
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
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
                className="border-t border-slate-200 align-top dark:border-slate-700"
              >
                <td className="px-3 py-2">
                  <div className="font-medium">{plain ? plain.site || "（未命名）" : "—"}</div>
                  {plain && plain.tags.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {plain.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-200"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </td>
                <td className="max-w-[16rem] truncate px-3 py-2 text-slate-600 dark:text-slate-300">
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
                <td className="max-w-[14rem] px-3 py-2 text-slate-500">
                  {plain ? plain.note : "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <button
                    type="button"
                    disabled={item.decryptError}
                    onClick={() => toggleReveal(item.id)}
                    className="mr-1 rounded px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    {isRevealed ? "隐藏" : "显示"}
                  </button>
                  <button
                    type="button"
                    disabled={item.decryptError}
                    onClick={() => void copySecret(item)}
                    className="mr-1 rounded px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    {copiedId === item.id ? "已复制" : "复制"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onEdit(item)}
                    className="mr-1 rounded px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
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
  );
}
