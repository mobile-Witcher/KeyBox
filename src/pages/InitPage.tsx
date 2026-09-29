/**
 * InitPage.tsx —— R01：首个管理员初始化（手机号登录后的激活步骤）。
 *
 * 关键约束：
 *   - 【2026-09-29】登录已改为平台原生手机号验证码，因此本页不再要求填用户名与登录密码：
 *     身份就是当前平台会话，云函数 kbInitAdmin 从运行时注入读取 uid。
 *   - 主密码只在本机内存里短暂存在：本页用它在客户端算出 kdfSalt / kdfVerifier 后即丢弃，
 *     绝不把主密码发往云端（架构 §6.1：云函数只收盐与校验串）。
 *   - 云函数侧会校验“表中已有用户即拒绝”，本页只是体验层；真正闸门在服务端（防二次抢管理员）。
 */
import { useState } from "react";
import { AuthCard, ErrorBanner, Field, InfoBanner, PrimaryButton } from "../components/AuthForm";
import { api } from "../lib/api";
import { createKeyVerifier, deriveMasterKey, generateSaltB64, PBKDF2_ITERATIONS } from "../lib/crypto";
import { log } from "../lib/log";
import { createRecoveryMaterial } from "../lib/recovery";

const MIN_MASTER_PWD = 8;

export default function InitPage({
  onInitialized,
  onSignOut,
}: {
  /** 初始化完成（已写入管理员行）后回调。 */
  onInitialized: () => void;
  /** 切换账号（退出当前平台会话）。 */
  onSignOut: () => void;
}): JSX.Element {
  const [masterPwd, setMasterPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // R28：初始化成功后的一次性恢复码展示
  const [step, setStep] = useState<"form" | "recovery">("form");
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [ackChecked, setAckChecked] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setInfo(null);

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
      // 1) 本机生成盐并派生主密钥（只活在这里，用完即弃）
      const kdfSalt = generateSaltB64();
      const masterKey = await deriveMasterKey(masterPwd, kdfSalt, PBKDF2_ITERATIONS);
      // 2) 生成 kdf_verifier（用主密钥加密固定串，不含任何真实密钥）
      const kdfVerifier = await createKeyVerifier(masterKey);
      // R28：生成一次性恢复码材料（客户端生成；请求只带 salt 与密文）
      const material = await createRecoveryMaterial(masterKey, kdfSalt, PBKDF2_ITERATIONS);
      // 3) 只把“盐 + 校验串 + 恢复材料”发往云端；主密码不上传
      const res = await api.initAdmin({
        kdfSalt,
        kdfVerifier,
        recoverySalt: material.recoverySaltB64,
        recoveryBlob: material.recoveryBlob,
      });

      if (!res.ok) {
        if (res.error === "ALREADY_INITIALIZED") {
          setInfo("系统已完成初始化，请直接登录。");
          onInitialized();
          return;
        }
        if (res.error === "NOT_LOGGED_IN") {
          setError("登录状态已失效，请重新登录后再试。");
          return;
        }
        setError(describeError(res.error));
        return;
      }

      // 4) 成功：清空内存中的密码，先展示一次性恢复码（勾选确认后再进入主界面）
      setMasterPwd("");
      setConfirmPwd("");
      setAckChecked(false);
      setRecoveryCode(material.code);
      setStep("recovery");
    } catch (err) {
      log.error("初始化失败", err);
      setError("初始化失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  // R28：一次性恢复码展示——勾选“我已抄下”后方可继续；进入后应用内会再确认一次（写 recovery_ack_at）。
  if (step === "recovery" && recoveryCode) {
    return (
      <AuthCard
        title="请抄下你的恢复码（只显示一次）"
        subtitle="主密码遗忘时，只能靠这串恢复码找回数据。我们不会再次显示它，任何人都无法替你找回。"
      >
        <div className="my-3 rounded-lg border border-kb-border-strong bg-slate-50 p-3 font-mono text-base tracking-widest break-all dark:border-slate-600 dark:bg-slate-900">
          {recoveryCode}
        </div>
        <div className="my-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          ⚠️ 建议：把恢复码抄在纸上或存进离线密码管理器。它一旦丢失，云端密文将永久无法解开。
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
            onClick={() => onInitialized()}
            disabled={!ackChecked}
            className="w-full rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900"
          >
            我已抄好，进入应用
          </button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="首次初始化：设置主密码"
      subtitle="当前手机号是第一个使用者，将创建管理员账号。主密码只在本机加密数据，云端永远拿不到它。"
      footer={
        <button type="button" onClick={onSignOut} className="underline hover:no-underline">
          不是我的手机号？切换账号
        </button>
      }
    >
      <ErrorBanner message={error} />
      <InfoBanner message={info} />
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Field
          label="主密码"
          type="password"
          value={masterPwd}
          onChange={setMasterPwd}
          autoComplete="new-password"
          hint="用于本机加密全部密钥；云端没有任何副本，遗忘即不可找回。"
        />
        <Field
          label="确认主密码"
          type="password"
          value={confirmPwd}
          onChange={setConfirmPwd}
          autoComplete="new-password"
        />
        <PrimaryButton loading={busy}>创建管理员并完成初始化</PrimaryButton>
      </form>
    </AuthCard>
  );
}

/** 把云函数错误码转成给用户看的中文提示（不透传任何内部细节）。 */
function describeError(code?: string): string {
  switch (code) {
    case "ALREADY_INITIALIZED":
      return "系统已完成初始化，请直接登录。";
    case "MISSING_KDF_PARAMS":
      return "缺少密钥参数，请刷新后重试。";
    case "MISSING_RECOVERY_PARAMS":
      return "恢复码材料不完整，请刷新后重试。";
    default:
      return "初始化失败，请稍后重试。";
  }
}
