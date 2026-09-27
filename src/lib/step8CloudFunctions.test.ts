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
import { describe, expect, it } from "vitest";

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

function makeDeleteLib(cfg: {
  callerUid?: string;
  callerRow?: Array<{ role: string; status: string }>;
  countSeq?: number[];
}): { lib: Dict; calls: { pgRequest: DeleteCall[]; pgCount: Array<{ table: string; query: Dict }>; getCaller: number } } {
  const calls = {
    pgRequest: [] as DeleteCall[],
    pgCount: [] as Array<{ table: string; query: Dict }>,
    getCaller: 0,
  };
  let countIdx = 0;
  const seq = cfg.countSeq ?? [0];
  const lib: Dict = {
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
      const value = seq[Math.min(countIdx, seq.length - 1)];
      countIdx += 1;
      return value;
    },
  };
  return { lib, calls };
}

function deleteCalls(calls: DeleteCall[]): DeleteCall[] {
  return calls.filter((c) => c.method === "DELETE" && c.table === "kb_secrets");
}

describe("R14 kbAdminDeleteUserData：身份与范围收口", () => {
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

  it("DELETE 只按 owner_id=目标收口，且 prefer=return=minimal（绝无 representation）", async () => {
    const { lib, calls } = makeDeleteLib({ callerRow: [{ role: "admin", status: "active" }] });
    const { main } = loadFunction("kbAdminDeleteUserData", lib);
    await main({ uid: "target-uid" });

    const dels = deleteCalls(calls.pgRequest);
    expect(dels).toHaveLength(1);
    expect(dels[0].opts.query).toEqual({ owner_id: "eq.target-uid" });
    expect(dels[0].opts.prefer).toBe("return=minimal");
    expect(String(dels[0].opts.prefer)).not.toContain("representation");
    // 任何请求都不得使用 representation
    const anyRepr = calls.pgRequest.some((c) => String(c.opts.prefer ?? "").includes("representation"));
    expect(anyRepr).toBe(false);
  });

  it("用户记录【软删】status='deleted'（PATCH，而非 DELETE 物理删行）", async () => {
    const { lib, calls } = makeDeleteLib({ callerRow: [{ role: "admin", status: "active" }] });
    const { main } = loadFunction("kbAdminDeleteUserData", lib);
    await main({ uid: "target-uid" });

    const patch = calls.pgRequest.find((c) => c.method === "PATCH" && c.table === "kb_users");
    expect(patch).toBeDefined();
    expect(patch?.opts.body).toEqual({ status: "deleted" });
    expect(patch?.opts.query).toEqual({ uid: "eq.target-uid" });
    // 没有对 kb_users 的物理 DELETE
    expect(calls.pgRequest.some((c) => c.method === "DELETE" && c.table === "kb_users")).toBe(false);
  });

  it("★返回体【只】含 {deletedCount}，且为 before-after 的差值", async () => {
    const { lib } = makeDeleteLib({
      callerRow: [{ role: "admin", status: "active" }],
      countSeq: [5, 2],
    });
    const { main } = loadFunction("kbAdminDeleteUserData", lib);
    const res = await main({ uid: "target-uid" });

    expect(res.ok).toBe(true);
    expect(res.data).toBeTruthy();
    expect(Object.keys(res.data as Dict)).toEqual(["deletedCount"]);
    expect((res.data as Dict).deletedCount).toBe(3);
    // 响应体不含任何内容字段
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("payload");
    expect(serialized).not.toContain("KB1:");
  });

  it("before<after（异常）时 deletedCount 不为负（Math.max 兜底）", async () => {
    const { lib } = makeDeleteLib({
      callerRow: [{ role: "admin", status: "active" }],
      countSeq: [1, 4],
    });
    const { main } = loadFunction("kbAdminDeleteUserData", lib);
    const res = await main({ uid: "target-uid" });
    expect((res.data as Dict).deletedCount).toBe(0);
  });

  it("计数口径一致：两次 pgCount 都按 owner_id=目标 收口", async () => {
    const { lib, calls } = makeDeleteLib({
      callerRow: [{ role: "admin", status: "active" }],
      countSeq: [2, 0],
    });
    const { main } = loadFunction("kbAdminDeleteUserData", lib);
    await main({ uid: "target-uid" });
    expect(calls.pgCount).toHaveLength(2);
    for (const c of calls.pgCount) {
      expect(c.table).toBe("kb_secrets");
      expect(c.query.owner_id).toBe("eq.target-uid");
    }
  });

  it("异常路径：底层抛错 → 返回 fail(message)，不抛裸异常", async () => {
    const { lib } = makeDeleteLib({ callerRow: [{ role: "admin", status: "active" }] });
    (lib.pgCount as unknown) = async () => {
      throw new Error("PG_500");
    };
    const { main } = loadFunction("kbAdminDeleteUserData", lib);
    const res = await main({ uid: "target-uid" });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("PG_500");
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

function makeRegisterLib(cfg: { users?: RegUser[] }): {
  lib: Dict;
  calls: { pgRequest: Array<{ method: string; table: string; opts: Dict }>; pgCount: Array<{ table: string; query: Dict }> };
} {
  const users = cfg.users ?? [];
  const calls = {
    pgRequest: [] as Array<{ method: string; table: string; opts: Dict }>,
    pgCount: [] as Array<{ table: string; query: Dict }>,
  };
  const lib: Dict = {
    USERNAME_PATTERN: /^[A-Za-z0-9_.-]{3,32}$/,
    MIN_LOGIN_PWD: 8,
    USER_LIMIT: 20,
    TICKET_REFRESH_MS: 15 * 60 * 1000,
    TICKET_EXPIRE_MS: 7 * 24 * 3600 * 1000,
    ok: (data?: unknown) => ok(data),
    fail: (code: string) => fail(code),
    getApp: () => ({ auth: () => ({ createTicket: () => "FAKE_TICKET" }) }),
    pgRequest: async (method: string, table: string, opts: Dict = {}) => {
      calls.pgRequest.push({ method, table, opts });
      const query = (opts.query ?? {}) as Dict;
      if (method === "GET" && table === "kb_users") {
        const want = String(query.username ?? "").replace(/^eq\./, "");
        return users.filter((u) => u.username === want).map((u) => ({ uid: u.uid }));
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
    randomUid: () => "NEWUID24CHARS0000000000",
    hashLoginPwd: (pwd: string) => `scrypt$fake$${String(pwd).length}`,
  };
  return { lib, calls };
}

function validEvent(overrides: Dict = {}): Dict {
  return {
    code: "KB-testcode",
    username: "newuser",
    loginPwd: "secret123",
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

  it("建用户体：role=user、status=active、owner 字段无关、且【不含任何主密码字段】", async () => {
    const { lib, calls } = makeRegisterLib({ users: [] });
    const { main } = loadFunction("kbRegister", lib);
    await main(validEvent());
    const post = calls.pgRequest.find((c) => c.method === "POST" && c.table === "kb_users");
    expect(post).toBeDefined();
    const body = (post?.opts.body ?? {}) as Dict;
    expect(body.role).toBe("user");
    expect(body.status).toBe("active");
    expect(body.username).toBe("newuser");
    // 只有 login_hash（哈希），绝无主密码 / 明文
    const keys = Object.keys(body).sort();
    expect(keys).toEqual(
      ["key_epoch", "kdf_salt", "kdf_verifier", "login_hash", "role", "status", "uid", "username"].sort()
    );
    expect(JSON.stringify(body).toLowerCase()).not.toContain("master");
    expect(JSON.stringify(body)).not.toContain("secret123");
  });

  it("用户名已存在 → USERNAME_TAKEN（早于名额/建号）", async () => {
    const { lib, calls } = makeRegisterLib({
      users: [{ uid: "u1", username: "newuser", status: "active" }],
    });
    const { main } = loadFunction("kbRegister", lib);
    const res = await main(validEvent());
    expect(res.error).toBe("USERNAME_TAKEN");
    expect(calls.pgRequest.some((c) => c.method === "POST" && c.table === "kb_users")).toBe(false);
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
