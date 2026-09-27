/**
 * admin.test.ts —— 第 8 步管理员数据访问（R12 / R13 / R14）对抗性单测。
 *
 * 隔离方式：伪造 rdb 客户端（不触碰真实 CloudBase）与伪造 `api`（不触碰真实云函数）。
 * 重点（架构 §5.4 / §7.1，最危险处）：
 *   - R12：只映射白名单 5 字段，后端多返回的密文/敏感列【绝不】进入返回值（纵深防御）。
 *   - R13：只提交 `{status}` 单字段 + **必须** `.eq('uid', ...)`；缺 uid 时**不得发出任何请求**
 *          （无过滤的 UPDATE = 全表更新，是本步最大的雷）。
 *   - R14：只把 `{uid}` 传给云函数；缺 uid 时不得调用云函数。
 *
 * 本文件不修改任何生产代码，只做黑盒行为断言（观察注入的假客户端收到了什么）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ */
/* 注入的假依赖（必须在导入被测模块之前建立）                              */
/* ------------------------------------------------------------------ */
const h = vi.hoisted(() => {
  const calls = {
    rpc: [] as string[],
    from: [] as string[],
    update: [] as Array<Record<string, unknown>>,
    eq: [] as Array<[string, string]>,
  };
  const apiCalls = {
    adminDeleteUserData: [] as Array<{ uid: string }>,
  };
  const behavior = {
    rpcResult: { data: [] as unknown, error: null as { message?: string } | null },
    updateError: null as { message?: string } | null,
    deleteResult: { ok: true, data: { deletedCount: 0 } } as {
      ok: boolean;
      data?: { deletedCount: number };
      error?: string;
    },
  };

  const rdb = {
    rpc(fn: string): Promise<{ data: unknown; error: { message?: string } | null }> {
      calls.rpc.push(fn);
      return Promise.resolve(behavior.rpcResult);
    },
    from(table: string): {
      update(values: Record<string, unknown>): {
        eq(column: string, value: string): Promise<{ error: { message?: string } | null }>;
      };
    } {
      calls.from.push(table);
      return {
        update(values: Record<string, unknown>) {
          calls.update.push(values);
          return {
            eq(column: string, value: string) {
              calls.eq.push([column, value]);
              return Promise.resolve({ error: behavior.updateError });
            },
          };
        },
      };
    },
  };

  return { calls, apiCalls, behavior, rdb };
});

vi.mock("./cloudbase", () => ({ db: h.rdb }));

vi.mock("./api", () => ({
  api: {
    adminDeleteUserData(params: { uid: string }) {
      h.apiCalls.adminDeleteUserData.push(params);
      return Promise.resolve(h.behavior.deleteResult);
    },
  },
}));

import { adminDeleteUserData, adminListUsers, adminSetUserStatus } from "./admin";

beforeEach(() => {
  h.calls.rpc.length = 0;
  h.calls.from.length = 0;
  h.calls.update.length = 0;
  h.calls.eq.length = 0;
  h.apiCalls.adminDeleteUserData.length = 0;
  h.behavior.rpcResult = { data: [], error: null };
  h.behavior.updateError = null;
  h.behavior.deleteResult = { ok: true, data: { deletedCount: 0 } };
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ================================================================== */
/* R12 · adminListUsers —— 白名单映射 + 纵深防御                        */
/* ================================================================== */
describe("R12 adminListUsers：只映射白名单字段", () => {
  it("调用的是直连 RPC kb_admin_user_list（不套云函数）", async () => {
    await adminListUsers();
    expect(h.calls.rpc).toEqual(["kb_admin_user_list"]);
  });

  it("返回值对象【恰好】只有 5 个白名单键", async () => {
    h.behavior.rpcResult = {
      data: [
        {
          uid: "u1",
          username: "alice",
          status: "active",
          created_at: "2026-01-01T00:00:00+00:00",
          item_count: 3,
        },
      ],
      error: null,
    };
    const rows = await adminListUsers();
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(
      ["uid", "username", "status", "created_at", "item_count"].sort()
    );
  });

  it("纵深防御：后端多返回 payload/login_hash/kdf_salt/kdf_verifier 时前端【一律不渲染】", async () => {
    // 模拟“数据库/函数被改错，把敏感列也带回来了”的最坏情况。
    h.behavior.rpcResult = {
      data: [
        {
          uid: "u1",
          username: "bob",
          status: "active",
          created_at: "2026-01-01T00:00:00+00:00",
          item_count: 2,
          // —— 以下绝不应出现在返回值/渲染里 ——
          payload: "KB1:SUPERSECRETCIPHERTEXT",
          login_hash: "scrypt$16384$8$1$AAAA$BBBB",
          kdf_salt: "SALTBASE64",
          kdf_verifier: "VERIFIERCIPHER",
          role: "admin",
        },
      ],
      error: null,
    };
    const rows = await adminListUsers();
    const row = rows[0] as unknown as Record<string, unknown>;

    expect(row.payload).toBeUndefined();
    expect(row.login_hash).toBeUndefined();
    expect(row.kdf_salt).toBeUndefined();
    expect(row.kdf_verifier).toBeUndefined();
    expect(row.role).toBeUndefined();

    // 整个序列化结果里不得残留任何敏感串（防“偷偷塞进 meta”之类的写法）
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("KB1:");
    expect(serialized).not.toContain("scrypt");
    expect(serialized).not.toContain("SALTBASE64");
    expect(serialized).not.toContain("VERIFIERCIPHER");
  });

  it("容错：缺失字段填默认值；item_count 数字字符串被转成 number", async () => {
    h.behavior.rpcResult = {
      data: [{ item_count: "7" } as unknown as Record<string, unknown>],
      error: null,
    };
    const rows = await adminListUsers();
    expect(rows[0].item_count).toBe(7);
    expect(typeof rows[0].item_count).toBe("number");
    expect(rows[0].uid).toBe("");
    expect(rows[0].username).toBe("");
  });

  it("容错：data 不是数组（异常返回体）→ 返回空列表而非崩溃", async () => {
    h.behavior.rpcResult = { data: { unexpected: true }, error: null };
    await expect(adminListUsers()).resolves.toEqual([]);
  });

  it("RPC 报错 → 抛出（前端可据此显示错误，不静默返回空列表）", async () => {
    h.behavior.rpcResult = { data: null, error: { message: "PERMISSION_DENIED" } };
    await expect(adminListUsers()).rejects.toThrow("PERMISSION_DENIED");
  });
});

/* ================================================================== */
/* R13 · adminSetUserStatus —— 单字段 + 必带 eq + 缺 uid 不发请求        */
/* ================================================================== */
describe("R13 adminSetUserStatus：只改一列且必须带过滤", () => {
  it("提交体【恰好】只有 status 一个键（禁止整行对象，防越列写 login_hash）", async () => {
    await adminSetUserStatus("target-uid", "disabled");
    expect(h.calls.update).toHaveLength(1);
    expect(Object.keys(h.calls.update[0])).toEqual(["status"]);
    expect(h.calls.update[0]).toEqual({ status: "disabled" });
  });

  it("【总是】带 .eq('uid', 目标uid)，绝不发无过滤更新", async () => {
    await adminSetUserStatus("target-uid", "disabled");
    expect(h.calls.eq).toEqual([["uid", "target-uid"]]);
  });

  it("启用路径同理只提交 {status:active} 且带 eq", async () => {
    await adminSetUserStatus("target-uid", "active");
    expect(h.calls.update[0]).toEqual({ status: "active" });
    expect(h.calls.eq).toEqual([["uid", "target-uid"]]);
  });

  it("★缺 uid（空串）→ 抛 MISSING_UID，且【不调用 rdb.from/update/eq】（无过滤=全表，最危险）", async () => {
    await expect(adminSetUserStatus("", "disabled")).rejects.toThrow("MISSING_UID");
    expect(h.calls.from).toEqual([]);
    expect(h.calls.update).toEqual([]);
    expect(h.calls.eq).toEqual([]);
  });

  it("★缺 uid（undefined 强转）→ 同样不发请求", async () => {
    await expect(
      // 故意绕过 TS 类型：模拟运行时拿到空值
      adminSetUserStatus(undefined as unknown as string, "disabled")
    ).rejects.toThrow("MISSING_UID");
    expect(h.calls.from).toEqual([]);
    expect(h.calls.update).toEqual([]);
    expect(h.calls.eq).toEqual([]);
  });

  it("后端报错 → 抛出（带原始 message）", async () => {
    h.behavior.updateError = { message: "PG_403" };
    await expect(adminSetUserStatus("u", "disabled")).rejects.toThrow("PG_403");
  });
});

/* ================================================================== */
/* R14 · adminDeleteUserData —— 只传 {uid}                             */
/* ================================================================== */
describe("R14 adminDeleteUserData：只把 uid 交给云函数", () => {
  it("调用云函数时入参【恰好】是 { uid }", async () => {
    h.behavior.deleteResult = { ok: true, data: { deletedCount: 5 } };
    const n = await adminDeleteUserData("victim-uid");
    expect(n).toBe(5);
    expect(h.apiCalls.adminDeleteUserData).toHaveLength(1);
    expect(Object.keys(h.apiCalls.adminDeleteUserData[0])).toEqual(["uid"]);
    expect(h.apiCalls.adminDeleteUserData[0]).toEqual({ uid: "victim-uid" });
  });

  it("★缺 uid → 抛 MISSING_UID，且【不调用云函数】（避免误删）", async () => {
    await expect(adminDeleteUserData("")).rejects.toThrow("MISSING_UID");
    expect(h.apiCalls.adminDeleteUserData).toEqual([]);
  });

  it("云函数返回失败 → 抛出错误码，不返回误导性数字", async () => {
    h.behavior.deleteResult = { ok: false, error: "NOT_ADMIN" };
    await expect(adminDeleteUserData("u")).rejects.toThrow("NOT_ADMIN");
  });

  it("云函数 ok 但缺 data → 抛出，绝不臆造 deletedCount", async () => {
    h.behavior.deleteResult = { ok: true };
    await expect(adminDeleteUserData("u")).rejects.toThrow();
  });
});
