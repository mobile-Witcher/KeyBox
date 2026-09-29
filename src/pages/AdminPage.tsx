/**
 * AdminPage.tsx —— 管理员后台（第 8 步，R02 / R12 / R13 / R14）。
 *
 * 两大区：
 *   1) 邀请码区：生成 / 复制 / 作废 + 已开户数 / 上限 20 与满员提示条（R02）。
 *   2) 用户列表区：uid / 用户名 / 状态 / 注册时间 / 条目数 + 停用启用 + 删除数据 + 二次确认（R12/R13/R14）。
 *
 * 界面纪律：**不得出现任何“查看密钥”入口**；底栏明示“管理员看不到任何人的密钥内容，仅可停用与删除”。
 * 数据来源：列表走直连 RPC、停用走直连 rdb（见 lib/admin.ts）；删除走云函数（唯一 service_role 路径）。
 *
 * “不能停用自己”与“不能删除自己的数据”都是【防呆不是权限】：自己那一行不显示停用/删除按钮，
 * 并提示去找另一个管理员（数据库不拦“停用自己”，但“删除自己”另有服务端自检兜底，见 Q1）。
 *
 * ⚠️ 端到端验证状态：**待控制台配置后验证**（控制台四项操作未完成，登录链路尚无法真跑）。
 */
import { useCallback, useEffect, useState } from "react";
import ThemeToggle from "../components/ThemeToggle";
import { api } from "../lib/api";
import {
  adminDeleteUserData,
  adminListUsers,
  adminSetUserStatus,
  type AdminUserRow,
} from "../lib/admin";
import { getActiveSession } from "../lib/cloudbase";
import { log } from "../lib/log";
import { useSessionGuard } from "../hooks/useSessionGuard";

/** R22：20 人开户上限（与云端 lib.js 的 USER_LIMIT 对应）。 */
const USER_LIMIT = 20;

interface AdminPageProps {
  username: string;
  onSignOut: () => void;
  onBack: () => void;
}

export default function AdminPage({ username, onSignOut, onBack }: AdminPageProps): JSX.Element {
  const [myUid, setMyUid] = useState<string>("");
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);

  // 会话时效：命中即登出（停用/软删/会话失效 → ≤1 分钟生效）
  useSessionGuard(onSignOut);

  useEffect(() => {
    let alive = true;
    (async () => {
      const session = await getActiveSession();
      if (alive && session) setMyUid(session.uid);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const rows = await adminListUsers();
      setUsers(rows);
    } catch (err) {
      log.error("加载用户列表失败", err);
      setError("加载用户列表失败，请稍后重试。");
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // —— 邀请码区 ——
  async function handleCreateInvite(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.inviteCreate();
      if (!res.ok || !res.data) {
        setError(res.error || "生成邀请码失败。");
        return;
      }
      setInviteCode(res.data.code);
      setNotice("已生成一次性邀请码，复制后发给新同事（用一次即失效）。");
    } catch (err) {
      log.error("生成邀请码失败", err);
      setError("生成邀请码失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyInvite(): Promise<void> {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function handleRevokeInvite(): Promise<void> {
    if (!inviteCode) return;
    if (!window.confirm("作废这个邀请码？作废后该码不能再用于注册。")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.inviteRevoke({ code: inviteCode });
      if (!res.ok) {
        setError(res.error || "作废邀请码失败（可能已被使用）。");
        return;
      }
      setInviteCode("");
      setNotice("邀请码已作废。");
    } catch (err) {
      log.error("作废邀请码失败", err);
      setError("作废邀请码失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  // —— 用户列表区 ——
  async function handleToggleStatus(row: AdminUserRow): Promise<void> {
    const next = row.status === "active" ? "disabled" : "active";
    const verb = next === "disabled" ? "停用" : "启用";
    if (next === "disabled") {
      if (!window.confirm(`停用用户「${row.username}」？其已登录会话将在 ≤1 分钟内失效。`)) return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminSetUserStatus(row.uid, next);
      setNotice(`已${verb}用户「${row.username}」。`);
      await reload();
    } catch (err) {
      log.error("更新用户状态失败", err);
      setError(`更新用户状态失败。`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteData(row: AdminUserRow): Promise<void> {
    if (
      !window.confirm(
        `确定删除用户「${row.username}」的全部密钥数据？\n` +
          `将删除其 ${row.item_count} 条记录，并把该用户置为 deleted（无法再登录）。\n` +
          `此操作不可撤销。`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const deletedCount = await adminDeleteUserData(row.uid);
      setNotice(`已删除用户「${row.username}」的 ${deletedCount} 条记录，该用户已置为 deleted。`);
      await reload();
    } catch (err) {
      log.error("删除用户数据失败", err);
      setError("删除用户数据失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  const seatCount = users.length;
  const full = seatCount >= USER_LIMIT;

  return (
    <div className="flex min-h-full flex-col">
      {/* 顶栏 */}
      <header className="flex items-center justify-between border-b border-kb-border px-6 py-3 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <span className="font-semibold">KeyBox · 管理后台</span>
          <button
            type="button"
            onClick={onBack}
            className="rounded px-2 py-1 text-sm text-kb-muted hover:bg-slate-100 dark:text-slate-300 dark:hover:brightness-110"
          >
            ← 返回密钥库
          </button>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-kb-muted">{username}</span>
          <button
            type="button"
            onClick={onSignOut}
            className="rounded px-2 py-1 text-kb-muted hover:bg-slate-100 dark:text-slate-300 dark:hover:brightness-110"
          >
            退出登录
          </button>
          {/* 主题切换固定在右上角（与用户端同一位置） */}
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-6">
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

        {/* 邀请码区（R02） */}
        <section className="rounded-xl border border-kb-border p-5 dark:border-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">邀请码</h2>
            <div className="text-sm text-kb-muted">
              已开户 {seatCount} / 上限 {USER_LIMIT}
            </div>
          </div>
          {full ? (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              已达 {USER_LIMIT} 人上限，无法再开户。如需腾出名额，请“删除数据”将某用户软删（status=deleted）。
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleCreateInvite()}
              disabled={busy || full}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900"
            >
              生成邀请码
            </button>
            {inviteCode ? (
              <>
                <code className="rounded bg-slate-100 px-3 py-1.5 font-mono text-sm dark:bg-slate-800">
                  {inviteCode}
                </code>
                <button
                  type="button"
                  onClick={() => void handleCopyInvite()}
                  className="rounded px-2 py-1 text-sm text-kb-text hover:bg-slate-100 dark:text-slate-200 dark:hover:brightness-110"
                >
                  {copied ? "已复制" : "复制"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRevokeInvite()}
                  disabled={busy}
                  className="rounded px-2 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950"
                >
                  作废
                </button>
              </>
            ) : (
              <span className="text-sm text-kb-muted">尚未生成邀请码。</span>
            )}
          </div>
        </section>

        {/* 用户列表区（R12/R13/R14） */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">用户（{users.length}）</h2>
            <button
              type="button"
              onClick={() => void reload()}
              disabled={busy}
              className="rounded-lg border border-kb-border-strong px-3 py-1.5 text-sm text-kb-text hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:brightness-110"
            >
              刷新
            </button>
          </div>
          {loading ? (
            <p className="text-sm text-kb-muted">正在读取用户列表…</p>
          ) : (
            <UserTable
              users={users}
              myUid={myUid}
              busy={busy}
              onToggle={(row) => void handleToggleStatus(row)}
              onDelete={(row) => void handleDeleteData(row)}
            />
          )}
        </section>
      </main>

      <footer className="border-t border-kb-border px-6 py-2 text-center text-xs text-kb-muted dark:border-slate-700">
        管理员看不到任何人的密钥内容，仅可停用与删除。
      </footer>
    </div>
  );
}

/** 用户列表（白名单字段：uid / username / status / created_at / item_count）。
 *  导出以便单测直接渲染（见 AdminPage.test.ts）。 */
export function UserTable({
  users,
  myUid,
  busy,
  onToggle,
  onDelete,
}: {
  users: AdminUserRow[];
  myUid: string;
  busy: boolean;
  onToggle: (row: AdminUserRow) => void;
  onDelete: (row: AdminUserRow) => void;
}): JSX.Element {
  if (users.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-kb-border-strong p-8 text-center text-sm text-kb-muted dark:border-slate-600">
        暂无用户。
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-kb-border">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-slate-100 text-kb-muted dark:bg-slate-800 dark:text-slate-300">
          <tr>
            <th className="px-3 py-2 font-medium">用户名</th>
            <th className="px-3 py-2 font-medium">状态</th>
            <th className="px-3 py-2 font-medium">注册时间</th>
            <th className="px-3 py-2 font-medium">条目数</th>
            <th className="px-3 py-2 font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((row) => {
            const isSelf = row.uid === myUid && myUid !== "";
            const active = row.status === "active";
            return (
              <tr key={row.uid} className="border-t border-kb-border">
                <td className="px-3 py-2">
                  <div className="font-medium">{row.username || "（未命名）"}</div>
                  <div className="font-mono text-xs text-kb-muted">{row.uid}</div>
                </td>
                <td className="px-3 py-2">
                  {active ? (
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      正常
                    </span>
                  ) : (
                    <span className="rounded bg-slate-200 px-2 py-0.5 text-xs text-kb-muted dark:bg-slate-700 dark:text-slate-300">
                      已停用
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-kb-muted">
                  {formatTime(row.created_at)}
                </td>
                <td className="px-3 py-2 text-kb-muted">{row.item_count}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {isSelf ? (
                    // 自己那一行：停用与删除数据都【不渲染】，复用“停用”那套防呆文案风格。
                    // 删除自己的数据会把唯一管理员锁死（无界面可救），故这里只是防呆的一层；
                    // 服务端另有 CANNOT_DELETE_SELF 自检兜底（前端防呆不算安全）。
                    <div className="space-y-0.5">
                      <span className="block text-xs text-kb-muted">
                        （不能停用自己，请用另一个管理员操作）
                      </span>
                      <span className="block text-xs text-kb-muted">
                        （不能删除自己的数据，请联系另一位管理员）
                      </span>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onToggle(row)}
                        className="mr-1 rounded px-2 py-1 text-xs text-kb-text hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:brightness-110"
                      >
                        {active ? "停用" : "启用"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onDelete(row)}
                        className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950"
                      >
                        删除数据
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 把 ISO 时间格式化为本地可读短串；解析失败原样返回。 */
function formatTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso || "—";
  return new Date(t).toLocaleString();
}
