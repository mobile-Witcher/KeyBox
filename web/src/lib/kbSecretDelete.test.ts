/**
 * kbSecretDelete.test.ts —— 云函数服务端行为对抗性单测（Q3：单次 DELETE + count=exact 计数）。
 *
 * 隔离方式：读入云函数【真实源码】，用 `new Function` 注入假 `require("./lib")` / 假 `fetch` 运行，
 *   在本机无云环境下跑真源码，断言它发出的请求与返回（不触碰真实 CloudBase）。
 *
 * 关键点：删除只允许删本人行（条件带 owner_id=eq.uid）；0 行 → NOT_FOUND（保持原契约）；
 *   全程【单次】请求，且响应体不含任何行内容（return=minimal）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url)); // src/lib
const FN_PATH = resolve(here, "../../../cloudfunctions/kbSecretDelete/index.js");

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}
interface MainResult {
  ok: boolean;
  data?: { deletedId?: number };
  error?: string;
}
interface FetchInit {
  method: string;
  headers: Record<string, string>;
}

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

function makeEnv(opts: { uid?: string; deletedCount?: number; deleteOk?: boolean }) {
  const fetchCalls: FetchCall[] = [];
  const ok = (data: unknown) => ({ ok: true, data: data === undefined ? null : data });
  const fail = (code: string) => ({ ok: false, error: String(code) });
  const getCaller = () => ({ uid: opts.uid ?? "", customUserId: "", openId: "" });
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
  const fakeLib = { ENV_ID: "env-abc", ok, fail, getCaller };
  return { fetchCalls, fakeLib, fakeFetch, fakeProcess };
}

describe("kbSecretDelete：Q3 单次 DELETE + 精确计数", () => {
  it("★N>0：恰好 1 次 DELETE，带 id=eq.X + owner_id=eq.uid + count=exact；返回 deletedId", async () => {
    const env = makeEnv({ uid: "USER-A", deletedCount: 1 });
    const main = loadMain(env.fakeLib, env.fakeFetch, env.fakeProcess);
    const res = await main({ id: 42 });

    expect(res).toEqual({ ok: true, data: { deletedId: 42 } });
    expect(env.fetchCalls).toHaveLength(1); // 全程单次请求
    const call = env.fetchCalls[0];
    expect(call.method).toBe("DELETE");
    expect(call.url).toContain("/kb_secrets");
    expect(call.url).toContain("id=eq.42");
    expect(call.url).toContain("owner_id=eq.USER-A");
    expect(call.headers.Prefer).toBe("return=minimal, count=exact");
  });

  it("★0 行 → NOT_FOUND（保持原契约），且仍是【单次】请求", async () => {
    const env = makeEnv({ uid: "USER-A", deletedCount: 0 });
    const main = loadMain(env.fakeLib, env.fakeFetch, env.fakeProcess);
    const res = await main({ id: 999 });
    expect(res).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(env.fetchCalls).toHaveLength(1);
  });

  it("未登录 → NOT_LOGGED_IN，不发任何请求", async () => {
    const env = makeEnv({ uid: "" });
    const main = loadMain(env.fakeLib, env.fakeFetch, env.fakeProcess);
    const res = await main({ id: 1 });
    expect(res).toEqual({ ok: false, error: "NOT_LOGGED_IN" });
    expect(env.fetchCalls).toEqual([]);
  });

  it("非法 id → INVALID_ID，不发任何请求", async () => {
    const env = makeEnv({ uid: "USER-A" });
    const main = loadMain(env.fakeLib, env.fakeFetch, env.fakeProcess);
    const res = await main({ id: "not-a-number" });
    expect(res).toEqual({ ok: false, error: "INVALID_ID" });
    expect(env.fetchCalls).toEqual([]);
  });

  it("DELETE 报错 → PG_<status>，不误报成功", async () => {
    const env = makeEnv({ uid: "USER-A", deleteOk: false });
    const main = loadMain(env.fakeLib, env.fakeFetch, env.fakeProcess);
    const res = await main({ id: 7 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("PG_500");
  });
});
