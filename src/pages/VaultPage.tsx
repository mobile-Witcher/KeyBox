/**
 * VaultPage.tsx —— 主界面：解锁 + 密钥增删改查（第 6 步，R15 / R16）。
 *
 * 流程（架构 §6.2 / §5.1 线框）：
 *   1. 进入时用 auth.getSession() 取 uid，并调 kbGetMyRole 取 kdfSalt / kdfVerifier / keyEpoch。
 *   2. 未解锁 → 显示“输入主密码”表单；本机校验通过后派生主密钥（只在内存）。
 *   3. 已解锁 → 用 app.rdb() 拉取本人密文并本地解密 → SecretTable 展示。
 *   4. 新增/编辑 → 本地加密 → kbSecretUpsert；删除 → kbSecretDelete。
 *
 * 明文纪律：主密钥只在本组件 state（内存）；离开本页（登出）即随之销毁。
 *
 * ⚠️ 端到端验证状态：**待控制台配置后验证**（四项控制台操作未完成，登录链路尚无法真跑）。
 *    本页的构建与类型检查已通过；真实读写需控制台配好后联调。
 */
import { useCallback, useEffect, useState } from "react";
import SecretDialog from "../components/SecretDialog";
import SecretTable from "../components/SecretTable";
import { api } from "../lib/api";
import { getActiveSession } from "../lib/cloudbase";
import {
  PBKDF2_ITERATIONS,
  deriveMasterKey,
  verifyMasterPassword,
  type MasterKey,
} from "../lib/crypto";
import { log } from "../lib/log";
import { listMySecrets, removeSecret, saveSecret, type SecretItem, type SecretPlain } from "../lib/vault";

export default function VaultPage({
  username,
  onSignOut,
}: {
  username: string;
  onSignOut: () => void;
}): JSX.Element {
  const [uid, setUid] = useState<string>("");
  const [kdfSalt, setKdfSalt] = useState<string>("");
  const [kdfVerifier, setKdfVerifier] = useState<string>("");
  const [keyEpoch, setKeyEpoch] = useState<number>(0);
  const [masterKey, setMasterKey] = useState<MasterKey | null>(null);
  const [items, setItems] = useState<SecretItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unlockPwd, setUnlockPwd] = useState<string>("");
  const [unlocking, setUnlocking] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<SecretItem | null>(null);

  // 1) 取会话与密钥参数
  useEffect(() => {
    let alive = true;
    (async () => {
      const session = await getActiveSession();
      if (!alive) return;
      if (!session) {
        onSignOut();
        return;
      }
      setUid(session.uid);

      const res = await api.getMyRole();
      if (!alive) return;
      if (!res.ok || !res.data) {
        setError("无法读取账号信息，请重新登录。");
        setLoading(false);
        return;
      }
      if (res.data.status !== "active") {
        log.warn("账号已被停用，强制登出");
        onSignOut();
        return;
      }
      setKdfSalt(res.data.kdfSalt);
      setKdfVerifier(res.data.kdfVerifier);
      setKeyEpoch(res.data.keyEpoch);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [onSignOut]);

  // 2) 解锁：本机校验主密码
  async function handleUnlock(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!unlockPwd) {
      setError("请输入主密码。");
      return;
    }
    setUnlocking(true);
    try {
      const correct = await verifyMasterPassword(unlockPwd, kdfSalt, kdfVerifier, PBKDF2_ITERATIONS);
      if (!correct) {
        setError("主密码不正确。");
        return;
      }
      const mk = await deriveMasterKey(unlockPwd, kdfSalt, PBKDF2_ITERATIONS);
      setMasterKey(mk);
      setUnlockPwd(""); // 明文密码用完即弃
    } catch (err) {
      log.error("解锁失败", err);
      setError("解锁失败，请重试。");
    } finally {
      setUnlocking(false);
    }
  }

  // 3) 拉取并本地解密
  const reload = useCallback(async (): Promise<void> => {
    if (!masterKey || !uid) return;
    setBusy(true);
    try {
      const list = await listMySecrets(uid, masterKey);
      setItems(list);
    } catch (err) {
      log.error("加载密钥失败", err);
      setError("加载密钥失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }, [masterKey, uid]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function handleAdd(): void {
    setEditing(null);
    setDialogOpen(true);
  }

  function handleEdit(item: SecretItem): void {
    setEditing(item);
    setDialogOpen(true);
  }

  async function handleSubmitDialog(plain: SecretPlain, existingId?: number): Promise<void> {
    if (!masterKey) return;
    setBusy(true);
    setError(null);
    try {
      await saveSecret(masterKey, keyEpoch, plain, existingId);
      setDialogOpen(false);
      setEditing(null);
      setNotice(existingId ? "已更新。" : "已新增。");
      await reload();
    } catch (err) {
      log.error("保存密钥失败", err);
      setError("保存失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(item: SecretItem): Promise<void> {
    const label = item.plain?.site || "该条记录";
    if (!window.confirm(`确定删除「${label}」？此操作不可撤销。`)) return;
    setBusy(true);
    setError(null);
    try {
      await removeSecret(item.id);
      setNotice("已删除。");
      await reload();
    } catch (err) {
      log.error("删除密钥失败", err);
      setError("删除失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      {/* 顶栏 */}
      <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3 dark:border-slate-700">
        <div className="font-semibold">KeyBox</div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-600 dark:text-slate-300">{username}</span>
          <button
            type="button"
            onClick={onSignOut}
            className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            退出登录
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 p-6">
        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            {notice}
          </div>
        ) : null}

        {loading ? (
          <p className="text-center text-sm text-slate-500">正在读取账号信息…</p>
        ) : !masterKey ? (
          <UnlockPanel
            value={unlockPwd}
            onChange={setUnlockPwd}
            onSubmit={handleUnlock}
            unlocking={unlocking}
          />
        ) : (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">我的密钥（{items.length}）</h2>
              <button
                type="button"
                onClick={handleAdd}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900"
              >
                + 新增密钥
              </button>
            </div>
            {busy ? <p className="text-sm text-slate-500">处理中…</p> : null}
            <SecretTable items={items} onEdit={handleEdit} onDelete={handleDelete} />
          </section>
        )}
      </main>

      {/* 底部状态条（架构 §5.1） */}
      <footer className="border-t border-slate-200 px-6 py-2 text-center text-xs text-slate-500 dark:border-slate-700">
        {masterKey ? "已解锁 · 本机解密 · 密钥不出本机" : "未解锁 · 输入主密码后才能查看密钥"}
      </footer>

      <SecretDialog
        open={dialogOpen}
        initial={editing}
        busy={busy}
        onCancel={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        onSubmit={(plain, existingId) => void handleSubmitDialog(plain, existingId)}
      />
    </div>
  );
}

/** 解锁面板：输入主密码 → 本机校验 kdf_verifier。 */
function UnlockPanel({
  value,
  onChange,
  onSubmit,
  unlocking,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  unlocking: boolean;
}): JSX.Element {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <h2 className="text-base font-semibold">输入主密码解锁</h2>
      <p className="mt-1 text-sm text-slate-500">
        主密码只在本机校验，云端没有任何副本。
      </p>
      <form className="mt-4 space-y-3" onSubmit={onSubmit}>
        <input
          type="password"
          value={value}
          autoComplete="current-password"
          onChange={(e) => onChange(e.target.value)}
          placeholder="主密码"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />
        <button
          type="submit"
          disabled={unlocking}
          className="w-full rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900"
        >
          {unlocking ? "校验中…" : "解锁"}
        </button>
      </form>
    </div>
  );
}
