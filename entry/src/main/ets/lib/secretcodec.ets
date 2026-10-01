/**
 * secretcodec.ets —— 密钥明文 payload 的编解码（纯本机，无网络无加密）。
 *
 * 从 Vault.ets 抽出为共享模块：安全面板（备份导出/导入）与列表页共用同一套
 * 序列化规则，保证「tags 为空省略键」的口径全局一致。加密仍只经 kbcrypto。
 */

/** 一条密钥的明文字段（与 Web 端 SecretPlain 对齐；旧数据缺字段补空串）。 */
export interface SecretPlain {
  site: string;
  url: string;
  website: string;
  model: string;
  key: string;
  note: string;
}

/** 密文 payload 的 JSON 结构（tags 缺失时序列化整个省略键，与旧数据互通）。 */
export class SecretWire {
  site: string = '';
  url: string = '';
  website: string = '';
  model: string = '';
  key: string = '';
  note: string = '';
  tags: string[] | undefined = undefined;
}

/** 把明文 + tags 序列化成 payload JSON；tags 为空时整个省略 tags 键。 */
export function serializePlain(p: SecretPlain, tags: string[]): string {
  const w = new SecretWire();
  w.site = p.site;
  w.url = p.url;
  w.website = p.website;
  w.model = p.model;
  w.key = p.key;
  w.note = p.note;
  w.tags = tags.length > 0 ? tags : undefined;
  return JSON.stringify(w);
}

/** 解析 payload JSON → SecretPlain（容错：缺字段补空串）。 */
export function toPlain(w: SecretWire): SecretPlain {
  return {
    site: typeof w.site === 'string' ? w.site : '',
    url: typeof w.url === 'string' ? w.url : '',
    website: typeof w.website === 'string' ? w.website : '',
    model: typeof w.model === 'string' ? w.model : '',
    key: typeof w.key === 'string' ? w.key : '',
    note: typeof w.note === 'string' ? w.note : ''
  };
}

/** 解析 payload JSON → tags（容错：缺失/非数组补空数组）。 */
export function toTags(w: SecretWire): string[] {
  if (!Array.isArray(w.tags)) {
    return [];
  }
  const out: string[] = [];
  for (const t of w.tags) {
    if (typeof t === 'string' && t !== '' && out.indexOf(t) < 0) {
      out.push(t);
    }
  }
  return out;
}
