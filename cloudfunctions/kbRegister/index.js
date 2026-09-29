"use strict";
/**
 * kbRegister —— R03 / R04 / R22 / R26：邀请码自助注册（手机号登录后的激活步骤）。
 *
 * 为什么不能放前端：前端判“码能不能用”改代码即可复用；20 人上限在前端等于没有上限。
 *
 * 【身份模型变更 2026-09-29】
 *   原设计由本函数生成 uid 并签发自定义登录票据；实测该路径在当前环境不可用
 *   （平台侧自定义登录密钥未登记）。现改为平台原生手机号验证码登录：
 *   用户先登录拿到平台会话，再带邀请码调用本函数完成激活 —— 因此 **uid 取自平台会话**。
 *   幂等：该 uid 已激活则直接返回成功（重复提交不报错，也绝不覆盖既有加密材料）。
 *
 * 入参：{ code, kdfSalt, kdfVerifier, recoverySalt?, recoveryBlob? }
 *   - R28：recoverySalt / recoveryBlob 必须【成对】出现——要么都给（客户端已生成恢复码并包裹主密钥），
 *     要么都缺（先开户，稍后由前端引导补设）。只给一半视为非法（fail-closed）。
 *   - 此处只收“盐 + 包裹后的密文”，绝不收恢复码明文。
 * 返回：{ ok, data: { uid, role } } | { ok:false, error }
 *
 * 邀请码原子占用（架构 §7）：PG 下单语句条件更新即可，
 *   UPDATE ... WHERE code=$1 AND status='unused' RETURNING id; 返回 0 行＝已被别人占用。
 *   这里用 PostgREST 的 PATCH + status=eq.unused 等价实现。
 */
const {
  USER_LIMIT,
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
    const code = String(params.code || "").trim();
    const kdfSalt = String(params.kdfSalt || "");
    const kdfVerifier = String(params.kdfVerifier || "");
    // R28：恢复材料（可选，但必须【成对】）——客户端生成恢复码后，用其独立派生的恢复密钥把主密钥
    //   包裹成 `KBRC1:` 密文；云函数只收 recoverySalt + recoveryBlob，绝不收恢复码明文本身。
    const recoverySalt = String(params.recoverySalt || "");
    const recoveryBlob = String(params.recoveryBlob || "");

    // ① 必须是已登录的平台账号（身份来自运行时注入，绝不信任 event 里的身份字段）
    const caller = getCaller();
    const uid = String(caller.uid || "").trim();
    if (!uid) return fail("NOT_LOGGED_IN");

    if (!code) return fail("INVALID_CODE");
    if (!kdfSalt || !kdfVerifier) return fail("MISSING_KDF_PARAMS");

    // R28：recoverySalt 与 recoveryBlob 必须同时给出或同时缺省（只给一半＝非法，fail-closed）。
    const hasRecoverySalt = recoverySalt.length > 0;
    const hasRecoveryBlob = recoveryBlob.length > 0;
    if (hasRecoverySalt !== hasRecoveryBlob) return fail("MISSING_RECOVERY_PARAMS");

    // ② 幂等：该平台账号已激活则直接返回既有身份（重复提交不报错，也不覆盖加密材料）
    const already = await pgRequest("GET", "kb_users", {
      query: { select: "uid,role,status", uid: `eq.${uid}` },
    });
    if (Array.isArray(already) && already.length > 0) {
      return ok({ uid, role: already[0].role, alreadyActivated: true });
    }

    // ③ 20 人上限（R22/R26）：统计 status <> 'deleted' 的用户数
    //    软删（status='deleted'）的用户【释放名额】，故用 neq.deleted 而非 eq.active
    const usedSeats = await pgCount("kb_users", { select: "uid", status: "neq.deleted" });
    if (usedSeats >= USER_LIMIT) return fail("LIMIT_REACHED");

    // ④ 邀请码原子占用：条件更新，返回 0 行即代表已被别人占用（并发下只有一次成功）
    const occupied = await pgRequest("PATCH", "kb_invites", {
      query: { code: `eq.${code}`, status: "eq.unused" },
      prefer: "return=representation",
      body: { status: "used", used_by: uid, used_at: new Date().toISOString() },
    });
    if (!Array.isArray(occupied) || occupied.length === 0) return fail("INVALID_CODE");

    const username = await resolveDisplayName(uid);

    // ⑤ 建立用户记录（不含主密码任何字段；role 固定 user；login_hash 为哨兵）
    try {
      await pgRequest("POST", "kb_users", {
        prefer: "return=minimal",
        body: {
          uid,
          username,
          login_hash: PASSWORD_LOGIN_DISABLED,
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
      // 插入失败（如并发同 uid）→ 尽力把邀请码还原，避免用户白消耗一个码
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
        // 并发下已被同一账号抢先写入 → 视为已激活成功（幂等）
        return ok({ uid, role: "user", alreadyActivated: true });
      }
      throw insertError;
    }

    // ⑥ 平台登录态已存在（手机号验证码登录），无需再签发自定义票据
    return ok({ uid, role: "user" });
  } catch (error) {
    return fail(error && error.message ? error.message : "INTERNAL_ERROR");
  }
};
