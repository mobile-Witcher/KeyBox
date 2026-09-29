/**
 * SecretDialog.tsx —— 新增 / 编辑密钥的弹窗（第 6 步，R15）。
 *
 * 关键约束：弹窗只收集明文，提交时交给上层（VaultPage）在本地加密；
 *   本组件不发任何网络请求，提交后由上层清空，明文不落盘、不进日志。
 */
import { useEffect, useState } from "react";
import type { SecretItem, SecretPlain } from "../lib/vault";
import { emptyPlain } from "../lib/vault";

interface SecretDialogProps {
  open: boolean;
  /** 为 null 表示新增；否则编辑该条。 */
  initial: SecretItem | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (plain: SecretPlain, existingId?: number) => void;
}

export default function SecretDialog({
  open,
  initial,
  busy,
  onCancel,
  onSubmit,
}: SecretDialogProps): JSX.Element | null {
  const [site, setSite] = useState("");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [note, setNote] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // 每次打开时用 initial 重置表单
  useEffect(() => {
    if (!open) return;
    const base: SecretPlain = initial?.plain ?? emptyPlain();
    setSite(base.site);
    setUrl(base.url);
    setKey(base.key);
    setNote(base.note);
    setTagsText(base.tags.join(", "));
    setError(null);
  }, [open, initial]);

  if (!open) return null;

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    setError(null);
    if (!site.trim()) {
      setError("站点名不能为空。");
      return;
    }
    if (!key) {
      setError("密钥不能为空。");
      return;
    }
    const tags = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    onSubmit(
      { site: site.trim(), url: url.trim(), key, note: note.trim(), tags },
      initial ? initial.id : undefined
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-lg dark:bg-kb-surface">
        <h3 className="text-base font-semibold">{initial ? "编辑密钥" : "新增密钥"}</h3>
        <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
          <DialogField label="站点名" value={site} onChange={setSite} placeholder="例如 OpenAI" />
          <DialogField label="网址" value={url} onChange={setUrl} placeholder="例如 https://api.openai.com" />
          <DialogField label="密钥" value={key} onChange={setKey} placeholder="要保存的 API 密钥" />
          <DialogField label="备注" value={note} onChange={setNote} placeholder="可选" />
          <DialogField
            label="标签"
            value={tagsText}
            onChange={setTagsText}
            placeholder="逗号分隔，例如 工作, 个人"
          />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-4 py-2 text-sm text-kb-muted hover:bg-kb-surface-2 dark:text-kb-text dark:hover:brightness-110"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg kb-btn-primary"
            >
              {busy ? "保存中…" : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DialogField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-kb-text">
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-kb-border-strong bg-white px-3 py-2 text-sm outline-none focus:border-kb-border-strong focus:ring-2 focus:ring-kb-border dark:border-kb-border-strong dark:kb-btn-primary"
      />
    </label>
  );
}
