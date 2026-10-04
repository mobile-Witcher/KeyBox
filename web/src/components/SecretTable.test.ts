/**
 * SecretTable.test.ts —— R25「剪贴板自动清空」对抗性单测（字段级复制版）。
 *
 * 隔离方式：本仓未安装 jsdom / @testing-library，故用最小 React 桩（useState / useRef / useCallback）
 *   驱动【真实的】useClipboardGuard；用伪造的 `window.setInterval / clearInterval` 与
 *   `navigator.clipboard` 捕获行为，手动推进“每秒 tick”。
 *
 * 核心断言（team-lead 的要求：文案与行为必须一致——要么真清，要么别承诺）：
 *   ★ 到点必须【真正写入空串清空剪贴板】，而不是只把文案改回去。
 * 2026-09-29：复制升级为【字段级】（copiedRef = "行id:字段名"），
 *   并新增「同一行不同字段互不干扰」的对抗用例。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SecretItem } from "../lib/vault";

const h = vi.hoisted(() => ({
  state: {
    idx: 0,
    values: [] as unknown[],
    setterCalls: [] as Array<{ slot: number; value: unknown }>,
  },
  timers: [] as Array<{ id: number; fn: () => void; ms: number }>,
  cleared: [] as number[],
  seq: 0,
  writes: [] as string[],
  writeFails: false,
}));

vi.mock("react", () => ({
  useState: (init: unknown) => {
    const slot = h.state.idx++;
    if (h.state.values.length <= slot) h.state.values.push(init);
    const setter = (v: unknown): void => {
      const prev = h.state.values[slot];
      const next = typeof v === "function" ? (v as (p: unknown) => unknown)(prev) : v;
      h.state.values[slot] = next;
      h.state.setterCalls.push({ slot, value: next });
    };
    return [h.state.values[slot], setter];
  },
  useRef: (init: unknown) => ({ current: init }),
  useCallback: (fn: unknown) => fn,
}));

import {
  CLIPBOARD_CLEAR_SECONDS,
  cellRef,
  copyButtonLabel,
  copyNoticeText,
  useClipboardGuard,
} from "./SecretTable";

function item(id: number, key: string): SecretItem {
  return {
    id,
    keyEpoch: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    pending: false,
    plain: {
      site: "站点",
      url: "https://example.com/v1",
      website: "https://example.com",
      model: "gpt-4o",
      key,
      note: "",
      tags: [],
    },
    decryptError: false,
  };
}

/** 安装伪造的 window / navigator（被 afterEach 还原）。 */
function installDom(): void {
  vi.stubGlobal("window", {
    setInterval(fn: () => void, ms: number): number {
      h.seq += 1;
      const id = h.seq;
      h.timers.push({ id, fn, ms });
      return id;
    },
    clearInterval(id: number): void {
      h.cleared.push(id);
    },
  });
  vi.stubGlobal("navigator", {
    clipboard: {
      async writeText(text: string): Promise<void> {
        if (h.writeFails) throw new Error("clipboard denied");
        h.writes.push(text);
      },
    },
  });
}

/** 挂载 hook（重置 useState 槽位，等价于组件重新挂载）。 */
function mount(seconds?: number): ReturnType<typeof useClipboardGuard> {
  h.state.idx = 0;
  h.state.values.length = 0;
  h.state.setterCalls.length = 0;
  return useClipboardGuard(seconds);
}

beforeEach(() => {
  h.timers.length = 0;
  h.cleared.length = 0;
  h.seq = 0;
  h.writes.length = 0;
  h.writeFails = false;
  installDom();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ================================================================== */
/* 文案与数值一致性                                                    */
/* ================================================================== */
describe("R25：文案与倒计时数值一致", () => {
  it("默认清空秒数为正，且提示文案里出现的正是这个秒数", () => {
    expect(CLIPBOARD_CLEAR_SECONDS).toBeGreaterThan(0);
    expect(copyNoticeText(CLIPBOARD_CLEAR_SECONDS)).toContain(String(CLIPBOARD_CLEAR_SECONDS));
  });

  it("按钮文案：已复制→`Ns 后清空`；未复制 / 归零 / 复制的是别的字段→`复制`", () => {
    const ref = cellRef(5, "key");
    expect(copyButtonLabel(ref, ref, 30)).toBe("30s 后清空");
    expect(copyButtonLabel(cellRef(6, "key"), ref, 30)).toBe("复制"); // 复制的是别的行
    expect(copyButtonLabel(cellRef(5, "url"), ref, 30)).toBe("复制"); // 同行不同字段
    expect(copyButtonLabel(null, ref, 0)).toBe("复制");
    expect(copyButtonLabel(ref, ref, 0)).toBe("复制"); // 归零后回到“复制”
  });

  it("cellRef：行 id 与字段名组合唯一", () => {
    expect(cellRef(5, "key")).toBe("5:key");
    expect(cellRef(5, "url")).toBe("5:url");
    expect(cellRef(6, "key")).toBe("6:key");
  });
});

/* ================================================================== */
/* 复制 → 倒计时 → ★真正清空（字段级）                                 */
/* ================================================================== */
describe("R25：复制 → 倒计时 → 真正清空剪贴板", () => {
  it("复制成功：写入明文 key、启动 1 秒计时器、remaining=总秒数、copiedRef=该行该字段", async () => {
    const guard = mount(3);
    await guard.copyField(item(7, "SECRET-KEY"), "key");
    expect(h.writes).toEqual(["SECRET-KEY"]); // 第一次写入的是明文密钥
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0].ms).toBe(1000);
    expect(h.state.values[0]).toBe("7:key"); // copiedRef（字段级）
    expect(h.state.values[1]).toBe(3); // remaining
  });

  it("复制 url / model 等其它字段：写入对应值，copiedRef 带字段名", async () => {
    const guard = mount(3);
    await guard.copyField(item(7, "K"), "model");
    expect(h.writes).toEqual(["gpt-4o"]);
    expect(h.state.values[0]).toBe("7:model");

    await guard.copyField(item(7, "K"), "website");
    expect(h.writes).toEqual(["gpt-4o", "https://example.com"]);
    expect(h.state.values[0]).toBe("7:website");
  });

  it("★到点【真正清空剪贴板】：第 N 次 tick 写入空串，并复位 UI 与计时器", async () => {
    const guard = mount(3);
    await guard.copyField(item(7, "SECRET-KEY"), "key");

    h.timers[0].fn(); // 1s
    expect(h.state.values[1]).toBe(2);
    expect(h.writes).toEqual(["SECRET-KEY"]); // 未到点，绝不清空

    h.timers[0].fn(); // 2s
    expect(h.state.values[1]).toBe(1);
    expect(h.writes).toEqual(["SECRET-KEY"]);

    h.timers[0].fn(); // 3s → 到点
    expect(h.writes).toEqual(["SECRET-KEY", ""]); // ★ 真的写入了空串
    expect(h.state.values[1]).toBe(0); // remaining 归零
    expect(h.state.values[0]).toBeNull(); // copiedRef 复位
    expect(h.cleared).toContain(h.timers[0].id); // 计时器被停表
  });

  it("倒计时结束前复制另一字段：先取消上一个计时器（不并存、不误清）", async () => {
    const guard = mount(30);
    await guard.copyField(item(1, "AAA"), "key");
    const firstId = h.timers[0].id;
    await guard.copyField(item(2, "BBB"), "url");
    expect(h.cleared).toContain(firstId); // 旧的被清掉
    expect(h.timers).toHaveLength(2);
    expect(h.state.values[0]).toBe("2:url");
    expect(h.writes).toEqual(["AAA", "https://example.com/v1"]);
  });

  it("剪贴板写入被拒：不标记已复制、不启动倒计时（也就不清空）", async () => {
    h.writeFails = true;
    const guard = mount(3);
    await guard.copyField(item(7, "SECRET"), "key");
    expect(h.timers).toHaveLength(0);
    expect(h.state.values[0]).toBeNull();
    expect(h.state.values[1]).toBe(0);
    expect(h.writes).toEqual([]);
  });

  it("解密失败（plain=null）的行：不复制、不启动倒计时", async () => {
    const guard = mount(3);
    const broken: SecretItem = { ...item(9, ""), plain: null, decryptError: true };
    await guard.copyField(broken, "key");
    expect(h.timers).toHaveLength(0);
    expect(h.writes).toEqual([]);
  });

  it("字段为空串：不复制、不进入已复制状态（避免复制出空内容误导用户）", async () => {
    const guard = mount(3);
    const bare = item(4, "K");
    bare.plain!.website = "";
    bare.plain!.model = "";
    bare.plain!.note = "";
    await guard.copyField(bare, "website");
    await guard.copyField(bare, "model");
    await guard.copyField(bare, "note");
    expect(h.timers).toHaveLength(0);
    expect(h.writes).toEqual([]);
  });

  it("stop() 手动停止：清掉计时器（卸载/离开时避免泄漏）", async () => {
    const guard = mount(30);
    await guard.copyField(item(1, "AAA"), "key");
    guard.stop();
    expect(h.cleared).toContain(h.timers[0].id);
  });
});
