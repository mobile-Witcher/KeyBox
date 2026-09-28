/**
 * api.ts —— 云函数调用封装（架构 §9 第 6 行）。
 *
 * 统一约定：
 *   - 所有云函数返回 { ok: boolean, data?, error? }（架构 §7），本文件把异常也归一成同一形状。
 *   - 本步骤（第 4 步）只封装 6 个账号类函数；其余函数待后续步骤再补。
 *   - 主密码从不进入本文件：kdfSalt / kdfVerifier 是“盐 + 用主密钥加密的校验串”，
 *     都不是主密码本身（架构 §6.1 第 3 步）。
 */
import { app, auth } from "./cloudbase";
import { log } from "./log";

/** 云函数统一返回体。 */
export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** 归一化后的安全返回体（调用方必得一种形状，不会抛裸异常）。 */
async function call<T>(name: string, data: Record<string, unknown>): Promise<ApiResult<T>> {
  try {
    const res = await app.callFunction({ name, data });
    const result = (res && (res as { result?: unknown }).result) as ApiResult<T> | undefined;
    if (!result || typeof result !== "object" || typeof result.ok !== "boolean") {
      log.error(`云函数 ${name} 返回体形状非法`);
      return { ok: false, error: "MALFORMED_RESPONSE" };
    }
    return result;
  } catch (error) {
    log.error(`调用云函数 ${name} 失败`, error);
    return { ok: false, error: error instanceof Error ? error.message : "NETWORK_ERROR" };
  }
}

/** kbInitAdmin 入参：登录密码 + 客户端算出的主密钥盐与校验串（不含主密码）。 */
export interface InitAdminParams {
  username: string;
  loginPwd: string;
  kdfSalt: string;
  kdfVerifier: string;
  /** R28：恢复码派生盐（base64；须独立于 kdfSalt）。与 recoveryBlob 必须【成对】给出或同时缺省。 */
  recoverySalt?: string;
  /** R28：`KBRC1:` 恢复码密文（用恢复码包裹主密钥所得）。绝不承载恢复码/主密钥明文。 */
  recoveryBlob?: string;
}

/** kbInitAdmin 返回。 */
export interface InitAdminData {
  uid: string;
  role: string;
}

export interface RegisterParams {
  code: string;
  username: string;
  loginPwd: string;
  kdfSalt: string;
  kdfVerifier: string;
  /** R28：恢复码派生盐（base64；须独立于 kdfSalt）。与 recoveryBlob 必须【成对】给出或同时缺省。 */
  recoverySalt?: string;
  /** R28：`KBRC1:` 恢复码密文（用恢复码包裹主密钥所得）。绝不承载恢复码/主密钥明文。 */
  recoveryBlob?: string;
}

export interface RegisterData {
  uid: string;
  ticket: string;
  role: string;
}

export interface LoginParams {
  username: string;
  loginPwd: string;
}

export interface LoginData {
  ticket: string;
  uid: string;
  role: string;
}

export interface InviteCreateData {
  code: string;
  createdAt: string;
}

export interface InviteRevokeParams {
  codeId?: number;
  code?: string;
}

export interface MyRoleData {
  role: string;
  status: string;
  kdfSalt: string;
  kdfVerifier: string;
  keyEpoch: number;
  /** R28：本人恢复码派生盐（仅回本人；管理员列表【不含】此列）。可能为 null（尚未设恢复码）。 */
  recoverySalt: string | null;
  /** R28：本人 `KBRC1:` 恢复码密文（仅回本人）。可能为 null。 */
  recoveryBlob: string | null;
  /** R28：用户确认“已抄下恢复码”的时间；为 null ⇒ 前端持续提醒。 */
  recoveryAckAt: string | null;
  userCount: number;
}

/** kbSecretUpsert 入参：payload 为 `KB1:` 密文；有 id 则更新、无 id 则新增。 */
export interface SecretUpsertParams {
  id?: number;
  payload: string;
  keyEpoch: number;
}

export interface SecretUpsertData {
  id: number;
  updatedAt: string;
}

export interface SecretDeleteData {
  deletedId: number;
}

/** kbAdminDeleteUserData 返回：**仅**删除条数（不含任何字段内容）。 */
export interface AdminDeleteUserDataData {
  deletedCount: number;
}

export const api = {
  /** R01：首个管理员初始化（表中已有用户会被云函数拒绝）。 */
  initAdmin(params: InitAdminParams): Promise<ApiResult<InitAdminData>> {
    return call<InitAdminData>("kbInitAdmin", { ...params });
  },
  /** R02：管理员生成一次性邀请码。 */
  inviteCreate(): Promise<ApiResult<InviteCreateData>> {
    return call<InviteCreateData>("kbInviteCreate", {});
  },
  /** R02：管理员作废邀请码（仅 unused 可作废）。 */
  inviteRevoke(params: InviteRevokeParams): Promise<ApiResult<{ codeId: number }>> {
    return call<{ codeId: number }>("kbInviteRevoke", { ...params });
  },
  /** R03/R04/R22：用邀请码自助注册，成功后云函数签发登录票据。 */
  register(params: RegisterParams): Promise<ApiResult<RegisterData>> {
    return call<RegisterData>("kbRegister", { ...params });
  },
  /** R05/R13：登录密码校验在云端，通过后签发登录票据。 */
  login(params: LoginParams): Promise<ApiResult<LoginData>> {
    return call<LoginData>("kbLogin", { ...params });
  },
  /** R11/R26：取本人 role/status/密钥参数与用户数（只返回本人那一行）。 */
  getMyRole(): Promise<ApiResult<MyRoleData>> {
    return call<MyRoleData>("kbGetMyRole", {});
  },
  /** R08/R15：新增或更新一条密钥密文（owner_id 由云函数按会话身份写入）。 */
  secretUpsert(params: SecretUpsertParams): Promise<ApiResult<SecretUpsertData>> {
    return call<SecretUpsertData>("kbSecretUpsert", { ...params });
  },
  /** R15：删除本人一条密钥记录。 */
  secretDelete(params: { id: number }): Promise<ApiResult<SecretDeleteData>> {
    return call<SecretDeleteData>("kbSecretDelete", { ...params });
  },
  /**
   * R10/R14：管理员删除某用户全部密钥数据（唯一持 service_role 的云函数）。
   * 入参只接受一个 uid；返回体仅 { deletedCount }。
   */
  adminDeleteUserData(params: { uid: string }): Promise<ApiResult<AdminDeleteUserDataData>> {
    return call<AdminDeleteUserDataData>("kbAdminDeleteUserData", { ...params });
  },
};

/**
 * 用云函数签发的自定义登录票据换取 CloudBase 会话。
 * 已核实（auth-web-cloudbase）：auth.signInWithCustomTicket(cb) 接收一个返回票据的函数。
 */
export async function signInWithTicket(ticket: string): Promise<ApiResult<{ signedIn: boolean }>> {
  if (!ticket) return { ok: false, error: "EMPTY_TICKET" };
  try {
    const res = (await auth.signInWithCustomTicket(async () => ticket)) as
      | { error?: { message?: string } }
      | undefined;
    if (res && res.error) {
      return { ok: false, error: res.error.message || "SIGN_IN_FAILED" };
    }
    return { ok: true, data: { signedIn: true } };
  } catch (error) {
    log.error("signInWithCustomTicket 失败", error);
    return { ok: false, error: error instanceof Error ? error.message : "SIGN_IN_FAILED" };
  }
}
