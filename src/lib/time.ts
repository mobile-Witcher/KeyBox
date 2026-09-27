/**
 * time.ts —— 时间戳比较（纯函数，零依赖）。
 *
 * 为什么单独抽出来：PostgREST 返回的 timestamptz 常写作 `...+00:00`，
 * 而本机 `new Date().toISOString()` 写作 `...Z`。两者【直接做字符串比较会出错】——
 * `+`(0x2B) < `.`(0x2E)，于是同一时刻的 `+00:00` 会看起来比 `Z` 更“旧”，
 * 导致后写覆盖（LWW）判断反了。故一律解析成 epoch 后再比。
 *
 * 本文件不依赖 CloudBase / 网络 / IndexedDB，方便单测。
 */

/** 解析 ISO 时间戳为 epoch 毫秒；无法解析返回 NaN。 */
export function toEpoch(ts: string): number {
  const t = Date.parse(ts);
  return Number.isNaN(t) ? Number.NaN : t;
}

/**
 * a 是否比 b（时间上）更新。
 * 解析失败时退回字符串比较（保守：宁可保持当前值，也不误判覆盖）。
 */
export function isNewer(a: string, b: string): boolean {
  const ta = toEpoch(a);
  const tb = toEpoch(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a > b;
  return ta > tb;
}
