/**
 * db.ts —— IndexedDB 本地存储（架构 §8，第 7 步）。
 *
 * 用 idb 封装（架构指定）。三个库 + 一个 meta：
 *   - `main`    ：本人密文副本（KB1: 密文 + updated_at + key_epoch + owner_id + 是否有待上传变更）
 *   - `staging` ：暂存区（供 R21「改主密码」整批重加密时写入“新代密文”，本步骤先建好备用）
 *   - `queue`   ：待上传队列（upsert / delete），断网时累积，恢复后逐条重放
 *   - `meta`    ：少量键值（缓存归属 owner、临时 id 计数器）
 *
 * 铁律：**解密后的主密钥绝不落盘**。本文件只存密文与元数据；主密钥只活在内存（VaultPage state）。
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

const DB_NAME = "keybox";
const DB_VERSION = 1;

/** 本地缓存的密文行（不含任何明文或密钥材料）。 */
export interface CachedSecret {
  /** 服务端 id（>0），或本地临时 id（<0，尚未上传的新条目）。 */
  id: number;
  ownerId: string;
  /** `KB1:` 密文。 */
  payload: string;
  keyEpoch: number;
  /** 版本时间：服务端行用服务端 updated_at；本地未上传改动用本地时间（ISO）。 */
  updatedAt: string;
  /** 是否有未上传的本地变更。 */
  pending: boolean;
}

/** 待上传队列项。 */
export interface QueueEntry {
  qid?: number;
  op: "upsert" | "delete";
  id: number;
  payload?: string;
  keyEpoch?: number;
}

interface KeyBoxDB extends DBSchema {
  main: { key: number; value: CachedSecret };
  staging: { key: number; value: CachedSecret };
  queue: { key: number; value: QueueEntry };
  meta: { key: string; value: string };
}

const META_OWNER = "owner";
const META_TEMP_SEQ = "tempSeq";

let dbPromise: Promise<IDBPDatabase<KeyBoxDB>> | null = null;

function getDb(): Promise<IDBPDatabase<KeyBoxDB>> {
  if (!dbPromise) {
    dbPromise = openDB<KeyBoxDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("main")) {
          db.createObjectStore("main", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("staging")) {
          db.createObjectStore("staging", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("queue")) {
          db.createObjectStore("queue", { keyPath: "qid", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta");
        }
      },
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// main：密文缓存
// ---------------------------------------------------------------------------
export async function getAllCached(): Promise<CachedSecret[]> {
  const db = await getDb();
  return db.getAll("main");
}

export async function putCached(row: CachedSecret): Promise<void> {
  const db = await getDb();
  await db.put("main", row);
}

export async function putCachedMany(rows: CachedSecret[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("main", "readwrite");
  await Promise.all([...rows.map((r) => tx.store.put(r)), tx.done]);
}

export async function deleteCached(id: number): Promise<void> {
  const db = await getDb();
  await db.delete("main", id);
}

// ---------------------------------------------------------------------------
// queue：待上传队列
// ---------------------------------------------------------------------------
export async function getQueue(): Promise<QueueEntry[]> {
  const db = await getDb();
  // getAll 按主键（qid 自增）升序返回，即入队顺序
  return db.getAll("queue");
}

export async function enqueue(entry: Omit<QueueEntry, "qid">): Promise<void> {
  const db = await getDb();
  await db.add("queue", entry as QueueEntry);
}

export async function deleteQueueEntry(qid: number): Promise<void> {
  const db = await getDb();
  await db.delete("queue", qid);
}

/** 删除某条记录的所有排队操作（冲突回滚时用：服务端版本胜出则丢弃本地待上传的改动）。 */
export async function deleteQueueByRowId(rowId: number): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("queue", "readwrite");
  const all = await tx.store.getAll();
  await Promise.all(
    all.filter((e) => e.id === rowId && e.qid !== undefined).map((e) => tx.store.delete(e.qid as number))
  );
  await tx.done;
}

export async function clearQueue(): Promise<void> {
  const db = await getDb();
  await db.clear("queue");
}

// ---------------------------------------------------------------------------
// staging：暂存区（R21 备用）
// ---------------------------------------------------------------------------
export async function putStagingMany(rows: CachedSecret[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("staging", "readwrite");
  await Promise.all([...rows.map((r) => tx.store.put(r)), tx.done]);
}

export async function getStaging(): Promise<CachedSecret[]> {
  const db = await getDb();
  return db.getAll("staging");
}

export async function clearStaging(): Promise<void> {
  const db = await getDb();
  await db.clear("staging");
}

// ---------------------------------------------------------------------------
// meta
// ---------------------------------------------------------------------------
export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const value = await db.get("meta", key);
  return value === undefined ? null : value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.put("meta", value, key);
}

/** 取下一个本地临时 id（负数，避免与服务端正数 id 冲突）。 */
export async function nextTempId(): Promise<number> {
  const current = Number.parseInt((await getMeta(META_TEMP_SEQ)) || "0", 10);
  const next = Number.isFinite(current) ? current + 1 : 1;
  await setMeta(META_TEMP_SEQ, String(next));
  return -next;
}

export const META_OWNER_KEY = META_OWNER;

/** 清空全部本地数据（切换账号或登出时调用，避免串号）。 */
export async function resetLocal(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["main", "staging", "queue", "meta"], "readwrite");
  await Promise.all([
    tx.objectStore("main").clear(),
    tx.objectStore("staging").clear(),
    tx.objectStore("queue").clear(),
    tx.objectStore("meta").clear(),
    tx.done,
  ]);
}
