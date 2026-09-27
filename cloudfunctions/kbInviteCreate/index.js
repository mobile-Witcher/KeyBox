"use strict";
/**
 * kbInviteCreate —— R02：管理员生成一次性邀请码。
 *
 * 为什么不能放前端：前端生成码＝任何人都能自己造码开户。
 *
 * 入参：无（身份取自运行时 auth.getUserInfo()）
 * 返回：{ ok, data: { code, createdAt } } | { ok:false, error }
 */
const crypto = require("crypto");
const { ok, fail, getCaller, pgRequest } = require("./lib");

/** 码值形如 KB-8f2a3c：3 字节随机转 hex（48 bit 熵，足够一次性凭证）。 */
function randomCode() {
  return `KB-${crypto.randomBytes(3).toString("hex")}`;
}

/** 管理员判定：读调用者自己那一行（显式列，不用 select *）。 */
async function assertAdmin(uid) {
  if (!uid) return false;
  const rows = await pgRequest("GET", "kb_users", {
    query: { select: "role,status", uid: `eq.${uid}` },
  });
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows[0].role === "admin" && rows[0].status === "active";
}

exports.main = async () => {
  try {
    const { uid } = getCaller();
    if (!(await assertAdmin(uid))) return fail("NOT_ADMIN");

    const code = randomCode();
    const createdAt = new Date().toISOString();

    // created_at 由数据库默认 now() 写入，这里只回传一个近似时间给前端展示
    await pgRequest("POST", "kb_invites", {
      prefer: "return=minimal",
      body: { code, status: "unused", created_by: uid },
    });

    return ok({ code, createdAt });
  } catch (error) {
    return fail(error && error.message ? error.message : "INTERNAL_ERROR");
  }
};
