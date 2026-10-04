/**
 * LoginPage.tsx —— 手机号验证码登录（R05 的登录入口，2026-09-29 改为平台原生登录）。
 *
 * 关键约束：
 *   - 验证码校验走 signInWithOtp 返回的 `data.verifyOtp({ token })` 回调（见 phone-auth.ts）。
 *   - 登录成功后平台会话即建立；本页不做任何云函数调用。
 *   - 首次登录会由平台自动创建账号；是否已完成业务激活由 App 层调 kbGetMyRole 判定。
 *   - 手机号只在本页内存与请求中使用，不落日志、不落本地存储。
 */
import { useEffect, useState } from "react";
import { AuthCard, ErrorBanner, Field, InfoBanner, PrimaryButton } from "../components/AuthForm";
import { log } from "../lib/log";
import { describePhoneAuthError, sendSmsCode, signInWithSmsCode } from "../lib/phone-auth";

/** 重新发送验证码的冷却秒数。 */
const RESEND_SECONDS = 60;

export default function LoginPage({
  onLoggedIn,
}: {
  /** 登录成功（平台会话已建立）后回调；是否需激活由上层判断。 */
  onLoggedIn: () => void;
}): JSX.Element {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // 发送后的冷却倒计时
  useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = window.setInterval(() => {
      setCountdown((n) => (n <= 1 ? 0 : n - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  async function handleSend(): Promise<void> {
    setError(null);
    setInfo(null);
    setSending(true);
    try {
      const res = await sendSmsCode(phone);
      if (!res.ok) {
        setError(describePhoneAuthError(res.error));
        return;
      }
      setCountdown(RESEND_SECONDS);
      setInfo("验证码已发送，请查看短信（几分钟内有效）。");
    } finally {
      setSending(false);
    }
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await signInWithSmsCode(code);
      if (!res.ok) {
        setError(describePhoneAuthError(res.error));
        return;
      }
      setCode("");
      onLoggedIn();
    } catch (err) {
      log.error("登录失败", err);
      setError("登录失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="登录"
      subtitle="用手机号验证码登录。首次登录会自动创建账号，之后凭管理员发放的邀请码完成激活。"
    >
      <ErrorBanner message={error} />
      <InfoBanner message={info} />
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Field
          label="手机号"
          value={phone}
          onChange={setPhone}
          placeholder="11 位手机号，例如 13800138000"
          autoComplete="tel"
        />
        <div>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || countdown > 0}
            className="w-full rounded-lg border border-kb-border-strong px-4 py-2 text-sm font-medium text-kb-text transition hover:bg-kb-surface-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-kb-border-strong dark:text-kb-text dark:hover:bg-kb-surface-2"
          >
            {countdown > 0 ? `${countdown} 秒后可重新发送` : sending ? "发送中…" : "发送验证码"}
          </button>
        </div>
        <Field
          label="验证码"
          value={code}
          onChange={setCode}
          placeholder="短信里的验证码"
          autoComplete="one-time-code"
          hint="验证码校验成功后即完成登录，无需再记用户名与密码。"
        />
        <PrimaryButton loading={busy}>登录</PrimaryButton>
      </form>
    </AuthCard>
  );
}
