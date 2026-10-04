/**
 * remember.ts —— "记住主密码"：在本机保存解锁凭据，下次打开自动解锁。
 *
 * ⚠️ 本模块**有意突破 `db.ts` 的「主密钥绝不落盘」铁律**（2026-09-29 经所有者确认后新增），
 * 理由与边界如下——改动前请务必读完：
 *
 *   - **存的是什么**：主密钥的**原始 32 字节**（能直接解开你全部密文的那把钥匙），
 *     **不是主密码本身**。因此即便这份记录被人读到，也拿不到你那个（可能在别处复用的）密码。
 *   - **风险是什么**：**能读到这台设备本机存储的人，就能解开你已存的密钥。**
 *     这是「自动解锁」的固有代价，不是实现缺陷。**共享 / 公用设备请勿开启。**
 *   - **存在哪**：**独立**的 IndexedDB 数据库 `keybox-unlock`，与存放密文的 `keybox` 库物理分离；
 *     不随账号上传、不出设备。`clearUnlockCredential()` 或换账号即可清除。
 *   - **何时自动失效**：记录带 `uid` 与 `keyEpoch`。换账号 → uid 不符即忽略；
 *     改过主密码 → keyEpoch 不符 ⇒ 调用方应**清除并提示重新输入**（避免拿旧钥匙解新代密文而必然失败）。
 *   - **默认关闭**：只有用户在解锁面板**主动勾选**「在这台设备上记住」才会写入。
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

const DB_NAME = "keybox-unlock";
const DB_VERSION = 1;
const STORE = "unlock";
/** 固定主键：只保留最新一份解锁凭据（多账号场景下后登入者覆盖前者）。 */
const RECORD_KEY = "current";

/** 落盘的解锁凭据（整个对象都在本机，绝不上传）。 */
interface UnlockRecord {
  key: string;
  /** 绑定的账号 uid；与当前登录账号不符即视为无效。 */
  uid: string;
  /** 绑定的密钥代数；与云端 key_epoch 不符说明改过主密码，凭据自动失效。 */
  keyEpoch: number;
  /** 主密钥原始字节（32 字节）。 */
  raw: Uint8Array;
  /** 写入时间（ISO）。 */
  savedAt: string;
}

interface UnlockDB extends DBSchema {
  unlock: { key: string; value: UnlockRecord };
}

let dbPromise: Promise<IDBPDatabase<UnlockDB>> | null = null;

function getDb(): Promise<IDBPDatabase<UnlockDB>> {
  if (!dbPromise) {
    dbPromise = openDB<UnlockDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "key" });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * 保存解锁凭据（用户主动勾选"记住"且本次是用主密码解锁成功时调用）。
 * 注意：传入的 raw 必须是**当前代**的主密钥原始字节。
 */
export async function saveUnlockCredential(
  uid: string,
  keyEpoch: number,
  raw: Uint8Array
): Promise<void> {
  if (!uid) throw new Error("缺少 uid，拒绝保存解锁凭据");
  if (!(raw instanceof Uint8Array) || raw.length === 0) {
    throw new Error("主密钥材料非法，拒绝保存解锁凭据");
  }
  const db = await getDb();
  const record: UnlockRecord = {
    key: RECORD_KEY,
    uid,
    keyEpoch,
    raw: new Uint8Array(raw), // 拷贝一份，避免调用方后续复用/清零同一缓冲
    savedAt: new Date().toISOString(),
  };
  await db.put(STORE, record);
}

/**
 * 读取解锁凭据。只有 uid 完全一致时才返回；否则返回 null（不为其他账号自动解锁）。
 * keyEpoch 由调用方与云端比对后再决定是否可用。
 */
export async function loadUnlockCredential(
  uid: string
): Promise<{ raw: Uint8Array; keyEpoch: number; savedAt: string } | null> {
  if (!uid) return null;
  try {
    const db = await getDb();
    const record = (await db.get(STORE, RECORD_KEY)) as UnlockRecord | undefined;
    if (!record || record.uid !== uid) return null;
    return {
      raw: new Uint8Array(record.raw),
      keyEpoch: record.keyEpoch,
      savedAt: record.savedAt,
    };
  } catch {
    // 读取失败（隐私模式 / 存储被禁）一律降级为"未记住"，不影响正常输入解锁
    return null;
  }
}

/** 清除已保存的解锁凭据（用户主动清除、或检测到 keyEpoch 失效时调用）。 */
export async function clearUnlockCredential(): Promise<void> {
  try {
    const db = await getDb();
    await db.delete(STORE, RECORD_KEY);
  } catch {
    // 清除失败不阻断主流程
  }
}

/** 当前本机是否已为指定账号保存了解锁凭据（供界面显示状态）。 */
export async function hasUnlockCredential(uid: string): Promise<boolean> {
  return (await loadUnlockCredential(uid)) !== null;
}
