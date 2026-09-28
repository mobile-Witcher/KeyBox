"use strict";
/**
 * kbAckRecovery —— R28：写入 recovery_ack_at（用户勾选“我已抄下并自行保管”）。
 *
 * 为什么不能放前端：recovery_ack_at 列对客户端【零授权】，前端改不了；
 *   且“是否已确认”决定前端是否持续提醒，必须由服务端作为真相来源。
 *
 * 入参：无（身份取自运行时 auth.getUserInfo()）
 * 返回：{ ok, data: { ackedAt } } | { ok:false, error }
 *
 * 幂等：重复确认覆盖为最新时间即可（多次点击无害）。
 * 只写【本人】那一行；只提交 { recovery_ack_at } 单列，绝不动其他列。
 */
const { ok, fail, getCaller, pgRequest } = require("./lib");

exports.main = async () => {
  try {
    const { uid } = getCaller();
    if (!uid) return fail("NOT_LOGGED_IN");

    // 先确认本人行存在（显式列，避免 return=representation 把整行敏感列带回内存）
    const rows = await pgRequest("GET", "kb_users", {
      query: { select: "uid", uid: `eq.${uid}` },
    });
    if (!Array.isArray(rows) || rows.length === 0) return fail("USER_NOT_FOUND");

    const ackedAt = new Date().toISOString();
    await pgRequest("PATCH", "kb_users", {
      query: { uid: `eq.${uid}` },
      prefer: "return=minimal",
      body: { recovery_ack_at: ackedAt },
    });

    return ok({ ackedAt });
  } catch (error) {
    return fail(error && error.message ? error.message : "INTERNAL_ERROR");
  }
};
