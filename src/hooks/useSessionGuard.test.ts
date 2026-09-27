/**
 * useSessionGuard.test.ts —— 第 8 步「会话时效护栏」对抗性单测（R13 本机已解锁窗口，架构 §7.1）。
 *
 * 隔离方式：本仓库未安装 jsdom / @testing-library，故用最小化的 React 桩替换
 *   `useRef / useCallback / useEffect`，手动驱动 effect 体；并用伪造的 `window.setInterval`
 *   与 `document` 捕获 60 秒轮询与 visibilitychange 监听。这样测试运行的是
 *   **真实的 useSessionGuard 源码**，而非复写它的逻辑。
 *
 * 覆盖的断言（team-lead 第 4 条）：
 *   ① 触发点覆盖「启动 + visibilitychange 回前台 + 每 60 秒 + 每次同步前（checkNow 返回值）」；
 *   ② 命中 status !== 'active' → 立即回调 onExpired（登出 + 清空主密钥由调用方执行）；
 *   ③ ★网络错误【不】误登出（这条必须有专门用例）；
 *   ④ 卸载时清理计时器与监听（避免泄漏 / 重复轮询）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    getMyRoleResult: { ok: true, data: { status: "active" } } as {
      ok: boolean;
      data?: { status: string };
      error?: string;
    },
    getMyRoleCalls: 0,
    capturedEffect: null as null | (() => void | (() => void)),
    intervals: [] as Array<{ fn: () => void; ms: number; id: number }>,
    clearedIntervals: [] as number[],
    visibilityListeners: [] as Array<() => void>,
    removedListeners: [] as Array<() => void>,
    visibilityState: "visible" as "visible" | "hidden",
    intervalSeq: 0,
  };
  return { state };
});

vi.mock("react", () => ({
  useRef: (init: unknown) => ({ current: init }),
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => void | (() => void)) => {
    h.state.capturedEffect = fn;
  },
}));

vi.mock("../lib/api", () => ({
  api: {
    getMyRole() {
      h.state.getMyRoleCalls += 1;
      return Promise.resolve(h.state.getMyRoleResult);
    },
  },
}));

import { useSessionGuard } from "./useSessionGuard";

/** 安装伪造的 window / document。 */
function installDom(): void {
  (globalThis as unknown as { window: unknown }).window = {
    setInterval(fn: () => void, ms: number): number {
      h.state.intervalSeq += 1;
      const id = h.state.intervalSeq;
      h.state.intervals.push({ fn, ms, id });
      return id;
    },
    clearInterval(id: number): void {
      h.state.clearedIntervals.push(id);
    },
  };
  (globalThis as unknown as { document: unknown }).document = {
    get visibilityState() {
      return h.state.visibilityState;
    },
    addEventListener(type: string, fn: () => void): void {
      if (type === "visibilitychange") h.state.visibilityListeners.push(fn);
    },
    removeEventListener(type: string, fn: () => void): void {
      if (type === "visibilitychange") h.state.removedListeners.push(fn);
    },
  };
}

/** 挂载 hook：运行一次 effect 体（等价于组件挂载）。 */
function mount(onExpired: () => void): { checkNow: () => Promise<boolean>; cleanup: () => void } {
  const { checkNow } = useSessionGuard(onExpired);
  const cleanup = (h.state.capturedEffect ? h.state.capturedEffect() : undefined) as
    | (() => void)
    | undefined;
  return { checkNow, cleanup: cleanup ?? (() => undefined) };
}

beforeEach(() => {
  h.state.getMyRoleResult = { ok: true, data: { status: "active" } };
  h.state.getMyRoleCalls = 0;
  h.state.capturedEffect = null;
  h.state.intervals.length = 0;
  h.state.clearedIntervals.length = 0;
  h.state.visibilityListeners.length = 0;
  h.state.removedListeners.length = 0;
  h.state.visibilityState = "visible";
  h.state.intervalSeq = 0;
  installDom();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ================================================================== */
/* ① 触发点                                                            */
/* ================================================================== */
describe("R13 会话护栏：触发点覆盖", () => {
  it("启动（挂载即查一次）", async () => {
    mount(() => undefined);
    expect(h.state.getMyRoleCalls).toBe(1);
  });

  it("前台每 60 秒轮询（间隔常量 = 60000ms）", () => {
    mount(() => undefined);
    expect(h.state.intervals).toHaveLength(1);
    expect(h.state.intervals[0].ms).toBe(60_000);
  });

  it("每 60 秒回调真正触发一次 getMyRole", () => {
    mount(() => undefined);
    expect(h.state.getMyRoleCalls).toBe(1);
    h.state.intervals[0].fn(); // 模拟 60 秒到点
    expect(h.state.getMyRoleCalls).toBe(2);
  });

  it("visibilitychange 回到前台（visible）触发一次查询", () => {
    mount(() => undefined);
    expect(h.state.getMyRoleCalls).toBe(1);
    h.state.visibilityState = "visible";
    h.state.visibilityListeners[0]();
    expect(h.state.getMyRoleCalls).toBe(2);
  });

  it("visibilitychange 转后台（hidden）不触发查询（省流）", () => {
    mount(() => undefined);
    h.state.visibilityState = "hidden";
    h.state.visibilityListeners[0]();
    expect(h.state.getMyRoleCalls).toBe(1);
  });

  it("返回的 checkNow 可供“每次同步前”主动调用", async () => {
    const { checkNow } = mount(() => undefined);
    await checkNow();
    expect(h.state.getMyRoleCalls).toBe(2); // 1 启动 + 1 主动
  });

  it("卸载时清理：clearInterval 被调用且监听被移除", () => {
    const { cleanup } = mount(() => undefined);
    cleanup();
    expect(h.state.clearedIntervals).toEqual([h.state.intervals[0].id]);
    expect(h.state.removedListeners).toHaveLength(1);
  });
});

/* ================================================================== */
/* ② 命中停用 / 会话失效 → 立即 onExpired                              */
/* ================================================================== */
describe("R13 会话护栏：命中即锁定", () => {
  it("status='disabled' → onExpired 被调用，checkNow 返回 false", async () => {
    h.state.getMyRoleResult = { ok: true, data: { status: "disabled" } };
    const onExpired = vi.fn();
    const { checkNow } = mount(onExpired);
    await Promise.resolve(); // 冲掉 effect 内 void checkNow() 的 await
    const result = await checkNow();
    expect(onExpired).toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it("status='deleted'（软删）→ onExpired 被调用", async () => {
    h.state.getMyRoleResult = { ok: true, data: { status: "deleted" } };
    const onExpired = vi.fn();
    mount(onExpired);
    await Promise.resolve();
    expect(onExpired).toHaveBeenCalled();
  });

  it("error='NOT_LOGGED_IN'（会话失效）→ onExpired 被调用", async () => {
    h.state.getMyRoleResult = { ok: false, error: "NOT_LOGGED_IN" };
    const onExpired = vi.fn();
    mount(onExpired);
    await Promise.resolve();
    expect(onExpired).toHaveBeenCalled();
  });

  it("error='USER_NOT_FOUND'（账号被删）→ onExpired 被调用", async () => {
    h.state.getMyRoleResult = { ok: false, error: "USER_NOT_FOUND" };
    const onExpired = vi.fn();
    mount(onExpired);
    await Promise.resolve();
    expect(onExpired).toHaveBeenCalled();
  });

  it("status='active' 且 ok → 不锁定，checkNow 返回 true", async () => {
    const onExpired = vi.fn();
    const { checkNow } = mount(onExpired);
    await Promise.resolve();
    const result = await checkNow();
    expect(onExpired).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });
});

/* ================================================================== */
/* ③ ★网络错误【不】误登出（关键用例）                                  */
/* ================================================================== */
describe("R13 会话护栏：网络错误不误伤（★关键）", () => {
  const networkErrors = ["NETWORK_ERROR", "Failed to fetch", "PG_502", "TIMEOUT", "MALFORMED_RESPONSE"];

  it.each(networkErrors)("error='%s' → 不调用 onExpired，checkNow 返回 true", async (err) => {
    h.state.getMyRoleResult = { ok: false, error: err };
    const onExpired = vi.fn();
    const { checkNow } = mount(onExpired);
    await Promise.resolve();
    const result = await checkNow();
    await Promise.resolve();
    expect(onExpired).not.toHaveBeenCalled();
    expect(result).toBe(true); // true＝“未判定失效”，调用方继续
  });

  it("断网（ok=false 且无 error 字段）→ 同样不登出", async () => {
    h.state.getMyRoleResult = { ok: false };
    const onExpired = vi.fn();
    const { checkNow } = mount(onExpired);
    await Promise.resolve();
    await checkNow();
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("对照组：同一网络错误反复轮询 10 次，onExpired 始终 0 次（不累积误伤）", async () => {
    h.state.getMyRoleResult = { ok: false, error: "NETWORK_ERROR" };
    const onExpired = vi.fn();
    mount(onExpired);
    await Promise.resolve();
    for (let i = 0; i < 10; i += 1) h.state.intervals[0].fn();
    await Promise.resolve();
    expect(onExpired).not.toHaveBeenCalled();
  });
});
