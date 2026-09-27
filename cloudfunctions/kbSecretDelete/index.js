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
 *
 * Q3：改为【单次】DELETE——用 `Prefer: count=exact` 从响应头取精确行数判断是否删到（0 行=NOT_FOUND），
 *   `return=minimal` 保证响应体不含任何行内容；不再“先 GET 取行数 + 再 DELETE”两次请求。
 */
const { ok, fail, getCaller, ENV_ID } = require("./lib");

/**
 * 单次 DELETE 并取回【精确删除行数】。
 *
 * 为什么不用 lib.pgRequest：它只返回响应体，读不到 PostgREST 放在 `Content-Range` 响应头里的计数；
 *   而 lib.js 是 cloudfunctions 下 9 份必须 md5 一致的共享文件，不能只改这一份（会破坏一致性校验）。
 *   故在本函数内本地发这一条 DELETE：`return=minimal`（响应体不含任何行内容）+ `count=exact`（响应头给行数）。
 *   凭据与网关与 lib 同源（ENV_ID 取自 lib、密钥读同一组环境变量）。
 *
 * @returns 被删除的精确行数（Content-Range 形如 `*\/<count>`；解析不到时安全回落 0）。
 */
async function deleteWithCount(pathname, query) {
  const apiKey = process.env.CLOUDBASE_API_KEY || process.env.CLOUDBASE_APIKEY || "";
  if (!ENV_ID) throw new Error("ENV_ID_MISSING");
  if (!apiKey) throw new Error("SERVICE_CREDENTIAL_MISSING");
  const url = new URL(`https://${ENV_ID}.api.tcloudbasegateway.com/v1/rdb/rest/${pathname}`);
  const map = query || {};
  Object.keys(map).forEach((key) => {
    const value = map[key];
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  const response = await fetch(url.toString(), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal, count=exact",
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PG_${response.status}: ${text}`);
  }
  const range = response.headers.get("content-range") || response.headers.get("Content-Range") || "";
  const total = Number.parseInt(range.split("/").pop() || "", 10);
  return Number.isFinite(total) ? total : 0;
}

exports.main = async (event) => {
  try {
    const { uid } = getCaller();
    if (!uid) return fail("NOT_LOGGED_IN");

    const rawId = event && event.id !== undefined && event.id !== null ? event.id : null;
    const id = Number.parseInt(rawId, 10);
    if (!Number.isInteger(id)) return fail("INVALID_ID");

    // 单次 DELETE：条件显式带 owner_id = 会话 uid（绕过 RLS 时归属仍由服务端收口）。
    const deletedCount = await deleteWithCount("kb_secrets", { id: `eq.${id}`, owner_id: `eq.${uid}` });
    if (deletedCount === 0) return fail("NOT_FOUND");

    return ok({ deletedId: id });
  } catch (error) {
    return fail(error && error.message ? error.message : "INTERNAL_ERROR");
  }
};
