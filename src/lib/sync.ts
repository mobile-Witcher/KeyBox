/**
 * sync.ts —— 本地优先 + 联网增量同步（架构 §8，第 7 步）。
 *
 * 策略：
 *   - 本地先写：增删改立刻落 IndexedDB 缓存（界面即时生效），并发入待上传队列。
 *   - 上下行字段：上行只传 `payload`(密文) 与 `key_epoch`；下行含 id / payload / updated_at / owner_id。
 *   - 冲突：后写覆盖（LWW），以【服务端 updated_at】为准；本地未上传改动被服务端更新覆盖时，
 *     会丢弃本地待上传项并返回冲突记录，供界面【显式提示】“这条被更新的版本覆盖了”，绝不静默覆盖。
 *   - 断网：队列保留在 IndexedDB；恢复联网后逐条重放（成功一条出队一条）。
 *
 * 读用 app.rdb()（显式列 + .eq("owner_id", uid)）；写删走云函数（归属由服务端判定）。
 * 本文件只搬运密文与时间戳，不接触主密钥（加密由 vault.encryptPlain 完成，主密钥由调用方传入）。
 */
import { api } from "./api";
import { db as pgDb } from "./cloudbase";
import type { MasterKey } from "./crypto";
import {
  META_OWNER_KEY,
  deleteCached,
  deleteQueueByRowId,
  deleteQueueEntry,
  enqueue,
  getAllCached,
  getMeta,
  getQueue,
  nextTempId,
  putCached,
  resetLocal,
  setMeta,
  type CachedSecret,
} from "./db";
import { log } from "./log";
import { isNewer } from "./time";
import { encryptPlain, type SecretPlain } from "./vault";

/** 一次同步的结果。 */
export interface SyncResult {
  online: boolean;
  pending: number;
  pushed: number;
  conflicts: SyncConflict[];
}

/** 本地未上传改动被服务端更新覆盖的一条冲突。 */
export interface SyncConflict {
  id: number;
  localUpdatedAt: string;
  remoteUpdatedAt: string;
}

/** 云端行（snake_case，显式列）。 */
interface RemoteRow {
  id: number;
  payload: string;
  key_epoch: number;
  updated_at: string;
  owner_id: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toCached(uid: string, row: RemoteRow, pending: boolean): CachedSecret {
  return {
    id: row.id,
    ownerId: uid,
    payload: row.payload,
    keyEpoch: row.key_epoch,
    updatedAt: row.updated_at,
    pending,
  };
}

/** 拉取本人全部密文行（app.rdb()；显式列 + .eq("owner_id", uid)）。 */
async function pullRemote(uid: string): Promise<RemoteRow[]> {
  const { data, error } = await pgDb
    .from("kb_secrets")
    .select("id,payload,key_epoch,updated_at,owner_id")
    .eq("owner_id", uid)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message || "READ_FAILED");
  return (Array.isArray(data) ? data : []) as RemoteRow[];
}

/** 把远端行合并进本地缓存（LWW by updated_at）。返回需要提示的冲突。 */
async function mergeRemote(uid: string, remote: RemoteRow[]): Promise<SyncConflict[]> {
  const cached = await getAllCached();
  const cachedById = new Map(cached.map((c) => [c.id, c]));
  const remoteIds = new Set(remote.map((r) => r.id));
  const conflicts: SyncConflict[] = [];

  for (const r of remote) {
    const local = cachedById.get(r.id);
    if (!local) {
      await putCached(toCached(uid, r, false));
      continue;
    }
    if (isNewer(r.updated_at, local.updatedAt)) {
      // 服务端版本更新 → 覆盖本地（按 epoch 比较，兼容 "Z" 与 "+00:00" 两种 ISO 写法）
      if (local.pending) {
        // 本地有未上传改动却被服务端更新覆盖：丢弃本地待上传项并记录冲突（界面会显式提示）
        await deleteQueueByRowId(local.id);
        conflicts.push({
          id: r.id,
          localUpdatedAt: local.updatedAt,
          remoteUpdatedAt: r.updated_at,
        });
      }
      await putCached(toCached(uid, r, false));
    }
    // 否则：本地不旧于远端 → 保留本地（若 pending，稍后由 flush 上传）
  }

  // 服务端已删除、且本地无待上传变更的行 → 一并清理
  for (const c of cached) {
    if (c.id > 0 && !remoteIds.has(c.id) && !c.pending) {
      await deleteCached(c.id);
    }
  }
  return conflicts;
}

/** 逐条重放上传队列；成功一条出队一条。任一条失败（离线）即抛出，保留剩余队列。 */
async function flushQueue(): Promise<number> {
  const entries = await getQueue();
  const tempMap = new Map<number, number>(); // 本地临时 id → 服务端真实 id
  let pushed = 0;
  for (const entry of entries) {
    if (entry.qid === undefined) continue;
    if (entry.op === "upsert") {
      const targetId = entry.id < 0 ? tempMap.get(entry.id) : entry.id;
      const res = await api.secretUpsert({
        id: targetId,
        payload: entry.payload ?? "",
        keyEpoch: entry.keyEpoch ?? 0,
      });
      if (!res.ok || !res.data) throw new Error(res.error || "UPSERT_FAILED");
      if (entry.id < 0) {
        tempMap.set(entry.id, res.data.id);
        await replaceCachedId(entry.id, res.data.id, res.data.updatedAt);
      } else {
        await markSynced(entry.id, res.data.updatedAt);
      }
    } else {
      // 删除分支：临时 id(<0) 必须经 tempMap 解析成服务端真实 id。
      // 否则「离线新增 → 未同步即删除」时：前面的 upsert 已建出服务端行并把临时 id 换成真 id，
      // 这条 delete 却仍按临时 id 处理 → 服务端残留孤儿行（下次同步又会重新出现）。
      // 回归测试见 sync.test.ts「离线「新增→删除」不残留孤儿行」。
      const realId = entry.id < 0 ? tempMap.get(entry.id) : entry.id;
      if (realId === undefined) {
        // 该临时条目从未成功上传（或对应的 upsert 已不在本次重放中）→ 服务端无对应行，直接丢弃此队列项即可
        await deleteCached(entry.id);
      } else {
        const res = await api.secretDelete({ id: realId });
        if (!res.ok && res.error !== "NOT_FOUND") throw new Error(res.error || "DELETE_FAILED");
        await deleteCached(realId);
      }
    }
    await deleteQueueEntry(entry.qid);
    pushed += 1;
  }
  return pushed;
}

async function markSynced(id: number, updatedAt: string): Promise<void> {
  const all = await getAllCached();
  const row = all.find((c) => c.id === id);
  if (row) await putCached({ ...row, updatedAt, pending: false });
}

async function replaceCachedId(tempId: number, realId: number, updatedAt: string): Promise<void> {
  const all = await getAllCached();
  const row = all.find((c) => c.id === tempId);
  if (!row) return;
  await deleteCached(tempId);
  await putCached({ ...row, id: realId, updatedAt, pending: false });
}

/** 主同步：换号清缓存 → 拉取 → 合并 → 重放队列。 */
export async function syncVault(uid: string): Promise<SyncResult> {
  const prevOwner = await getMeta(META_OWNER_KEY);
  if (prevOwner && prevOwner !== uid) {
    await resetLocal(); // 换账号：清空本地，避免串号
  }
  await setMeta(META_OWNER_KEY, uid);

  let online = true;
  let conflicts: SyncConflict[] = [];
  let pushed = 0;
  try {
    const remote = await pullRemote(uid);
    conflicts = await mergeRemote(uid, remote);
    pushed = await flushQueue();
  } catch (error) {
    log.warn("同步失败（可能离线），保留本地队列待重放", error);
    online = false;
  }

  const queue = await getQueue();
  return { online, pending: queue.length, pushed, conflicts };
}

/** 本地保存（新增/更新）：先落缓存 + 入队，返回本地或服务端 id。 */
export async function saveLocal(
  uid: string,
  masterKey: MasterKey,
  keyEpoch: number,
  plain: SecretPlain,
  existingId?: number
): Promise<number> {
  const payload = await encryptPlain(masterKey, plain);
  const id = existingId ?? (await nextTempId());
  await putCached({ id, ownerId: uid, payload, keyEpoch, updatedAt: nowIso(), pending: true });
  await enqueue({ op: "upsert", id, payload, keyEpoch });
  return id;
}

/** 本地删除：先落本地（界面立刻消失）+ 入队。 */
export async function deleteLocal(id: number): Promise<void> {
  await deleteCached(id);
  await enqueue({ op: "delete", id });
}
