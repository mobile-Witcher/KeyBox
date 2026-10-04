/**
 * admin.ts —— 管理员后台的数据访问（第 8 步，R12 / R13 / R14）。
 *
 * 设计（架构 §7.1）：能交给数据库做的一律直连、不套云函数——
 *   - R12 用户列表：直连 RPC `kb_admin_user_list()`（DEFINER，函数体内已 is_admin() 自检，
 *     EXECUTE 只授 authenticated/service_role）。再包一层云函数只会多一个持凭据者，纯增敞口。
 *   - R13 停用/启用：直连 rdb 更新（数据库已有「可改他人行」策略 + 「只可改 status 一列」列级 GRANT）。
 *   - R14 删除数据：**唯一**走云函数（持 service_role，按单个 uid 收口）。
 *
 * 前端只渲染白名单字段；即使后端多返回也不使用（纵深防御）。
 */
import { api } from "./api";
import { db } from "./cloudbase";
import { log } from "./log";

/** R12 返回行（白名单字段；后端 kb_admin_user_list() 已限定）。 */
export interface AdminUserRow {
  uid: string;
  username: string;
  status: string;
  created_at: string;
  item_count: number;
}

/** R13 可提交的状态：active=正常；disabled=停用。（deleted 由 R14 云函数写入，客户端不可设。） */
export type UserStatus = "active" | "disabled";

/**
 * rdb 客户端的收窄类型：`.rpc()` 与 `.update().eq()` 在 SDK 类型声明里未暴露，
 * 这里显式收窄，避免依赖未声明的类型形状（方法名与 Supabase 风格一致，已核实）。
 */
interface RdbResult {
  data: unknown;
  error: { message?: string } | null;
}
interface RdbClient {
  rpc: (fn: string) => Promise<RdbResult>;
  from: (table: string) => {
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: string) => Promise<{ error: { message?: string } | null }>;
    };
  };
}
const rdb = db as unknown as RdbClient;

/** R12：直连 RPC 读取用户列表（管理员）。仅保留白名单字段。 */
export async function adminListUsers(): Promise<AdminUserRow[]> {
  const { data, error } = await rdb.rpc("kb_admin_user_list");
  if (error) {
    log.error("读取用户列表失败", error);
    throw new Error(error.message || "LIST_FAILED");
  }
  const rows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
  return rows.map((row) => ({
    uid: String(row.uid ?? ""),
    username: String(row.username ?? ""),
    status: String(row.status ?? ""),
    created_at: String(row.created_at ?? ""),
    item_count: Number(row.item_count ?? 0),
  }));
}

/**
 * R13：直连更新【某个】用户的 status。
 * ⚠️ 只提交 `{ status }` 一个字段（禁止整行对象）；**必须带 `.eq('uid', uid)`**（无过滤＝全表更新）。
 * 「不能停用自己」是防呆、不是权限，由 UI 层保证（数据库故意不拦，保留“另一管理员可恢复”的逃生口）。
 */
export async function adminSetUserStatus(uid: string, status: UserStatus): Promise<void> {
  if (!uid) throw new Error("MISSING_UID");
  const { error } = await rdb.from("kb_users").update({ status }).eq("uid", uid);
  if (error) {
    log.error("更新用户状态失败", error);
    throw new Error(error.message || "UPDATE_FAILED");
  }
}

/** R14：经云函数删除某用户全部密钥数据（service_role 收口），返回删除条数。 */
export async function adminDeleteUserData(uid: string): Promise<number> {
  if (!uid) throw new Error("MISSING_UID");
  const res = await api.adminDeleteUserData({ uid });
  if (!res.ok || !res.data) throw new Error(res.error || "DELETE_FAILED");
  return res.data.deletedCount;
}
