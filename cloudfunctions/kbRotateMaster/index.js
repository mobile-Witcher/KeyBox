"use strict";
/**
 * kbRotateMaster —— R21：改主密码时的【整批重写】本人全部密文（单请求、原子、key_epoch+1）。
 *
 * 为什么必须走云函数、为什么不能放前端：
 *   改主密码会一次性覆盖【全部】记录并同时推进 key_epoch，跨记录的一致性只有服务端能保证；
 *   且 kdf_salt / kdf_salt_prev / kdf_verifier / key_epoch 这几列对客户端【零授权】，客户端根本改不了。
 *
 * 入参：{ kdfSalt, kdfSaltPrev, kdfVerifier, recoveryBlob?, items:[{id,payload}] }
 *   - items：本机用【新】主密钥重加密后的全部新代密文（payload 为 `KB1:` 密文，id 为服务端行 id）；
 *   - kdfSaltPrev：上一代主密码盐（仅用于改主密码失败后的本机回滚窗口，§6.3）；
 *   - recoveryBlob（可选）：若账号已设恢复码，则用【新】主密钥重包裹后的 `KBRC1:` 密文，随本次一并更新。
 * 返回：{ ok, data: { keyEpoch } } | { ok:false, error }
 *
 * ★原子性 / “不逐条提交”：
 *   整批覆盖由数据库函数 public.kb_rotate_master 在【一个事务】内完成（一条
 *   `UPDATE ... FROM jsonb_to_recordset(...)` + 一条 kb_users 更新），故绝不出现“半新半旧”。
 *   本函数只做入参校验，然后把整批交给该函数（单次 /rpc 调用＝单个客户端请求）。
 *   PostgREST 无法在单请求内逐行写不同 payload，故这里必须借数据库函数——详见迁移注释。
 *
 * 安全护栏：
 *   1) 身份取自 auth.getUserInfo()（lib.getCaller），绝不接受 event.uid；
 *   2) 恢复材料只收 recoveryBlob（`KBRC1:` 密文），绝不收恢复码/主密钥明文；
 *   3) 归属校验在数据库函数内完成：传入的每个 id 都必须属于会话 uid，且集合必须与云端当前行【完全一致】
 *      （漏一条＝残留旧代密文＝半新半旧，多一条＝越权，均 fail-closed）。
 *   4) service_role 凭据只从环境变量取，绝不硬编码。
 */
const { ok, fail, getCaller, ENV_ID } = require("./lib");

/** 密文前缀（与 src/lib/crypto.ts 的 SECRET_PREFIX / RECOVERY_PREFIX 一致）。 */
const SECRET_PREFIX = "KB1:";
const RECOVERY_PREFIX = "KBRC1:";

/**
 * 调用数据库函数（PostgREST `/rpc/{fn}`）。
 *
 * 为什么不用 lib.pgRequest：它只拼【表】路径；rpc 走 `/rpc/<函数名>`，
 *   而 lib.js 是 cloudfunctions 下多份必须 md5 一致的共享文件，不宜只改一份。
 *   故在本函数内本地发这一条 rpc：网关与凭据与 lib 同源（ENV_ID 取自 lib，密钥读同一组环境变量）。
 */
async function callRpc(fnName, body) {
  const apiKey = process.env.CLOUDBASE_API_KEY || process.env.CLOUDBASE_APIKEY || "";
  if (!ENV_ID) throw new Error("ENV_ID_MISSING");
  if (!apiKey) throw new Error("SERVICE_CREDENTIAL_MISSING");
  const url = `https://${ENV_ID}.api.tcloudbasegateway.com/v1/rdb/rest/rpc/${fnName}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = text;
    }
  }
  if (!response.ok) {
    const detail = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`PG_${response.status}: ${detail}`);
  }
  return data;
}

/** 把 rpc 返回值（整数 / 数字串 / 单元素数组）规整成整数；非法返回 NaN。 */
function normalizeEpoch(value) {
  let raw = value;
  if (Array.isArray(raw)) {
    const first = raw[0];
    raw = first && typeof first === "object" ? first.kb_rotate_master : first;
  }
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  return Number.isInteger(n) ? n : Number.NaN;
}

/** 校验并规整 items：每条必须是 { id>0, payload 为 `KB1:` 密文 }。 */
function normalizeItems(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const item of input) {
    const id = Number(item && item.id);
    const payload = String((item && item.payload) || "");
    if (!Number.isInteger(id) || id <= 0) return null;
    if (!payload.startsWith(SECRET_PREFIX)) return null;
    out.push({ id, payload });
  }
  return out;
}

exports.main = async (event) => {
  try {
    const { uid } = getCaller();
    if (!uid) return fail("NOT_LOGGED_IN");

    const kdfSalt = String((event && event.kdfSalt) || "");
    const kdfSaltPrev = String((event && event.kdfSaltPrev) || "");
    const kdfVerifier = String((event && event.kdfVerifier) || "");
    const recoveryBlobRaw = String((event && event.recoveryBlob) || "");

    if (!kdfSalt || !kdfVerifier) return fail("MISSING_KDF_PARAMS");

    // 恢复材料若提供，必须是 `KBRC1:` 密文（绝不接受恢复码明文）
    if (recoveryBlobRaw && !recoveryBlobRaw.startsWith(RECOVERY_PREFIX)) {
      return fail("INVALID_RECOVERY_BLOB");
    }

    const items = normalizeItems(event && event.items);
    if (items === null) return fail("INVALID_ITEMS");

    // 整批交给数据库函数（单事务、原子）；归属与集合一致性由函数内校验
    const result = await callRpc("kb_rotate_master", {
      p_uid: uid,
      p_kdf_salt: kdfSalt,
      p_kdf_salt_prev: kdfSaltPrev,
      p_kdf_verifier: kdfVerifier,
      p_recovery_blob: recoveryBlobRaw,
      p_items: items,
    });

    const keyEpoch = normalizeEpoch(result);
    if (!Number.isInteger(keyEpoch)) return fail("ROTATE_NO_EPOCH");
    return ok({ keyEpoch });
  } catch (error) {
    return fail(error && error.message ? error.message : "INTERNAL_ERROR");
  }
};
