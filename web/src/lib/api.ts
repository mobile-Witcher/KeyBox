/**
 * api.ts —— 云函数调用封装。
 *
 * 【身份模型 2026-09-29 变更】
 *   登录改为 CloudBase 平台原生的「手机号验证码登录」（见 src/lib/phone-auth.ts）：
 *   会话由平台签发，uid 即平台账号 uid。因此：
 *     - 云函数一律在【已登录】状态下调用（走 SDK callFunction），不再需要 HTTP 网关通道；
 *     - 不再有"登录前函数"，也不再由云函数签发自定义登录票据
 *       （实测自定义登录在 PG 环境不可用：服务端恒返回"私钥已过期或私钥不存在"）。
 *   调用者身份由云函数侧 getCaller() 从运行时注入读取，前端从不传 uid。
 *
 * 统一约定：
 *   - 所有云函数返回 { ok: boolean, data?, error?, initialized? }，本文件把异常也归一成同一形状。
 *   - 主密码从不进入本文件：kdfSalt / kdfVerifier 是“盐 + 用主密钥加密的校验串”，
 *     都不是主密码本身（架构 §6.1 第 3 步）。
 */
import { requireApp } from "./cloudbase";
import { log } from "./log";

/** 云函数统一返回体。 */
export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  /**
   * 仅 kbGetMyRole 在“本账号尚未激活”时附带：
   *   true  = 系统已有用户 → 前端应引导去「邀请码激活」
   *   false = 系统还没有任何用户 → 前端应引导去「首次初始化」
   */
  initialized?: boolean;
}

/** 归一化后的安全返回体（调用方必得一种形状，不会抛裸异常）。 */
async function call<T>(name: string, data: Record<string, unknown>): Promise<ApiResult<T>> {
  try {
    const res = await requireApp().callFunction({ name, data });
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

/**
 * kbInitAdmin 入参。
 * 身份取自平台会话（uid），因此不再需要用户名 / 登录密码。
 */
export interface InitAdminParams {
  /** 客户端算出的主密钥盐与校验串（不含主密码）。 */
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

/** kbRegister 入参：邀请码 + 主密钥材料（身份同样取自平台会话）。 */
export interface RegisterParams {
  code: string;
  kdfSalt: string;
  kdfVerifier: string;
  /** R28：恢复码派生盐（base64）。与 recoveryBlob 必须【成对】。 */
  recoverySalt?: string;
  /** R28：`KBRC1:` 恢复码密文。 */
  recoveryBlob?: string;
}

export interface RegisterData {
  uid: string;
  role: string;
  /** 该平台账号本就已激活（重复提交的幂等返回）。 */
  alreadyActivated?: boolean;
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

/** kbRotateMaster 入参：改主密码时本机【重加密后】的全量新代密文（不含任何明文/密钥）。 */
export interface RotateMasterParams {
  /** 新一代主密码派生盐（base64）。 */
  kdfSalt: string;
  /** 上一代主密码派生盐（base64，供本机回滚窗口使用；§6.3）。 */
  kdfSaltPrev: string;
  /** 新一代 kdf_verifier（`KB1:` 密文）。 */
  kdfVerifier: string;
  /** R28：若账号已设恢复码，则用【新】主密钥重包裹后的 `KBRC1:` 密文（可选）。 */
  recoveryBlob?: string;
  /** 本机重加密后的全部密文行（id 为服务端行 id，payload 为 `KB1:` 密文）。 */
  items: Array<{ id: number; payload: string }>;
}

/** kbRotateMaster 返回：推进后的 key_epoch（服务端 +1）。 */
export interface RotateMasterData {
  keyEpoch: number;
}

/** kbAckRecovery 返回：本次写入的 recovery_ack_at（ISO）。 */
export interface AckRecoveryData {
  ackedAt: string;
}

export const api = {
  /** R01：首个管理员初始化（表中已有用户会被云函数拒绝）。需已登录（手机号验证码）。 */
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
  /** R03/R04/R22：用邀请码完成激活（需已登录；接口幂等，重复提交不报错）。 */
  register(params: RegisterParams): Promise<ApiResult<RegisterData>> {
    return call<RegisterData>("kbRegister", { ...params });
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
  /**
   * R21：整批提交重加密后的全量密文（单请求、原子；key_epoch+1 由服务端完成）。
   * 只传密文与盐/校验串，主密钥与主密码绝不进入本请求。
   */
  rotateMaster(params: RotateMasterParams): Promise<ApiResult<RotateMasterData>> {
    return call<RotateMasterData>("kbRotateMaster", { ...params });
  },
  /** R28：确认“已抄下恢复码”（写 recovery_ack_at；仅本人那一行）。 */
  ackRecovery(): Promise<ApiResult<AckRecoveryData>> {
    return call<AckRecoveryData>("kbAckRecovery", {});
  },
};
