"use strict";
/**
 * kbGetMyRole —— R11 / R26：按会话 uid 只返回本人 role/status/密钥参数/用户数。
 *
 * 为什么不能放前端：前端本地写死 isAdmin=true 就能拿到管理员能力；角色判定必须服务端做。
 *
 * 入参：无（身份取自运行时 auth.getUserInfo()）
 * 返回：{ ok, data: { role, status, kdfSalt, kdfVerifier, keyEpoch, recoverySalt, recoveryBlob, recoveryAckAt, userCount } }
 *       | { ok:false, error }
 *
 * 注意：
 *   - status 原样返回（不因 disabled 报错），因为客户端每 60 秒轮询要能发现“已被停用”（R13 本机窗口）。
 *   - kdfSalt / kdfVerifier 返回给“用户本人”是设计使然：本机需要它们来校验主密码（架构 §6.2）。
 *   - R28：recoverySalt / recoveryBlob 也只返回给“用户本人”（修复/换主密码流程在本机需要它们解回主密钥）；
 *     recoveryAckAt 供前端判断是否仍要“恢复码未确认”的持续提醒（为 null ⇒ 未确认）。
 *     这三者【绝不出现在】管理员用户列表（kb_admin_user_list()）里。
 *   - select 显式列，禁止 select *；绝不返回 login_hash。
 */
const { ok, fail, getCaller, pgRequest, pgCount } = require("./lib");

exports.main = async () => {
  try {
    const { uid } = getCaller();
    if (!uid) return fail("NOT_LOGGED_IN");

    const rows = await pgRequest("GET", "kb_users", {
      query: {
        select: "role,status,kdf_salt,kdf_verifier,key_epoch,recovery_salt,recovery_blob,recovery_ack_at",
        uid: `eq.${uid}`,
      },
    });
    if (!Array.isArray(rows) || rows.length === 0) return fail("USER_NOT_FOUND");

    const row = rows[0];
    const userCount = await pgCount("kb_users", { select: "uid", status: "eq.active" });

    return ok({
      role: row.role,
      status: row.status,
      kdfSalt: row.kdf_salt,
      kdfVerifier: row.kdf_verifier,
      keyEpoch: row.key_epoch,
      recoverySalt: row.recovery_salt,
      recoveryBlob: row.recovery_blob,
      recoveryAckAt: row.recovery_ack_at,
      userCount,
    });
  } catch (error) {
    return fail(error && error.message ? error.message : "INTERNAL_ERROR");
  }
};
