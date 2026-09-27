"use strict";
/**
 * kbAdminDeleteUserData —— R10 / R14：删除【某一个】用户的全部密钥数据（管理员操作）。
 *
 * 为什么必须走云函数（全项目唯一持 service_role 的地方）：
 *   删除要按 owner_id 批量删【他人】的行，而 RLS 的 DELETE 策略 `USING(is_admin())` 对【全表】为真，
 *   直连 = “无范围删除”——前端一旦漏写 `.eq('owner_id', ...)` 就会误删全库密文且不可恢复。
 *   云函数把影响范围按“单个 uid”在服务端收口。
 *
 * 入参：{ uid } —— 目标用户 uid，**仅此一个**（按构造限制影响范围）
 * 返回：{ ok, data: { deletedCount } } | { ok:false, error }
 *
 * 安全护栏（逐条对应验收）：
 *   1) 身份取自 auth.getUserInfo()（lib.getCaller），**绝不接受 event.uid 当作“我是谁”**；
 *   2) 函数内先 is_admin() 自检（只查调用者自己那一行的 role/status）；
 *   3) DELETE 只作用于 `WHERE owner_id = $uid`；
 *      **绝不使用 return=representation / RETURNING payload**——PG 的 RETURNING 会把被删行内容带回
 *      调用方，是很容易踩的泄漏点。删除后计数改用 pgCount 前后差，**只为拿行数，不拿内容**；
 *   4) 返回体**仅 { deletedCount }**，不含任何字段内容；
 *   5) 用户记录**软删** status='deleted'（不硬删）：保留审计痕迹、释放 20 人名额（R22/R26），
 *      且 kbLogin 已在 status!='active' 时拒登，软删即无法登录。
 *
 * ⚠️ 代价（原文写进注释，勿删）：删路径持 service_role **会绕过 RLS**，因此 R10 的
 *   “删除路径不泄露明文”是【代码保证】（本文件不读、不返回 payload），而非数据库保证；
 *   “不可读”仍由【数据库保证】（kb_secrets 的 SELECT 策略不含 is_admin()，管理员用自己的会话
 *   一行都读不到他人密文）。
 */
const { ok, fail, getCaller, pgRequest, pgCount } = require("./lib");

/** 管理员判定：读调用者自己那一行（显式列，不用 select *）。 */
async function isAdmin(uid) {
  if (!uid) return false;
  const rows = await pgRequest("GET", "kb_users", {
    query: { select: "role,status", uid: `eq.${uid}` },
  });
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows[0].role === "admin" && rows[0].status === "active";
}

exports.main = async (event) => {
  try {
    const { uid: callerUid } = getCaller();
    if (!(await isAdmin(callerUid))) return fail("NOT_ADMIN");

    const targetUid = String((event && event.uid) || "").trim();
    if (!targetUid) return fail("MISSING_UID");

    // ① 删除目标用户全部密钥：按 owner_id 收口，服务端计数（不 RETURNING 行内容）
    const before = await pgCount("kb_secrets", { select: "id", owner_id: `eq.${targetUid}` });
    await pgRequest("DELETE", "kb_secrets", {
      query: { owner_id: `eq.${targetUid}` },
      prefer: "return=minimal", // ⚠️ 绝不用 return=representation（会带回被删行内容）
    });
    const after = await pgCount("kb_secrets", { select: "id", owner_id: `eq.${targetUid}` });
    const deletedCount = Math.max(0, before - after);

    // ② 用户记录软删（保留审计痕迹；kbLogin 拒登；名额统计按 status<>'deleted'）
    await pgRequest("PATCH", "kb_users", {
      query: { uid: `eq.${targetUid}` },
      prefer: "return=minimal",
      body: { status: "deleted" },
    });

    return ok({ deletedCount });
  } catch (error) {
    return fail(error && error.message ? error.message : "INTERNAL_ERROR");
  }
};
