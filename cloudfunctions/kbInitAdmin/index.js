"use strict";
/**
 * kbInitAdmin —— R01：首个管理员初始化（手机号验证码登录后的激活步骤）。
 *
 * 为什么不能放前端：前端判断“有没有管理员”可被绕过，谁都能刷一个 admin；
 *   真正的闸门必须在服务端：表中已有任意用户即拒绝（防二次抢管理员）。
 *
 * 【身份模型变更 2026-09-29】
 *   原设计用"用户名 + 登录密码"由云函数校验并签发自定义登录票据；实测该路径在当前环境不可用
 *   （平台侧自定义登录密钥未登记，服务端恒返回"私钥已过期或私钥不存在"）。
 *   现改为平台原生登录：用户先用手机号验证码登录（auth.signInWithOtp + data.verifyOtp），
 *   拿到平台会话后调用本函数完成激活 —— 因此 **uid 取自平台会话**，不再由云函数生成。
 *   login_hash 写哨兵值（该账号不走密码登录，且哨兵不可能通过任何密码校验）。
 *
 * 入参：{ kdfSalt, kdfVerifier, recoverySalt?, recoveryBlob? }
 *   - kdfSalt / kdfVerifier 由客户端算好（架构 §6.1），主密码本身不上传。
 *   - R28：recoverySalt / recoveryBlob 必须【成对】出现或同时缺省，只收盐与包裹后的密文。
 * 返回：{ ok, data: { uid, role } } | { ok:false, error }
 */
const {
  ok,
  fail,
  getCaller,
  pgRequest,
  pgCount,
  normalizeEvent,
  resolveDisplayName,
  PASSWORD_LOGIN_DISABLED,
} = require("./lib");

exports.main = async (event) => {
  try {
    // 兼容两条调用通道（SDK 直调 / HTTP 网关包装）——见 lib.js 的 normalizeEvent。
    const params = normalizeEvent(event);
    const kdfSalt = String(params.kdfSalt || "");
    const kdfVerifier = String(params.kdfVerifier || "");
    // R28：恢复材料（可选，但必须【成对】）——与 kbRegister 同口径，只收 recoverySalt + recoveryBlob。
    const recoverySalt = String(params.recoverySalt || "");
    const recoveryBlob = String(params.recoveryBlob || "");

    // ① 必须是已登录的平台账号（身份来自运行时注入，绝不信任 event 里的身份字段）
    const caller = getCaller();
    const uid = String(caller.uid || "").trim();
    if (!uid) return fail("NOT_LOGGED_IN");

    if (!kdfSalt || !kdfVerifier) return fail("MISSING_KDF_PARAMS");

    // R28：recoverySalt 与 recoveryBlob 必须同时给出或同时缺省（只给一半＝非法，fail-closed）。
    const hasRecoverySalt = recoverySalt.length > 0;
    const hasRecoveryBlob = recoveryBlob.length > 0;
    if (hasRecoverySalt !== hasRecoveryBlob) return fail("MISSING_RECOVERY_PARAMS");

    // ② 查 kb_users 是否为空（select 显式列，禁止 select *）
    const existing = await pgCount("kb_users", { select: "uid" });
    if (existing > 0) return fail("ALREADY_INITIALIZED");

    const username = await resolveDisplayName(uid);

    // ③ 写入首个管理员（role=admin）；login_hash 写哨兵（该账号不走密码登录）
    await pgRequest("POST", "kb_users", {
      prefer: "return=minimal",
      body: {
        uid,
        username,
        login_hash: PASSWORD_LOGIN_DISABLED,
        role: "admin",
        status: "active",
        kdf_salt: kdfSalt,
        kdf_verifier: kdfVerifier,
        key_epoch: 0,
        // R28：显式写恢复材料（同 kbRegister）；缺省时显式写 null，绝不依赖 DB 默认。
        recovery_salt: hasRecoverySalt ? recoverySalt : null,
        recovery_blob: hasRecoveryBlob ? recoveryBlob : null,
        recovery_created_at: hasRecoveryBlob ? new Date().toISOString() : null,
        recovery_ack_at: null,
      },
    });

    // ④ 并发兜底：若同时写入多个管理员，只保留 uid 字典序最小者，其余自查回滚自身。
    //    这样两个并发请求不会“互相删除”而双双失败，最终恰好剩一个管理员。
    const admins = await pgRequest("GET", "kb_users", {
      query: { select: "uid", role: "eq.admin", order: "uid.asc" },
    });
    if (Array.isArray(admins) && admins.length > 1 && admins[0].uid !== uid) {
      await pgRequest("DELETE", "kb_users", { query: { uid: `eq.${uid}` } });
      return fail("ALREADY_INITIALIZED");
    }

    return ok({ uid, role: "admin" });
  } catch (error) {
    return fail(error && error.message ? error.message : "INTERNAL_ERROR");
  }
};
