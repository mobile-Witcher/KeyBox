"use strict";
/**
 * kbRegister —— R03 / R04 / R22 / R26：邀请码自助注册。
 *
 * 为什么不能放前端：前端判“码能不能用”改代码即可复用；20 人上限在前端等于没有上限。
 *
 * 入参：{ code, username, loginPwd, kdfSalt, kdfVerifier, recoverySalt?, recoveryBlob? }
 *   - R28：recoverySalt / recoveryBlob 必须【成对】出现——要么都给（客户端已生成恢复码并包裹主密钥），
 *     要么都缺（先开户，稍后由前端引导补设）。只给一半视为非法（fail-closed）。
 *   - 此处只收“盐 + 包裹后的密文”，绝不收恢复码明文。
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
  normalizeEvent,
} = require("./lib");

exports.main = async (event) => {
  try {
    // 兼容两条调用通道（SDK 直调 / HTTP 网关包装）——见 lib.js 的 normalizeEvent。
    const params = normalizeEvent(event);
    const code = String(params.code || "").trim();
    const username = String(params.username || "").trim();
    const loginPwd = String(params.loginPwd || "");
    const kdfSalt = String(params.kdfSalt || "");
    const kdfVerifier = String(params.kdfVerifier || "");
    // R28：恢复材料（可选，但必须【成对】）——客户端生成恢复码后，用其独立派生的恢复密钥把主密钥
    //   包裹成 `KBRC1:` 密文；云函数只收 recoverySalt + recoveryBlob，绝不收恢复码明文本身。
    const recoverySalt = String(params.recoverySalt || "");
    const recoveryBlob = String(params.recoveryBlob || "");

    if (!code) return fail("INVALID_CODE");
    if (!USERNAME_PATTERN.test(username)) return fail("INVALID_USERNAME");
    if (loginPwd.length < MIN_LOGIN_PWD) return fail("WEAK_LOGIN_PWD");
    if (!kdfSalt || !kdfVerifier) return fail("MISSING_KDF_PARAMS");

    // R28：recoverySalt 与 recoveryBlob 必须同时给出或同时缺省（只给一半＝非法，fail-closed）。
    const hasRecoverySalt = recoverySalt.length > 0;
    const hasRecoveryBlob = recoveryBlob.length > 0;
    if (hasRecoverySalt !== hasRecoveryBlob) return fail("MISSING_RECOVERY_PARAMS");

    // ① 用户名查重（select 显式列）
    const duplicated = await pgRequest("GET", "kb_users", {
      query: { select: "uid", username: `eq.${username}` },
    });
    if (Array.isArray(duplicated) && duplicated.length > 0) return fail("USERNAME_TAKEN");

    // ② 20 人上限（R22/R26）：统计 status <> 'deleted' 的用户数
    //    软删（status='deleted'）的用户【释放名额】，故用 neq.deleted 而非 eq.active
    const usedSeats = await pgCount("kb_users", { select: "uid", status: "neq.deleted" });
    if (usedSeats >= USER_LIMIT) return fail("LIMIT_REACHED");

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
          // R28：显式写恢复材料（绝不为空时依赖 DB 默认；service_role 无用户 JWT，DEFAULT 亦不可靠）。
          //   未提供恢复码时显式写 null（允许先开户、稍后补设）；recovery_ack_at 显式写 null 表示
          //   “尚未确认”，待用户勾选“我已抄下并自行保管”后由 kbAckRecovery 写入时间戳。
          recovery_salt: hasRecoverySalt ? recoverySalt : null,
          recovery_blob: hasRecoveryBlob ? recoveryBlob : null,
          recovery_created_at: hasRecoveryBlob ? new Date().toISOString() : null,
          recovery_ack_at: null,
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
