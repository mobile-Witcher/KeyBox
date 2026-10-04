/**
 * r21Rotate.test.ts —— R21（改主密码整批重写）+ R28 ack 云函数【对抗性单测】。
 *
 * 做法：与 step8CloudFunctions.test.ts 同源的【依赖注入式沙箱】——读云函数真实源码，
 *   用 `new Function` 注入受控假 `require("./lib")`，用假 `fetch` 捕获 rpc 请求，
 *   不触碰真实 SDK / 网络 / 数据库。
 *
 * 覆盖：
 *   - kbRotateMaster：单请求、原子交由 /rpc/kb_rotate_master；入参校验（id>0、payload=KB1:、恢复密文=KBRC1:）；
 *     身份取服务端；绝不把 payload 明文写进错误/日志；返回 keyEpoch 规整。
 *   - kbAckRecovery：只写本人那一行的 recovery_ack_at 单列；未登录/无行即拒。
 *   - 迁移静态断言：kb_rotate_master 函数存在、单事务整批 UPDATE、EXECUTE 收口、role 护栏 fail-closed。
 */
import { readFileSync, readdirSync } from "node:fs";
import { repoRoot } from "./testRepoRoot";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = repoRoot();
const CLOUD_ROOT = resolve(REPO, "cloudfunctions");
const MIGRATIONS = resolve(REPO, "cloudbase/migrations");

type Dict = Record<string, unknown>;
type CloudResult = { ok: boolean; data?: Dict | null; error?: string };
type MainFn = (event?: unknown) => Promise<CloudResult>;

function loadFunction(relDir: string, fakeLib: Dict): { main: MainFn } {
  const dir = resolve(CLOUD_ROOT, relDir);
  const source = readFileSync(resolve(dir, "index.js"), "utf8");
  const moduleObj: { exports: Dict } = { exports: {} };
  const fakeRequire = (name: string): Dict => {
    if (name === "./lib") return fakeLib;
    throw new Error(`沙箱只允许 require("./lib")，收到 require("${name}") @ ${relDir}`);
  };
  const factory = new Function("require", "module", "exports", "__dirname", source) as (
    ...args: unknown[]
  ) => unknown;
  factory(fakeRequire, moduleObj, moduleObj.exports, dir);
  return moduleObj.exports as { main: MainFn };
}

const ok = (data?: unknown): CloudResult => ({ ok: true, data: (data ?? null) as Dict });
const fail = (code: string): CloudResult => ({ ok: false, error: String(code) });

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** 安装假 fetch：捕获请求；`text` 为响应体；okFlag=false 时模拟非 2xx。 */
function stubFetch(text: string, okFlag = true, status = 200): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ?? "" });
    return {
      ok: okFlag,
      status: okFlag ? status : 500,
      text: async () => text,
    };
  });
  return calls;
}

/* ================================================================== */
/* kbRotateMaster（R21）                                               */
/* ================================================================== */
function makeRotateLib(callerUid: string | null): Dict {
  return {
    ENV_ID: "test-env",
    ok: (data?: unknown) => ok(data),
    fail: (code: string) => fail(code),
    getCaller: () => ({ uid: callerUid ?? "", openId: "", customUserId: "" }),
  };
}

function rotateEvent(overrides: Dict = {}): Dict {
  return {
    kdfSalt: "NEWSALT",
    kdfSaltPrev: "OLDSALT",
    kdfVerifier: "KB1:verifier",
    items: [
      { id: 5, payload: "KB1:aaa" },
      { id: 6, payload: "KB1:bbb" },
    ],
    ...overrides,
  };
}

describe("R21 kbRotateMaster：单请求原子整批重写", () => {
  beforeEach(() => {
    process.env.CLOUDBASE_API_KEY = "test-svc-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLOUDBASE_API_KEY;
  });

  it("★单次 POST 到 /rpc/kb_rotate_master，带会话 uid 与整批 items（不拆多请求）", async () => {
    const calls = stubFetch("3");
    const { main } = loadFunction("kbRotateMaster", makeRotateLib("ME-UID"));
    const res = await main(rotateEvent());

    expect(res.ok).toBe(true);
    expect(res.data?.keyEpoch).toBe(3);
    expect(calls).toHaveLength(1); // 抓“拆成多条 PATCH”回归
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/v1/rdb/rest/rpc/kb_rotate_master");
    const body = JSON.parse(calls[0].body) as Dict;
    expect(body.p_uid).toBe("ME-UID"); // 身份来自服务端
    expect(body.p_kdf_salt).toBe("NEWSALT");
    expect(body.p_kdf_salt_prev).toBe("OLDSALT");
    expect(body.p_kdf_verifier).toBe("KB1:verifier");
    expect(body.p_items).toEqual([
      { id: 5, payload: "KB1:aaa" },
      { id: 6, payload: "KB1:bbb" },
    ]);
    // 凭据在 Authorization 头里（不进 body）
    expect(calls[0].headers.Authorization).toBe("Bearer test-svc-key");
  });

  it("★不采信 event.uid：p_uid 必须是会话 uid", async () => {
    const calls = stubFetch("9");
    const { main } = loadFunction("kbRotateMaster", makeRotateLib("REAL-UID"));
    await main(rotateEvent({ uid: "ATTACKER-SUPPLIED" }));
    const body = JSON.parse(calls[0].body) as Dict;
    expect(body.p_uid).toBe("REAL-UID");
    expect(calls[0].body).not.toContain("ATTACKER-SUPPLIED");
  });

  it("恢复材料成对语义：提供 `KBRC1:` 才透传；非法前缀 → INVALID_RECOVERY_BLOB（不发请求）", async () => {
    const calls1 = stubFetch("1");
    const { main } = loadFunction("kbRotateMaster", makeRotateLib("ME"));
    await main(rotateEvent({ recoveryBlob: "KBRC1:rewrapped" }));
    expect((JSON.parse(calls1[0].body) as Dict).p_recovery_blob).toBe("KBRC1:rewrapped");

    const calls2 = stubFetch("1");
    const { main: main2 } = loadFunction("kbRotateMaster", makeRotateLib("ME"));
    const res = await main2(rotateEvent({ recoveryBlob: "plaintext-code" }));
    expect(res.error).toBe("INVALID_RECOVERY_BLOB");
    expect(calls2).toHaveLength(0);
  });

  it("★items 校验 fail-closed：payload 非 `KB1:` / id<=0 / 非数组 → INVALID_ITEMS，不建请求", async () => {
    const cases: Dict[] = [
      { items: [{ id: 5, payload: "PLAIN" }] },
      { items: [{ id: 0, payload: "KB1:x" }] },
      { items: [{ id: 5 }] },
      { items: "not-array" },
    ];
    for (const c of cases) {
      const calls = stubFetch("1");
      const { main } = loadFunction("kbRotateMaster", makeRotateLib("ME"));
      const res = await main(rotateEvent(c));
      expect(res.error).toBe("INVALID_ITEMS");
      expect(calls).toHaveLength(0);
    }
  });

  it("空 items（空保险箱）放行 → 仍发一次请求", async () => {
    const calls = stubFetch("1");
    const { main } = loadFunction("kbRotateMaster", makeRotateLib("ME"));
    const res = await main(rotateEvent({ items: [] }));
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("未登录 → NOT_LOGGED_IN（不建请求）", async () => {
    const calls = stubFetch("1");
    const { main } = loadFunction("kbRotateMaster", makeRotateLib(null));
    const res = await main(rotateEvent());
    expect(res.error).toBe("NOT_LOGGED_IN");
    expect(calls).toHaveLength(0);
  });

  it("缺 kdf 参数 → MISSING_KDF_PARAMS（不建请求）", async () => {
    const calls = stubFetch("1");
    const { main } = loadFunction("kbRotateMaster", makeRotateLib("ME"));
    const res = await main(rotateEvent({ kdfVerifier: "" }));
    expect(res.error).toBe("MISSING_KDF_PARAMS");
    expect(calls).toHaveLength(0);
  });

  it("rpc 非 2xx → PG_<status>，不抛裸异常；错误串里【不含】payload 密文", async () => {
    stubFetch("boom", false);
    const { main } = loadFunction("kbRotateMaster", makeRotateLib("ME"));
    const res = await main(rotateEvent());
    expect(res.ok).toBe(false);
    expect(res.error).toContain("PG_500");
    expect(String(res.error)).not.toContain("KB1:aaa");
  });

  it("rpc 返回形态容错：数字串 / 单元素数组 [{kb_rotate_master:N}] 都能规整", async () => {
    const { main: m1 } = loadFunction("kbRotateMaster", makeRotateLib("ME"));
    stubFetch('"5"');
    expect((await m1(rotateEvent())).data?.keyEpoch).toBe(5);
    vi.unstubAllGlobals();

    const { main: m2 } = loadFunction("kbRotateMaster", makeRotateLib("ME"));
    stubFetch(JSON.stringify([{ kb_rotate_master: 7 }]));
    expect((await m2(rotateEvent())).data?.keyEpoch).toBe(7);
    vi.unstubAllGlobals();

    const { main: m3 } = loadFunction("kbRotateMaster", makeRotateLib("ME"));
    stubFetch("null");
    expect((await m3(rotateEvent())).error).toBe("ROTATE_NO_EPOCH");
  });
});

/* ================================================================== */
/* kbAckRecovery（R28 ack）                                            */
/* ================================================================== */
interface AckCall {
  method: string;
  table: string;
  opts: Dict & { query?: Dict; body?: Dict };
}

function makeAckLib(cfg: { uid?: string; exists?: boolean }): { lib: Dict; calls: AckCall[] } {
  const calls: AckCall[] = [];
  const lib: Dict = {
    ok: (data?: unknown) => ok(data),
    fail: (code: string) => fail(code),
    getCaller: () => ({ uid: cfg.uid ?? "ME-UID", openId: "", customUserId: "" }),
    pgRequest: async (method: string, table: string, opts: Dict = {}) => {
      calls.push({ method, table, opts });
      if (method === "GET" && table === "kb_users") {
        return cfg.exists === false ? [] : [{ uid: cfg.uid ?? "ME-UID" }];
      }
      return null;
    },
  };
  return { lib, calls };
}

describe("R28 kbAckRecovery：只写本人 recovery_ack_at", () => {
  it("★先查本人行，再只提交 { recovery_ack_at } 单列（return=minimal）", async () => {
    const { lib, calls } = makeAckLib({});
    const { main } = loadFunction("kbAckRecovery", lib);
    const res = await main();
    expect(res.ok).toBe(true);
    expect(typeof res.data?.ackedAt).toBe("string");
    expect(new Date(String(res.data?.ackedAt)).toISOString()).toBe(res.data?.ackedAt);

    const get = calls.find((c) => c.method === "GET");
    expect(get?.opts.query).toEqual({ select: "uid", uid: "eq.ME-UID" });

    const patch = calls.find((c) => c.method === "PATCH" && c.table === "kb_users");
    expect(patch?.opts.query).toEqual({ uid: "eq.ME-UID" });
    expect(patch?.opts.prefer).toBe("return=minimal");
    expect(Object.keys(patch?.opts.body ?? {})).toEqual(["recovery_ack_at"]);
  });

  it("未登录 → NOT_LOGGED_IN（不发任何请求）", async () => {
    const { lib, calls } = makeAckLib({ uid: "" });
    const { main } = loadFunction("kbAckRecovery", lib);
    const res = await main();
    expect(res.error).toBe("NOT_LOGGED_IN");
    expect(calls).toHaveLength(0);
  });

  it("本人行不存在 → USER_NOT_FOUND（不发 PATCH）", async () => {
    const { lib, calls } = makeAckLib({ exists: false });
    const { main } = loadFunction("kbAckRecovery", lib);
    const res = await main();
    expect(res.error).toBe("USER_NOT_FOUND");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});

/* ================================================================== */
/* 迁移静态断言（kb_rotate_master 函数）                                */
/* ================================================================== */
describe("R21 迁移：kb_rotate_master 单事务原子 + EXECUTE 收口", () => {
  const fileName = readdirSync(MIGRATIONS).find((n) => n.endsWith("_kb_rotate_master_fn.sql"));
  const raw = readFileSync(resolve(MIGRATIONS, fileName as string), "utf8");
  const sql = raw.replace(/--[^\n]*/g, " ");

  it("迁移文件存在、命名合法，且版本晚于恢复码迁移", () => {
    expect(fileName).toBeTruthy();
    const m = /^(\d{14})_([a-z][a-z_]*)$/.exec(String(fileName).replace(/\.sql$/, ""));
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBeGreaterThan(20260928034647);
  });

  it("★定义 public.kb_rotate_master（plpgsql），且整批覆盖是【一条】UPDATE ... FROM jsonb_to_recordset", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.kb_rotate_master\s*\(/);
    expect(sql).toMatch(/LANGUAGE plpgsql/);
    expect(sql).toMatch(/UPDATE public\.kb_secrets[\s\S]*FROM jsonb_to_recordset/);
    // 用户行更新里含 key_epoch 推进、旧盐、恢复码重包裹
    expect(sql).toMatch(/key_epoch\s*=\s*v_new/);
    expect(sql).toMatch(/recovery_blob\s*=\s*CASE/);
  });

  it("★fail-closed 身份护栏：非 service_role 时必须 p_uid = auth.uid()，否则抛错", () => {
    expect(sql).toMatch(/request\.jwt\.claims/);
    expect(sql).toMatch(/v_role\s*<>\s*'service_role'/);
    expect(sql).toMatch(/auth\.uid\(\)\s*IS\s+NULL\s+OR\s+auth\.uid\(\)\s*<>\s*p_uid/);
    expect(sql).toMatch(/RAISE EXCEPTION 'ROTATE_FORBIDDEN'/);
  });

  it("★归属 + 集合一致性：逐条校验 owner_id，且数量必须相等（防残留旧代密文）", () => {
    expect(sql).toMatch(/RAISE EXCEPTION 'ROTATE_SET_MISMATCH'/);
    expect(sql).toMatch(/s\.owner_id\s*=\s*p_uid/);
  });

  it("★EXECUTE 收口：收回 PUBLIC/anon/authenticated，只授 service_role", () => {
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.kb_rotate_master\([^)]*\) FROM PUBLIC/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.kb_rotate_master\([^)]*\) FROM anon/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.kb_rotate_master\([^)]*\) FROM authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.kb_rotate_master\([^)]*\) TO service_role/);
  });
});
