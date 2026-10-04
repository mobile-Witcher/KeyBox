/**
 * time.test.ts —— 时间戳比较单测（第 7 步 LWW 正确性）。
 *
 * 重点：证明 `...+00:00` 与 `...Z` 两种 ISO 写法【按时间先后】比较正确，
 * 而不是按字符串字典序（否则后写覆盖会判反）。
 */
import { describe, expect, it } from "vitest";
import { isNewer, toEpoch } from "./time";

describe("toEpoch", () => {
  it("解析 Z 与 +00:00 得到同一 epoch", () => {
    expect(toEpoch("2026-01-01T00:00:00.000Z")).toBe(toEpoch("2026-01-01T00:00:00+00:00"));
  });

  it("无法解析返回 NaN", () => {
    expect(Number.isNaN(toEpoch("not-a-date"))).toBe(true);
  });
});

describe("isNewer（跨 ISO 写法的时间先后）", () => {
  it("同一时刻两种写法互不为“更新”", () => {
    expect(isNewer("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00+00:00")).toBe(false);
    expect(isNewer("2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00.000Z")).toBe(false);
  });

  it("更晚的 +00:00 比更早的 Z 新（字符串比较会判错的反例）", () => {
    expect(isNewer("2026-01-01T00:00:01+00:00", "2026-01-01T00:00:00.000Z")).toBe(true);
  });

  it("更早的 +00:00 不比更晚的 Z 新", () => {
    expect(isNewer("2026-01-01T00:00:00+00:00", "2026-01-01T00:00:01.000Z")).toBe(false);
  });

  it("纯字符串字典序会把 '+00:00' 误判为更旧——本函数不这样", () => {
    // 反例：字典序下 "2026-01-01T00:00:00+00:00" < "2026-01-01T00:00:00.000Z"（'+' < '.'）
    const a = "2026-01-01T00:00:00+00:00";
    const b = "2026-01-01T00:00:00.000Z";
    expect(a < b).toBe(true); // 字符串确实判错
    expect(isNewer(a, b)).toBe(false); // 时间上相等，不是更新
  });

  it("解析失败退回字符串比较（保守）", () => {
    expect(isNewer("zzz", "aaa")).toBe(true);
    expect(isNewer("aaa", "zzz")).toBe(false);
  });
});
