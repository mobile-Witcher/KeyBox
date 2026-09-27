/**
 * vault.ts —— 密钥明文数据的本地处理层（第 6/7 步，纯本机、无网络）。
 *
 * 边界：
 *   - 加密/解密：只在这里调用 crypto.ts（唯一接触密钥的模块）。主密钥由调用方传入，本文件不缓存。
 *   - 网络：本文件【不发任何网络请求】。读缓存/写缓存/上下行由 db.ts 与 sync.ts 负责。
 *   - 标签与搜索：全部在【本机内存】对已解密数据过滤；关键词一个字节都不发往云端（R19）。
 */
import { decryptString, encryptString, type MasterKey } from "./crypto";
import type { CachedSecret } from "./db";
import { log } from "./log";

/** 一条密钥的明文字段（payload 解密后的 JSON 结构）。 */
export interface SecretPlain {
  site: string;
  url: string;
  key: string;
  note: string;
  tags: string[];
}

/** 列表项：本地缓存行 + 解密结果。plain 为 null 表示解密失败（如换过主密码）。 */
export interface SecretItem {
  id: number;
  keyEpoch: number;
  updatedAt: string;
  pending: boolean;
  plain: SecretPlain | null;
  decryptError: boolean;
}

/** 空明文模板，保证字段齐全。 */
export function emptyPlain(): SecretPlain {
  return { site: "", url: "", key: "", note: "", tags: [] };
}

/** 把任意解析结果规整成 SecretPlain（容错：缺字段补空、类型不符强转）。 */
export function normalizePlain(input: Partial<SecretPlain> | null | undefined): SecretPlain {
  const src = input || {};
  return {
    site: typeof src.site === "string" ? src.site : "",
    url: typeof src.url === "string" ? src.url : "",
    key: typeof src.key === "string" ? src.key : "",
    note: typeof src.note === "string" ? src.note : "",
    tags: Array.isArray(src.tags) ? src.tags.filter((t) => typeof t === "string") : [],
  };
}

/** 本地加密一条明文 → `KB1:` 密文。 */
export async function encryptPlain(masterKey: MasterKey, plain: SecretPlain): Promise<string> {
  return encryptString(masterKey.key, JSON.stringify(normalizePlain(plain)));
}

/** 把本地缓存的密文行逐条解密成可渲染项。单条失败不阻断整表。 */
export async function decryptCached(
  rows: CachedSecret[],
  masterKey: MasterKey
): Promise<SecretItem[]> {
  const items: SecretItem[] = [];
  for (const row of rows) {
    try {
      const json = await decryptString(masterKey.key, row.payload);
      const parsed = JSON.parse(json) as Partial<SecretPlain>;
      items.push({
        id: row.id,
        keyEpoch: row.keyEpoch,
        updatedAt: row.updatedAt,
        pending: row.pending,
        plain: normalizePlain(parsed),
        decryptError: false,
      });
    } catch (decryptError) {
      log.warn("某条密钥解密失败", decryptError);
      items.push({
        id: row.id,
        keyEpoch: row.keyEpoch,
        updatedAt: row.updatedAt,
        pending: row.pending,
        plain: null,
        decryptError: true,
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// 标签（R18）：多选、筛选、重命名、删除（删除前由调用方提示影响条数）
// ---------------------------------------------------------------------------

export interface TagCount {
  name: string;
  count: number;
}

/** 统计所有标签及出现次数（只统计可解密的条目）。 */
export function collectTags(items: SecretItem[]): TagCount[] {
  const counter = new Map<string, number>();
  for (const item of items) {
    if (!item.plain) continue;
    for (const tag of item.plain.tags) {
      counter.set(tag, (counter.get(tag) ?? 0) + 1);
    }
  }
  return [...counter.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
}

/** 某标签影响的条目数（删除前提示用）。 */
export function countByTag(items: SecretItem[], tag: string): number {
  return items.filter((item) => item.plain?.tags.includes(tag)).length;
}

/**
 * 本地筛选：标签 + 关键词（站点名 / 网址 / 标签）。**纯内存过滤，不外发关键词。**
 * tag 为 null 表示“全部”；关键词为空表示不过滤。
 */
export function filterItems(
  items: SecretItem[],
  tag: string | null,
  keyword: string
): SecretItem[] {
  const kw = keyword.trim().toLowerCase();
  return items.filter((item) => {
    if (!item.plain) {
      // 解密失败的条目：仅在“无标签筛选且有关键词不匹配”时按情况保留
      return tag === null && kw === "";
    }
    if (tag !== null && !item.plain.tags.includes(tag)) return false;
    if (kw === "") return true;
    const haystack = [item.plain.site, item.plain.url, ...item.plain.tags]
      .join(" ")
      .toLowerCase();
    return haystack.includes(kw);
  });
}

/** 计算“把某标签重命名/删除”后需要保存的条目（返回明文，调用方负责持久化）。 */
export function mapTagChange(
  items: SecretItem[],
  oldName: string,
  next: string | null
): Array<{ id: number; plain: SecretPlain }> {
  const changed: Array<{ id: number; plain: SecretPlain }> = [];
  for (const item of items) {
    if (!item.plain || !item.plain.tags.includes(oldName)) continue;
    const tags =
      next === null
        ? item.plain.tags.filter((t) => t !== oldName)
        : // 重命名：去重（若已有同名标签则不重复添加）
          [...new Set(item.plain.tags.map((t) => (t === oldName ? next : t)))];
    changed.push({ id: item.id, plain: { ...item.plain, tags } });
  }
  return changed;
}
