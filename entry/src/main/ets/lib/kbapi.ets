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

// ---------------------------------------------------------------------------
// 云函数调用（CloudBase HTTP API：POST {API_BASE}/v1/functions/{name}，
// Authorization: Bearer <access_token>，调用者身份由云函数侧从会话注入读取）。
// 统一返回体 { ok, data?, error? } 与 Web 端 src/lib/api.ts 对齐。
// ---------------------------------------------------------------------------

/** 云函数归一化返回体。 */
export interface KbFnEnvelope {
  ok: boolean;
  data: Record<string, Object> | null;
  error: string;
}

/** kbGetMyRole 返回（本人角色 + 密钥参数 + 恢复码材料状态；recovery_* 仅回本人）。 */
export interface KbMyRole {
  role: string;
  status: string;
  kdfSalt: string;
  kdfVerifier: string;
  keyEpoch: number;
  recoverySalt: string;
  recoveryBlob: string;
  recoveryAckAt: string;
}

/** kbRotateMaster 的单条重加密密文行。 */
export interface KbRotateItem {
  id: number;
  payload: string;
}

class KbRotateMasterBody {
  kdfSalt: string = '';
  kdfSaltPrev: string = '';
  kdfVerifier: string = '';
  recoveryBlob: string | undefined = undefined;
  items: KbRotateItem[] = [];
}

function fnStr(v: Object | undefined): string {
  return typeof v === 'string' ? v : '';
}

function fnNum(v: Object | undefined): number {
  return typeof v === 'number' ? v : 0;
}

/**
 * 调用一个云函数并归一化返回体。
 * HTTP API 可能在返回体外再包一层 { result: <函数返回体> }（或 JSON 字符串），此处解包。
 */
async function invokeFunction(name: string, bodyJson: string,
  accessToken: string): Promise<KbFnEnvelope> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + accessToken
  };
  const req = http.createHttp();
  try {
    const resp = await req.request(`${API_BASE}/v1/functions/${name}`, {
      method: http.RequestMethod.POST,
      header: headers,
      extraData: bodyJson,
      connectTimeout: 20000,
      readTimeout: 60000 // rotateMaster 是全量重写，放宽读超时
    });
    const text = resp.result as string;
    const code = resp.responseCode;
    if (code < 200 || code >= 300) {
      throw new Error(`HTTP ${code}: ${text.slice(0, 180)}`);
    }
    let node = JSON.parse(text) as Record<string, Object>;
    // 解开至多两层 result 包装（对象或 JSON 字符串均可）
    for (let i = 0; i < 2; i++) {
      const inner = node['result'];
      if (inner === undefined || inner === null) {
        break;
      }
      let innerObj: Object | null = null;
      if (typeof inner === 'string') {
        try {
          innerObj = JSON.parse(inner) as Record<string, Object>;
        } catch (e) {
          break;
        }
      } else if (typeof inner === 'object') {
        innerObj = inner;
      }
      if (innerObj === null) {
        break;
      }
      const candidate = innerObj as Record<string, Object>;
      if (typeof candidate['ok'] === 'boolean' && node['ok'] === undefined) {
        node = candidate;
      } else {
        break;
      }
    }
    const ok = typeof node['ok'] === 'boolean' ? node['ok'] as boolean : false;
    const dataRaw = node['data'];
    const data = (dataRaw !== undefined && dataRaw !== null && typeof dataRaw === 'object')
      ? dataRaw as Record<string, Object> : null;
    const error = fnStr(node['error']);
    return { ok: ok, data: data, error: error };
  } catch (err) {
    const be = err as BusinessError;
    if (be.code !== undefined && (be.code as number) !== 2300000 &&
      (be.code as number) < 2300000) {
      throw new Error(`云函数请求失败 [code=${be.code}] ${be.message}`);
    }
    throw err as Error;
  } finally {
    req.destroy();
  }
}

/** R11/R26：取本人 role/status/密钥参数/恢复码状态（kbGetMyRole，身份取自会话）。 */
export async function fetchMyRole(accessToken: string): Promise<KbMyRole> {
  const env = await invokeFunction('kbGetMyRole', '{}', accessToken);
  if (!env.ok || env.data === null) {
    throw new Error('读取账号信息失败：' + (env.error === '' ? '未知错误' : env.error));
  }
  return {
    role: fnStr(env.data['role']),
    status: fnStr(env.data['status']),
    kdfSalt: fnStr(env.data['kdfSalt']),
    kdfVerifier: fnStr(env.data['kdfVerifier']),
    keyEpoch: fnNum(env.data['keyEpoch']),
    recoverySalt: fnStr(env.data['recoverySalt']),
    recoveryBlob: fnStr(env.data['recoveryBlob']),
    recoveryAckAt: fnStr(env.data['recoveryAckAt'])
  };
}

/**
 * R21：整批提交重加密后的全量密文（kbRotateMaster；key_epoch+1 由服务端完成）。
 * 只传密文与盐/校验串，主密钥与主密码绝不进入本请求。返回推进后的 key_epoch。
 */
export async function rotateMasterRemote(kdfSalt: string, kdfSaltPrev: string,
  kdfVerifier: string, recoveryBlob: string, items: KbRotateItem[],
  accessToken: string): Promise<number> {
  const body = new KbRotateMasterBody();
  body.kdfSalt = kdfSalt;
  body.kdfSaltPrev = kdfSaltPrev;
  body.kdfVerifier = kdfVerifier;
  body.recoveryBlob = recoveryBlob === '' ? undefined : recoveryBlob;
  body.items = items;
  const env = await invokeFunction('kbRotateMaster', JSON.stringify(body), accessToken);
  if (!env.ok || env.data === null) {
    throw new Error(env.error === '' ? '未知错误' : env.error);
  }
  const keyEpoch = fnNum(env.data['keyEpoch']);
  if (keyEpoch <= 0) {
    throw new Error('服务端未返回有效的密钥代数');
  }
  return keyEpoch;
}

/** R28：确认「已抄下恢复码」（kbAckRecovery，写 recovery_ack_at；幂等）。返回确认时间。 */
export async function ackRecoveryRemote(accessToken: string): Promise<string> {
  const env = await invokeFunction('kbAckRecovery', '{}', accessToken);
  if (!env.ok || env.data === null) {
    throw new Error('确认失败：' + (env.error === '' ? '未知错误' : env.error));
  }
  return fnStr(env.data['ackedAt']);
}
