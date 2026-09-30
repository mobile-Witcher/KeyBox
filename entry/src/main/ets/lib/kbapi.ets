/**
 * kbapi.ets —— CloudBase 数据访问（RDB REST，PostgREST 风格，纯 HTTP）。
 *
 * 鉴权：Authorization: Bearer <access_token>（用户态）。
 * 隔离：owner_id 由数据库列默认值 auth.uid() 写入；查询过滤 owner_id=eq.<uid>；
 *       服务端 RLS 双保险（Phase 0 Step 4 已实测）。
 */
import { http } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { API_BASE } from './config';

/** kb_secrets 一行（只取渲染所需列）。 */
export interface KbSecretRow {
  id: number;
  payload: string;
  key_epoch: number;
  updated_at: string;
}

/** kb_users 的密钥参数行。 */
export interface KbUserInfo {
  kdf_salt: string;
  kdf_verifier: string;
  key_epoch: number;
  role: string;
  status: string;
}

async function request(method: string, path: string, body: string | null,
  accessToken: string): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + accessToken
  };
  const req = http.createHttp();
  try {
    const resp = await req.request(API_BASE + path, {
      method: method as http.RequestMethod,
      header: headers,
      extraData: body === null ? undefined : body,
      connectTimeout: 15000,
      readTimeout: 15000
    });
    const text = resp.result as string;
    const code = resp.responseCode;
    if (code < 200 || code >= 300) {
      // 401/403 等：把服务端原样错误带出来，便于定位（如 token 过期、列未授权）
      throw new Error(`HTTP ${code}: ${text.slice(0, 180)}`);
    }
    return text;
  } catch (err) {
    const be = err as BusinessError;
    if (be.code !== undefined && (be.code as number) !== 2300000 &&
      (be.code as number) < 2300000) {
      // http 模块网络错误（2300xxx）
      throw new Error(`网络请求失败 [code=${be.code}] ${be.message}`);
    }
    throw err as Error; // 上面已包装的业务错误原样抛出（确保 Error 类型）
  } finally {
    req.destroy();
  }
}

/** 拉取本人全部密文（按更新时间升序）。 */
export async function fetchSecretRows(uid: string, accessToken: string): Promise<KbSecretRow[]> {
  const path = `/v1/rdb/rest/kb_secrets?select=id,payload,key_epoch,updated_at` +
    `&owner_id=eq.${uid}&order=updated_at.asc`;
  const resp = await request('GET', path, null, accessToken);
  return JSON.parse(resp) as KbSecretRow[];
}

/** 读取本人的 kdf_salt / kdf_verifier / key_epoch（解锁校验用）。 */
export async function fetchMyKeyInfo(uid: string, accessToken: string): Promise<KbUserInfo> {
  const path = `/v1/rdb/rest/kb_users?select=kdf_salt,kdf_verifier,key_epoch,role,status&uid=eq.${uid}`;
  const resp = await request('GET', path, null, accessToken);
  const rows = JSON.parse(resp) as KbUserInfo[];
  if (rows.length === 0) {
    throw new Error('账号不存在或已被停用');
  }
  return rows[0];
}

/** 插入一条密文（owner_id 由列默认值 auth.uid() 自动写入，不传）。 */
export async function insertSecretRow(payload: string, keyEpoch: number,
  accessToken: string): Promise<void> {
  const body = JSON.stringify({ payload: payload, key_epoch: keyEpoch });
  await request('POST', '/v1/rdb/rest/kb_secrets', body, accessToken);
}

/** 更新一条密文（按 id）。 */
export async function updateSecretRow(id: number, payload: string, keyEpoch: number,
  accessToken: string): Promise<void> {
  const body = JSON.stringify({ payload: payload, key_epoch: keyEpoch,
    updated_at: new Date().toISOString() });
  await request('PATCH', `/v1/rdb/rest/kb_secrets?id=eq.${id}`, body, accessToken);
}

/** 删除一条密文（按 id，硬删；RLS 保证只能删自己的）。 */
export async function deleteSecretRow(id: number, accessToken: string): Promise<void> {
  await request('DELETE', `/v1/rdb/rest/kb_secrets?id=eq.${id}`, null, accessToken);
}
