/**
 * LoginPage.tsx —— R05 / R13：登录。
 *
 * 关键约束：
 *   - 登录密码校验在云端（kbLogin），通过后由云函数签发自定义登录票据；本页只负责换取会话。
 *   - 请求体不含主密码（R05）。主密码的解锁步骤属本机行为，将在第 6/7 步接入。
 *   - 停用/启用导致的拒绝会在 kbLogin 里以 ACCOUNT_DISABLED 返回（R13 云端窗口）。
 */
import { useState } from "react";
import { AuthCard, ErrorBanner, Field, InfoBanner, PrimaryButton } from "../components/AuthForm";
import { api, signInWithTicket } from "../lib/api";
import { log } from "../lib/log";

export default function LoginPage({
  onLoggedIn,
  onGoRegister,
}: {
  onLoggedIn: (username: string) => void;
  onGoRegister: () => void;
}): JSX.Element {
  const [username, setUsername] = useState("");
  const [loginPwd, setLoginPwd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setInfo(null);

    if (!username || !loginPwd) {
      setError("请输入用户名与登录密码。");
      return;
    }

    setBusy(true);
    try {
      const res = await api.login({ username, loginPwd });
      if (!res.ok || !res.data?.ticket) {
        setError(describeError(res.error));
        return;
      }
      const signed = await signInWithTicket(res.data.ticket);
      if (!signed.ok) {
        setError("登录票据换取会话失败，请重试。");
        return;
      }
      setLoginPwd("");
      onLoggedIn(username);
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
      subtitle="登录成功后，还需在本机输入主密码才能解锁你的密钥内容。"
      footer={
        <button type="button" onClick={onGoRegister} className="underline hover:no-underline">
          有邀请码？去注册
        </button>
      }
    >
      <ErrorBanner message={error} />
      <InfoBanner message={info} />
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Field
          label="用户名"
          value={username}
          onChange={setUsername}
          autoComplete="username"
        />
        <Field
          label="登录密码"
          type="password"
          value={loginPwd}
          onChange={setLoginPwd}
          autoComplete="current-password"
        />
        <PrimaryButton loading={busy}>登录</PrimaryButton>
      </form>
    </AuthCard>
  );
}

/** 错误码 → 用户提示。 */
function describeError(code?: string): string {
  switch (code) {
    case "INVALID_CREDENTIALS":
      return "用户名或密码不正确。";
    case "ACCOUNT_DISABLED":
      return "该账号已被停用，请联系管理员。";
    case "MISSING_FIELDS":
      return "请填写用户名与密码。";
    default:
      return "登录失败，请稍后重试。";
  }
}
