"use strict";
/**
 * kbInitAdmin —— R01：首个管理员初始化。
 *
 * 为什么不能放前端：前端判断“有没有管理员”可被绕过，谁都能刷一个 admin；
 *   真正的闸门必须在服务端：表中已有任意用户即拒绝（防二次抢管理员）。
 *
 * 入参：{ username, loginPwd, kdfSalt, kdfVerifier }
 *   - loginPwd 只用于生成 scrypt 哈希（明文不入库）；
 *   - kdfSalt / kdfVerifier 由客户端算好（架构 §6.1），主密码本身不上传。
 * 返回：{ ok, data: { uid, role } } | { ok:false, error }
 */
const { USERNAME_PATTERN, MIN_LOGIN_PWD, ok, fail, pgRequest, pgCount, randomUid, hashLoginPwd } = require("./lib");

exports.main = async (event) => {
  try {
    const username = String((event && event.username) || "").trim();
    const loginPwd = String((event && event.loginPwd) || "");
    const kdfSalt = String((event && event.kdfSalt) || "");
    const kdfVerifier = String((event && event.kdfVerifier) || "");

    if (!USERNAME_PATTERN.test(username)) return fail("INVALID_USERNAME");
    if (loginPwd.length < MIN_LOGIN_PWD) return fail("WEAK_LOGIN_PWD");
    if (!kdfSalt || !kdfVerifier) return fail("MISSING_KDF_PARAMS");

    // ① 查 kb_users 是否为空（select 显式列，禁止 select *）
    const existing = await pgCount("kb_users", { select: "uid" });
    if (existing > 0) return fail("ALREADY_INITIALIZED");

    const uid = randomUid();
    const loginHash = hashLoginPwd(loginPwd);

    // ② 写入首个管理员（role=admin）
    await pgRequest("POST", "kb_users", {
      prefer: "return=minimal",
      body: {
        uid,
        username,
        login_hash: loginHash,
        role: "admin",
        status: "active",
        kdf_salt: kdfSalt,
        kdf_verifier: kdfVerifier,
        key_epoch: 0,
      },
    });

    // ③ 并发兜底：若同时写入多个管理员，只保留 uid 字典序最小者，其余自查回滚自身。
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
