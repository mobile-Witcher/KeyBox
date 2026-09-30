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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SecretCardGrid from "../components/SecretCardGrid";
import SecretDialog from "../components/SecretDialog";
import SecretTable from "../components/SecretTable";
import SecurityPanel from "../components/SecurityPanel";
import StatusBar from "../components/StatusBar";
import TagSidebar from "../components/TagSidebar";
import TopBar from "../components/TopBar";
import { GridIcon, ListIcon } from "../components/icons";
import { api } from "../lib/api";
import { getActiveSession } from "../lib/cloudbase";
import {
  PBKDF2_ITERATIONS,
  deriveMasterKey,
  masterKeyFromRaw,
  verifyMasterPassword,
  type MasterKey,
} from "../lib/crypto";
import {
  clearUnlockCredential,
  loadUnlockCredential,
  saveUnlockCredential,
} from "../lib/remember";
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
  const [recoverySalt, setRecoverySalt] = useState<string | null>(null);
  const [recoveryBlob, setRecoveryBlob] = useState<string | null>(null);
  const [recoveryAckAt, setRecoveryAckAt] = useState<string | null>(null);
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
  /** "在这台设备上记住"勾选（默认关闭——共享设备下必须由用户主动开启）。 */
  const [remember, setRemember] = useState<boolean>(false);
  /** 本机已保存的解锁凭据时间（非空表示"已记住"，供界面显示与清除）。 */
  const [rememberedAt, setRememberedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<SecretItem | null>(null);
  /** 密钥区视图形态：网格（卡片，默认）/ 列表（表格）。纯视图偏好，不参与任何数据逻辑。 */
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  /** 安全面板锚点：顶栏与侧栏的「设置」图标滚动到这里。 */
  const securityRef = useRef<HTMLDivElement | null>(null);
  const [securityOpen, setSecurityOpen] = useState(false);

  const scrollToSettings = useCallback((): void => {
    securityRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setSecurityOpen(true); // 设置图标点过来时自动展开
  }, []);

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
      setRecoverySalt(res.data.recoverySalt);
      setRecoveryBlob(res.data.recoveryBlob);
      setRecoveryAckAt(res.data.recoveryAckAt);

      // 尝试用本机记住的解锁凭据【自动解锁】（仅当用户此前主动勾选过"记住"）
      const saved = await loadUnlockCredential(session.uid);
      if (!alive) return;
      if (saved) {
        if (saved.keyEpoch === res.data.keyEpoch) {
          try {
            const mk = await masterKeyFromRaw(saved.raw);
            if (!alive) return;
            setMasterKey(mk);
            setRememberedAt(saved.savedAt);
          } catch (err) {
            log.warn("自动解锁失败，回退为手动输入主密码", err);
          }
        } else {
          // 主密码变更过 → 旧凭据必然解不开新一代密文，直接清除并提示
          await clearUnlockCredential();
          if (alive) {
            setNotice("检测到主密码已变更，本机记住的解锁凭据已失效，请重新输入主密码。");
          }
        }
      }
      if (alive) setLoading(false);
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

  // 重新拉取角色/密钥参数（改主密码或导入备份后调用）
  const refreshRole = useCallback(async (): Promise<void> => {
    const res = await api.getMyRole();
    if (res.ok && res.data) {
      setKdfSalt(res.data.kdfSalt);
      setKdfVerifier(res.data.kdfVerifier);
      setKeyEpoch(res.data.keyEpoch);
      setRecoverySalt(res.data.recoverySalt);
      setRecoveryBlob(res.data.recoveryBlob);
      setRecoveryAckAt(res.data.recoveryAckAt);
    }
  }, []);

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

      // 用户勾选"在这台设备上记住"→ 写入本机解锁凭据（失败不影响本次解锁）
      if (remember) {
        try {
          await saveUnlockCredential(uid, keyEpoch, mk.raw);
          setRememberedAt(new Date().toISOString());
        } catch (err) {
          log.warn("保存解锁凭据失败（不影响本次解锁）", err);
        }
      }
    } catch (err) {
      log.error("解锁失败", err);
      setError("解锁失败，请重试。");
    } finally {
      setUnlocking(false);
    }
  }

  /** 清除本机已记住的解锁凭据（用户主动操作）。 */
  async function handleClearRemembered(): Promise<void> {
    await clearUnlockCredential();
    setRememberedAt(null);
    setRemember(false);
    setNotice("已清除本机记住的解锁凭据，下次需要重新输入主密码。");
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

  // 改主密码成功后：旧主密钥作废（清空内存）→ 用新密码重新解锁；并刷新新盐/新校验串/新代数
  const handleRotated = useCallback((): void => {
    setMasterKey(null);
    setItems([]);
    void refreshRole();
  }, [refreshRole]);

  // 导入备份 / 确认恢复码后：刷新角色并重载本机解密列表
  const handleDataChanged = useCallback((): void => {
    void refreshRole();
    void reload();
  }, [refreshRole, reload]);

  const tags = useMemo(() => collectTags(items), [items]);
  const visible = useMemo(() => filterItems(items, activeTag, keyword), [items, activeTag, keyword]);
  /** 恢复码已生成但用户还没确认留存 → 设置入口显示角标（只影响视觉，不改任何业务流程）。 */
  const recoveryPending = Boolean(recoveryBlob) && !recoveryAckAt;

  return (
    <div className="flex min-h-full flex-col">
      <TopBar
        username={username}
        searchValue={keyword}
        onSearchChange={setKeyword}
        onSignOut={onSignOut}
        onOpenAdmin={onOpenAdmin}
        onOpenSettings={masterKey ? scrollToSettings : undefined}
      />

      {/* 桌面：侧栏与主区左右并排；移动端：纵向堆叠（侧栏变成横向标签条，见 TagSidebar） */}
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col md:flex-row">
        {masterKey ? (
          <TagSidebar
            totalCount={items.length}
            tags={tags}
            activeTag={activeTag}
            onSelect={setActiveTag}
            onRequestRename={(tag) => void handleRequestRename(tag)}
            onRequestDelete={(tag) => void handleRequestDelete(tag)}
            onOpenSettings={scrollToSettings}
            settingsAttention={recoveryPending}
          />
        ) : null}

        <main className="min-w-0 flex-1 p-4 sm:p-6">
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
            <p className="text-center text-sm text-kb-muted">正在读取账号信息…</p>
          ) : !masterKey ? (
            <UnlockPanel
              value={unlockPwd}
              onChange={setUnlockPwd}
              onSubmit={handleUnlock}
              unlocking={unlocking}
              remember={remember}
              onRememberChange={setRemember}
              rememberedAt={rememberedAt}
              onClearRemembered={() => void handleClearRemembered()}
            />
          ) : (
            <div className="space-y-6">
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold">
                  我的密钥（{visible.length}
                  {visible.length !== items.length ? ` / 共 ${items.length}` : ""}）
                  {activeTag ? <span className="ml-2 text-sm text-kb-muted">标签：{activeTag}</span> : null}
                </h2>
                <div className="flex items-center gap-2">
                  {/* 视图切换：卡片网格（默认）/ 表格列表。纯显示偏好，不参与任何数据逻辑。 */}
                  <div
                    role="group"
                    aria-label="密钥显示方式"
                    className="flex items-center gap-0.5 rounded-lg border border-kb-border p-0.5"
                  >
                    <ViewToggleButton
                      active={viewMode === "grid"}
                      label="卡片视图"
                      onClick={() => setViewMode("grid")}
                    >
                      <GridIcon size={16} />
                    </ViewToggleButton>
                    <ViewToggleButton
                      active={viewMode === "list"}
                      label="列表视图"
                      onClick={() => setViewMode("list")}
                    >
                      <ListIcon size={16} />
                    </ViewToggleButton>
                  </div>
                  <button
                    type="button"
                    onClick={() => void runSync()}
                    disabled={busy}
                    className="rounded-lg border border-kb-border-strong px-3 py-1.5 text-sm text-kb-text hover:bg-kb-surface-2 disabled:opacity-50 dark:border-kb-border-strong dark:text-kb-text dark:hover:brightness-110"
                  >
                    同步
                  </button>
                  <button
                    type="button"
                    onClick={handleAdd}
                    className="rounded-lg kb-btn-primary"
                  >
                    + 新增密钥
                  </button>
                </div>
              </div>
              {busy ? <p className="text-sm text-kb-muted">处理中…</p> : null}
              {viewMode === "grid" ? (
                <SecretCardGrid
                  items={visible}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onSync={() => void runSync()}
                  syncing={busy}
                  onAdd={handleAdd}
                />
              ) : (
                <SecretTable items={visible} onEdit={handleEdit} onDelete={handleDelete} />
              )}
            </section>
            {/* 顶栏 / 侧栏的「设置」图标滚动到这里（安全操作入口，业务逻辑一字未动） */}
            <div ref={securityRef}>
            <button
              type="button"
              onClick={() => setSecurityOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-lg border border-kb-border bg-kb-surface px-4 py-3 text-left"
            >
              <span>
                <span className="text-sm font-semibold">安全</span>
                <span className="ml-2 text-xs text-kb-muted">修改主密码 · 恢复码管理（点击展开/收起）</span>
              </span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={securityOpen ? "rotate-180 transition-transform" : "transition-transform"}
              >
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </button>
            {securityOpen ? (
              <SecurityPanel
                uid={uid}
                masterKey={masterKey}
                kdfSalt={kdfSalt}
                kdfVerifier={kdfVerifier}
                keyEpoch={keyEpoch}
                recoverySalt={recoverySalt}
                recoveryBlob={recoveryBlob}
                recoveryAckAt={recoveryAckAt}
                onRotated={handleRotated}
                onDataChanged={handleDataChanged}
              />
            ) : null}
            </div>
            </div>
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
 * 视图切换按钮（卡片 / 列表）。
 * 选中态与未选中态都只用主题令牌，9 套皮肤与深色模式下自动可读。
 */
function ViewToggleButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`grid h-7 w-7 place-items-center rounded-md transition ${
        active
          ? "bg-kb-surface-2 text-kb-primary"
          : "text-kb-muted hover:bg-kb-surface-2 hover:text-kb-text"
      }`}
    >
      {children}
    </button>
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

/** 解锁面板：输入主密码 → 本机校验 kdf_verifier；可勾选"在这台设备上记住"以支持下次自动解锁。 */
function UnlockPanel({
  value,
  onChange,
  onSubmit,
  unlocking,
  remember,
  onRememberChange,
  rememberedAt,
  onClearRemembered,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  unlocking: boolean;
  remember: boolean;
  onRememberChange: (value: boolean) => void;
  /** 非空表示本机已保存解锁凭据（可一键清除）。 */
  rememberedAt: string | null;
  onClearRemembered: () => void;
}): JSX.Element {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-kb-border bg-kb-surface p-6 shadow-sm dark:border-kb-border dark:bg-kb-surface">
      <h2 className="text-base font-semibold">输入主密码解锁</h2>
      <p className="mt-1 text-sm text-kb-muted">
        主密码只在本机校验，云端没有任何副本。
      </p>
      <form className="mt-4 space-y-3" onSubmit={onSubmit}>
        <input
          type="password"
          value={value}
          autoComplete="current-password"
          onChange={(e) => onChange(e.target.value)}
          placeholder="主密码"
          className="w-full rounded-lg border border-kb-border-strong bg-kb-surface px-3 py-2 text-sm outline-none focus:border-kb-border-strong focus:ring-2 focus:ring-kb-border dark:border-kb-border-strong dark:bg-kb-surface"
        />

        <label className="flex items-start gap-2 text-sm text-kb-muted">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => onRememberChange(e.target.checked)}
            className="mt-1"
          />
          <span>
            在这台设备上记住主密码
            <span className="mt-0.5 block text-xs text-kb-muted">
              下次打开自动解锁。<strong className="font-medium">共享或公用电脑请勿勾选</strong>
              ——勾选后，能打开这台设备的人就能查看你已保存的密钥。
            </span>
          </span>
        </label>

        <button
          type="submit"
          disabled={unlocking}
          className="w-full rounded-lg kb-btn-primary"
        >
          {unlocking ? "校验中…" : "解锁"}
        </button>
      </form>

      {rememberedAt ? (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-kb-border pt-3 text-xs text-kb-muted dark:border-kb-border dark:text-kb-muted">
          <span>本机已保存解锁凭据（{new Date(rememberedAt).toLocaleString()}）</span>
          <button
            type="button"
            onClick={onClearRemembered}
            className="shrink-0 underline hover:no-underline"
          >
            清除
          </button>
        </div>
      ) : null}
    </div>
  );
}
