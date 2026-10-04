/**
 * phone-auth.ts —— 手机号验证码登录（CloudBase 平台原生）。
 *
 * 为什么用平台原生登录（2026-09-29 变更）：
 *   原方案由云函数校验"用户名 + 登录密码"并签发自定义登录票据；实测在当前环境不可用——
 *   平台侧自定义登录密钥未登记，服务端恒返回「私钥已过期或私钥不存在，请重新生成」。
 *   改用平台原生手机号验证码登录后：短信通道开箱可用、登录态由平台签发、
 *   云函数调用天然是"已登录用户"（函数安全规则放行），整条链路无需任何密钥配置。
 *
 * 关键约束（官方约定，勿改）：
 *   - 验证码校验必须用 signInWithOtp 返回结果里的 `data.verifyOtp({ token })` 回调，
 *     不能用独立的 auth.verifyOtp({ token })（那个还需要 messageId）。
 *   - 手机号需带国家码，形如 `+86 13800138000`。
 *   - 会话判据一律用 auth.getSession()（data.session 为空即未登录）。
 */
import { requireAuth } from "./cloudbase";
import { log } from "./log";
import type { ApiResult } from "./api";

interface OtpVerifyResult {
  data?: { user?: { id?: string } };
  error?: { message?: string };
}
interface OtpSendResult {
  data?: { verifyOtp?: (p: { token: string }) => Promise<OtpVerifyResult> };
  error?: { message?: string };
}

/** 待校验的验证码句柄：sendSmsCode 成功后持有，signInWithSmsCode 成功后清空。 */
let pendingVerify: ((p: { token: string }) => Promise<OtpVerifyResult>) | null = null;

/** 是否已经发过验证码（供界面按钮状态使用）。 */
export function hasPendingCode(): boolean {
  return pendingVerify !== null;
}

/** 发送短信验证码。入参为 11 位国内号码，内部自动补 `+86`。 */
export async function sendSmsCode(phone: string): Promise<ApiResult<null>> {
  const normalized = String(phone || "").trim();
  if (!/^1[3-9]\d{9}$/.test(normalized)) return { ok: false, error: "INVALID_PHONE" };
  try {
    const authClient = requireAuth() as unknown as {
      signInWithOtp: (p: { phone: string }) => Promise<OtpSendResult>;
    };
    const res = await authClient.signInWithOtp({ phone: `+86 ${normalized}` });
    if (res && res.error) return { ok: false, error: res.error.message || "SEND_FAILED" };
    pendingVerify = (res && res.data && res.data.verifyOtp) || null;
    if (!pendingVerify) return { ok: false, error: "SEND_FAILED" };
    return { ok: true, data: null };
  } catch (error) {
    log.error("发送短信验证码失败", error);
    return { ok: false, error: error instanceof Error ? error.message : "SEND_FAILED" };
  }
}

/** 用短信验证码完成登录；成功后平台会话即已建立。 */
export async function signInWithSmsCode(token: string): Promise<ApiResult<{ uid: string }>> {
  const code = String(token || "").trim();
  if (!code) return { ok: false, error: "EMPTY_CODE" };
  if (!pendingVerify) return { ok: false, error: "NO_PENDING_CODE" };
  try {
    const res = await pendingVerify({ token: code });
    if (res && res.error) return { ok: false, error: res.error.message || "VERIFY_FAILED" };
    const uid = res && res.data && res.data.user ? res.data.user.id : "";
    pendingVerify = null;
    return { ok: true, data: { uid: String(uid || "") } };
  } catch (error) {
    log.error("短信验证码登录失败", error);
    return { ok: false, error: error instanceof Error ? error.message : "VERIFY_FAILED" };
  }
}

/** 把登录错误码/消息转成给用户看的中文提示（不透传内部细节）。 */
export function describePhoneAuthError(code?: string): string {
  const text = String(code || "");
  if (text === "INVALID_PHONE") return "请输入 11 位手机号。";
  if (text === "EMPTY_CODE") return "请输入收到的验证码。";
  if (text === "NO_PENDING_CODE") return "请先点「发送验证码」。";
  if (text.indexOf("验证码") >= 0 || text.indexOf("verification") >= 0 || text.indexOf("invalid") >= 0) {
    return "验证码不正确或已过期，请重新获取。";
  }
  if (text.indexOf("发送") >= 0 || text.indexOf("sms") >= 0 || text.indexOf("SEND_FAILED") >= 0) {
    return "验证码发送失败，请稍后重试。";
  }
  return "登录失败，请稍后重试。";
}
