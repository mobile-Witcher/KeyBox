#!/usr/bin/env node
/**
 * scripts/rescue-admin.js —— KeyBox 本地救援脚本（"账号救援"，非云函数 / 非 CI / 不被任何代码调用）。
 *
 * ⚠️ 红线（必须在每次运行前默念）：
 *   1) 本脚本**只恢复"账号能登录"**；能否解密数据完全取决于用户手上的 主密码 / 恢复码 / 备份，
 *      **云端永远解不开**。主密码 + 恢复码 + 备份三者全丢 = 永久救不回。
 *   2) **永不读、永不写 `payload`**；**永不触碰** `kdf_salt` / `kdf_salt_prev` / `kdf_verifier` / `key_epoch`
 *      ——覆盖这几个字段等于把用户全部密文变成永远打不开的砖头。
 *      （唯一例外：`recreate-admin` 在"整行已丢失"时新建一行，因列是 NOT NULL 必须以空占位写入，
 *        见该子命令注释与 docs/RECOVERY.md；它**永不修改既有行**的这些列。）
 *   3) 凭据只从本地 `.env.local` / 运行时环境变量读（环境 ID + 服务端 API Key），
 *      **绝不硬编码、绝不回显、退出不落盘**。
 *   4) 所有**写操作**先打印"将改什么"，再要求显式 `--yes`；缺 `--yes` 一律**不执行**。
 *
 * 用法（在项目根目录执行）：
 *   node scripts/rescue-admin.js list-users
 *   node scripts/rescue-admin.js hash-login-pwd --password '新登录密码'
 *   node scripts/rescue-admin.js reset-login --uid <uid> --password '新登录密码' --yes
 *   node scripts/rescue-admin.js set-status  --uid <uid> --status active --yes
 *   node scripts/rescue-admin.js recreate-admin [--uid <现有uid> | --force-new-uid] [--username <名>] --yes
 *
 * 详见 docs/RECOVERY.md。
 */
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// 登录密码哈希 —— 必须与 cloudfunctions/*\/lib.js 的 hashLoginPwd / verifyLoginPwd 完全一致。
// 参数取自 lib.js 的 SCRYPT 常量（N=16384, r=8, p=1, keylen=32, salt=16B），格式
// `scrypt$N$r$p$saltB64$hashB64`。**代码是唯一准绳**：往返一致性由
// src/lib/rescueAdmin.test.ts 对真实 lib.js 的 verifyLoginPwd 做校验（不是复制参数了事）。
// ---------------------------------------------------------------------------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };
const UID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const UID_LENGTH = 24;

/** 生成与 lib.js 完全一致的登录密码哈希。 */
export function hashLoginPwd(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

/** 生成 24 位 base62 uid（与 lib.js 的 randomUid 同口径）。仅 `--force-new-uid` 时用。 */
export function randomUid() {
  const bytes = randomBytes(UID_LENGTH);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) out += UID_ALPHABET[bytes[i] % UID_ALPHABET.length];
  return out;
}

// ---------------------------------------------------------------------------
// 凭据（只从 .env.local / 环境变量读；不回显）
// ---------------------------------------------------------------------------
/** 若存在 `.env.local` 则载入（Node ≥ 20.12 的 process.loadEnvFile）；缺失/解析失败不致命。 */
export function loadEnvLocal(cwd = process.cwd()) {
  const path = resolve(cwd, ".env.local");
  if (existsSync(path) && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(path);
    } catch {
      /* 忽略：由后续 MISSING 错误提示 */
    }
  }
}

/** 解析凭据：与云函数 lib.js 同源的环境变量名。 */
export function resolveCreds(env = process.env) {
  const envId = env.TCB_ENV || env.ENV_ID || env.VITE_CLOUDBASE_ENV_ID || "";
  const apiKey = env.CLOUDBASE_API_KEY || env.CLOUDBASE_APIKEY || "";
  return { envId: String(envId).trim(), apiKey: String(apiKey).trim() };
}

/** PG REST 客户端（PostgREST 风格，凭 service_role）；**绝不打印凭据**。 */
export function makePgClient({ envId, apiKey }, fetchImpl = fetch) {
  if (!envId) throw new Error("ENV_ID_MISSING");
  if (!apiKey) throw new Error("SERVICE_CREDENTIAL_MISSING");
  const base = `https://${envId}.api.tcloudbasegateway.com/v1/rdb/rest`;
  return {
    async request(method, table, options = {}) {
      const url = new URL(`${base}/${table}`);
      const query = options.query || {};
      for (const key of Object.keys(query)) {
        const value = query[key];
        if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
      }
      const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
      if (options.prefer) headers.Prefer = options.prefer;
      const res = await fetchImpl(url.toString(), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const text = await res.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (!res.ok) {
        const detail = typeof data === "string" ? data : JSON.stringify(data);
        throw new Error(`PG_${res.status}: ${detail}`);
      }
      const range = res.headers.get("content-range") || res.headers.get("Content-Range") || "";
      const total = Number.parseInt(range.split("/").pop() || "", 10);
      return { data, count: Number.isFinite(total) ? total : null };
    },
  };
}

// ---------------------------------------------------------------------------
// 命令实现（核心逻辑，接受注入的 ctx，便于测试）
// ---------------------------------------------------------------------------
/** `list-users`：只读；字段限白名单 uid/username/role/status/created_at（**绝不含 payload/敏感列**）。 */
export async function listUsers(ctx) {
  const { data } = await ctx.pg.request("GET", "kb_users", {
    query: { select: "uid,username,role,status,created_at", order: "created_at.asc" },
  });
  const rows = Array.isArray(data) ? data : [];
  return rows.map((r) => ({
    uid: String(r.uid ?? ""),
    username: String(r.username ?? ""),
    role: String(r.role ?? ""),
    status: String(r.status ?? ""),
    created_at: String(r.created_at ?? ""),
  }));
}

/** 从 kb_secrets 按 owner_id 分组，取出现次数最多者（**只读 owner_id 列，绝不读 payload**）。 */
export async function detectOwnerUid(ctx) {
  const { data } = await ctx.pg.request("GET", "kb_secrets", { query: { select: "owner_id" } });
  const rows = Array.isArray(data) ? data : [];
  const counts = new Map();
  for (const r of rows) {
    const owner = String(r.owner_id ?? "");
    if (owner) counts.set(owner, (counts.get(owner) || 0) + 1);
  }
  let uid = null;
  let count = 0;
  for (const [key, n] of counts) {
    if (n > count) {
      uid = key;
      count = n;
    }
  }
  return uid ? { uid, count } : null;
}

/** `reset-login`：**只**更新 login_hash 一列。 */
export async function resetLogin(ctx, { uid, password, yes } = {}) {
  const targetUid = String(uid || "").trim();
  if (!targetUid) throw new Error("MISSING_UID");
  if (!password) throw new Error("MISSING_PASSWORD");
  const preview =
    `将把 kb_users 中 uid=${targetUid} 的 login_hash 更新为“新的登录密码哈希”。\n` +
    `  · 只改这一列；**不碰** kdf_salt / kdf_verifier / key_epoch / payload。`;
  if (!yes) return { executed: false, reason: "NO_YES", preview };
  await ctx.pg.request("PATCH", "kb_users", {
    query: { uid: `eq.${targetUid}` },
    prefer: "return=minimal",
    body: { login_hash: hashLoginPwd(password) },
  });
  return { executed: true, uid: targetUid };
}

/** `set-status`：**只**更新 status 一列（active / disabled / deleted）。 */
export async function setStatus(ctx, { uid, status, yes } = {}) {
  const targetUid = String(uid || "").trim();
  if (!targetUid) throw new Error("MISSING_UID");
  if (!["active", "disabled", "deleted"].includes(status)) throw new Error("INVALID_STATUS");
  const preview =
    `将把 kb_users 中 uid=${targetUid} 的 status 改为 '${status}'。\n` +
    `  · 只改这一列；**不碰** login_hash / kdf_salt / kdf_verifier / key_epoch / payload。`;
  if (!yes) return { executed: false, reason: "NO_YES", preview };
  await ctx.pg.request("PATCH", "kb_users", {
    query: { uid: `eq.${targetUid}` },
    prefer: "return=minimal",
    body: { status },
  });
  return { executed: true, uid: targetUid, status };
}

/**
 * `recreate-admin`：整行丢失时重建一行管理员。
 *
 * uid 规则（**不得默认生成新 uid**）：未传 `--uid` 时从 kb_secrets 自动探测归属最集中的 uid 并要求确认；
 * 仅显式 `--force-new-uid` 才生成全新 uid（会使既有密文对新 uid 不可读——数据仍在库中）。
 *
 * ⚠️ NOT NULL 现实：`login_hash` / `kdf_salt` / `kdf_verifier` 在库中均 NOT NULL（见迁移
 * 20260927193625），故**新建行**必须以**空占位**写入这三列；随后由 `reset-login` 与
 * App 内“重设主密码”补齐。本命令**永不修改既有行**的这些列（若行已存在则直接报错 USER_ALREADY_EXISTS）。
 */
export async function recreateAdmin(ctx, { uid, username, forceNewUid, yes } = {}) {
  let targetUid = String(uid || "").trim();
  let generated = false;
  let detected = null;

  if (!targetUid) {
    if (forceNewUid) {
      generated = true;
      detected = await detectOwnerUid(ctx); // 仅用于警告里的条数
      targetUid = randomUid();
    } else {
      detected = await detectOwnerUid(ctx);
      if (!detected) throw new Error("CANNOT_DETECT_UID");
      targetUid = detected.uid;
    }
  }

  // 绝不覆盖已存在的行（保护既有用户的加密材料）
  const { data: existing } = await ctx.pg.request("GET", "kb_users", {
    query: { select: "uid", uid: `eq.${targetUid}` },
  });
  if (Array.isArray(existing) && existing.length > 0) throw new Error("USER_ALREADY_EXISTS");

  const finalUsername = String(username || "").trim() || targetUid;
  const lines = [];
  if (generated) {
    lines.push(
      `⚠️ 将生成全新 uid：原有 ${detected ? detected.count : "若干"} 条密文的 owner_id 与新 uid 不匹配，` +
        `该账号登录后【看不到】已有密钥（数据仍在库中，但访问不到）。`
    );
  } else if (detected) {
    lines.push(`库中密文归属最集中的 uid 是 ${detected.uid}（共 ${detected.count} 条）。将用它重建管理员行。`);
  }
  lines.push(
    `将新建（INSERT）kb_users 一行：`,
    `  · uid=${targetUid}`,
    `  · username=${finalUsername}`,
    `  · role='admin'，status='active'`,
    `  · login_hash / kdf_salt / kdf_verifier 以**空占位**写入（NOT NULL 约束要求）；`,
    `    随后请执行 reset-login 设登录密码，并在 App 内“重设主密码”生成 kdf_salt / kdf_verifier。`
  );
  const preview = lines.join("\n");
  if (!yes) return { executed: false, reason: "NO_YES", preview, uid: targetUid, generated };

  await ctx.pg.request("POST", "kb_users", {
    prefer: "return=minimal",
    body: {
      uid: targetUid,
      username: finalUsername,
      role: "admin",
      status: "active",
      login_hash: "",
      kdf_salt: "",
      kdf_verifier: "",
    },
  });
  return { executed: true, uid: targetUid, username: finalUsername, generated };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const USAGE = [
  "KeyBox 救援脚本（本地手工运行；只恢复“能登录”，不恢复数据解密）",
  "",
  "  node scripts/rescue-admin.js list-users",
  "  node scripts/rescue-admin.js hash-login-pwd --password '<新登录密码>'",
  "  node scripts/rescue-admin.js reset-login  --uid <uid> --password '<新登录密码>' --yes",
  "  node scripts/rescue-admin.js set-status   --uid <uid> --status <active|disabled|deleted> --yes",
  "  node scripts/rescue-admin.js recreate-admin [--uid <现有uid> | --force-new-uid] [--username <名>] --yes",
  "",
  "凭据来源：.env.local 或环境变量 TCB_ENV/ENV_ID/VITE_CLOUDBASE_ENV_ID + CLOUDBASE_API_KEY。",
  "写操作必须带 --yes；缺 --yes 只打印预览、不改任何东西。详见 docs/RECOVERY.md。",
].join("\n");

/** 极简参数解析：`--k v` 取值，`--flag` 取 true。 */
function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (typeof a === "string" && a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || (typeof next === "string" && next.startsWith("--"))) {
        out[key] = true;
      } else {
        out[key] = next;
        i += 1;
      }
    }
  }
  return out;
}

/** 统一的写操作结果汇报（预览 + 缺 --yes 的中止提示）。返回进程退出码。 */
function report(result) {
  if (result && result.preview) console.log(result.preview);
  if (!result || !result.executed) {
    console.error("❌ 未提供 --yes，已中止（未做任何改动）。确认预览无误后，在命令末尾追加 --yes 重跑。");
    return 1;
  }
  console.log("✅ 已完成。");
  return 0;
}

async function main(argv = process.argv.slice(2)) {
  loadEnvLocal();
  const [cmd, ...rest] = argv;
  const flags = parseFlags(rest);

  const password = flags.password || process.env.RESCUE_LOGIN_PASSWORD || "";

  if (cmd === "list-users") {
    const rows = await listUsers({ pg: makePgClient(resolveCreds()) });
    console.log(`共 ${rows.length} 个用户：`);
    for (const r of rows) console.log(`  ${r.uid}  ${r.username}  role=${r.role}  status=${r.status}  ${r.created_at}`);
    return 0;
  }
  if (cmd === "hash-login-pwd") {
    if (!password) throw new Error("MISSING_PASSWORD");
    console.log(hashLoginPwd(password));
    return 0;
  }
  if (cmd === "reset-login") {
    return report(await resetLogin({ pg: makePgClient(resolveCreds()) }, { uid: flags.uid, password, yes: flags.yes }));
  }
  if (cmd === "set-status") {
    return report(await setStatus({ pg: makePgClient(resolveCreds()) }, { uid: flags.uid, status: flags.status, yes: flags.yes }));
  }
  if (cmd === "recreate-admin") {
    return report(
      await recreateAdmin({ pg: makePgClient(resolveCreds()) }, {
        uid: flags.uid,
        username: flags.username,
        forceNewUid: flags["force-new-uid"],
        yes: flags.yes,
      })
    );
  }
  console.log(USAGE);
  return 2;
}

// 仅在被当作 CLI 直接运行时才执行（被 import 时不产生副作用）。
const isCli = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(`❌ 错误：${err && err.message ? err.message : String(err)}`);
      process.exitCode = 1;
    });
}
