/**
 * capture-auth.mjs —— Phase 0 实验 2：捕获 js-sdk 手机验证码登录的【真实 HTTP 请求】。
 *
 * 用法（在 F:/KeyBox 目录下运行，phone/PK 走环境变量，不落文件）：
 *   KEYBOX_PHONE="17787418073" KEYBOX_PK="<publishable key>" node /f/KeyBox-harmony/phase0/capture-auth.mjs
 *
 * 原理：拦截 https.request，记录 SDK 发出的 method/path/headers/body；
 *   再动态加载 node 版 js-sdk，实际调用 auth.signInWithOtp({ phone })。
 * 捕获结果即鸿蒙端 ArkTS 实现要照抄的最终规范。
 */
import https from "node:https";
import http from "node:http";

const PHONE = process.env.KEYBOX_PHONE || "";
const PK = process.env.KEYBOX_PK || "";
if (!PHONE || !PK) {
  console.error("缺少 KEYBOX_PHONE / KEYBOX_PK 环境变量");
  process.exit(1);
}

// node 环境无 localStorage，SDK 可能需要最小 polyfill
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

const captured = [];

// Node 18+ 的全局 fetch 走 undici（不经过 https.request），所以拦截点必须是 fetch 本身
const origFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async function (input, init) {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : input && input.url;
  const entry = {
    method: (init && init.method) || "GET",
    url,
    headers: (init && init.headers) || (input && input.headers) || {},
    body: init && init.body ? String(init.body) : "",
    response: "",
  };
  captured.push(entry);
  const res = await origFetch(input, init);
  try {
    const clone = res.clone();
    entry.response = await clone.text(); // 完整落盘（终端显示才截断）
  } catch {
    /* 忽略响应读取失败 */
  }
  return res;
};

// 动态加载 node 版 SDK（绝对路径：脚本在仓库外，需显式指向仓库的 node_modules）
const mod = await import(
  "file:///F:/KeyBox/node_modules/@cloudbase/js-sdk/dist/index.node.cjs.js"
);
const cloudbase = mod.default ?? mod;

console.log("[1] SDK loaded");
const app = cloudbase.init({
  env: "weichi-d4gfw5uo1334e0ffb",
  region: "ap-shanghai",
  accessKey: PK,
});
console.log("[2] init ok");
const auth = app.auth();
console.log("[3] auth instance ok, signInWithOtp =", typeof auth.signInWithOtp);

console.log("[4] calling signInWithOtp...");
const p = auth.signInWithOtp({ phone: PHONE });
const res = await Promise.race([
  p,
  new Promise((r) => setTimeout(() => r({ __timeout: true }), 20000)),
]);
console.log("[5] result:", JSON.stringify(res).slice(0, 400));

console.log("\n===== 捕获的 HTTP 请求（SDK 真实发出的）=====");
import fs from "node:fs";
let n = 0;
for (const c of captured) {
  n += 1;
  console.log(`\n#${n} ${c.method} ${c.url}`);
  const hs = { ...c.headers };
  for (const k of Object.keys(hs)) {
    if (/authorization|token|key/i.test(k) && typeof hs[k] === "string" && hs[k].length > 24) {
      hs[k] = hs[k].slice(0, 24) + "...(截断)";
    }
  }
  console.log("  headers:", JSON.stringify(hs));
  if (c.body) console.log("  body:", c.body.slice(0, 600));
  if (c.response) console.log("  response:", c.response.slice(0, 400));
  // 完整响应落盘（verification_id 是长 JWT，终端输出会截断）
  if (c.response.includes("verification_id")) {
    fs.writeFileSync("F:/KeyBox-harmony/phase0/step1-response.json", c.response);
    console.log("  ✅ 完整响应已存 phase0/step1-response.json");
  }
}
if (n === 0) console.log("(未捕获到请求)");
