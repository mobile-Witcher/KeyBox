/**
 * RegisterPage.tsx —— R03 / R04 / R22 / R28：邀请码自助注册 + 一次性恢复码。
 *
 * 用户侧：邀请码 + 用户名 + 登录密码 + 主密码。
 * 关键约束：
 *   - 邀请码有效性 / 占用 / 20 人上限，全部由 kbRegister 在云端原子判定。
 *   - 主密码不上传：本页在客户端算出 kdfSalt / kdfVerifier 后再提交（与初始化页同一套原语）。
 *   - R28：注册时**一并生成恢复码**（客户端生成、用独立盐派生恢复密钥把主密钥包裹成 `KBRC1:` 密文随注册上传）；
 *     恢复码**只显示一次**，必须勾选“我已抄下并自行保管”方可继续；勾选后写 recovery_ack_at。
 *   - 恢复码明文绝不进日志、绝不进任何请求体（请求里只有 recoverySalt 与 recoveryBlob）。
 */
import { useState } from "react";
import { AuthCard, ErrorBanner, Field, PrimaryButton } from "../components/AuthForm";
import { api, signInWithTicket } from "../lib/api";
import { createKeyVerifier, deriveMasterKey, generateSaltB64, PBKDF2_ITERATIONS } from "../lib/crypto";
import { log } from "../lib/log";
import { createRecoveryMaterial } from "../lib/recovery";

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

  // R28：注册成功后的“一次性恢复码”步骤
  const [step, setStep] = useState<"form" | "recovery">("form");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [ackChecked, setAckChecked] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

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
      // R28：生成恢复材料（客户端生成；请求只带 salt 与密文，不带恢复码明文）
      const material = await createRecoveryMaterial(masterKey, kdfSalt, PBKDF2_ITERATIONS);

      const res = await api.register({
        code: code.trim(),
        username,
        loginPwd,
        kdfSalt,
        kdfVerifier,
        recoverySalt: material.recoverySaltB64,
        recoveryBlob: material.recoveryBlob,
      });
      if (!res.ok) {
        setError(describeError(res.error));
        return;
      }

      // 密码用后即弃（恢复码展示阶段不再需要）
      setLoginPwd("");
      setMasterPwd("");
      setConfirmPwd("");

      const ticket = res.data?.ticket;
      let auto = false;
      if (ticket) {
        const signed = await signInWithTicket(ticket);
        auto = signed.ok;
      }
      setSignedIn(auto);
      setRecoveryCode(material.code);
      setAckChecked(false);
      setStep("recovery");
    } catch (err) {
      log.error("注册失败", err);
      setError("注册失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  /** R28：勾选确认后写 recovery_ack_at（若尚未登录则留到登录后由安全面板补确认）。 */
  async function handleFinish(): Promise<void> {
    setError(null);
    if (!ackChecked) {
      setError("请先勾选“我已抄下并自行保管恢复码”。");
      return;
    }
    setBusy(true);
    try {
      if (signedIn) {
        await api.ackRecovery(); // 尽力而为；失败不阻断注册完成
      }
      setRecoveryCode(""); // 明文用完即弃
      onRegistered(username);
    } finally {
      setBusy(false);
    }
  }

  if (step === "recovery") {
    return (
      <AuthCard
        title="请抄下你的恢复码（只显示一次）"
        subtitle="主密码遗忘时，只能靠这串恢复码找回数据。我们不会再次显示它，也无法替你找回。"
      >
        <ErrorBanner message={error} />
        <div className="my-3 rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-base tracking-widest break-all dark:border-slate-600 dark:bg-slate-900">
          {recoveryCode}
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={ackChecked}
            onChange={(e) => setAckChecked(e.target.checked)}
            className="mt-1"
          />
          <span>我已抄下并自行保管恢复码（建议抄写或存入离线密码管理器）。</span>
        </label>
        <div className="mt-4">
          <button
            type="button"
            onClick={() => void handleFinish()}
            disabled={busy || !ackChecked}
            className="w-full rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900"
          >
            {busy ? "处理中…" : "完成并进入"}
          </button>
        </div>
        {!signedIn ? (
          <button
            type="button"
            onClick={onGoLogin}
            className="mt-3 w-full text-sm underline hover:no-underline"
          >
            自动登录未成功？去手动登录
          </button>
        ) : null}
      </AuthCard>
    );
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
        <Field label="邀请码" value={code} onChange={setCode} placeholder="KB-XXXXXX" />
        <Field label="用户名" value={username} onChange={setUsername} autoComplete="username" />
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
          hint="用于本机加密；遗忘时可用注册时生成的一次性恢复码自救。"
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
    case "MISSING_RECOVERY_PARAMS":
      return "恢复码材料不完整，请刷新后重试。";
    default:
      return "注册失败，请稍后重试。";
  }
}
