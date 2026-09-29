/**
 * SecurityPanel.tsx —— 安全面板（R21 改主密码 / R29 备份导出导入 / R28 恢复码状态）。
 *
 * 内容：
 *   - R29：导出加密备份到本机文件；从本机文件导入（用主密码解密后写回本地存储，不依赖云端在线）。
 *   - R21：改主密码——本机逐条解密 → 重加密 → 单请求提交 → 失败自动回滚（编排见 lib/rotate.ts）。
 *   - R28：恢复码“已抄下”确认（写 recovery_ack_at）+ 未确认时的持续提醒。
 *
 * 明文纪律：主密码/恢复码只在本组件 state 内存中短暂存在；提交后立即清空；绝不进日志。
 */
import { useState } from "react";
import { api } from "../lib/api";
import {
  PBKDF2_ITERATIONS,
  deriveMasterKey,
  generateSaltB64,
  verifyMasterPassword,
  type MasterKey,
} from "../lib/crypto";
import {
  backupFileName,
  backupToCachedRows,
  downloadBackup,
  exportBackup,
  importBackup,
  looksLikeBackup,
} from "../lib/backup";
import {
  deleteCached,
  getAllCached,
  putCachedMany,
  putStagingMany,
  clearStaging,
  type CachedSecret,
} from "../lib/db";
import { log } from "../lib/log";
import { changeMasterPassword, type RotateDeps } from "../lib/rotate";

export interface SecurityPanelProps {
  uid: string;
  masterKey: MasterKey;
  kdfSalt: string;
  kdfVerifier: string;
  keyEpoch: number;
  recoverySalt: string | null;
  recoveryBlob: string | null;
  recoveryAckAt: string | null;
  /** 改主密码成功后：父组件应清空内存主密钥并要求用新密码重新解锁。 */
  onRotated: () => void;
  /** 导入备份 / 确认恢复码后：父组件应重新取角色并重载列表。 */
  onDataChanged: () => void;
}

/** 用给定行整体替换 main 区（改主密码成功后 staging→main / 导入覆盖）。 */
async function replaceMainRows(rows: CachedSecret[]): Promise<void> {
  const current = await getAllCached();
  for (const row of current) {
    await deleteCached(row.id);
  }
  await putCachedMany(rows);
}

export default function SecurityPanel({
  uid,
  masterKey,
  kdfSalt,
  kdfVerifier,
  keyEpoch,
  recoverySalt,
  recoveryBlob,
  recoveryAckAt,
  onRotated,
  onDataChanged,
}: SecurityPanelProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");

  const needRecoveryCode = Boolean(recoveryBlob) && Boolean(recoverySalt);

  function resetChangeForm(): void {
    setOldPwd("");
    setNewPwd("");
    setConfirmPwd("");
    setRecoveryCode("");
  }

  // ---- R29 导出 ----
  async function handleExport(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const rows = await getAllCached();
      const text = await exportBackup({
        masterKey,
        items: rows.map((r) => ({ id: r.id, payload: r.payload, keyEpoch: r.keyEpoch })),
        kdfSalt,
        kdfVerifier,
        keyEpoch,
      });
      downloadBackup(text, backupFileName());
      setNotice(`已导出加密备份（${rows.length} 条）。请妥善离线保管该文件。`);
    } catch (err) {
      log.error("导出备份失败", err);
      setError("导出备份失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  // ---- R29 导入 ----
  async function handleImportFile(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files && event.target.files[0];
    event.target.value = ""; // 允许重复选同一文件
    if (!file) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const text = await file.text();
      if (!looksLikeBackup(text)) {
        setError("该文件不是 KeyBox 备份（缺少 KBBK1: 前缀）。");
        return;
      }
      const plain = await importBackup(masterKey, text);
      const rows = backupToCachedRows(plain, uid);
      await putCachedMany(rows);
      setNotice(`已从备份恢复 ${rows.length} 条到本机（不依赖云端）。可点“同步”上传。`);
      onDataChanged();
    } catch (err) {
      log.error("导入备份失败", err);
      setError("导入失败：文件被改过或当前主密码与该备份不匹配。");
    } finally {
      setBusy(false);
    }
  }

  // ---- R21 改主密码 ----
  async function handleChangeMaster(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!oldPwd || !newPwd) {
      setError("请填写原主密码与新主密码。");
      return;
    }
    if (newPwd.length < 8) {
      setError("新主密码至少 8 位。");
      return;
    }
    if (newPwd !== confirmPwd) {
      setError("两次输入的新主密码不一致。");
      return;
    }
    if (needRecoveryCode && !recoveryCode.trim()) {
      setError("本账号已设恢复码：请再次输入恢复码，以便用新主密钥重包裹（否则恢复码将失效）。");
      return;
    }

    setBusy(true);
    try {
      // 先本机校验原主密码，避免拿错密钥白跑一轮
      const okOld = await verifyMasterPassword(oldPwd, kdfSalt, kdfVerifier, PBKDF2_ITERATIONS);
      if (!okOld) {
        setError("原主密码不正确。");
        return;
      }
      const oldMasterKey = await deriveMasterKey(oldPwd, kdfSalt, PBKDF2_ITERATIONS);

      const deps: RotateDeps = {
        listMain: getAllCached,
        writeStaging: putStagingMany,
        clearStaging,
        replaceMain: replaceMainRows,
        rotateRemote: (p) => api.rotateMaster(p),
      };

      const result = await changeMasterPassword(deps, {
        oldMasterKey,
        oldSaltB64: kdfSalt,
        oldVerifier: kdfVerifier,
        newPassword: newPwd,
        newSaltB64: generateSaltB64(),
        iterations: PBKDF2_ITERATIONS,
        recoveryCode: needRecoveryCode ? recoveryCode : undefined,
        recoverySaltB64: needRecoveryCode ? recoverySalt ?? undefined : undefined,
      });

      resetChangeForm();
      setNotice(`主密码已更新（密钥代数 → ${result.keyEpoch}）。请用新主密码解锁。`);
      onRotated();
    } catch (err) {
      log.error("改主密码失败", err);
      setError(err instanceof Error ? err.message : "改主密码失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  // ---- R28 确认已抄下恢复码 ----
  async function handleAckRecovery(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await api.ackRecovery();
      if (!res.ok) {
        setError("确认失败，请稍后重试。");
        return;
      }
      setNotice("已记录：你已抄写并妥善保管恢复码。");
      onDataChanged();
    } catch (err) {
      log.error("确认恢复码失败", err);
      setError("确认失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  const showRecoveryReminder = Boolean(recoveryBlob) && !recoveryAckAt;

  return (
    <section className="space-y-4 rounded-xl border border-kb-border bg-kb-surface p-5 shadow-sm dark:border-kb-border dark:bg-kb-surface">
      <h2 className="text-base font-semibold">安全</h2>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          {notice}
        </div>
      ) : null}

      {showRecoveryReminder ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <div className="font-medium">你还没有确认已抄下恢复码</div>
          <p className="mt-1">
            恢复码用于在主密码遗忘时找回数据；若未妥善保管，将无法恢复。确认后此提醒会消失。
          </p>
          <button
            type="button"
            onClick={() => void handleAckRecovery()}
            disabled={busy}
            className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            我已抄下并自行保管
          </button>
        </div>
      ) : null}

      {/* R29 备份 */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">加密备份（R29）</h3>
        <p className="text-xs text-kb-muted">备份文件同样是密文；导入用主密码解密，不依赖云端在线。</p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={busy}
            className="rounded-lg border border-kb-border-strong px-3 py-1.5 text-sm text-kb-text hover:bg-kb-surface-2 disabled:opacity-50 dark:border-kb-border-strong dark:text-kb-text dark:hover:brightness-110"
          >
            导出备份
          </button>
          <label className="cursor-pointer rounded-lg border border-kb-border-strong px-3 py-1.5 text-sm text-kb-text hover:bg-kb-surface-2 dark:border-kb-border-strong dark:text-kb-text dark:hover:brightness-110">
            导入备份
            <input type="file" accept=".kbbk,text/plain" className="hidden" onChange={(e) => void handleImportFile(e)} disabled={busy} />
          </label>
        </div>
      </div>

      {/* R21 改主密码 */}
      <form className="space-y-2 border-t border-kb-border pt-4 dark:border-kb-border" onSubmit={handleChangeMaster}>
        <h3 className="text-sm font-medium">修改主密码（R21）</h3>
        <p className="text-xs text-kb-muted">
          本机会用原主密码逐条解密、用新主密码重加密后再整批提交；任何一条失败都会整体中止，不会产生“半新半旧”。
        </p>
        <input
          type="password"
          value={oldPwd}
          onChange={(e) => setOldPwd(e.target.value)}
          placeholder="原主密码"
          autoComplete="current-password"
          className="w-full rounded-lg border border-kb-border-strong bg-kb-surface px-3 py-2 text-sm outline-none focus:border-kb-border-strong dark:border-kb-border-strong dark:bg-kb-surface"
        />
        <input
          type="password"
          value={newPwd}
          onChange={(e) => setNewPwd(e.target.value)}
          placeholder="新主密码（至少 8 位）"
          autoComplete="new-password"
          className="w-full rounded-lg border border-kb-border-strong bg-kb-surface px-3 py-2 text-sm outline-none focus:border-kb-border-strong dark:border-kb-border-strong dark:bg-kb-surface"
        />
        <input
          type="password"
          value={confirmPwd}
          onChange={(e) => setConfirmPwd(e.target.value)}
          placeholder="确认新主密码"
          autoComplete="new-password"
          className="w-full rounded-lg border border-kb-border-strong bg-kb-surface px-3 py-2 text-sm outline-none focus:border-kb-border-strong dark:border-kb-border-strong dark:bg-kb-surface"
        />
        {needRecoveryCode ? (
          <input
            type="text"
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            placeholder="恢复码（用于重包裹，保持其可用）"
            className="w-full rounded-lg border border-kb-border-strong bg-kb-surface px-3 py-2 text-sm outline-none focus:border-kb-border-strong dark:border-kb-border-strong dark:bg-kb-surface"
          />
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg kb-btn-primary"
        >
          {busy ? "处理中…" : "修改主密码"}
        </button>
      </form>
    </section>
  );
}
