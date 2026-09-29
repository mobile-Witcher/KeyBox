/**
 * AuthForm.tsx —— 账号三页（初始化 / 手机号登录 / 邀请码激活）共用的表单件。
 * 目的：把表单外观与布局收敛到一处，页面只关心业务逻辑，避免三份重复标记。
 * 注意：这里不接触任何密钥；字段值只以受控字符串在各页面内存中短暂停留。
 *
 * 2026-09-29 视觉精修（"精致克制"）：改用 index.css 的组件工具类（.kb-card-lg / .kb-input /
 * .kb-btn-primary / .kb-hint）与语义令牌，替换原先散落的 slate-* 硬编码；补品牌字标、
 * 背景光晕、加载指示与提示条图标。**props 签名保持不变**，三个页面无需改动。
 */
import type { ChangeEvent, ReactNode } from "react";

/** 居中卡片外壳（含品牌区与极淡背景光晕）。 */
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
    <div className="relative flex min-h-full items-center justify-center overflow-hidden p-6">
      {/* 纯装饰背景光晕：极淡的品牌色，营造层次而不喧闹 */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-22%] h-[440px] w-[640px] -translate-x-1/2 rounded-full bg-kb-primary opacity-[0.07] blur-3xl" />
      </div>

      <div className="kb-card-lg relative w-full max-w-md p-8">
        {/* 品牌区 */}
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-9 w-9 place-items-center rounded-xl bg-kb-primary text-base font-bold text-kb-primary-contrast"
          >
            K
          </span>
          <span className="text-lg font-semibold tracking-tight text-kb-text">KeyBox</span>
        </div>

        <h1 className="mt-7 text-lg font-semibold tracking-tight text-kb-text">{title}</h1>
        {subtitle ? (
          <p className="mt-1.5 text-sm leading-relaxed text-kb-muted">{subtitle}</p>
        ) : null}

        <div className="mt-6 space-y-4">{children}</div>

        {footer ? (
          <div className="mt-6 border-t border-kb-border pt-4 text-sm text-kb-muted">{footer}</div>
        ) : null}
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
      <span className="mb-1.5 block text-sm font-medium text-kb-text">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        className="kb-input"
      />
      {hint ? <span className="kb-hint mt-1.5 block">{hint}</span> : null}
    </label>
  );
}

/** 主按钮（含加载指示）。 */
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
      className="kb-btn-primary w-full py-2.5"
    >
      {loading ? (
        <>
          <span
            aria-hidden
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
          />
          处理中…
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** 错误提示条。message 为 null 时不渲染。 */
export function ErrorBanner({ message }: { message: string | null }): JSX.Element | null {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm leading-relaxed text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
    >
      <span aria-hidden className="mt-px shrink-0 font-semibold">
        !
      </span>
      <span>{message}</span>
    </div>
  );
}

/** 中性提示条（如“已初始化，请直接登录”）。 */
export function InfoBanner({ message }: { message: string | null }): JSX.Element | null {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
      <span aria-hidden className="mt-px shrink-0 font-semibold">
        i
      </span>
      <span>{message}</span>
    </div>
  );
}
