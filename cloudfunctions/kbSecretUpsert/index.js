"use strict";
/**
 * kbSecretUpsert —— R08 / R15：新增或更新一条密钥记录（云端只存 payload 密文）。
 *
 * 为什么不能放前端：归属标记（owner_id）若由前端传＝谁都能把记录挂到别人名下。
 *   故写入时 **owner_id 一律用服务端会话身份**，忽略入参里任何 owner 值（架构 §7 / §4.4 第二层）。
 *
 * 入参：{ id?, payload, keyEpoch }
 *   - 无 id → 新增；有 id → 更新（更新前先校验该条 owner_id 等于会话 uid）。
 *   - payload 必须是 `KB1:` 开头的密文（明文永不进本函数）。
 * 返回：{ ok, data: { id, updatedAt } } | { ok:false, error }
 *
 * 注意：云函数走服务端凭据（service_role，绕过 RLS），因此 RLS 不会替我们兜底，
 *   归属校验与 owner_id 赋值都在本函数内显式完成（这是刻意设计，见架构 §7）。
 */
const { ok, fail, getCaller, pgRequest } = require("./lib");

const PAYLOAD_PREFIX = "KB1:";
const MAX_PAYLOAD_LEN = 200000;

exports.main = async (event) => {
  try {
    const { uid } = getCaller();
    if (!uid) return fail("NOT_LOGGED_IN");

    const payload = String((event && event.payload) || "");
    const rawEpoch = event && event.keyEpoch !== undefined && event.keyEpoch !== null ? event.keyEpoch : 0;
    const keyEpoch = Number.parseInt(rawEpoch, 10);
    const rawId = event && event.id !== undefined && event.id !== null ? event.id : null;

    if (!payload.startsWith(PAYLOAD_PREFIX)) return fail("INVALID_PAYLOAD");
    if (payload.length > MAX_PAYLOAD_LEN) return fail("PAYLOAD_TOO_LARGE");
    if (!Number.isInteger(keyEpoch) || keyEpoch < 0) return fail("INVALID_KEY_EPOCH");

    const nowIso = new Date().toISOString(); // updated_at 用服务端时间

    // —— 更新分支 ——
    if (rawId !== null) {
      const id = Number.parseInt(rawId, 10);
      if (!Number.isInteger(id)) return fail("INVALID_ID");

      // ① 更新前先确认该条属于会话 uid（select 显式列，禁止 select *）
      const owned = await pgRequest("GET", "kb_secrets", {
        query: { select: "id", id: `eq.${id}`, owner_id: `eq.${uid}` },
      });
      if (!Array.isArray(owned) || owned.length === 0) return fail("NOT_FOUND");

      // ② 条件更新（带 owner_id 过滤，双保险）
      const updated = await pgRequest("PATCH", "kb_secrets", {
        query: { id: `eq.${id}`, owner_id: `eq.${uid}` },
        prefer: "return=representation",
        body: { payload, key_epoch: keyEpoch, updated_at: nowIso },
      });
      if (!Array.isArray(updated) || updated.length === 0) return fail("NOT_FOUND");

      const row = updated[0];
      return ok({ id: row.id, updatedAt: row.updated_at });
    }

    // —— 新增分支：owner_id 用服务端身份，忽略入参 ——
    const inserted = await pgRequest("POST", "kb_secrets", {
      prefer: "return=representation",
      body: { owner_id: uid, payload, key_epoch: keyEpoch, updated_at: nowIso },
    });
    const row = Array.isArray(inserted) && inserted.length > 0 ? inserted[0] : null;
    return ok({ id: row ? row.id : null, updatedAt: row ? row.updated_at : nowIso });
  } catch (error) {
    return fail(error && error.message ? error.message : "INTERNAL_ERROR");
  }
};
