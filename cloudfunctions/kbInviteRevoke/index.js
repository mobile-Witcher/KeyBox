"use strict";
/**
 * kbInviteRevoke —— R02：管理员作废邀请码（仅 unused 可作废）。
 *
 * 为什么不能放前端：同上，前端改码状态＝码可被无限复用。
 *
 * 入参：{ codeId } 或 { code }（codeId 为 kb_invites.id）
 * 返回：{ ok, data: { codeId } } | { ok:false, error }
 */
const { ok, fail, getCaller, pgRequest } = require("./lib");

async function assertAdmin(uid) {
  if (!uid) return false;
  const rows = await pgRequest("GET", "kb_users", {
    query: { select: "role,status", uid: `eq.${uid}` },
  });
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows[0].role === "admin" && rows[0].status === "active";
}

exports.main = async (event) => {
  try {
    const { uid } = getCaller();
    if (!(await assertAdmin(uid))) return fail("NOT_ADMIN");

    const codeId = event && event.codeId !== undefined && event.codeId !== null ? event.codeId : null;
    const code = event && event.code ? String(event.code) : "";

    const query = { status: "eq.unused" };
    if (codeId !== null) {
      query.id = `eq.${codeId}`;
    } else if (code) {
      query.code = `eq.${code}`;
    } else {
      return fail("MISSING_CODE");
    }

    const updated = await pgRequest("PATCH", "kb_invites", {
      query,
      prefer: "return=representation",
      body: { status: "revoked" },
    });
    if (!Array.isArray(updated) || updated.length === 0) return fail("NOT_FOUND_OR_NOT_UNUSED");

    return ok({ codeId: updated[0].id });
  } catch (error) {
    return fail(error && error.message ? error.message : "INTERNAL_ERROR");
  }
};
