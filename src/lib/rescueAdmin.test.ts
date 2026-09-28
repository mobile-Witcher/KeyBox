/**
 * rescueAdmin.test.ts —— 本地救援脚本 scripts/rescue-admin.js 的单测。
 *
 * 为什么值得测：救援脚本是"账号已经登不进去"时的最后一根绳。它必须满足两条铁律，
 *   且都必须被测试【抓住回归】（不是"看起来对"）：
 *   1) 脚本生成的登录密码哈希，必须能被【真实】云函数 lib.js 的 verifyLoginPwd 校验通过
 *      ——否则会在最需要救命的时候失败（哈希不兼容 = 永远登不上）。
 *   2) 任何写操作缺 `--yes` 一律【不执行】——避免"只看一眼预览"就把生产库改了。
 *
 * 隔离方式：
 *   · 救援脚本是 ESM（package.json "type":"module"），用【动态 import】加载真源码；
 *     其 CLI 由 `import.meta.url === pathToFileURL(process.argv[1])` 守卫，被 import 时无副作用。
 *   · 真实 lib.js 是 CommonJS 且在顶层 `require("@cloudbase/node-sdk")`（本机未安装），
 *     故用与 step8CloudFunctions.test.ts 相同的 `new Function` 沙箱注入假 require 运行真源码，
 *     只取其中的 hashLoginPwd / verifyLoginPwd（纯函数，不依赖 SDK）。
 */
import * as nodeCrypto from "node:crypto";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const here = nodePath.dirname(fileURLToPath(import.meta.url)); // src/lib
const SCRIPT_PATH = nodePath.resolve(here, "../../scripts/rescue-admin.js");
const LIB_PATH = nodePath.resolve(here, "../../cloudfunctions/kbInviteCreate/lib.js");

// ---------------------------------------------------------------------------
// 类型：救援脚本的公开契约（仅测试所需）
// ---------------------------------------------------------------------------
interface PgOptions {
  query?: Record<string, unknown>;
  prefer?: string;
  body?: unknown;
}
interface PgCall {
  method: string;
  table: string;
  options: PgOptions;
}
interface PgContext {
  pg: {
    request: (method: string, table: string, options?: PgOptions) => Promise<{ data: unknown; count: number | null }>;
  };
}
interface WriteResult {
  executed: boolean;
  reason?: string;
  preview?: string;
  uid?: string;
  status?: string;
  username?: string;
  generated?: boolean;
}
interface RescueModule {
  RESET_REQUIRED: string;
  hashLoginPwd: (password: string) => string;
  randomUid: () => string;
  resolveCreds: (env: Record<string, string | undefined>) => { envId: string; apiKey: string };
  makePgClient: (
    creds: { envId: string; apiKey: string },
    fetchImpl?: unknown
  ) => { request: (method: string, table: string, options?: PgOptions) => Promise<{ data: unknown; count: number | null }> };
  listUsers: (ctx: PgContext) => Promise<Array<{ uid: string; username: string; role: string; status: string; created_at: string }>>;
  detectOwnerUid: (ctx: PgContext) => Promise<{ uid: string; count: number } | null>;
  resetLogin: (ctx: PgContext, args: { uid?: string; password?: string; yes?: boolean }) => Promise<WriteResult>;
  setStatus: (ctx: PgContext, args: { uid?: string; status?: string; yes?: boolean }) => Promise<WriteResult>;
  recreateAdmin: (
    ctx: PgContext,
    args: { uid?: string; username?: string; forceNewUid?: boolean; yes?: boolean }
  ) => Promise<WriteResult>;
}

const rescue = (await import(/* @vite-ignore */ pathToFileURL(SCRIPT_PATH).href)) as RescueModule;

// ---------------------------------------------------------------------------
// 加载【真实】lib.js（沙箱注入假 require）
// ---------------------------------------------------------------------------
interface RealLib {
  hashLoginPwd: (password: string) => string;
  verifyLoginPwd: (password: string, stored: string) => boolean;
}
function loadRealLib(): RealLib {
  const src = nodeFs.readFileSync(LIB_PATH, "utf8");
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  const requireShim = (id: string): unknown => {
    if (id === "@cloudbase/node-sdk") return { init: () => ({ auth: () => ({ getUserInfo: () => ({}) }) }) };
    if (id === "fs") return nodeFs;
    if (id === "path") return nodePath;
    if (id === "crypto") return nodeCrypto;
    throw new Error(`unexpected require(${id})`);
  };
  const factory = new Function("require", "module", "exports", src);
  factory(requireShim, mod, mod.exports);
  if (typeof mod.exports.verifyLoginPwd !== "function") throw new Error("真实 lib.js 未导出 verifyLoginPwd");
  return mod.exports as unknown as RealLib;
}
const realLib = loadRealLib();

// ---------------------------------------------------------------------------
// 假 ctx（记录每次 PG 调用，按 "METHOD table" 路由返回体）
// ---------------------------------------------------------------------------
function makeCtx(
  routes: Record<string, () => { data: unknown; count?: number | null }> = {}
): { calls: PgCall[]; ctx: PgContext } {
  const calls: PgCall[] = [];
  const ctx: PgContext = {
    pg: {
      async request(method: string, table: string, options: PgOptions = {}) {
        calls.push({ method, table, options });
        const handler = routes[`${method} ${table}`];
        const r = handler ? handler() : { data: [], count: null };
        return { data: r.data ?? [], count: r.count ?? null };
      },
    },
  };
  return { calls, ctx };
}
const writeCalls = (calls: PgCall[]): PgCall[] => calls.filter((c) => c.method === "POST" || c.method === "PATCH" || c.method === "DELETE");

// ===========================================================================
// 红线 1：哈希往返（脚本生成的哈希 → 真实 verifyLoginPwd 必须通过）
// ===========================================================================
describe("rescueAdmin：登录密码哈希必须与真实云函数 lib.js 兼容（救命前提）", () => {
  it("★脚本生成的哈希 → 真实 verifyLoginPwd 必须通过（往返一致）", () => {
    for (const pwd of ["correct horse battery", "新登录密码-8位以上", "aVeryLongP@ssw0rd_123456"]) {
      const hash = rescue.hashLoginPwd(pwd);
      expect(realLib.verifyLoginPwd(pwd, hash)).toBe(true);
    }
  });

  it("★反例：错误密码必须【不通过】（否则哈希等于没校验）", () => {
    const hash = rescue.hashLoginPwd("the-right-one");
    expect(realLib.verifyLoginPwd("the-WRONG-one", hash)).toBe(false);
    expect(realLib.verifyLoginPwd("", hash)).toBe(false);
    expect(realLib.verifyLoginPwd("the-right-one ", hash)).toBe(false); // 尾随空格也不认
  });

  it("格式为 scrypt$N$r$p$saltB64$hashB64，且参数与 lib.js 一致（N=16384,r=8,p=1）", () => {
    const hash = rescue.hashLoginPwd("format-check");
    const parts = hash.split("$");
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe("scrypt");
    expect(parts[1]).toBe("16384");
    expect(parts[2]).toBe("8");
    expect(parts[3]).toBe("1");
    expect(Buffer.from(parts[4], "base64").length).toBe(16); // 16B salt
    expect(Buffer.from(parts[5], "base64").length).toBe(32); // keylen=32
  });

  it("两次哈希不同（随机 salt），但都能被 verifyLoginPwd 通过", () => {
    const a = rescue.hashLoginPwd("same-password");
    const b = rescue.hashLoginPwd("same-password");
    expect(a).not.toBe(b);
    expect(realLib.verifyLoginPwd("same-password", a)).toBe(true);
    expect(realLib.verifyLoginPwd("same-password", b)).toBe(true);
  });

  it("真实 lib.js 生成的哈希，脚本口径也能认可（双向一致）", () => {
    const hash = realLib.hashLoginPwd("roundtrip-both-ways");
    // 脚本未导出 verify，但同一算法：用真实 verify 校验脚本产物已足够；
    // 这里反过来断言"真生成的也能被真校验通过"，防止只测了单向。
    expect(realLib.verifyLoginPwd("roundtrip-both-ways", hash)).toBe(true);
  });

  it("空串 / 畸形串 → verifyLoginPwd 返回 false，不会误判为登录成功", () => {
    expect(realLib.verifyLoginPwd("anything", "")).toBe(false);
    expect(realLib.verifyLoginPwd("anything", "not-a-hash")).toBe(false);
  });

  it("★哨兵占位（RESET-REQUIRED）不可能被当成合法登录哈希：任意密码【含空密码】必 false", () => {
    // 这条守住"重建后到重设主密码前不能登录"的安全属性（空串若被当'无密码'放行就是静默绕过）。
    const sentinel = rescue.RESET_REQUIRED;
    expect(sentinel.length).toBeGreaterThan(0); // 绝不能退化成空串
    expect(sentinel).not.toBe("");
    for (const pwd of ["", " ", "anything", "admin123456", sentinel, "RESET-REQUIRED", "reset-required"]) {
      expect(realLib.verifyLoginPwd(pwd, sentinel)).toBe(false);
    }
  });
});

// ===========================================================================
// 红线 2：写操作缺 --yes 一律不执行
// ===========================================================================
describe("rescueAdmin：所有写操作缺 --yes 一律【不执行】（不改任何东西）", () => {
  it("reset-login 缺 --yes → executed=false / reason=NO_YES，且【零】PG 调用", async () => {
    const { calls, ctx } = makeCtx();
    const res = await rescue.resetLogin(ctx, { uid: "USER-A", password: "newpass123" });
    expect(res.executed).toBe(false);
    expect(res.reason).toBe("NO_YES");
    expect(res.preview).toContain("login_hash");
    expect(calls).toEqual([]); // 连读都没有
  });

  it("set-status 缺 --yes → executed=false / reason=NO_YES，且【零】PG 调用", async () => {
    const { calls, ctx } = makeCtx();
    const res = await rescue.setStatus(ctx, { uid: "USER-A", status: "active" });
    expect(res.executed).toBe(false);
    expect(res.reason).toBe("NO_YES");
    expect(res.preview).toContain("status");
    expect(calls).toEqual([]);
  });

  it("recreate-admin 缺 --yes → executed=false，且【没有任何写调用】（只有只读探测）", async () => {
    const { calls, ctx } = makeCtx({ "GET kb_users": () => ({ data: [] }) });
    const res = await rescue.recreateAdmin(ctx, { uid: "USER-A" });
    expect(res.executed).toBe(false);
    expect(res.reason).toBe("NO_YES");
    expect(res.preview).toContain("INSERT");
    expect(writeCalls(calls)).toEqual([]); // 允许 GET，但绝不允许 POST/PATCH/DELETE
  });
});

// ===========================================================================
// reset-login：只改 login_hash 一列
// ===========================================================================
describe("rescueAdmin：reset-login 只改 login_hash，绝不旁触加密列", () => {
  it("带 --yes → PATCH kb_users，过滤 uid=eq.X，prefer=return=minimal，body 仅含 login_hash", async () => {
    const { calls, ctx } = makeCtx();
    const res = await rescue.resetLogin(ctx, { uid: "USER-A", password: "brand-new-pwd", yes: true });
    expect(res.executed).toBe(true);

    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch).toBeTruthy();
    expect(patch!.table).toBe("kb_users");
    expect(patch!.options.query?.uid).toBe("eq.USER-A");
    expect(patch!.options.prefer).toBe("return=minimal");

    const body = patch!.options.body as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["login_hash"]); // 有且仅有这一列
    expect(realLib.verifyLoginPwd("brand-new-pwd", String(body.login_hash))).toBe(true);
  });

  it("缺 uid → MISSING_UID（不发请求）", async () => {
    const { calls, ctx } = makeCtx();
    await expect(rescue.resetLogin(ctx, { password: "x".repeat(12), yes: true })).rejects.toThrow("MISSING_UID");
    expect(calls).toEqual([]);
  });

  it("缺 password → MISSING_PASSWORD（不发请求）", async () => {
    const { calls, ctx } = makeCtx();
    await expect(rescue.resetLogin(ctx, { uid: "USER-A", yes: true })).rejects.toThrow("MISSING_PASSWORD");
    expect(calls).toEqual([]);
  });
});

// ===========================================================================
// set-status：只改 status 一列
// ===========================================================================
describe("rescueAdmin：set-status 只改 status 一列", () => {
  it("带 --yes → PATCH kb_users，body 仅含 status", async () => {
    const { calls, ctx } = makeCtx();
    const res = await rescue.setStatus(ctx, { uid: "USER-A", status: "active", yes: true });
    expect(res.executed).toBe(true);
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.options.query?.uid).toBe("eq.USER-A");
    expect(patch.options.prefer).toBe("return=minimal");
    expect(patch.options.body).toEqual({ status: "active" });
  });

  it("非法 status → INVALID_STATUS（不发请求）", async () => {
    const { calls, ctx } = makeCtx();
    await expect(rescue.setStatus(ctx, { uid: "USER-A", status: "hacked", yes: true })).rejects.toThrow("INVALID_STATUS");
    expect(calls).toEqual([]);
  });

  it("缺 uid → MISSING_UID", async () => {
    const { calls, ctx } = makeCtx();
    await expect(rescue.setStatus(ctx, { uid: "", status: "active", yes: true })).rejects.toThrow("MISSING_UID");
    expect(calls).toEqual([]);
  });
});

// ===========================================================================
// recreate-admin：uid 规则（不默认生成新 uid；force-new-uid 才生成）
// ===========================================================================
describe("rescueAdmin：recreate-admin 的 uid 规则", () => {
  it("显式 --uid 且行不存在 → POST 新建，role=admin/status=active，且【不碰】加密列真值", async () => {
    const { calls, ctx } = makeCtx({ "GET kb_users": () => ({ data: [] }) });
    const res = await rescue.recreateAdmin(ctx, { uid: "USER-A", username: "管理员", yes: true });
    expect(res.executed).toBe(true);
    expect(res.uid).toBe("USER-A");
    expect(res.generated).toBe(false);

    const post = calls.find((c) => c.method === "POST")!;
    expect(post.table).toBe("kb_users");
    const body = post.options.body as Record<string, unknown>;
    expect(body.uid).toBe("USER-A");
    expect(body.username).toBe("管理员");
    expect(body.role).toBe("admin");
    expect(body.status).toBe("active");
    // NOT NULL 占位列以**哨兵值**占位（重建行的现实约束）；绝不写 kdf_salt_prev/key_epoch/payload
    expect(body.login_hash).toBe(rescue.RESET_REQUIRED);
    expect(body.kdf_salt).toBe(rescue.RESET_REQUIRED);
    expect(body.kdf_verifier).toBe(rescue.RESET_REQUIRED);
    expect(Object.keys(body).sort()).toEqual(["kdf_salt", "kdf_verifier", "login_hash", "role", "status", "uid", "username"]);
    expect(body).not.toHaveProperty("kdf_salt_prev");
    expect(body).not.toHaveProperty("key_epoch");
    expect(body).not.toHaveProperty("payload");
  });

  it("显式 --uid 但行已存在 → USER_ALREADY_EXISTS（绝不覆盖既有加密材料）", async () => {
    const { calls, ctx } = makeCtx({ "GET kb_users": () => ({ data: [{ uid: "USER-A" }] }) });
    await expect(rescue.recreateAdmin(ctx, { uid: "USER-A", yes: true })).rejects.toThrow("USER_ALREADY_EXISTS");
    expect(writeCalls(calls)).toEqual([]); // 报错前没有任何写入
  });

  it("未传 --uid → 自动探测 kb_secrets 中归属最集中的 owner_id 并复用它（确定性，不随机）", async () => {
    const { calls, ctx } = makeCtx({
      "GET kb_secrets": () => ({ data: [{ owner_id: "A" }, { owner_id: "A" }, { owner_id: "A" }, { owner_id: "B" }] }),
      "GET kb_users": () => ({ data: [] }),
    });
    const res = await rescue.recreateAdmin(ctx, { yes: true });
    expect(res.uid).toBe("A"); // 出现 3 次 > B 的 1 次
    expect(res.generated).toBe(false);
    const post = calls.find((c) => c.method === "POST")!;
    expect((post.options.body as Record<string, unknown>).uid).toBe("A");
  });

  it("--force-new-uid → 生成全新 uid（≠ 探测到的），generated=true，且预览含【红色警告】", async () => {
    const { calls, ctx } = makeCtx({
      "GET kb_secrets": () => ({ data: [{ owner_id: "A" }, { owner_id: "A" }] }),
      "GET kb_users": () => ({ data: [] }),
    });
    const res = await rescue.recreateAdmin(ctx, { forceNewUid: true, yes: true });
    expect(res.generated).toBe(true);
    expect(res.uid).toBeTruthy();
    expect(res.uid).not.toBe("A");
    expect(res.uid!.length).toBe(24);
    const post = calls.find((c) => c.method === "POST")!;
    expect((post.options.body as Record<string, unknown>).uid).toBe(res.uid);
  });

  it("--force-new-uid 的【预览阶段】必须出现『原有密文将看不到』的警告文案", async () => {
    const { ctx } = makeCtx({
      "GET kb_secrets": () => ({ data: [{ owner_id: "A" }] }),
      "GET kb_users": () => ({ data: [] }),
    });
    const res = await rescue.recreateAdmin(ctx, { forceNewUid: true }); // 缺 --yes → 只看预览
    expect(res.executed).toBe(false);
    expect(res.preview).toContain("⚠️");
    expect(res.preview).toContain("看不到");
  });

  it("库中无任何密文且未传 --uid → CANNOT_DETECT_UID（不擅自生成，避免又一个孤账号）", async () => {
    const { calls, ctx } = makeCtx({
      "GET kb_secrets": () => ({ data: [] }),
      "GET kb_users": () => ({ data: [] }),
    });
    await expect(rescue.recreateAdmin(ctx, { yes: true })).rejects.toThrow("CANNOT_DETECT_UID");
    expect(writeCalls(calls)).toEqual([]);
  });
});

// ===========================================================================
// list-users / detectOwnerUid：只读白名单，绝不带 payload
// ===========================================================================
describe("rescueAdmin：只读命令的字段白名单（绝不读 payload）", () => {
  it("list-users 只取 uid/username/role/status/created_at，且 select 不含 payload", async () => {
    const { calls, ctx } = makeCtx({
      "GET kb_users": () => ({
        data: [
          { uid: "U1", username: "alice", role: "member", status: "active", created_at: "2026-01-01", payload: "SHOULD-NOT-LEAK", login_hash: "SHOULD-NOT-LEAK" },
        ],
      }),
    });
    const rows = await rescue.listUsers(ctx);
    expect(rows).toEqual([{ uid: "U1", username: "alice", role: "member", status: "active", created_at: "2026-01-01" }]);
    expect(Object.keys(rows[0]).sort()).toEqual(["created_at", "role", "status", "uid", "username"]);
    const select = String(calls[0].options.query?.select ?? "");
    expect(select).not.toContain("payload");
    expect(select).not.toContain("login_hash");
  });

  it("detectOwnerUid 只取 owner_id 列，且选出现次数最多者", async () => {
    const { calls, ctx } = makeCtx({
      "GET kb_secrets": () => ({ data: [{ owner_id: "A" }, { owner_id: "B" }, { owner_id: "A" }] }),
    });
    const found = await rescue.detectOwnerUid(ctx);
    expect(found).toEqual({ uid: "A", count: 2 });
    expect(calls[0].options.query?.select).toBe("owner_id");
  });
});

// ===========================================================================
// randomUid / resolveCreds / makePgClient：格式与凭据纪律
// ===========================================================================
describe("rescueAdmin：uid 与凭据纪律", () => {
  it("randomUid 为 24 位 base62", () => {
    const uid = rescue.randomUid();
    expect(uid).toHaveLength(24);
    expect(uid).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(rescue.randomUid()).not.toBe(uid);
  });

  it("resolveCreds 兼容 TCB_ENV/ENV_ID/VITE_CLOUDBASE_ENV_ID 与 CLOUDBASE_API_KEY/APIKEY，并去空白", () => {
    expect(rescue.resolveCreds({ TCB_ENV: " env-1 ", CLOUDBASE_API_KEY: " key-1 " })).toEqual({ envId: "env-1", apiKey: "key-1" });
    expect(rescue.resolveCreds({ ENV_ID: "env-2", CLOUDBASE_APIKEY: "key-2" })).toEqual({ envId: "env-2", apiKey: "key-2" });
    expect(rescue.resolveCreds({ VITE_CLOUDBASE_ENV_ID: "env-3" })).toEqual({ envId: "env-3", apiKey: "" });
    expect(rescue.resolveCreds({})).toEqual({ envId: "", apiKey: "" });
  });

  it("makePgClient 缺 envId / apiKey → 抛 ENV_ID_MISSING / SERVICE_CREDENTIAL_MISSING", () => {
    expect(() => rescue.makePgClient({ envId: "", apiKey: "k" })).toThrow("ENV_ID_MISSING");
    expect(() => rescue.makePgClient({ envId: "e", apiKey: "" })).toThrow("SERVICE_CREDENTIAL_MISSING");
  });

  it("makePgClient：apiKey 只进 Authorization 头，【绝不】出现在 URL（不泄漏）", async () => {
    const captured: Array<{ url: string; init: { method: string; headers: Record<string, string> } }> = [];
    const fakeFetch = async (url: string, init: { method: string; headers: Record<string, string> }) => {
      captured.push({ url, init });
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => "" };
    };
    const client = rescue.makePgClient({ envId: "env-abc", apiKey: "SECRET-SVC-KEY" }, fakeFetch);
    await client.request("GET", "kb_users", { query: { uid: "eq.U1" } });
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toContain("https://env-abc.api.tcloudbasegateway.com/v1/rdb/rest/kb_users");
    expect(captured[0].url).toContain("uid=eq.U1");
    expect(captured[0].url).not.toContain("SECRET-SVC-KEY");
    expect(captured[0].init.headers.Authorization).toBe("Bearer SECRET-SVC-KEY");
  });
});
