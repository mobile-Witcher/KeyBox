/**
 * vault.ts —— 密钥记录的数据层（第 6 步核心功能）。
 *
 * 边界（架构 §6 / §8）：
 *   - 读：用 app.rdb() 直连 PG；查询【必须】带 .eq("owner_id", uid)（与 RLS 策略表达式匹配），
 *     uid 来自 auth.getSession()（不用 auth.getUser()）。
 *   - 解密：在本地用主密钥解开 `KB1:` 密文后渲染；主密钥只在内存（由调用方持有，本文件不缓存）。
 *   - 写/删：走云函数 kbSecretUpsert / kbSecretDelete（归属由服务端判定）。
 *   - 只用 postgREST 风格：.eq() / .order()；禁用 .where() / .orderBy() / .count() / .offset()。
 *
 * 明文只活在本文件返回的对象里（内存）；任何字段都不写日志、不上传。
 */
import { db } from "./cloudbase";
import { api } from "./api";
import { decryptString, encryptString, type MasterKey } from "./crypto";
import { log } from "./log";

/** 一条密钥的明文字段（payload 解密后的 JSON 结构）。 */
export interface SecretPlain {
  site: string;
  url: string;
  key: string;
  note: string;
  tags: string[];
}

/** 列表项：云端行 + 本地解密结果。plain 为 null 表示解密失败（如换过主密码）。 */
export interface SecretItem {
  id: number;
  keyEpoch: number;
  updatedAt: string;
  plain: SecretPlain | null;
  decryptError: boolean;
}

/** 空明文模板，保证字段齐全。 */
export function emptyPlain(): SecretPlain {
  return { site: "", url: "", key: "", note: "", tags: [] };
}

/** 把任意解析结果规整成 SecretPlain（容错：缺字段补空、类型不符强转）。 */
function normalizePlain(input: Partial<SecretPlain> | null | undefined): SecretPlain {
  const src = input || {};
  return {
    site: typeof src.site === "string" ? src.site : "",
    url: typeof src.url === "string" ? src.url : "",
    key: typeof src.key === "string" ? src.key : "",
    note: typeof src.note === "string" ? src.note : "",
    tags: Array.isArray(src.tags) ? src.tags.filter((t) => typeof t === "string") : [],
  };
}

/** 云端返回的行（snake_case，显式列）。 */
interface SecretRow {
  id: number;
  payload: string;
  key_epoch: number;
  updated_at: string;
}

/**
 * 读取本人全部密钥并本地解密。
 * 查询带 .eq("owner_id", uid) 且显式列出所需列（不取 owner_id，减少无谓字段）。
 */
export async function listMySecrets(uid: string, masterKey: MasterKey): Promise<SecretItem[]> {
  const { data, error } = await db
    .from("kb_secrets")
    .select("id,payload,key_epoch,updated_at")
    .eq("owner_id", uid)
    .order("updated_at", { ascending: false });

  if (error) {
    log.error("读取 kb_secrets 失败", error);
    throw new Error(error.message || "READ_FAILED");
  }

  const rows = (Array.isArray(data) ? data : []) as SecretRow[];
  const items: SecretItem[] = [];
  for (const row of rows) {
    try {
      const json = await decryptString(masterKey.key, row.payload);
      const parsed = JSON.parse(json) as Partial<SecretPlain>;
      items.push({
        id: row.id,
        keyEpoch: row.key_epoch,
        updatedAt: row.updated_at,
        plain: normalizePlain(parsed),
        decryptError: false,
      });
    } catch (decryptError) {
      // 单条解密失败不阻断整表；标记出来让用户知道（例如服务端存的是上一代密钥的密文）
      log.warn("某条密钥解密失败", decryptError);
      items.push({
        id: row.id,
        keyEpoch: row.key_epoch,
        updatedAt: row.updated_at,
        plain: null,
        decryptError: true,
      });
    }
  }
  return items;
}

/**
 * 保存（新增或更新）一条密钥：本地加密成 `KB1:` 密文后交给云函数。
 * 返回云端记录 id。existingId 为空即新增。
 */
export async function saveSecret(
  masterKey: MasterKey,
  keyEpoch: number,
  plain: SecretPlain,
  existingId?: number
): Promise<number> {
  const payload = await encryptString(masterKey.key, JSON.stringify(normalizePlain(plain)));
  const res = await api.secretUpsert({ id: existingId, payload, keyEpoch });
  if (!res.ok || !res.data) {
    throw new Error(res.error || "SAVE_FAILED");
  }
  return res.data.id;
}

/** 删除一条密钥（只允许删自己的；归属由云函数判定）。 */
export async function removeSecret(id: number): Promise<void> {
  const res = await api.secretDelete({ id });
  if (!res.ok) {
    throw new Error(res.error || "DELETE_FAILED");
  }
}
