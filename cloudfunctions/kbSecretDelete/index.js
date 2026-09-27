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

    // ① 先按会话身份确认该行存在（GET 只取 id 列，**绝不把 payload 密文读回服务端内存**）。
    //    这样"是否删到"完全由行数判断，与 kbSecretUpsert 的更新分支同款先查后改风格。
    const owned = await pgRequest("GET", "kb_secrets", {
      query: { select: "id", id: `eq.${id}`, owner_id: `eq.${uid}` },
    });
    if (!Array.isArray(owned) || owned.length === 0) return fail("NOT_FOUND");

    // ② 条件删除；return=minimal 表示不把删掉的行回传（旧写法 return=representation 会把整行读回内存）。
    await pgRequest("DELETE", "kb_secrets", {
      query: { id: `eq.${id}`, owner_id: `eq.${uid}` },
      prefer: "return=minimal",
    });

    return ok({ deletedId: id });
  } catch (error) {
    return fail(error && error.message ? error.message : "INTERNAL_ERROR");
  }
};
