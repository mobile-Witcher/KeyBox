/**
 * AuthForm.tsx —— 账号三页（初始化 / 登录 / 注册）共用的极简表单件。
 * 目的：把表单外观与布局收敛到一处，页面只关心业务逻辑，避免三份重复标记。
 * 注意：这里不接触任何密钥；字段值只以受控字符串在各页面内存中短暂停留。
 */
import type { ChangeEvent, ReactNode } from "react";

/** 居中卡片外壳。 */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <h1 className="text-xl font-semibold">KeyBox</h1>
        <h2 className="mt-1 text-base font-medium text-slate-800 dark:text-slate-100">{title}</h2>
        {subtitle ? <p className="mt-2 text-sm text-slate-500">{subtitle}</p> : null}
        <div className="mt-6 space-y-4">{children}</div>
        {footer ? <div className="mt-6 text-sm text-slate-600 dark:text-slate-300">{footer}</div> : null}
      </div>
    </div>
  );
}

/** 受控文本字段。 */
export function Field({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "password" | "email";
  autoComplete?: string;
  placeholder?: string;
  hint?: string;
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
      />
      {hint ? <span className="mt-1 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

/** 主按钮。 */
export function PrimaryButton({
  children,
  disabled,
  loading,
}: {
  children: ReactNode;
  disabled?: boolean;
  loading?: boolean;
}): JSX.Element {
  return (
    <button
      type="submit"
      disabled={disabled || loading}
      className="w-full rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900"
    >
      {loading ? "处理中…" : children}
    </button>
  );
}

/** 错误提示条。message 为 null 时不渲染。 */
export function ErrorBanner({ message }: { message: string | null }): JSX.Element | null {
  if (!message) return null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
      {message}
    </div>
  );
}

/** 中性提示条（如“已初始化，请直接登录”）。 */
export function InfoBanner({ message }: { message: string | null }): JSX.Element | null {
  if (!message) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
      {message}
    </div>
  );
}
