/**
 * RegisterPage.tsx —— R03 / R04 / R22：邀请码自助注册。
 *
 * 用户侧填四项：邀请码 + 用户名 + 登录密码 + 主密码。
 * 关键约束：
 *   - 邀请码是否有效、是否已被占用、是否已达 20 人上限，全部由 kbRegister 在云端原子判定。
 *   - 主密码不上传：本页在客户端算出 kdfSalt / kdfVerifier 后再提交（与初始化页同一套原语）。
 *   - 注册成功后云函数直接签发登录票据，本页换取会话即视为开户完成（R04）。
 */
import { useState } from "react";
import { AuthCard, ErrorBanner, Field, PrimaryButton } from "../components/AuthForm";
import { api, signInWithTicket } from "../lib/api";
import { createKeyVerifier, deriveMasterKey, generateSaltB64, PBKDF2_ITERATIONS } from "../lib/crypto";
import { log } from "../lib/log";

const MIN_LOGIN_PWD = 8;
const MIN_MASTER_PWD = 8;
const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;

export default function RegisterPage({
  onRegistered,
  onGoLogin,
}: {
  onRegistered: (username: string) => void;
  onGoLogin: () => void;
}): JSX.Element {
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [loginPwd, setLoginPwd] = useState("");
  const [masterPwd, setMasterPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!code.trim()) {
      setError("请填写邀请码。");
      return;
    }
    if (!USERNAME_PATTERN.test(username)) {
      setError("用户名需为 3–32 位的字母、数字、下划线、点或连字符。");
      return;
    }
    if (loginPwd.length < MIN_LOGIN_PWD) {
      setError(`登录密码至少 ${MIN_LOGIN_PWD} 位。`);
      return;
    }
    if (masterPwd.length < MIN_MASTER_PWD) {
      setError(`主密码至少 ${MIN_MASTER_PWD} 位。`);
      return;
    }
    if (masterPwd !== confirmPwd) {
      setError("两次输入的主密码不一致。");
      return;
    }

    setBusy(true);
    try {
      const kdfSalt = generateSaltB64();
      const masterKey = await deriveMasterKey(masterPwd, kdfSalt, PBKDF2_ITERATIONS);
      const kdfVerifier = await createKeyVerifier(masterKey);

      const res = await api.register({
        code: code.trim(),
        username,
        loginPwd,
        kdfSalt,
        kdfVerifier,
      });
      if (!res.ok) {
        setError(describeError(res.error));
        return;
      }

      const ticket = res.data?.ticket;
      if (ticket) {
        const signed = await signInWithTicket(ticket);
        if (!signed.ok) {
          setError("账号已创建，但自动登录失败，请手动登录。");
          onGoLogin();
          return;
        }
      } else {
        onGoLogin();
        return;
      }

      setLoginPwd("");
      setMasterPwd("");
      setConfirmPwd("");
      onRegistered(username);
    } catch (err) {
      log.error("注册失败", err);
      setError("注册失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="用邀请码注册"
      subtitle="主密码用于本机加密，云端不保存任何副本；请务必记牢。"
      footer={
        <button type="button" onClick={onGoLogin} className="underline hover:no-underline">
          已有账号？去登录
        </button>
      }
    >
      <ErrorBanner message={error} />
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Field
          label="邀请码"
          value={code}
          onChange={setCode}
          placeholder="KB-XXXXXX"
        />
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
          autoComplete="new-password"
        />
        <Field
          label="主密码"
          type="password"
          value={masterPwd}
          onChange={setMasterPwd}
          autoComplete="new-password"
          hint="用于本机加密；遗忘即不可找回（后续可用恢复码/备份自救）。"
        />
        <Field
          label="确认主密码"
          type="password"
          value={confirmPwd}
          onChange={setConfirmPwd}
          autoComplete="new-password"
        />
        <PrimaryButton loading={busy}>注册并登录</PrimaryButton>
      </form>
    </AuthCard>
  );
}

function describeError(code?: string): string {
  switch (code) {
    case "INVALID_CODE":
      return "邀请码无效或已被使用。";
    case "USERNAME_TAKEN":
      return "该用户名已被占用，请换一个。";
    case "LIMIT_REACHED":
      return "已达 20 人开户上限，请联系管理员。";
    case "INVALID_USERNAME":
      return "用户名格式不合法。";
    case "WEAK_LOGIN_PWD":
      return "登录密码强度不足。";
    case "MISSING_KDF_PARAMS":
      return "缺少密钥参数，请刷新后重试。";
    default:
      return "注册失败，请稍后重试。";
  }
}
