/**
 * db.test.ts —— 第 7 步 IndexedDB 层单测（用 fake-indexeddb 提供浏览器外的 indexedDB）。
 *
 * 目的：
 *   - 验证 main / staging / queue / meta 四个存储的读写与清空；
 *   - 验证待上传队列的顺序、按记录 id 批量出队、清空；
 *   - 验证临时 id 递增（负数，避免与服务端正数 id 冲突）；
 *   - **验证落盘的密文行不含任何主密钥材料**（结构里只有 id/ownerId/payload/keyEpoch/updatedAt/pending）。
 *
 * 注意：必须在导入 ./db 之前先安装 fake-indexeddb 全局（import 顺序即执行顺序）。
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  META_OWNER_KEY,
  clearQueue,
  clearStaging,
  deleteCached,
  deleteQueueByRowId,
  deleteQueueEntry,
  enqueue,
  getAllCached,
  getMeta,
  getQueue,
  getStaging,
  nextTempId,
  putCached,
  putCachedMany,
  putStagingMany,
  resetLocal,
  setMeta,
  type CachedSecret,
} from "./db";

function cached(id: number, payload: string): CachedSecret {
  return {
    id,
    ownerId: "user-1",
    payload,
    keyEpoch: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    pending: false,
  };
}

beforeEach(async () => {
  await resetLocal();
});

describe("main：密文缓存", () => {
  it("put/get/delete 往返", async () => {
    await putCached(cached(1, "KB1:aaa"));
    await putCached(cached(2, "KB1:bbb"));
    let all = await getAllCached();
    expect(all).toHaveLength(2);

    await deleteCached(1);
    all = await getAllCached();
    expect(all.map((r) => r.id)).toEqual([2]);
  });

  it("putCachedMany 批量写入", async () => {
    await putCachedMany([cached(1, "KB1:a"), cached(2, "KB1:b"), cached(3, "KB1:c")]);
    const all = await getAllCached();
    expect(all.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("落盘行【不含】任何主密钥材料（结构白名单）", async () => {
    await putCached(cached(1, "KB1:aaa"));
    const [row] = await getAllCached();
    expect(Object.keys(row).sort()).toEqual(
      ["id", "ownerId", "payload", "keyEpoch", "updatedAt", "pending"].sort()
    );
    // 没有 masterKey / key / 明文 等字段
    expect("masterKey" in row).toBe(false);
    expect("key" in row).toBe(false);
  });
});

describe("queue：待上传队列", () => {
  it("按入队顺序返回，且带自增 qid", async () => {
    await enqueue({ op: "upsert", id: 5, payload: "KB1:x", keyEpoch: 0 });
    await enqueue({ op: "upsert", id: 6, payload: "KB1:y", keyEpoch: 0 });
    await enqueue({ op: "delete", id: 7 });
    const q = await getQueue();
    expect(q.map((e) => e.op)).toEqual(["upsert", "upsert", "delete"]);
    expect(q.map((e) => e.id)).toEqual([5, 6, 7]);
    expect(q.every((e) => typeof e.qid === "number")).toBe(true);
  });

  it("deleteQueueEntry 按 qid 出队一次", async () => {
    await enqueue({ op: "upsert", id: 5, payload: "KB1:x", keyEpoch: 0 });
    const [entry] = await getQueue();
    await deleteQueueEntry(entry.qid as number);
    expect(await getQueue()).toEqual([]);
  });

  it("deleteQueueByRowId 移除某记录的全部排队操作（冲突回滚用）", async () => {
    await enqueue({ op: "upsert", id: 5, payload: "KB1:x", keyEpoch: 0 });
    await enqueue({ op: "upsert", id: 6, payload: "KB1:y", keyEpoch: 0 });
    await enqueue({ op: "delete", id: 5 });
    await deleteQueueByRowId(5);
    const q = await getQueue();
    expect(q.map((e) => e.id)).toEqual([6]);
  });

  it("clearQueue 清空", async () => {
    await enqueue({ op: "delete", id: 1 });
    await enqueue({ op: "delete", id: 2 });
    await clearQueue();
    expect(await getQueue()).toEqual([]);
  });
});

describe("staging：暂存区（R21 备用）", () => {
  it("put/get/clear 往返", async () => {
    await putStagingMany([cached(1, "KB1:s1"), cached(2, "KB1:s2")]);
    expect((await getStaging()).map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 2]);
    await clearStaging();
    expect(await getStaging()).toEqual([]);
  });
});

describe("meta：键值与临时 id", () => {
  it("set/get 往返；缺失返回 null", async () => {
    expect(await getMeta("nope")).toBeNull();
    await setMeta(META_OWNER_KEY, "user-9");
    expect(await getMeta(META_OWNER_KEY)).toBe("user-9");
  });

  it("nextTempId 递增且为负数（不与服务端正数 id 冲突）", async () => {
    expect(await nextTempId()).toBe(-1);
    expect(await nextTempId()).toBe(-2);
    expect(await nextTempId()).toBe(-3);
  });
});

describe("resetLocal：换号/登出清空", () => {
  it("四个存储全部清空", async () => {
    await putCached(cached(1, "KB1:a"));
    await putStagingMany([cached(2, "KB1:s")]);
    await enqueue({ op: "upsert", id: 1, payload: "KB1:a", keyEpoch: 0 });
    await setMeta(META_OWNER_KEY, "user-1");

    await resetLocal();

    expect(await getAllCached()).toEqual([]);
    expect(await getStaging()).toEqual([]);
    expect(await getQueue()).toEqual([]);
    expect(await getMeta(META_OWNER_KEY)).toBeNull();
  });
});
