/**
 * step8CloudFunctions.test.ts —— 第 8 步云函数（R14 删除 / R22·R26 名额）对抗性单测。
 *
 * 难点与对策：每个云函数目录内 `lib.js` 顶部 `require("@cloudbase/node-sdk")`，而该包**未安装**
 *   （仓库前端只装 @cloudbase/js-sdk）。因此这里用 **依赖注入式沙箱加载** 读入云函数源码，
 *   用 `new Function` 注入一个受控的假 `require`（把 "./lib" 换成假实现），
 *   从而运行的是**云函数真实源码**，又不触碰真实 SDK / 网络 / 数据库。
 *
 * 覆盖 team-lead 第 3 / 5 条断言：
 *   - R14：身份取自服务端 getUserInfo（getCaller），不采信 event.uid；先做管理员自检；
 *          入参只收一个 uid；DELETE 用 return=minimal（绝不 representation/RETURNING payload）；
 *          返回体只含 {deletedCount}；用户软删 status='deleted'。
 *   - R22/R26：kbRegister 上限统计用 status<>'deleted'（软删释放名额；disabled 不释放）。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLOUD_ROOT = resolve(HERE, "../../cloudfunctions");

type Dict = Record<string, unknown>;
type CloudResult = { ok: boolean; data?: Dict | null; error?: string };
type MainFn = (event: unknown) => Promise<CloudResult>;

/** 读入某个云函数的 index.js，用假 require 注入 "./lib"，返回其 exports。 */
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

/* ================================================================== */
/* kbAdminDeleteUserData（R14）                                         */
/* ================================================================== */
interface DeleteCall {
  method: string;
  table: string;
  opts: Dict & { query?: Dict; prefer?: string; body?: Dict };
}
interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}
interface FetchInit {
  method: string;
  headers: Record<string, string>;
}

/**
 * R14 契约已于 Q3 变更（team-lead 授权同步）：删除改为 index.js 内本地 `deleteWithCount()`，
 * 走**全局 `fetch`**（而不是 `pgRequest`），故 fake lib 需提供 `ENV_ID`，并用 `stubFetch` 驱动。
 * `pgCount` 仍保留在 fake lib —— 但用法从“被调用两次”变为“**断言根本不再调用**”（抓回退回归）。
 */
function makeDeleteLib(cfg: {
  callerUid?: string;
  callerRow?: Array<{ role: string; status: string }>;
}): { lib: Dict; calls: { pgRequest: DeleteCall[]; pgCount: Array<{ table: string; query: Dict }>; getCaller: number } } {
  const calls = {
    pgRequest: [] as DeleteCall[],
    pgCount: [] as Array<{ table: string; query: Dict }>,
    getCaller: 0,
  };
  const lib: Dict = {
    ENV_ID: "test-env", // deleteWithCount 需要（与 pgRequest 同源的网关地址）
    ok: (data?: unknown) => ok(data),
    fail: (code: string) => fail(code),
    getCaller: () => {
      calls.getCaller += 1;
      return { uid: cfg.callerUid ?? "admin-uid", openId: "", customUserId: "" };
    },
    pgRequest: async (method: string, table: string, opts: DeleteCall["opts"] = {}) => {
      calls.pgRequest.push({ method, table, opts });
      if (method === "GET" && table === "kb_users") {
        return cfg.callerRow ?? [{ role: "admin", status: "active" }];
      }
      return null;
    },
    pgCount: async (table: string, query: Dict) => {
      calls.pgCount.push({ table, query });
      return 0;
    },
  };
  return { lib, calls };
}

function deleteCalls(calls: DeleteCall[]): DeleteCall[] {
  return calls.filter((c) => c.method === "DELETE" && c.table === "kb_secrets");
}

/** 安装假 `fetch`：捕获请求，并用 Content-Range 响应头给出精确行数；返回捕获数组。 */
function stubFetch(count: number, okFlag = true): FetchCall[] {
  const fetchCalls: FetchCall[] = [];
  vi.stubGlobal("fetch", async (url: string, init: FetchInit) => {
    fetchCalls.push({ url, method: init.method, headers: init.headers });
    return {
      ok: okFlag,
      status: okFlag ? 204 : 500,
      headers: {
        get: (name: string) => (name.toLowerCase() === "content-range" ? `*/${count}` : null),
      },
      text: async () => (okFlag ? "" : "boom"),
    };
  });
  return fetchCalls;
}

/** 从 fetch 捕获里挑出 DELETE。 */
function deleteFetches(fetchCalls: FetchCall[]): FetchCall[] {
  return fetchCalls.filter((c) => c.method === "DELETE");
}

describe("R14 kbAdminDeleteUserData：身份与范围收口", () => {
  // Q3 起删除走本地 deleteWithCount()（全局 fetch）+ 读服务端凭据环境变量；此处注入、用后还原。
  beforeEach(() => {
    process.env.CLOUDBASE_API_KEY = "test-svc-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLOUDBASE_API_KEY;
  });

  it("★身份取自服务端 getCaller，【不采信】event.uid：非管理员即便伪造 event.uid=管理员 也被拒", async () => {
    const { lib, calls } = makeDeleteLib({
      callerUid: "attacker-uid",
      callerRow: [{ role: "user", status: "active" }], // 服务端身份实为普通用户
    });
    const { main } = loadFunction("kbAdminDeleteUserData", lib);
    const res = await main({ uid: "real-admin-uid" }); // event.uid 伪装成管理员

    expect(res.ok).toBe(false);
    expect(res.error).toBe("NOT_ADMIN");
    // 自检读的是 callerUid，不是 event.uid
    const adminCheck = calls.pgRequest.find((c) => c.method === "GET" && c.table === "kb_users");
    expect(adminCheck?.opts.query?.uid).toBe("eq.attacker-uid");
    expect(JSON.stringify(calls)).not.toContain("real-admin-uid");
    // 未通过自检 → 绝不发出 DELETE
    expect(deleteCalls(calls.pgRequest)).toHaveLength(0);
  });

  it("非管理员 → NOT_ADMIN，且不发出任何 DELETE/PATCH（先自检后动手）", async () => {
    const { lib, calls } = makeDeleteLib({ callerRow: [{ role: "admin", status: "disabled" }] });
    const { main } = loadFunction("kbAdminDeleteUserData", lib);
    const res = await main({ uid: "victim" });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("NOT_ADMIN");
    expect(calls.pgRequest.filter((c) => c.method !== "GET")).toHaveLength(0);
  });

  it("★管理员但 event.uid 缺失 → MISSING_UID，且【不发出 DELETE】（防无过滤删除）", async () => {
    const { lib, calls } = makeDeleteLib({ callerRow: [{ role: "admin", status: "active" }] });
    const { main } = loadFunction("kbAdminDeleteUserData", lib);
    const res = await main({});
    expect(res.ok).toBe(false);
    expect(res.error).toBe("MISSING_UID");
    expect(deleteCalls(calls.pgRequest)).toHaveLength(0);
  });

  it("★管理员但 event.uid 是空白 → MISSING_UID，且不发 DELETE", async () => {
    const { lib, calls } = makeDeleteLib({ callerRow: [{ role: "admin", status: "active" }] });
    const { main } = loadFunction("kbAdminDeleteUserData", lib);
    const res = await main({ uid: "   " });
    expect(res.error).toBe("MISSING_UID");
    expect(deleteCalls(calls.pgRequest)).toHaveLength(0);
  });

  it("★删除是【单次】DELETE，带 owner_id=目标收口，prefer 含 return=minimal 与 count=exact（绝无 representation）", async () => {
    const { lib } = makeDeleteLib({ callerRow: [{ role: "admin", status: "active" }] });
    const fetchCalls = stubFetch(3);
    const { main } = loadFunction("kbAdminDeleteUserData", lib);
    await main({ uid: "target-uid" });

    const dels = deleteFetches(fetchCalls);
    expect(dels).toHaveLength(1); // 单次删除（抓“改回多次”回归）
    expect(dels[0].url).toContain("owner_id=eq.target-uid"); // 范围收口（抓“忘带 owner_id”回归）
    const prefer = dels[0].headers.Prefer ?? "";
    expect(prefer).toContain("return=minimal"); // 不回传行内容
    expect(prefer).toContain("count=exact"); // 单次拿精确行数（抓“丢 count=exact”回归）
    expect(prefer).not.toContain("representation");
  });

  it("用户记录【软删】status='deleted'（PATCH，而非 DELETE 物理删行）", async () => {
    const { lib, calls } = makeDeleteLib({ callerRow: [{ role: "admin", status: "active" }] });
    stubFetch(2);
    const { main } = loadFunction("kbAdminDeleteUserData", lib);
    await main({ uid: "target-uid" });

    const patch = calls.pgRequest.find((c) => c.method === "PATCH" && c.table === "kb_users");
    expect(patch).toBeDefined();
    expect(patch?.opts.body).toEqual({ status: "deleted" });
    expect(patch?.opts.query).toEqual({ uid: "eq.target-uid" });
    // 没有对 kb_users 的物理 DELETE
    expect(calls.pgRequest.some((c) => c.method === "DELETE" && c.table === "kb_users")).toBe(false);
  });

  it("★返回体【只】含 {deletedCount}，且取自单次 DELETE 响应头 Content-Range", async () => {
    const { lib, calls } = makeDeleteLib({ callerRow: [{ role: "admin", status: "active" }] });
    stubFetch(3); // 响应头 Content-Range: */3
    const { main } = loadFunction("kbAdminDeleteUserData", lib);
    const res = await main({ uid: "target-uid" });

    expect(res.ok).toBe(true);
    expect(res.data).toBeTruthy();
    expect(Object.keys(res.data as Dict)).toEqual(["deletedCount"]);
    expect((res.data as Dict).deletedCount).toBe(3); // 精确值来自响应头
    expect(calls.pgCount).toHaveLength(0); // 抓“改回 before/after 两次计数”回归
    // 响应体不含任何内容字段
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("payload");
    expect(serialized).not.toContain("KB1:");
  });

  it("0 行 → deletedCount 0（保持原外部语义：软删照做、不报错；不改成 NOT_FOUND）", async () => {
    const { lib } = makeDeleteLib({ callerRow: [{ role: "admin", status: "active" }] });
    stubFetch(0); // Content-Range: */0
    const { main } = loadFunction("kbAdminDeleteUserData", lib);
    const res = await main({ uid: "target-uid" });
    expect(res.ok).toBe(true);
    expect((res.data as Dict).deletedCount).toBe(0);
  });

  it("计数【单次】：不再调用 pgCount，且带 count=exact 的请求恰好 1 个", async () => {
    const { lib, calls } = makeDeleteLib({ callerRow: [{ role: "admin", status: "active" }] });
    const fetchCalls = stubFetch(2);
    const { main } = loadFunction("kbAdminDeleteUserData", lib);
    await main({ uid: "target-uid" });

    expect(calls.pgCount).toHaveLength(0); // 抓“回退到两次 pgCount”回归
    const countReqs = fetchCalls.filter((c) => (c.headers.Prefer ?? "").includes("count=exact"));
    expect(countReqs).toHaveLength(1);
    expect(countReqs[0].method).toBe("DELETE");
    expect(countReqs[0].url).toContain("owner_id=eq.target-uid");
  });

  it("异常路径：DELETE 失败 → 返回 PG_<status>，不抛裸异常", async () => {
    const { lib } = makeDeleteLib({ callerRow: [{ role: "admin", status: "active" }] });
    stubFetch(0, false); // fetch 返回非 2xx（500）
    const { main } = loadFunction("kbAdminDeleteUserData", lib);
    const res = await main({ uid: "target-uid" });
    expect(res.ok).toBe(false);
    // 锚定整串：`toContain("PG_500")` 会把 `PG_5000` 也判过（前缀匹配），故收紧为精确等值。
    expect(res.error).toBe("PG_500: boom");
  });
});

/* ================================================================== */
/* kbRegister（R22 / R26 名额）                                         */
/* ================================================================== */
interface RegUser {
  uid: string;
  username: string;
  status: string;
}

function makeRegisterLib(cfg: { users?: RegUser[]; callerUid?: string }): {
  lib: Dict;
  calls: { pgRequest: Array<{ method: string; table: string; opts: Dict }>; pgCount: Array<{ table: string; query: Dict }> };
} {
  const users = cfg.users ?? [];
  const calls = {
    pgRequest: [] as Array<{ method: string; table: string; opts: Dict }>,
    pgCount: [] as Array<{ table: string; query: Dict }>,
  };
  const lib: Dict = {
    USER_LIMIT: 20,
    // 2026-09-29：登录改为平台原生手机号验证码后，本函数身份取自平台会话（getCaller），
    //   入参不再包含用户名 / 登录密码；login_hash 写哨兵值。
    PASSWORD_LOGIN_DISABLED: "RESET-REQUIRED",
    ok: (data?: unknown) => ok(data),
    fail: (code: string) => fail(code),
    normalizeEvent: (e: unknown) => (e && typeof e === "object" ? e : {}),
    getCaller: () => ({ uid: cfg.callerUid ?? "test-uid", openId: "", customUserId: "" }),
    resolveDisplayName: async () => "138****8000",
    pgRequest: async (method: string, table: string, opts: Dict = {}) => {
      calls.pgRequest.push({ method, table, opts });
      const query = (opts.query ?? {}) as Dict;
      if (method === "GET" && table === "kb_users") {
        // 新实现按 uid 查重（幂等判定），不再是按 username 查重
        const wantUid = String(query.uid ?? "").replace(/^eq\./, "");
        return users
          .filter((u) => u.uid === wantUid)
          .map((u) => ({ uid: u.uid, role: "user", status: u.status }));
      }
      if (method === "PATCH" && table === "kb_invites") return [{ id: 1 }];
      return null;
    },
    pgCount: async (table: string, query: Dict) => {
      calls.pgCount.push({ table, query });
      // 解释 status 过滤，忠实模拟真实 PG：neq.deleted / eq.active
      const s = query.status;
      if (s === "neq.deleted") return users.filter((u) => u.status !== "deleted").length;
      if (s === "eq.active") return users.filter((u) => u.status === "active").length;
      return users.length;
    },
  };
  return { lib, calls };
}

function validEvent(overrides: Dict = {}): Dict {
  return {
    code: "KB-testcode",
    kdfSalt: "SALT",
    kdfVerifier: "VERIFIER",
    ...overrides,
  };
}

function seatQuery(calls: Array<{ table: string; query: Dict }>): Dict | undefined {
  return calls.find((c) => c.table === "kb_users")?.query;
}

describe("R22/R26 kbRegister：名额统计按 status<>'deleted'（软删释放名额）", () => {
  it("★上限统计查询【恰好】是 status=neq.deleted（不是 eq.active）", async () => {
    const { lib, calls } = makeRegisterLib({ users: [] });
    const { main } = loadFunction("kbRegister", lib);
    await main(validEvent());
    const q = seatQuery(calls.pgCount);
    expect(q).toEqual({ select: "uid", status: "neq.deleted" });
    expect(q?.status).not.toBe("eq.active");
  });

  it("20 个 active → LIMIT_REACHED，且不占用邀请码、不建用户", async () => {
    const users: RegUser[] = Array.from({ length: 20 }, (_, i) => ({
      uid: `u${i}`,
      username: `user${i}`,
      status: "active",
    }));
    const { lib, calls } = makeRegisterLib({ users });
    const { main } = loadFunction("kbRegister", lib);
    const res = await main(validEvent());
    expect(res.error).toBe("LIMIT_REACHED");
    expect(calls.pgRequest.some((c) => c.method === "POST" && c.table === "kb_users")).toBe(false);
    expect(calls.pgRequest.some((c) => c.method === "PATCH" && c.table === "kb_invites")).toBe(false);
  });

  it("★19 active + 1 deleted → 放行（软删用户不再占名额）", async () => {
    const users: RegUser[] = [
      ...Array.from({ length: 19 }, (_, i) => ({ uid: `u${i}`, username: `user${i}`, status: "active" })),
      { uid: "u19", username: "gone", status: "deleted" },
    ];
    const { lib, calls } = makeRegisterLib({ users });
    const { main } = loadFunction("kbRegister", lib);
    const res = await main(validEvent());
    expect(res.ok).toBe(true);
    expect(calls.pgRequest.some((c) => c.method === "POST" && c.table === "kb_users")).toBe(true);
  });

  it("★19 active + 1 disabled → 仍 LIMIT_REACHED（disabled 不释放名额，只有 deleted 释放）", async () => {
    const users: RegUser[] = [
      ...Array.from({ length: 19 }, (_, i) => ({ uid: `u${i}`, username: `user${i}`, status: "active" })),
      { uid: "u19", username: "off", status: "disabled" },
    ];
    const { lib } = makeRegisterLib({ users });
    const { main } = loadFunction("kbRegister", lib);
    const res = await main(validEvent());
    expect(res.error).toBe("LIMIT_REACHED");
  });

  it("建用户体：role=user、status=active、uid 取自平台会话、且【不含任何主密码字段】", async () => {
    const { lib, calls } = makeRegisterLib({ users: [], callerUid: "platform-uid-123" });
    const { main } = loadFunction("kbRegister", lib);
    await main(validEvent());
    const post = calls.pgRequest.find((c) => c.method === "POST" && c.table === "kb_users");
    expect(post).toBeDefined();
    const body = (post?.opts.body ?? {}) as Dict;
    expect(body.role).toBe("user");
    expect(body.status).toBe("active");
    // 身份来自平台会话（不再取自 event），用户名是脱敏手机号
    expect(body.uid).toBe("platform-uid-123");
    expect(body.username).toBe("138****8000");
    // 不走密码登录：login_hash 是哨兵值（不可能通过任何密码校验）
    expect(body.login_hash).toBe("RESET-REQUIRED");
    // 只有 login_hash（哨兵），绝无主密码 / 明文。
    // R28：恢复四列【始终显式出现】于 INSERT 体（未提供恢复码时为 null），绝不依赖 DB 默认值。
    const keys = Object.keys(body).sort();
    expect(keys).toEqual(
      [
        "key_epoch",
        "kdf_salt",
        "kdf_verifier",
        "login_hash",
        "recovery_ack_at",
        "recovery_blob",
        "recovery_created_at",
        "recovery_salt",
        "role",
        "status",
        "uid",
        "username",
      ].sort()
    );
    // 本用例未提供恢复码 → 恢复材料显式为 null，且激活【绝不】替用户确认（ack 恒 null）
    expect(body.recovery_salt).toBeNull();
    expect(body.recovery_blob).toBeNull();
    expect(body.recovery_created_at).toBeNull();
    expect(body.recovery_ack_at).toBeNull();
    expect(JSON.stringify(body).toLowerCase()).not.toContain("master");
  });

  it("★该平台账号已激活 → 幂等返回成功（不重复建行、不消耗邀请码）", async () => {
    const { lib, calls } = makeRegisterLib({
      users: [{ uid: "test-uid", username: "138****8000", status: "active" }],
    });
    const { main } = loadFunction("kbRegister", lib);
    const res = await main(validEvent());
    expect(res.ok).toBe(true);
    expect(res.data?.alreadyActivated).toBe(true);
    // 幂等路径绝不写入、也不占用邀请码
    expect(calls.pgRequest.some((c) => c.method === "POST" && c.table === "kb_users")).toBe(false);
    expect(calls.pgRequest.some((c) => c.method === "PATCH" && c.table === "kb_invites")).toBe(false);
  });

  it("无效邀请码（占用返回空）→ INVALID_CODE", async () => {
    const { lib } = makeRegisterLib({ users: [] });
    // 让邀请码占用返回空数组，模拟“已被占用”
    (lib.pgRequest as unknown) = async (method: string, table: string) => {
      if (method === "GET" && table === "kb_users") return [];
      if (method === "PATCH" && table === "kb_invites") return [];
      return null;
    };
    const { main } = loadFunction("kbRegister", lib);
    const res = await main(validEvent());
    expect(res.error).toBe("INVALID_CODE");
  });
});
