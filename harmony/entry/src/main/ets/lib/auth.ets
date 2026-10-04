/**
 * auth.ets —— 手机号验证码登录（三步 REST，规范与 Phase 0 实测一致）+ 会话刷新。
 *
 * 实测记录（2026-09-29，真实短信 + token 验证通过）：
 *   ① POST /auth/v1/verification          body 仅 {"phone_number":"+86 1xxxxxxxxxx"}
 *      （无 target 字段；手机号必须 /^\+\d{1,3}\s+\d+/ 格式，缺国家码自动补 "+86 "）
 *      → {"verification_id":"..."}（611 字符 JWT）
 *   ② POST /auth/v1/verification/verify   {verification_id, verification_code}
 *      → {"verification_token":"..."}
 *   ③ POST /auth/v1/signin                {verification_token}
 *      → {"access_token","refresh_token","expires_in":7200,"sub":"<平台 uid>"}
 *
 * 鉴权头：认证三步用 `Authorization: Bearer <publishable_key>`；
 *          之后的数据请求（RDB REST）换 `Bearer <access_token>`。
 *
 * 会话刷新（2026-09-30 实测格式）：
 *   POST /auth/v1/token，**无 Authorization 头**，
 *   body = { client_id(环境id), client_secret(空串), grant_type:"refresh_token", refresh_token }。
 *   带任何 Authorization 头都会被服务器当 JWT 验签而报 "malformed jwt / invalid token header"。
 */
import { http } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { API_BASE, PUBLISHABLE_KEY, ENV_ID } from './config';

const SDK_VERSION: string = '@cloudbase/js-sdk/3.10.1';

interface VerificationBody {
  phone_number: string;
}

interface VerifyBody {
  verification_id: string;
  verification_code: string;
}

interface SignInBody {
  verification_token: string;
}

interface RefreshBody {
  client_id: string;
  client_secret: string;
  grant_type: string;
  refresh_token: string;
}

/** 统一 POST（带 Authorization 头的认证三步用）：返回响应文本。 */
async function post(path: string, body: VerificationBody | VerifyBody | SignInBody,
  bearer: string): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + bearer,
    'X-SDK-Version': SDK_VERSION
  };
  const req = http.createHttp();
  try {
    const resp = await req.request(API_BASE + path, {
      method: http.RequestMethod.POST,
      header: headers,
      extraData: JSON.stringify(body),
      connectTimeout: 15000,
      readTimeout: 15000
    });
    return resp.result as string;
  } finally {
    req.destroy();
  }
}

function extractField(jsonText: string, field: string): string {
  const parsed = JSON.parse(jsonText) as Record<string, Object>;
  const v = parsed[field];
  return typeof v === 'string' ? v : '';
}

/** 规范化手机号：无国际码则补 "+86 "（与 js-sdk 的 formatPhone 行为一致）。 */
export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (/^\+\d{1,3}\s+\d+/.test(trimmed)) {
    return trimmed;
  }
  return '+86 ' + trimmed;
}

/** Step ①：发送验证码 → verification_id。 */
export async function sendVerification(phone: string): Promise<string> {
  const body: VerificationBody = { phone_number: normalizePhone(phone) };
  const resp = await post('/auth/v1/verification', body, PUBLISHABLE_KEY);
  const vid = extractField(resp, 'verification_id');
  if (vid === '') {
    throw new Error('发送验证码失败：' + resp.slice(0, 120));
  }
  return vid;
}

/** Step ②：校验验证码 → verification_token。 */
export async function verifyCode(verificationId: string, code: string): Promise<string> {
  const body: VerifyBody = { verification_id: verificationId, verification_code: code };
  const resp = await post('/auth/v1/verification/verify', body, PUBLISHABLE_KEY);
  const token = extractField(resp, 'verification_token');
  if (token === '') {
    throw new Error('验证码校验失败（已过期或不正确）：' + resp.slice(0, 120));
  }
  return token;
}

/** 登录结果。 */
export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  uid: string;
}

/** Step ③：verification_token 换登录态。 */
export async function signIn(verificationToken: string): Promise<Session> {
  const body: SignInBody = { verification_token: verificationToken };
  const resp = await post('/auth/v1/signin', body, PUBLISHABLE_KEY);
  const parsed = JSON.parse(resp) as Record<string, Object>;
  const accessToken = parsed['access_token'];
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new Error('登录失败：' + resp.slice(0, 120));
  }
  return {
    accessToken: accessToken,
    refreshToken: typeof parsed['refresh_token'] === 'string' ? parsed['refresh_token'] : '',
    expiresIn: typeof parsed['expires_in'] === 'number' ? parsed['expires_in'] : 7200,
    uid: typeof parsed['sub'] === 'string' ? parsed['sub'] : ''
  };
}

/**
 * 用 refresh_token 换新登录态（access_token 7200s 过期后的静默续期）。
 * 实测格式（2026-09-30，端点探测确认）：POST /auth/v1/token，**无 Authorization 头**，
 * body = { client_id(环境id), client_secret(空串), grant_type:"refresh_token", refresh_token }。
 * 带任何 Authorization 头都会被服务器当 JWT 验签而报 "malformed jwt / invalid token header"。
 */
/**
 * R95 加固：平台侧偶发续期竞态（invalid_grant 4026）可能让首次续期失败，
 * 先重试一次再判定会话失效，避免把用户误登出。
 */
export async function refreshSession(refreshToken: string): Promise<Session> {
  try {
    return await refreshSessionOnce(refreshToken);
  } catch (e) {
    await new Promise<void>((resolve) => { setTimeout(() => { resolve(); }, 600); });
    return await refreshSessionOnce(refreshToken);
  }
}

async function refreshSessionOnce(refreshToken: string): Promise<Session> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const body: RefreshBody = {
    client_id: ENV_ID,
    client_secret: '',
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  };
  const req = http.createHttp();
  try {
    const resp = await req.request(API_BASE + '/auth/v1/token', {
      method: http.RequestMethod.POST,
      header: headers,
      extraData: JSON.stringify(body),
      connectTimeout: 15000,
      readTimeout: 15000
    });
    const parsed = JSON.parse(resp.result as string) as Record<string, Object>;
    const accessToken = parsed['access_token'];
    if (typeof accessToken !== 'string' || accessToken === '') {
      throw new Error('会话已过期，请重新登录');
    }
    return {
      accessToken: accessToken,
      refreshToken: typeof parsed['refresh_token'] === 'string' ? parsed['refresh_token'] : refreshToken,
      expiresIn: typeof parsed['expires_in'] === 'number' ? parsed['expires_in'] : 7200,
      uid: typeof parsed['sub'] === 'string' ? parsed['sub'] : ''
    };
  } catch (err) {
    const be = err as BusinessError;
    throw new Error('刷新会话失败 [code=' + be.code + '] ' + be.message);
  } finally {
    req.destroy();
  }
}
