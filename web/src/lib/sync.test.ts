/**
 * sync.test.ts —— 第 7 步同步层回归测试。
 *
 * 重点回归（独立验证发现的 C3）：
 *   「离线新增 → 未同步即删除」后 flushQueue 必须把删除落到服务端真实 id，
 *   否则服务端会残留孤儿行（下次同步重新出现）。
 *
 * 做法：把网络边界（./api 的 secretUpsert/secretDelete、./cloudbase 的 db 读）换成
 *   一个「内存假服务端」，从而在本机无云环境、无需控制台配置的前提下，
 *   端到端断言「服务端最终有几行 / 删的是哪个 id」。
 *
 * 纪律：不写死任何密码/密钥字面量；主密钥用随机盐派生（迭代数取小值，仅为本测试提速，
 *   与本仓 crypto 原语的正确性无关，原语本身由 crypto.test.ts 覆盖）。
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- 假服务端状态：必须在 vi.mock 工厂之前可用 → 用 vi.hoisted 提升到顶部 ----
type ServerRow = {
  id: number;
  payload: string;
  key_epoch: number;
  updated_at: string;
  owner_id: string;
};

const hoisted = vi.hoisted(() => ({
  uid: "user-1",
  server: new Map<number, ServerRow>(),
  seq: { id: 100 },
  calls: { upsert: [] as Array<number | undefined>, delete: [] as number[] },
}));

// 读路径：sync.ts 只从 ./cloudbase 取 `db`（app.rdb()），这里给出 PostgREST 风格链式桩。
vi.mock("./cloudbase", () => ({
  db: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: Array.from(hoisted.server.values()), error: null }),
        }),
      }),
    }),
  },
  // sync.ts 未用到，但给出占位，避免将来误用时是 undefined。
  auth: {},
  app: {},
}));

// 写路径：把云函数调用换成内存假服务端（owner_id 固定为测试用户）。
vi.mock("./api", () => ({
  api: {
    secretUpsert: async (p: { id?: number; payload: string; keyEpoch: number }) => {
      const now = new Date().toISOString();
      if (typeof p.id === "number" && hoisted.server.has(p.id)) {
        const row = hoisted.server.get(p.id) as ServerRow;
        row.payload = p.payload;
        row.key_epoch = p.keyEpoch;
        row.updated_at = now;
        return { ok: true, data: { id: row.id, updatedAt: row.updated_at } };
      }
      const id = hoisted.seq.id++;
      hoisted.server.set(id, {
        id,
        payload: p.payload,
        key_epoch: p.keyEpoch,
        updated_at: now,
        owner_id: hoisted.uid,
      });
      hoisted.calls.upsert.push(id);
      return { ok: true, data: { id, updatedAt: now } };
    },
    secretDelete: async ({ id }: { id: number }) => {
      hoisted.calls.delete.push(id);
      if (!hoisted.server.has(id)) return { ok: false, error: "NOT_FOUND" };
      hoisted.server.delete(id);
      return { ok: true, data: { deletedId: id } };
    },
  },
}));

import { generateSaltB64, deriveMasterKey, type MasterKey } from "./crypto";
import { getAllCached, getQueue, resetLocal } from "./db";
import { deleteLocal, saveLocal, syncVault } from "./sync";
import { emptyPlain } from "./vault";

const UID = hoisted.uid;

/** 随机盐派生主密钥（迭代数取小值提速；只验证同步逻辑，不验证 KDF 强度）。 */
async function makeMasterKey(): Promise<MasterKey> {
  return deriveMasterKey("correct horse battery staple", generateSaltB64(), 1000);
}

beforeEach(async () => {
  await resetLocal();
  hoisted.server.clear();
  hoisted.seq.id = 100;
  hoisted.calls.upsert.length = 0;
  hoisted.calls.delete.length = 0;
});

describe("flushQueue：离线「新增→删除」不残留孤儿行（C3 回归）", () => {
  it("先新增(id<0)再删除、随后同步 → 服务端/本地均无残留、队列清空、删除用的是真实 id", async () => {
    const mk = await makeMasterKey();

    // ① 离线新增 → 得到临时 id(<0)
    const tempId = await saveLocal(UID, mk, 0, { ...emptyPlain(), site: "gh", key: "s3cr3t" });
    expect(tempId).toBeLessThan(0);

    // ② 未同步即删除同一条
    await deleteLocal(tempId);

    // 预置：本地已无该条；队列里是 upsert + delete 两条
    expect(await getAllCached()).toEqual([]);
    expect((await getQueue()).map((e) => e.op)).toEqual(["upsert", "delete"]);

    // ③ 同步（触发 flushQueue 重放）
    const result = await syncVault(UID);
    expect(result.online).toBe(true);

    // ④ 回归核心：服务端不得残留孤儿行
    expect(hoisted.server.size).toBe(0);
    expect(await getAllCached()).toEqual([]);
    expect(await getQueue()).toEqual([]);

    // 删除确实按服务端真实 id 发出（而不是拿临时 id 空删）
    expect(hoisted.calls.upsert).toHaveLength(1);
    expect(hoisted.calls.delete).toHaveLength(1);
    expect(hoisted.calls.delete[0]).toBeGreaterThan(0);
  });

  it("仅离线新增、随后同步 → 服务端保留 1 行，本地行换成真实 id 且已同步", async () => {
    const mk = await makeMasterKey();
    const tempId = await saveLocal(UID, mk, 0, { ...emptyPlain(), site: "a" });
    expect(tempId).toBeLessThan(0);

    await syncVault(UID);

    expect(hoisted.server.size).toBe(1);
    const rows = await getAllCached();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBeGreaterThan(0);
    expect(rows[0].pending).toBe(false);
    expect(await getQueue()).toEqual([]);
  });

  it("删除已同步条目(id>0) → 服务端对应行被删（常规路径不回归）", async () => {
    const mk = await makeMasterKey();
    await saveLocal(UID, mk, 0, { ...emptyPlain(), site: "b" });
    await syncVault(UID); // 落成真实行
    const [row] = await getAllCached();
    expect(row.id).toBeGreaterThan(0);
    expect(hoisted.server.size).toBe(1);

    await deleteLocal(row.id);
    await syncVault(UID);

    expect(hoisted.server.size).toBe(0);
    expect(await getAllCached()).toEqual([]);
    expect(await getQueue()).toEqual([]);
  });
});
