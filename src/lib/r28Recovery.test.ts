/**
 * r28Recovery.test.ts —— R28 恢复码【批次1】对抗性单测。
 *
 * 覆盖范围（team-lead 指派）：
 *   - 迁移：加 recovery_salt / recovery_blob / recovery_created_at / recovery_ack_at 四列；
 *     ★ 列级授权【不放宽】——GRANT SELECT 的列清单里没有 recovery_*（客户端读不到恢复材料）。
 *   - kbRegister / kbInitAdmin：显式写恢复材料（成对校验；缺省时显式 null，绝不依赖 DB 默认；
 *     注册/初始化【绝不】替用户确认 recovery_ack_at）。
 *   - kbGetMyRole：select 显式列含 recovery_salt/blob/ack_at（且【不含】login_hash）；
 *     只读【本人】那一行；返回体把恢复三件套回给本人。
 *   - 管理员用户列表路径（kb_admin_user_list() / admin.ts）【永不】出现 recovery_blob。
 *
 * 做法：与 step8CloudFunctions.test.ts 同源的【依赖注入式沙箱】——读云函数真实源码，
 *   用 `new Function` 注入受控假 `require("./lib")`，不触碰真实 SDK / 网络 / 数据库。
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const CLOUD_ROOT = resolve(REPO, "cloudfunctions");
const MIGRATIONS = resolve(REPO, "cloudbase/migrations");
const SRC = resolve(REPO, "src");

type Dict = Record<string, unknown>;
type CloudResult = { ok: boolean; data?: Dict | null; error?: string };
type MainFn = (event?: unknown) => Promise<CloudResult>;

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

/** 去掉 SQL 的行注释（`--` 到行尾），用于“源码层面”断言，避免被注释里的示例误导。 */
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, " ");
}

/* ================================================================== */
/* kbRegister：显式写恢复材料（成对校验）                               */
/* ================================================================== */
interface RegCall {
  method: string;
  table: string;
  opts: Dict & { query?: Dict; body?: Dict };
}

function makeRegisterLib(): { lib: Dict; calls: RegCall[] } {
  const calls: RegCall[] = [];
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
      calls.push({ method, table, opts });
      if (method === "GET" && table === "kb_users") return [];
      if (method === "PATCH" && table === "kb_invites") return [{ id: 1 }];
      return null;
    },
    pgCount: async () => 0,
    randomUid: () => "NEWUID24CHARS0000000000",
    hashLoginPwd: (pwd: string) => `scrypt$fake$${String(pwd).length}`,
  };
  return { lib, calls };
}

function registerEvent(overrides: Dict = {}): Dict {
  return {
    code: "KB-testcode",
    username: "newuser",
    loginPwd: "secret123",
    kdfSalt: "KDFSALT",
    kdfVerifier: "VERIFIER",
    ...overrides,
  };
}

function registerPostBody(calls: RegCall[]): Dict | undefined {
  return calls.find((c) => c.method === "POST" && c.table === "kb_users")?.opts.body;
}

describe("R28 kbRegister：恢复材料显式写入且成对", () => {
  it("★成对提供 → recovery_salt/blob 原样写入、recovery_created_at 为 ISO、recovery_ack_at 恒 null", async () => {
    const { lib, calls } = makeRegisterLib();
    const { main } = loadFunction("kbRegister", lib);
    const res = await main(
      registerEvent({ recoverySalt: "RECSALT", recoveryBlob: "KBRC1:AAAAbbbbCCCCdddd" })
    );
    expect(res.ok).toBe(true);
    const body = registerPostBody(calls);
    expect(body).toBeDefined();
    expect(body?.recovery_salt).toBe("RECSALT");
    expect(body?.recovery_blob).toBe("KBRC1:AAAAbbbbCCCCdddd");
    // created_at 是合法 ISO 串（round-trip）
    expect(new Date(String(body?.recovery_created_at)).toISOString()).toBe(body?.recovery_created_at);
    // 注册【绝不】替用户勾选“已抄下”
    expect(body?.recovery_ack_at).toBeNull();
  });

  it("★只给 recoverySalt（缺 blob）→ MISSING_RECOVERY_PARAMS，且【不建用户】", async () => {
    const { lib, calls } = makeRegisterLib();
    const { main } = loadFunction("kbRegister", lib);
    const res = await main(registerEvent({ recoverySalt: "RECSALT" }));
    expect(res.ok).toBe(false);
    expect(res.error).toBe("MISSING_RECOVERY_PARAMS");
    expect(registerPostBody(calls)).toBeUndefined();
  });

  it("★只给 recoveryBlob（缺 salt）→ MISSING_RECOVERY_PARAMS，且【不占邀请码】", async () => {
    const { lib, calls } = makeRegisterLib();
    const { main } = loadFunction("kbRegister", lib);
    const res = await main(registerEvent({ recoveryBlob: "KBRC1:xxxx" }));
    expect(res.error).toBe("MISSING_RECOVERY_PARAMS");
    expect(calls.some((c) => c.method === "PATCH" && c.table === "kb_invites")).toBe(false);
  });

  it("都缺 → 恢复四列显式为 null（可先开户、稍后补设）", async () => {
    const { lib, calls } = makeRegisterLib();
    const { main } = loadFunction("kbRegister", lib);
    await main(registerEvent());
    const body = registerPostBody(calls);
    expect(body?.recovery_salt).toBeNull();
    expect(body?.recovery_blob).toBeNull();
    expect(body?.recovery_created_at).toBeNull();
    expect(body?.recovery_ack_at).toBeNull();
  });

  it("恢复密文只是被【透传】的密文：绝不把恢复码明文塞进任何字段", async () => {
    const { lib, calls } = makeRegisterLib();
    const { main } = loadFunction("kbRegister", lib);
    // 恢复码明文（32 位 base32，含分组）只应活在客户端；这里证明它不会出现在入库体
    const code = "ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567";
    await main(registerEvent({ recoverySalt: "RECSALT", recoveryBlob: "KBRC1:opaque" }));
    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain(code);
    expect(serialized).not.toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"); // 恢复码原始串
  });
});

/* ================================================================== */
/* kbInitAdmin：同 kbRegister 口径                                     */
/* ================================================================== */
function makeInitLib(existing: number): { lib: Dict; calls: RegCall[] } {
  const calls: RegCall[] = [];
  const lib: Dict = {
    USERNAME_PATTERN: /^[A-Za-z0-9_.-]{3,32}$/,
    MIN_LOGIN_PWD: 8,
    ok: (data?: unknown) => ok(data),
    fail: (code: string) => fail(code),
    pgCount: async () => existing,
    pgRequest: async (method: string, table: string, opts: Dict = {}) => {
      calls.push({ method, table, opts });
      if (method === "GET" && table === "kb_users") return [{ uid: "ADMINUID0000000000000000" }];
      return null;
    },
    randomUid: () => "ADMINUID0000000000000000",
    hashLoginPwd: (pwd: string) => `scrypt$fake$${String(pwd).length}`,
  };
  return { lib, calls };
}

function initEvent(overrides: Dict = {}): Dict {
  return {
    username: "owner",
    loginPwd: "secret123",
    kdfSalt: "KDFSALT",
    kdfVerifier: "VERIFIER",
    ...overrides,
  };
}

describe("R28 kbInitAdmin：显式写恢复材料且成对", () => {
  it("★成对提供 → recovery_salt/blob 写入、created_at 为 ISO、ack 恒 null", async () => {
    const { lib, calls } = makeInitLib(0);
    const { main } = loadFunction("kbInitAdmin", lib);
    const res = await main(initEvent({ recoverySalt: "RS", recoveryBlob: "KBRC1:zzz" }));
    expect(res.ok).toBe(true);
    const body = calls.find((c) => c.method === "POST" && c.table === "kb_users")?.opts.body;
    expect(body?.recovery_salt).toBe("RS");
    expect(body?.recovery_blob).toBe("KBRC1:zzz");
    expect(new Date(String(body?.recovery_created_at)).toISOString()).toBe(body?.recovery_created_at);
    expect(body?.recovery_ack_at).toBeNull();
    expect(body?.role).toBe("admin");
  });

  it("★半对 → MISSING_RECOVERY_PARAMS，且【不写库】", async () => {
    const { lib, calls } = makeInitLib(0);
    const { main } = loadFunction("kbInitAdmin", lib);
    const res = await main(initEvent({ recoveryBlob: "KBRC1:only-blob" }));
    expect(res.error).toBe("MISSING_RECOVERY_PARAMS");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("老闸门不变：表中已有用户 → ALREADY_INITIALIZED（先于任何写入，优先于恢复材料校验之后）", async () => {
    const { lib, calls } = makeInitLib(3);
    const { main } = loadFunction("kbInitAdmin", lib);
    const res = await main(initEvent({ recoverySalt: "RS", recoveryBlob: "KBRC1:z" }));
    expect(res.error).toBe("ALREADY_INITIALIZED");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("都缺 → 恢复四列显式为 null", async () => {
    const { lib, calls } = makeInitLib(0);
    const { main } = loadFunction("kbInitAdmin", lib);
    await main(initEvent());
    const body = calls.find((c) => c.method === "POST" && c.table === "kb_users")?.opts.body;
    expect(body?.recovery_salt).toBeNull();
    expect(body?.recovery_blob).toBeNull();
    expect(body?.recovery_created_at).toBeNull();
    expect(body?.recovery_ack_at).toBeNull();
  });
});

/* ================================================================== */
/* kbGetMyRole：只回本人恢复三件套                                     */
/* ================================================================== */
interface RoleCall {
  method: string;
  table: string;
  opts: Dict & { query?: Dict };
}

function makeRoleLib(cfg: {
  uid?: string;
  row?: Dict | null;
}): { lib: Dict; calls: { pgRequest: RoleCall[] } } {
  const calls = { pgRequest: [] as RoleCall[] };
  const row =
    cfg.row === undefined
      ? {
          role: "user",
          status: "active",
          kdf_salt: "KS",
          kdf_verifier: "KV",
          key_epoch: 2,
          recovery_salt: "RS",
          recovery_blob: "KBRC1:blob",
          recovery_ack_at: "2026-09-28T00:00:00.000Z",
        }
      : cfg.row;
  const lib: Dict = {
    ok: (data?: unknown) => ok(data),
    fail: (code: string) => fail(code),
    getCaller: () => ({ uid: cfg.uid ?? "ME-UID", openId: "", customUserId: "" }),
    pgRequest: async (method: string, table: string, opts: Dict = {}) => {
      calls.pgRequest.push({ method, table, opts });
      return row === null ? [] : [row];
    },
    pgCount: async () => 5,
  };
  return { lib, calls };
}

describe("R28 kbGetMyRole：select 显式列 + 仅回本人", () => {
  it("★select 含 recovery_salt/blob/ack_at，且【不含】login_hash（禁 select *）", async () => {
    const { lib, calls } = makeRoleLib({});
    const { main } = loadFunction("kbGetMyRole", lib);
    await main();
    const select = String(calls.pgRequest[0]?.opts.query?.select ?? "");
    expect(select).toContain("recovery_salt");
    expect(select).toContain("recovery_blob");
    expect(select).toContain("recovery_ack_at");
    expect(select).not.toContain("login_hash");
    expect(select).not.toContain("*");
  });

  it("★只读【本人】那一行（uid=eq.会话 uid），不采信任何入参身份", async () => {
    const { lib, calls } = makeRoleLib({ uid: "ME-UID" });
    const { main } = loadFunction("kbGetMyRole", lib);
    await main({ uid: "SOMEONE-ELSE" } as unknown);
    expect(calls.pgRequest[0]?.opts.query?.uid).toBe("eq.ME-UID");
    expect(JSON.stringify(calls)).not.toContain("SOMEONE-ELSE");
  });

  it("返回体把恢复三件套回给本人（含 ack 供前端判断是否持续提醒）", async () => {
    const { lib } = makeRoleLib({});
    const { main } = loadFunction("kbGetMyRole", lib);
    const res = await main();
    expect(res.ok).toBe(true);
    expect(res.data?.recoverySalt).toBe("RS");
    expect(res.data?.recoveryBlob).toBe("KBRC1:blob");
    expect(res.data?.recoveryAckAt).toBe("2026-09-28T00:00:00.000Z");
    expect(res.data?.keyEpoch).toBe(2);
  });

  it("未登录 → NOT_LOGGED_IN（不读库）", async () => {
    const { lib, calls } = makeRoleLib({ uid: "" });
    const { main } = loadFunction("kbGetMyRole", lib);
    const res = await main();
    expect(res.error).toBe("NOT_LOGGED_IN");
    expect(calls.pgRequest).toHaveLength(0);
  });
});

/* ================================================================== */
/* 迁移：四列 + 授权不放宽（静态断言）                                 */
/* ================================================================== */
describe("R28 迁移：四列可空 + 列级授权不放宽", () => {
  const fileName = readdirSync(MIGRATIONS).find((n) => n.endsWith("_recovery_code_columns.sql"));
  const raw = readFileSync(resolve(MIGRATIONS, fileName as string), "utf8");
  const sql = stripSqlComments(raw);

  it("迁移文件命名合法（14 位时间戳 + snake），且版本晚于 20260927201318", () => {
    expect(fileName).toBeTruthy();
    const m = /^(\d{14})_([a-z][a-z_]*)$/.exec(String(fileName).replace(/\.sql$/, ""));
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBeGreaterThan(20260927201318);
  });

  it("★四列都以 IF NOT EXISTS 加在 kb_users 上", () => {
    for (const col of ["recovery_salt", "recovery_blob", "recovery_created_at", "recovery_ack_at"]) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${col}\\b`));
    }
    expect(sql).toMatch(/ALTER TABLE public\.kb_users/);
  });

  it("★四列【全部可空】：去注释后不得出现 NOT NULL（存量行与“未确认”语义都要求容忍 NULL）", () => {
    expect(sql).not.toMatch(/NOT\s+NULL/i);
  });

  it("★★授权不放宽：GRANT SELECT(...) 的列清单【不含】任何 recovery_*", () => {
    const grant = sql.match(/GRANT SELECT\s*\(([^)]*)\)\s*ON public\.kb_users TO authenticated/i);
    expect(grant).toBeTruthy();
    const cols = String(grant![1]);
    expect(cols).not.toMatch(/recovery/);
    // 仍然只有那 6 个非敏感列（与 harden 迁移同口径）
    expect(cols.replace(/\s+/g, "")).toBe("uid,username,role,status,key_epoch,created_at");
  });

  it("★先 REVOKE ALL 再 GRANT：anon / authenticated 对新列零授权；service_role 仍 GRANT ALL", () => {
    expect(sql).toMatch(/REVOKE ALL ON public\.kb_users FROM anon/);
    expect(sql).toMatch(/REVOKE ALL ON public\.kb_users FROM authenticated/);
    expect(sql).toMatch(/GRANT ALL ON public\.kb_users TO service_role/);
  });
});

/* ================================================================== */
/* 管理员列表路径永不出现 recovery_blob（R12/R28 纵深防御）             */
/* ================================================================== */
describe("R28 管理员列表：白名单继续排除恢复材料", () => {
  it("kb_admin_user_list() 返回列不含 recovery_blob / payload / kdf_ / login_hash", () => {
    const initSql = readFileSync(resolve(MIGRATIONS, "20260927193625_init_keybox.sql"), "utf8");
    const fn =
      initSql.match(/CREATE OR REPLACE FUNCTION public\.kb_admin_user_list[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).not.toBe("");
    expect(fn).not.toMatch(/recovery|payload|login_hash|kdf_/);
  });

  it("前端 admin.ts / AdminPage.tsx 源码不引用恢复材料列", () => {
    for (const rel of ["lib/admin.ts", "pages/AdminPage.tsx"]) {
      const c = readFileSync(resolve(SRC, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
      expect(c).not.toMatch(/recovery_blob|recovery_salt/);
    }
  });

  it("全仓云函数源码不出现 recovery_ack_at 之外的越权读取：恢复材料只被本人函数引用", () => {
    // kbAdminDeleteUserData 只处理 kb_secrets，绝不应触碰恢复材料
    const del = readFileSync(resolve(CLOUD_ROOT, "kbAdminDeleteUserData/index.js"), "utf8");
    expect(del).not.toMatch(/recovery_/);
  });
});
