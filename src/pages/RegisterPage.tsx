/**
 * RegisterPage.tsx —— R03 / R04 / R22 / R28：邀请码激活 + 一次性恢复码。
 *
 * 【2026-09-29 变更】登录改为平台原生手机号验证码后，本页不再要求用户名与登录密码：
 *   用户已用手机号登录（平台账号已存在），本页只需「邀请码 + 主密码」即可完成业务激活。
 *   云函数 kbRegister 从运行时注入读取 uid，接口幂等（重复提交不报错）。
 *
 * 关键约束：
 *   - 邀请码有效性 / 占用 / 20 人上限，全部由 kbRegister 在云端原子判定。
 *   - 主密码不上传：本页在客户端算出 kdfSalt / kdfVerifier 后再提交（与初始化页同一套原语）。
 *   - R28：激活时**一并生成恢复码**（客户端生成、用独立盐派生恢复密钥把主密钥包裹成 `KBRC1:` 密文随请求上传）；
 *     恢复码**只显示一次**，勾选“我已抄下”后写 recovery_ack_at（此时已登录，确认可成功写入）。
 *   - 恢复码明文绝不进日志、绝不进任何请求体（请求里只有 recoverySalt 与 recoveryBlob）。
 */
import { useState } from "react";
import { AuthCard, ErrorBanner, Field, PrimaryButton } from "../components/AuthForm";
import { api } from "../lib/api";
import { createKeyVerifier, deriveMasterKey, generateSaltB64, PBKDF2_ITERATIONS } from "../lib/crypto";
import { log } from "../lib/log";
import { createRecoveryMaterial } from "../lib/recovery";

const MIN_MASTER_PWD = 8;

export default function RegisterPage({
  onRegistered,
  onSignOut,
}: {
  /** 激活完成（已写入用户行）后回调。 */
  onRegistered: () => void;
  /** 切换账号（退出当前平台会话）。 */
  onSignOut: () => void;
}): JSX.Element {
  const [code, setCode] = useState("");
  const [masterPwd, setMasterPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // R28：激活成功后的“一次性恢复码”步骤
  const [step, setStep] = useState<"form" | "recovery">("form");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [ackChecked, setAckChecked] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!code.trim()) {
      setError("请填写邀请码。");
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
      setMasterPwd("");
      setConfirmPwd("");
      setRecoveryCode(material.code);
      setAckChecked(false);
      setStep("recovery");
    } catch (err) {
      log.error("激活失败", err);
      setError("激活失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  /** R28：勾选确认后写 recovery_ack_at（当前已登录，写入可成功；失败不阻断进入应用）。 */
  async function handleFinish(): Promise<void> {
    setError(null);
    if (!ackChecked) {
      setError("请先勾选“我已抄下并自行保管恢复码”。");
      return;
    }
    setBusy(true);
    try {
      await api.ackRecovery();
      setRecoveryCode(""); // 明文用完即弃
      onRegistered();
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
        <div className="my-3 rounded-lg border border-kb-border-strong bg-slate-50 p-3 font-mono text-base tracking-widest break-all dark:border-slate-600 dark:bg-slate-900">
          {recoveryCode}
        </div>
        <div className="my-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          ⚠️ 建议：抄在纸上或存进离线密码管理器，不要只存在这台设备里。
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={ackChecked}
            onChange={(e) => setAckChecked(e.target.checked)}
            className="mt-1"
          />
          <span>我已抄下并自行保管恢复码。</span>
        </label>
        <div className="mt-4">
          <button
            type="button"
            onClick={() => void handleFinish()}
            disabled={busy || !ackChecked}
            className="w-full rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900"
          >
            {busy ? "处理中…" : "我已抄好，进入应用"}
          </button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="输入邀请码完成激活"
      subtitle="你的手机号已登录成功。填入管理员发放的邀请码即可开通账号；主密码只在本机加密数据。"
      footer={
        <button type="button" onClick={onSignOut} className="underline hover:no-underline">
          不是我的手机号？切换账号
        </button>
      }
    >
      <ErrorBanner message={error} />
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Field label="邀请码" value={code} onChange={setCode} placeholder="KB-XXXXXX" />
        <Field
          label="主密码"
          type="password"
          value={masterPwd}
          onChange={setMasterPwd}
          autoComplete="new-password"
          hint="用于本机加密；遗忘时可用本次生成的恢复码自救。"
        />
        <Field
          label="确认主密码"
          type="password"
          value={confirmPwd}
          onChange={setConfirmPwd}
          autoComplete="new-password"
        />
        <PrimaryButton loading={busy}>激活并进入</PrimaryButton>
      </form>
    </AuthCard>
  );
}

function describeError(code?: string): string {
  switch (code) {
    case "INVALID_CODE":
      return "邀请码无效或已被使用。";
    case "LIMIT_REACHED":
      return "已达 20 人开户上限，请联系管理员。";
    case "MISSING_KDF_PARAMS":
      return "缺少密钥参数，请刷新后重试。";
    case "MISSING_RECOVERY_PARAMS":
      return "恢复码材料不完整，请刷新后重试。";
    case "NOT_LOGGED_IN":
      return "登录状态已失效，请重新登录后再试。";
    default:
      return "激活失败，请稍后重试。";
  }
}
