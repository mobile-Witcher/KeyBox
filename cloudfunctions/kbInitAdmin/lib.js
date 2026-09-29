"use strict";
/**
 * lib.js —— KeyBox 云函数公共助手（每个函数目录内置一份，内容等价）。
 *
 * 为什么每个目录各放一份：CloudBase 事件函数按“函数目录”独立打包，运行期无法 require 到兄弟目录，
 *   因此公共代码必须在每个函数目录内各保留一份；此文件是唯一副本来源，改动请同步到 8 个目录。
 *   （校验：对 cloudfunctions 下每个 `<函数目录>/lib.js` 求 md5，应全部一致。）
 *
 * 职责与“依据文档”出处：
 *  1) 统一返回体 { ok, data?, error? } —— 架构 §7 要求“不抛裸异常”。
 *  2) 身份读取：@cloudbase/node-sdk 的 auth.getUserInfo()，返回 { openId, appId, uid, customUserId }；
 *     绝不相信 event 里传来的身份字段。
 *     依据：技能 auth-nodejs-cloudbase《Scenario 2: Get caller identity in a CloudBase function》。
 *  3) 自定义登录票据：auth.createTicket(customUserId, { refresh, expire })。
 *     依据：技能 auth-nodejs-cloudbase《Scenario 8: Issue a custom login ticket》，需注入自定义登录私钥。
 *     私钥来源按优先级：① 环境变量 TCB_CUSTOM_LOGIN_CREDENTIALS(JSON 串)
 *                      → ② 环境变量 TCB_CUSTOM_LOGIN_KEY_FILE(路径)
 *                      → ③ 与本文件同目录的 tcb_custom_login.json（随函数包一起上传）。
 *                    （依据：技能 auth-nodejs-cloudbase《Scenario 7》推荐 __dirname 同目录写法。）
 *  4) 服务端访问 PG：走 CloudBase PG HTTP 网关 /v1/rdb/rest（PostgREST 风格），
 *     凭据取自环境变量（= service_role，绕过 RLS）。
 *     依据：技能 postgresql-development-cloudbase/references/auth-and-rls.md《Accessing PG from a cloud function》
 *     与 references/http-api.md。
 *
 * 为什么云函数要持服务端凭据：kb_users 的 login_hash / kdf_salt / kdf_verifier 刻意未授予 authenticated；
 *   开户与登录链路（R01/R04/R05/R11/R21）必须由服务端读这几列（架构 §11 风险 9，前提已实测确认）。
 */
const tcb = require("@cloudbase/node-sdk");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---------------------------------------------------------------------------
// 环境与常量（环境 ID / API Key 一律来自函数环境变量，绝不硬编码，硬约束 4）
// ---------------------------------------------------------------------------
const ENV_ID = process.env.TCB_ENV || process.env.ENV_ID || "";
/** 服务端凭据（service_role）。兼容两种常见命名。 */
const API_KEY = process.env.CLOUDBASE_API_KEY || process.env.CLOUDBASE_APIKEY || "";
/** 自定义登录私钥文件路径（文件本身被 .gitignore 挡住，不进仓库）。 */
const CUSTOM_LOGIN_KEY_FILE = process.env.TCB_CUSTOM_LOGIN_KEY_FILE || "";
/** 自定义登录私钥 JSON 串（直接把文件内容放进环境变量，免去路径问题）。 */
const CUSTOM_LOGIN_CREDENTIALS = process.env.TCB_CUSTOM_LOGIN_CREDENTIALS || "";
const PG_BASE = ENV_ID ? `https://${ENV_ID}.api.tcloudbasegateway.com/v1/rdb/rest` : "";

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;
const MIN_LOGIN_PWD = 8;
const USER_LIMIT = 20; // R22：20 人开户上限
const TICKET_REFRESH_MS = 15 * 60 * 1000; // R13 云端窗口目标 15 分钟
const TICKET_EXPIRE_MS = 7 * 24 * 3600 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };
/** 自定义登录 customUserId 允许的字符集（官方约束：字母/数字/部分符号；长度 4–32）。 */
const UID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const UID_LENGTH = 24;

// ---------------------------------------------------------------------------
// SDK 初始化
// ---------------------------------------------------------------------------
let cachedApp = null;

/**
 * 读取自定义登录私钥（多来源，缺失时返回 null，不抛异常）。
 *  优先级：① TCB_CUSTOM_LOGIN_CREDENTIALS(JSON 串) → ② TCB_CUSTOM_LOGIN_KEY_FILE(路径)
 *          → ③ 与本文件同目录的 tcb_custom_login.json。
 *  任一步解析失败都静默跳过，交由调用方以 TICKET_UNAVAILABLE 反馈。
 */
function loadCustomLoginCredentials() {
  // ① 直接放在环境变量里的 JSON 串（owner 无需处理文件路径）
  if (CUSTOM_LOGIN_CREDENTIALS) {
    try {
      return JSON.parse(CUSTOM_LOGIN_CREDENTIALS);
    } catch (error) {
      // 解析失败则继续尝试其他来源
    }
  }
  // ② 显式指定的文件路径；③ 与本文件同目录（随函数目录一起打包）
  const candidates = [];
  if (CUSTOM_LOGIN_KEY_FILE) candidates.push(CUSTOM_LOGIN_KEY_FILE);
  candidates.push(path.join(__dirname, "tcb_custom_login.json"));
  for (let i = 0; i < candidates.length; i += 1) {
    const file = candidates[i];
    try {
      if (file && fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, "utf8"));
      }
    } catch (error) {
      // 继续尝试下一个来源
    }
  }
  return null;
}

/**
 * 取得唯一的 Node SDK 实例。
 * 事件函数可用平台运行期凭据；若显式注入了 CLOUDBASE_API_KEY 则以它为准（更可控，映射 service_role）。
 */
function getApp() {
  if (cachedApp) return cachedApp;
  const options = { env: ENV_ID };
  if (API_KEY) options.accessKey = API_KEY;
  const credentials = loadCustomLoginCredentials();
  if (credentials) options.credentials = credentials;
  cachedApp = tcb.init(options);
  return cachedApp;
}

/** 读取调用者身份（只信运行时注入，忽略 event 身份字段）。 */
function getCaller() {
  try {
    const info = getApp().auth().getUserInfo() || {};
    return {
      uid: info.uid || "",
      customUserId: info.customUserId || "",
      openId: info.openId || "",
    };
  } catch (error) {
    return { uid: "", customUserId: "", openId: "" };
  }
}

// ---------------------------------------------------------------------------
// 统一返回体
// ---------------------------------------------------------------------------
function ok(data) {
  return { ok: true, data: data === undefined ? null : data };
}
function fail(code) {
  return { ok: false, error: String(code == null ? "UNKNOWN" : code) };
}

// ---------------------------------------------------------------------------
// PG 访问（PostgREST over Gateway）
// ---------------------------------------------------------------------------

/** 组装带过滤的 URL。 */
function buildUrl(pathname, query) {
  if (!PG_BASE) throw new Error("ENV_ID_MISSING");
  const url = new URL(`${PG_BASE}/${pathname}`);
  const map = query || {};
  Object.keys(map).forEach((key) => {
    const value = map[key];
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url;
}

/** 执行一次 PG REST 请求并解析 JSON；非 2xx 抛错（含 PG_<status> 与响应体）。 */
async function pgRequest(method, pathname, options) {
  const opts = options || {};
  if (!API_KEY) throw new Error("SERVICE_CREDENTIAL_MISSING");
  const url = buildUrl(pathname, opts.query);
  const headers = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };
  if (opts.prefer) headers.Prefer = opts.prefer;
  const response = await fetch(url.toString(), {
    method,
    headers,
    body: opts.body === undefined || opts.body === null ? undefined : JSON.stringify(opts.body),
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

/** 精确计数：读 PostgREST 的 Content-Range（用于 20 人上限与初始化判定）。 */
async function pgCount(pathname, query) {
  if (!API_KEY) throw new Error("SERVICE_CREDENTIAL_MISSING");
  const url = buildUrl(pathname, query);
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PG_${response.status}: ${text}`);
  }
  const range = response.headers.get("content-range") || response.headers.get("Content-Range") || "";
  const parsed = Number.parseInt(range.split("/")[1], 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ---------------------------------------------------------------------------
// 账号原语（登录密码哈希 / 恒定时间比较 / uid 生成）
// ---------------------------------------------------------------------------

/** 生成 24 位 base62 uid（同时用作自定义登录 customUserId；满足其字符集与长度约束）。 */
function randomUid() {
  const bytes = crypto.randomBytes(UID_LENGTH);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += UID_ALPHABET[bytes[i] % UID_ALPHABET.length];
  }
  return out;
}

/** scrypt 哈希登录密码，格式 scrypt$N$r$p$saltB64$hashB64（云端永不存明文密码）。 */
function hashLoginPwd(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

/** 恒定时间比较登录密码（避免时序侧信道）。 */
function verifyLoginPwd(password, stored) {
  try {
    const parts = String(stored).split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const N = Number.parseInt(parts[1], 10);
    const r = Number.parseInt(parts[2], 10);
    const p = Number.parseInt(parts[3], 10);
    const salt = Buffer.from(parts[4], "base64");
    const expected = Buffer.from(parts[5], "base64");
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT.maxmem,
    });
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch (error) {
    return false;
  }
}

/**
 * 归一化调用入参（兼容两种调用通道）。
 *
 * 背景：初始化 / 注册 / 登录这三个"登录前函数"必须能被未登录用户调用，而云函数安全规则
 * 默认拒绝匿名 SDK 调用（EXCEED_AUTHORITY）。现改经 HTTP 网关（/api/<函数名>，auth=false）
 * 调用——网关转发属服务端调用，不受客户端安全规则约束（已实测）。
 *
 * 两条通道交给函数的 event 形态不同，本函数统一成"参数对象"：
 *   - SDK 直调：参数平铺在 event 上                 → { username, loginPwd, ... }
 *   - HTTP 网关：参数在 event.body（JSON 字符串）    → { body: "{\"username\":...}", ... }
 * 返回空对象或参数对象，调用方无需关心走的是哪条通道。
 */
function normalizeEvent(event) {
  if (!event || typeof event !== "object") return {};
  // 形态 A：SDK 直调 —— 无 body/data 包装，参数已平铺
  if (event.body === undefined && event.data === undefined) return event;
  // 形态 B：HTTP 网关包装 —— 参数在 body（可能是 JSON 字符串）
  let body = event.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (error) {
      body = null;
    }
  }
  if (body && typeof body === "object") return body;
  // 形态 C：参数在 data
  if (event.data && typeof event.data === "object") return event.data;
  return event;
}

module.exports = {
  ENV_ID,
  USERNAME_PATTERN,
  MIN_LOGIN_PWD,
  USER_LIMIT,
  TICKET_REFRESH_MS,
  TICKET_EXPIRE_MS,
  ok,
  fail,
  getApp,
  getCaller,
  pgRequest,
  pgCount,
  randomUid,
  hashLoginPwd,
  verifyLoginPwd,
  normalizeEvent,
};
