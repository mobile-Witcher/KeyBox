"use strict";
/**
 * kbSecretDelete —— R15：删除本人一条密钥记录。
 *
 * 为什么不能放前端：同 upsert，归属必须由服务端判定；删除只允许删自己的行。
 *
 * 入参：{ id }
 * 返回：{ ok, data: { deletedId } } | { ok:false, error }
 *
 * 注意：云函数持服务端凭据（绕过 RLS），故删除条件显式带 owner_id = 会话 uid。
 *   SQL 等价：DELETE FROM kb_secrets WHERE id=$1 AND owner_id=$2;
 */
const { ok, fail, getCaller, pgRequest } = require("./lib");

exports.main = async (event) => {
  try {
    const { uid } = getCaller();
    if (!uid) return fail("NOT_LOGGED_IN");

    const rawId = event && event.id !== undefined && event.id !== null ? event.id : null;
    const id = Number.parseInt(rawId, 10);
    if (!Number.isInteger(id)) return fail("INVALID_ID");

    const deleted = await pgRequest("DELETE", "kb_secrets", {
      query: { id: `eq.${id}`, owner_id: `eq.${uid}` },
      prefer: "return=representation",
    });
    if (!Array.isArray(deleted) || deleted.length === 0) return fail("NOT_FOUND");

    return ok({ deletedId: id });
  } catch (error) {
    return fail(error && error.message ? error.message : "INTERNAL_ERROR");
  }
};
