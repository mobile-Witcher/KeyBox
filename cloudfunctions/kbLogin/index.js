"use strict";
/**
 * kbLogin —— R05 / R13：登录密码校验在云端，通过后签发自定义登录票据。
 *
 * 为什么不能放前端：登录密码校验放前端＝把哈希交出去；停用状态放前端＝停用形同虚设。
 *
 * 入参：{ username, loginPwd }
 * 返回：{ ok, data: { ticket, uid, role } } | { ok:false, error }
 *
 * 校验顺序：查用户 → scrypt 恒定时间比对 → status!=='active' 拒绝 → 签票。
 */
const { TICKET_REFRESH_MS, TICKET_EXPIRE_MS, ok, fail, getApp, pgRequest, verifyLoginPwd, normalizeEvent } = require("./lib");

exports.main = async (event) => {
  try {
    // 兼容两条调用通道（SDK 直调 / HTTP 网关包装）——见 lib.js 的 normalizeEvent。
    const params = normalizeEvent(event);
    const username = String(params.username || "").trim();
    const loginPwd = String(params.loginPwd || "");
    if (!username || !loginPwd) return fail("MISSING_FIELDS");

    // ① 查用户（显式列：只取校验必需字段）
    const rows = await pgRequest("GET", "kb_users", {
      query: { select: "uid,login_hash,role,status", username: `eq.${username}` },
    });
    if (!Array.isArray(rows) || rows.length === 0) return fail("INVALID_CREDENTIALS");

    const user = rows[0];

    // ② scrypt 比对（恒定时间）；失败与“用户不存在”返回同一错误码，避免枚举用户名
    if (!verifyLoginPwd(loginPwd, user.login_hash)) return fail("INVALID_CREDENTIALS");

    // ③ 停用/删除一律拒绝（R13）
    if (user.status !== "active") return fail("ACCOUNT_DISABLED");

    // ④ 通过才签发自定义登录票据
    let ticket = "";
    try {
      ticket = getApp().auth().createTicket(user.uid, {
        refresh: TICKET_REFRESH_MS,
        expire: TICKET_EXPIRE_MS,
      });
    } catch (ticketError) {
      // 注意：云函数内**不得**使用 console.*（见 src/lib/step8Security.test.ts，
      // 防止敏感值经日志外泄）。此处保留静默失败；如需临时诊断，
      // 请在放行该测试后短暂启用日志，用完立即回收。
      return fail("TICKET_UNAVAILABLE");
    }
    if (!ticket) return fail("TICKET_UNAVAILABLE");

    return ok({ ticket, uid: user.uid, role: user.role });
  } catch (error) {
    return fail(error && error.message ? error.message : "INTERNAL_ERROR");
  }
};
