/**
 * kbAdminDeleteUserData.test.ts —— 云函数服务端行为对抗性单测（Q1 禁止自删 + Q3 单次精确计数）。
 *
 * 隔离方式（本仓既有风格）：把云函数【真实源码】读成文本，用 `new Function` 注入
 *   假的 `require("./lib")` / 假 `fetch` / 假 `process` 运行，从而在本机无云环境下跑「真源码」，
 *   断言它实际发出的请求与返回体（不触碰真实 CloudBase）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url)); // src/lib
const FN_PATH = resolve(here, "../../../cloudfunctions/kbAdminDeleteUserData/index.js");

interface PgCall {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  prefer?: string;
  body?: unknown;
}
interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}
interface MainResult {
  ok: boolean;
  data?: { deletedCount?: number };
  error?: string;
}

/** 以假 require/fetch/process 运行真实云函数源码，返回其 main。 */
function loadMain(
  fakeLib: Record<string, unknown>,
  fakeFetch: unknown,
  fakeProcess: unknown
): (event: unknown) => Promise<MainResult> {
  const src = readFileSync(FN_PATH, "utf8");
  const mod: { exports: { main?: (event: unknown) => Promise<MainResult> } } = { exports: {} };
  const requireShim = (id: string): unknown => {
    if (id === "./lib") return fakeLib;
    throw new Error(`unexpected require(${id})`);
  };
  const factory = new Function("require", "module", "exports", "fetch", "process", src);
  factory(requireShim, mod, mod.exports, fakeFetch, fakeProcess);
  if (!mod.exports.main) throw new Error("云函数未导出 main");
  return mod.exports.main;
}

interface FetchInit {
  method: string;
  headers: Record<string, string>;
}

function makeEnv(opts: {
  callerUid?: string;
  isAdmin?: boolean;
  deletedCount?: number;
  deleteOk?: boolean;
}) {
  const pgCalls: PgCall[] = [];
  const fetchCalls: FetchCall[] = [];
  const ok = (data: unknown) => ({ ok: true, data: data === undefined ? null : data });
  const fail = (code: string) => ({ ok: false, error: String(code) });
  const getCaller = () => ({ uid: opts.callerUid ?? "", customUserId: "", openId: "" });
  const pgRequest = async (
    method: string,
    path: string,
    options?: { query?: Record<string, unknown>; prefer?: string; body?: unknown }
  ) => {
    pgCalls.push({ method, path, query: options?.query, prefer: options?.prefer, body: options?.body });
    if (method === "GET" && path === "kb_users") {
      return opts.isAdmin ? [{ role: "admin", status: "active" }] : [{ role: "member", status: "active" }];
    }
    return null;
  };
  const deleteOk = opts.deleteOk !== false;
  const fakeFetch = async (url: string, init: FetchInit) => {
    fetchCalls.push({ url, method: init.method, headers: init.headers });
    return {
      ok: deleteOk,
      status: deleteOk ? 204 : 500,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-range" ? `*/${opts.deletedCount ?? 0}` : null,
      },
      text: async () => (deleteOk ? "" : "boom"),
    };
  };
  const fakeProcess = { env: { CLOUDBASE_API_KEY: "svc-key" } };
  const fakeLib = { ENV_ID: "env-abc", ok, fail, getCaller, pgRequest };
  return { pgCalls, fetchCalls, fakeLib, fakeFetch, fakeProcess };
}

describe("Q1 · 禁止管理员删除自己的数据（服务端自检，不只靠前端）", () => {
  it("★目标 uid == 调用者 uid → CANNOT_DELETE_SELF，且【不发出任何 DELETE/PATCH】", async () => {
    const env = makeEnv({ callerUid: "ADMIN1", isAdmin: true });
    const main = loadMain(env.fakeLib, env.fakeFetch, env.fakeProcess);
    const res = await main({ uid: "ADMIN1" });
    expect(res).toEqual({ ok: false, error: "CANNOT_DELETE_SELF" });
    expect(env.fetchCalls.filter((c) => c.method === "DELETE")).toEqual([]);
    expect(env.pgCalls.filter((c) => c.method === "DELETE")).toEqual([]);
    expect(env.pgCalls.filter((c) => c.method === "PATCH")).toEqual([]); // 也不得把自己软删
  });

  it("删别人 → 正常走通：1 次 DELETE(kb_secrets, owner_id=eq.target) + 1 次 PATCH(kb_users, status=deleted)", async () => {
    const env = makeEnv({ callerUid: "ADMIN1", isAdmin: true, deletedCount: 5 });
    const main = loadMain(env.fakeLib, env.fakeFetch, env.fakeProcess);
    const res = await main({ uid: "USER2" });
    expect(res).toEqual({ ok: true, data: { deletedCount: 5 } });

    const del = env.fetchCalls.filter((c) => c.method === "DELETE");
    expect(del).toHaveLength(1);
    expect(del[0].url).toContain("/kb_secrets");
    expect(del[0].url).toContain("owner_id=eq.USER2");
    expect(del[0].headers.Prefer).toBe("return=minimal, count=exact");

    const patch = env.pgCalls.filter((c) => c.method === "PATCH");
    expect(patch).toHaveLength(1);
    expect(patch[0].query).toEqual({ uid: "eq.USER2" });
    expect(patch[0].body).toEqual({ status: "deleted" });
  });

  it("非管理员 → NOT_ADMIN，且不发出 DELETE", async () => {
    const env = makeEnv({ callerUid: "U", isAdmin: false });
    const main = loadMain(env.fakeLib, env.fakeFetch, env.fakeProcess);
    const res = await main({ uid: "OTHER" });
    expect(res).toEqual({ ok: false, error: "NOT_ADMIN" });
    expect(env.fetchCalls).toEqual([]);
  });

  it("缺 uid → MISSING_UID，且不发出 DELETE", async () => {
    const env = makeEnv({ callerUid: "ADMIN1", isAdmin: true });
    const main = loadMain(env.fakeLib, env.fakeFetch, env.fakeProcess);
    const res = await main({});
    expect(res).toEqual({ ok: false, error: "MISSING_UID" });
    expect(env.fetchCalls).toEqual([]);
  });
});

describe("Q3 · deletedCount 取自单次 DELETE 的 count=exact（不再 before/after 两次计数）", () => {
  it("恰好一次「取行数」请求，且它就是带 count=exact 的 DELETE", async () => {
    const env = makeEnv({ callerUid: "ADMIN1", isAdmin: true, deletedCount: 7 });
    const main = loadMain(env.fakeLib, env.fakeFetch, env.fakeProcess);
    const res = await main({ uid: "USER9" });
    expect(res).toEqual({ ok: true, data: { deletedCount: 7 } });

    const countReq = env.fetchCalls.filter((c) => (c.headers.Prefer || "").includes("count=exact"));
    expect(countReq).toHaveLength(1);
    expect(countReq[0].method).toBe("DELETE");
    // 旧写法会有 2 次 pgCount(GET)；这里不应有任何走 pgRequest 的 kb_secrets 请求
    expect(env.pgCalls.filter((c) => c.path === "kb_secrets")).toEqual([]);
  });

  it("0 行 → deletedCount 0（保留原外部语义：软删照做、不报错）", async () => {
    const env = makeEnv({ callerUid: "ADMIN1", isAdmin: true, deletedCount: 0 });
    const main = loadMain(env.fakeLib, env.fakeFetch, env.fakeProcess);
    const res = await main({ uid: "EMPTY" });
    expect(res).toEqual({ ok: true, data: { deletedCount: 0 } });
    expect(env.pgCalls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });

  it("DELETE 报错 → 抛 PG_<status>（不误报成功）", async () => {
    const env = makeEnv({ callerUid: "ADMIN1", isAdmin: true, deleteOk: false });
    const main = loadMain(env.fakeLib, env.fakeFetch, env.fakeProcess);
    const res = await main({ uid: "USER2" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("PG_500");
  });
});
