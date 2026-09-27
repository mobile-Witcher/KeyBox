"use strict";
/**
 * kbRegister —— R03 / R04 / R22 / R26：邀请码自助注册。
 *
 * 为什么不能放前端：前端判“码能不能用”改代码即可复用；20 人上限在前端等于没有上限。
 *
 * 入参：{ code, username, loginPwd, kdfSalt, kdfVerifier }
 * 返回：{ ok, data: { uid, role, ticket } } | { ok:false, error }
 *
 * 邀请码原子占用（架构 §7）：PG 下单语句条件更新即可，
 *   UPDATE ... WHERE code=$1 AND status='unused' RETURNING id; 返回 0 行＝已被别人占用。
 *   这里用 PostgREST 的 PATCH + status=eq.unused 等价实现。
 */
const {
  USERNAME_PATTERN,
  MIN_LOGIN_PWD,
  USER_LIMIT,
  TICKET_REFRESH_MS,
  TICKET_EXPIRE_MS,
  ok,
  fail,
  getApp,
  pgRequest,
  pgCount,
  randomUid,
  hashLoginPwd,
} = require("./lib");

exports.main = async (event) => {
  try {
    const code = String((event && event.code) || "").trim();
    const username = String((event && event.username) || "").trim();
    const loginPwd = String((event && event.loginPwd) || "");
    const kdfSalt = String((event && event.kdfSalt) || "");
    const kdfVerifier = String((event && event.kdfVerifier) || "");

    if (!code) return fail("INVALID_CODE");
    if (!USERNAME_PATTERN.test(username)) return fail("INVALID_USERNAME");
    if (loginPwd.length < MIN_LOGIN_PWD) return fail("WEAK_LOGIN_PWD");
    if (!kdfSalt || !kdfVerifier) return fail("MISSING_KDF_PARAMS");

    // ① 用户名查重（select 显式列）
    const duplicated = await pgRequest("GET", "kb_users", {
      query: { select: "uid", username: `eq.${username}` },
    });
    if (Array.isArray(duplicated) && duplicated.length > 0) return fail("USERNAME_TAKEN");

    // ② 20 人上限：统计 active 用户数
    const activeCount = await pgCount("kb_users", { select: "uid", status: "eq.active" });
    if (activeCount >= USER_LIMIT) return fail("LIMIT_REACHED");

    const uid = randomUid();

    // ③ 邀请码原子占用：条件更新，返回 0 行即代表已被别人占用（并发下只有一次成功）
    const occupied = await pgRequest("PATCH", "kb_invites", {
      query: { code: `eq.${code}`, status: "eq.unused" },
      prefer: "return=representation",
      body: { status: "used", used_by: uid, used_at: new Date().toISOString() },
    });
    if (!Array.isArray(occupied) || occupied.length === 0) return fail("INVALID_CODE");

    // ④ 建立用户记录（不含主密码任何字段；role 固定 user）
    try {
      await pgRequest("POST", "kb_users", {
        prefer: "return=minimal",
        body: {
          uid,
          username,
          login_hash: hashLoginPwd(loginPwd),
          role: "user",
          status: "active",
          kdf_salt: kdfSalt,
          kdf_verifier: kdfVerifier,
          key_epoch: 0,
        },
      });
    } catch (insertError) {
      // 插入失败（如并发同名）→ 尽力把邀请码还原，避免用户白消耗一个码
      try {
        await pgRequest("PATCH", "kb_invites", {
          query: { code: `eq.${code}`, used_by: `eq.${uid}` },
          prefer: "return=minimal",
          body: { status: "unused", used_by: null, used_at: null },
        });
      } catch (rollbackError) {
        // 还原失败只影响体验，不影响安全；此处吞掉，交由上层报错
      }
      const message = insertError && insertError.message ? insertError.message : "";
      if (message.indexOf("23505") >= 0 || message.toLowerCase().indexOf("duplicate") >= 0) {
        return fail("USERNAME_TAKEN");
      }
      throw insertError;
    }

    // ⑤ R04：校验邀请码后由云函数签发自定义登录票据
    let ticket = "";
    try {
      ticket = getApp().auth().createTicket(uid, {
        refresh: TICKET_REFRESH_MS,
        expire: TICKET_EXPIRE_MS,
      });
    } catch (ticketError) {
      // 私钥未注入时无法签票：注册仍算成功，前端回退到“手动登录”
      ticket = "";
    }

    return ok({ uid, role: "user", ticket });
  } catch (error) {
    return fail(error && error.message ? error.message : "INTERNAL_ERROR");
  }
};
