/**
 * VaultPage.tsx —— 主界面（第 6/7 步）。
 *
 * 职责：
 *   - 会话与密钥参数：auth.getSession() 取 uid；kbGetMyRole 取 kdfSalt / kdfVerifier / keyEpoch。
 *   - 解锁：本机校验主密码（crypto.verifyMasterPassword）→ 派生主密钥（只在内存，绝不落盘）。
 *   - 本地优先同步（第 7 步）：synchronize 走 sync.syncVault() —— 拉取远端 → 合并（LWW by updated_at）
 *     → 重放待上传队列；随后从 IndexedDB 读密文、本地解密成可渲染项。
 *   - 增删改：sync.saveLocal / sync.deleteLocal（先落本地 + 入队，界面即时生效）。
 *   - 标签（R18）：多选筛选 / 重命名 / 删除（删除前提示影响条数）。
 *   - 搜索（R19）：纯本机内存过滤（vault.filterItems），关键词一个字节都不发往云端。
 *   - 冲突：本地未上传改动被服务端更新覆盖时，显式提示“这条被更新的版本覆盖了”，绝不静默覆盖。
 *
 * 明文纪律：主密钥只在本组件 state（内存）；离开本页（登出/刷新）即随之销毁；不进日志、不落盘。
 *
 * ⚠️ 端到端验证状态：**待控制台配置后验证**（四项控制台操作未完成，登录链路尚无法真跑）。
 *    本页的构建与类型检查已通过；真实上下行需控制台配好后联调。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import SecretDialog from "../components/SecretDialog";
import SecretTable from "../components/SecretTable";
import StatusBar from "../components/StatusBar";
import TagSidebar from "../components/TagSidebar";
import TopBar from "../components/TopBar";
import { api } from "../lib/api";
import { getActiveSession } from "../lib/cloudbase";
import {
  PBKDF2_ITERATIONS,
  deriveMasterKey,
  verifyMasterPassword,
  type MasterKey,
} from "../lib/crypto";
import { getAllCached } from "../lib/db";
import { useSessionGuard } from "../hooks/useSessionGuard";
import { log } from "../lib/log";
import {
  deleteLocal,
  saveLocal,
  syncVault,
  type SyncConflict,
} from "../lib/sync";
import {
  collectTags,
  countByTag,
  decryptCached,
  filterItems,
  mapTagChange,
  type SecretItem,
  type SecretPlain,
} from "../lib/vault";

export default function VaultPage({
  username,
  onSignOut,
  onOpenAdmin,
}: {
  username: string;
  onSignOut: () => void;
  /** 仅管理员传入：顶栏显示“管理后台”入口（第 8 步）。 */
  onOpenAdmin?: () => void;
}): JSX.Element {
  const [uid, setUid] = useState<string>("");
  const [kdfSalt, setKdfSalt] = useState<string>("");
  const [kdfVerifier, setKdfVerifier] = useState<string>("");
  const [keyEpoch, setKeyEpoch] = useState<number>(0);
  const [masterKey, setMasterKey] = useState<MasterKey | null>(null);

  const [items, setItems] = useState<SecretItem[]>([]);
  const [online, setOnline] = useState<boolean>(true);
  const [pending, setPending] = useState<number>(0);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);

  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [keyword, setKeyword] = useState<string>("");

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

  // 2) 从本地缓存读取密文并本地解密
  const reload = useCallback(async (): Promise<void> => {
    if (!masterKey) return;
    const rows = await getAllCached();
    const list = await decryptCached(rows, masterKey);
    setItems(list);
  }, [masterKey]);

  // 会话时效（R13）：命中即清空内存主密钥 + 丢弃内存中的解密数据（锁定本地缓存）+ 登出
  const handleSessionExpired = useCallback((): void => {
    setMasterKey(null);
    setItems([]);
    log.warn("会话失效：已清空内存主密钥并登出");
    onSignOut();
  }, [onSignOut]);
  const { checkNow } = useSessionGuard(handleSessionExpired);

  // 3) 同步：先校验会话时效 → 拉取 → 合并 → 重放队列 → 本地重载
  const runSync = useCallback(async (): Promise<void> => {
    if (!uid) return;
    // 每次同步前先校验会话时效（R13：触发点之一）
    if (!(await checkNow())) return;
    setBusy(true);
    try {
      const res = await syncVault(uid);
      setOnline(res.online);
      setPending(res.pending);
      setConflicts(res.conflicts);
      await reload();
    } catch (err) {
      log.error("同步失败", err);
      setOnline(false);
      setError("同步失败，已保留本地数据，稍后会自动重试。");
    } finally {
      setBusy(false);
    }
  }, [uid, reload, checkNow]);

  // uid 就绪或主密钥变更（解锁）后触发同步
  useEffect(() => {
    if (uid) void runSync();
  }, [uid, runSync]);

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
      setMasterKey(mk); // 只在内存；下一步由 runSync effect 触发同步与本地解密
      setUnlockPwd(""); // 明文密码用完即弃
    } catch (err) {
      log.error("解锁失败", err);
      setError("解锁失败，请重试。");
    } finally {
      setUnlocking(false);
    }
  }

  function handleAdd(): void {
    setEditing(null);
    setDialogOpen(true);
  }

  function handleEdit(item: SecretItem): void {
    setEditing(item);
    setDialogOpen(true);
  }

  async function handleSubmitDialog(plain: SecretPlain, existingId?: number): Promise<void> {
    if (!masterKey || !uid) return;
    setBusy(true);
    setError(null);
    try {
      await saveLocal(uid, masterKey, keyEpoch, plain, existingId);
      setDialogOpen(false);
      setEditing(null);
      setNotice(existingId ? "已更新（本机已保存，正在同步）。" : "已新增（本机已保存，正在同步）。");
      await runSync();
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
      await deleteLocal(item.id);
      setNotice("已删除（正在同步）。");
      await runSync();
    } catch (err) {
      log.error("删除密钥失败", err);
      setError("删除失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  // R18：重命名标签（本机改标签 → 逐条保存 → 同步）
  async function handleRequestRename(tag: string): Promise<void> {
    if (!masterKey || !uid) return;
    const next = window.prompt(`把标签「${tag}」重命名为：`, tag);
    if (next === null) return; // 取消
    const trimmed = next.trim();
    if (!trimmed) {
      setError("标签名不能为空。");
      return;
    }
    if (trimmed === tag) return;

    const changed = mapTagChange(items, tag, trimmed);
    setBusy(true);
    setError(null);
    try {
      for (const change of changed) {
        await saveLocal(uid, masterKey, keyEpoch, change.plain, change.id);
      }
      if (activeTag === tag) setActiveTag(trimmed);
      setNotice(`已重命名标签「${tag}」→「${trimmed}」，共更新 ${changed.length} 条记录。`);
      await runSync();
    } catch (err) {
      log.error("重命名标签失败", err);
      setError("重命名标签失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  // R18：删除标签前提示会影响几条记录
  async function handleRequestDelete(tag: string): Promise<void> {
    if (!masterKey || !uid) return;
    const affected = countByTag(items, tag);
    if (
      !window.confirm(
        `删除标签「${tag}」会从 ${affected} 条记录上移除该标签（记录本身保留）。确认删除？`
      )
    ) {
      return;
    }
    const changed = mapTagChange(items, tag, null);
    setBusy(true);
    setError(null);
    try {
      for (const change of changed) {
        await saveLocal(uid, masterKey, keyEpoch, change.plain, change.id);
      }
      if (activeTag === tag) setActiveTag(null);
      setNotice(`已删除标签「${tag}」，共影响 ${changed.length} 条记录。`);
      await runSync();
    } catch (err) {
      log.error("删除标签失败", err);
      setError("删除标签失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  const tags = useMemo(() => collectTags(items), [items]);
  const visible = useMemo(() => filterItems(items, activeTag, keyword), [items, activeTag, keyword]);

  return (
    <div className="flex min-h-full flex-col">
      <TopBar
        username={username}
        searchValue={keyword}
        onSearchChange={setKeyword}
        onSignOut={onSignOut}
        onOpenAdmin={onOpenAdmin}
      />

      <div className="mx-auto flex w-full max-w-6xl flex-1">
        {masterKey ? (
          <TagSidebar
            totalCount={items.length}
            tags={tags}
            activeTag={activeTag}
            onSelect={setActiveTag}
            onRequestRename={(tag) => void handleRequestRename(tag)}
            onRequestDelete={(tag) => void handleRequestDelete(tag)}
          />
        ) : null}

        <main className="flex-1 p-6">
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
          {conflicts.length > 0 ? (
            <ConflictNotice conflicts={conflicts} onDismiss={() => setConflicts([])} />
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
                <h2 className="text-base font-semibold">
                  我的密钥（{visible.length}
                  {visible.length !== items.length ? ` / 共 ${items.length}` : ""}）
                  {activeTag ? <span className="ml-2 text-sm text-slate-500">标签：{activeTag}</span> : null}
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void runSync()}
                    disabled={busy}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    同步
                  </button>
                  <button
                    type="button"
                    onClick={handleAdd}
                    className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900"
                  >
                    + 新增密钥
                  </button>
                </div>
              </div>
              {busy ? <p className="text-sm text-slate-500">处理中…</p> : null}
              <SecretTable items={visible} onEdit={handleEdit} onDelete={handleDelete} />
            </section>
          )}
        </main>
      </div>

      <StatusBar unlocked={Boolean(masterKey)} online={online} pending={pending} />

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

/**
 * 冲突提示（第 7 步）：本地未上传改动被服务端更新覆盖时，显式告知，绝不静默覆盖。
 * 覆盖以【服务端 updated_at 为准】（后写覆盖，LWW）。
 */
function ConflictNotice({
  conflicts,
  onDismiss,
}: {
  conflicts: SyncConflict[];
  onDismiss: () => void;
}): JSX.Element {
  return (
    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">检测到 {conflicts.length} 处同步冲突</div>
          <ul className="mt-1 list-disc pl-5">
            {conflicts.map((c) => (
              <li key={c.id}>
                记录 #{c.id}：这条被更新的版本覆盖了（服务端 {formatTime(c.remoteUpdatedAt)} 覆盖了本机{" "}
                {formatTime(c.localUpdatedAt)} 的未上传改动）。
              </li>
            ))}
          </ul>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded px-2 py-1 text-xs text-amber-700 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900"
        >
          知道了
        </button>
      </div>
    </div>
  );
}

/** 把 ISO 时间格式化成“本地可读”短串；解析失败则原样返回。 */
function formatTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString();
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
