/**
 * useSessionGuard —— 会话时效护栏（R13「本机已解锁窗口」，架构 §7.1 最终值）。
 *
 * 触发点：① 启动（挂载即查一次）② `visibilitychange` 回到前台 ③ 每次同步前（由调用方调用返回的 `checkNow`）。
 * 另：前台每 60 秒轮询一次。
 *
 * 命中即回调 `onExpired`（调用方应：`signOut()` + 清空内存主密钥 + 锁定本地缓存）。
 * 判定命中的条件：
 *   - 返回体 `status !== 'active'`（被停用/软删）；
 *   - 会话失效（`NOT_LOGGED_IN` / `USER_NOT_FOUND`）。
 * 网络等其它错误【不】触发登出（避免断网误伤）。
 */
import { useCallback, useEffect, useRef } from "react";
import { api } from "../lib/api";
import { log } from "../lib/log";

/** 前台轮询间隔：≤1 分钟窗口（架构 §7.1）。 */
const POLL_INTERVAL_MS = 60 * 1000;

export function useSessionGuard(onExpired: () => void): { checkNow: () => Promise<boolean> } {
  // 用 ref 保存最新回调，避免把 onExpired 放进依赖导致计时器反复重建。
  const expiredRef = useRef(onExpired);
  expiredRef.current = onExpired;

  const checkNow = useCallback(async (): Promise<boolean> => {
    const res = await api.getMyRole();
    if (!res.ok) {
      if (res.error === "NOT_LOGGED_IN" || res.error === "USER_NOT_FOUND") {
        log.warn("会话已失效，触发锁定");
        expiredRef.current();
        return false;
      }
      return true; // 网络等错误：不登出
    }
    if (res.data && res.data.status !== "active") {
      log.warn("账号已被停用/软删，触发锁定");
      expiredRef.current();
      return false;
    }
    return true;
  }, []);

  useEffect(() => {
    void checkNow();
    const timer = window.setInterval(() => void checkNow(), POLL_INTERVAL_MS);
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") void checkNow();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [checkNow]);

  return { checkNow };
}
