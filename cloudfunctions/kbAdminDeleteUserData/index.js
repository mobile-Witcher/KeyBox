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
 *   3) ★**禁止自删**：目标 uid == 调用者 uid 时直接回 `CANNOT_DELETE_SELF`，不执行任何删除。
 *      单管理员删到自己 → 用户行变 deleted → kbLogin 拒登、kbInitAdmin 因表非空拒重初始化 →
 *      管理能力永久锁死、无界面可救。前端防呆（不渲染自己那行的按钮）不算安全，服务端必须也拦。
 *      ⚠️ 这是【禁止自删】，不是禁止删别人；删别人的路径保持原样；
 *   4) DELETE 只作用于 `WHERE owner_id = $uid`；
 *      **绝不使用 return=representation / RETURNING payload**——PG 的 RETURNING 会把被删行内容带回
 *      调用方，是很容易踩的泄漏点。删除【单次】完成并用 `Prefer: count=exact` 从响应头取精确行数
 *      （Q3：旧写法 before/after 两次计数相减，非原子）；
 *   5) 返回体**仅 { deletedCount }**，不含任何字段内容；
 *   6) 用户记录**软删** status='deleted'（不硬删）：保留审计痕迹、释放 20 人名额（R22/R26），
 *      且 kbLogin 已在 status!='active' 时拒登，软删即无法登录。
 *
 * ⚠️ 代价（原文写进注释，勿删）：删路径持 service_role **会绕过 RLS**，因此 R10 的
 *   “删除路径不泄露明文”是【代码保证】（本文件不读、不返回 payload），而非数据库保证；
 *   “不可读”仍由【数据库保证】（kb_secrets 的 SELECT 策略不含 is_admin()，管理员用自己的会话
 *   一行都读不到他人密文）。
 */
const { ok, fail, getCaller, pgRequest, ENV_ID } = require("./lib");

/**
 * 单次 DELETE 并取回【精确删除行数】（Q3）。
 *
 * 为什么不用 lib.pgRequest：它只返回响应体，读不到 PostgREST 放在 `Content-Range` 响应头里的计数；
 *   而 lib.js 是 cloudfunctions 下 9 份必须 md5 一致的共享文件，不能只改这一份（会破坏一致性校验）。
 *   故在本函数内本地发这一条 DELETE：`Prefer: return=minimal` 保证【响应体不含任何行内容】，
 *   `count=exact` 让响应头给出精确行数。凭据与网关与 lib 同源（ENV_ID 取自 lib、密钥读同一组环境变量）。
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

    // Q1：服务端自检——【禁止删除自己的数据】。位置：is_admin 之后、任何删除之前。
    //  前端不渲染按钮只是防呆（可被绕过），服务端必须同样拒绝。
    if (callerUid && targetUid === callerUid) return fail("CANNOT_DELETE_SELF");

    // ① 一次 DELETE 删除目标用户全部密钥，并按 owner_id 收口 + 取回精确行数（不 RETURNING 行内容）
    const deletedCount = await deleteWithCount("kb_secrets", { owner_id: `eq.${targetUid}` });

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
