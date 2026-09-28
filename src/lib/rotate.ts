/**
 * rotate.ts —— R21 改主密码的【双缓冲 + 整批覆盖 + 本地可回滚】编排（架构 §6.3）。
 *
 * 步骤（逐条对应 §6.3）：
 *   1. 用【旧】主密钥逐条解密全部记录，**有一条失败就整体中止**（绝不半途上传）；
 *   2. 生成新盐、新密钥，全量重加密得到“新代密文”，写进 staging 区（旧代密文原样留在 main 区）；
 *   3. **单个请求**提交 kbRotateMaster（新盐 + 新校验串 + 全部密文 + 恢复码重包裹，key_epoch+1 由服务端做）；
 *   4. 成功 → 把 staging 提升为 main；
 *   5. 失败 → 用 main 区保存的【上一代完整密文】整批覆盖回云端，回到一致状态；旧主密码仍可用。
 *
 * 本文件不直接依赖 IndexedDB / 网络：通过 `RotateDeps` 注入，便于单测与替换。
 * 主密钥只做参数传入，绝不落盘。
 */
import { PBKDF2_ITERATIONS, createKeyVerifier, decryptString, deriveMasterKey, encryptString, type MasterKey } from "./crypto";
import type { ApiResult } from "./api";
import type { CachedSecret } from "./db";
import { rewrapRecovery } from "./recovery";

/** kbRotateMaster 调用形（与 api.rotateMaster 入参一致，避免循环依赖只取结构）。 */
export interface RotateRemoteParams {
  kdfSalt: string;
  kdfSaltPrev: string;
  kdfVerifier: string;
  recoveryBlob?: string;
  items: Array<{ id: number; payload: string }>;
}

/** 编排依赖（生产由 db.ts + api.ts 提供；测试注入内存实现）。 */
export interface RotateDeps {
  /** 读 main 区全部密文行（旧代）。 */
  listMain(): Promise<CachedSecret[]>;
  /** 写 staging 区（新代密文）。 */
  writeStaging(rows: CachedSecret[]): Promise<void>;
  /** 清空 staging 区。 */
  clearStaging(): Promise<void>;
  /** 用给定行整体替换 main 区（提升 staging→main，或回滚）。 */
  replaceMain(rows: CachedSecret[]): Promise<void>;
  /** 提交整批重写（单请求）。 */
  rotateRemote(params: RotateRemoteParams): Promise<ApiResult<{ keyEpoch: number }>>;
}

export interface ChangeMasterInput {
  /** 旧主密钥（内存中派生的，用完由调用方丢弃）。 */
  oldMasterKey: MasterKey;
  /** 旧盐（写进 kdf_salt_prev，供回滚窗口与旧密码可用）。 */
  oldSaltB64: string;
  /** 旧 kdf_verifier（失败回滚时用来恢复旧主密码可用）。 */
  oldVerifier: string;
  /** 新主密码（只用于本机派生，不上传）。 */
  newPassword: string;
  /** 新盐（base64）。 */
  newSaltB64: string;
  iterations?: number;
  /** 若账号已设恢复码：再次输入的恢复码（用于把 recovery_blob 用新主密钥重包裹）。 */
  recoveryCode?: string;
  /** 当前 recovery_salt（重包裹时保持不变）。 */
  recoverySaltB64?: string;
}

export interface ChangeMasterResult {
  /** 服务端推进后的代数。 */
  keyEpoch: number;
  /** 新主密钥（调用方需更新内存中的它，并丢弃旧的）。 */
  newMasterKey: MasterKey;
  /** 若本次带恢复码，则为重包裹后的新 `KBRC1:` 密文。 */
  recoveryBlob?: string;
}

/** 改主密码过程中的错误（带机器可判定的 code）。 */
export class RotateError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "RotateError";
  }
}

/**
 * 执行改主密码（§6.3 全流程）。成功返回新主密钥与代数；失败抛 RotateError 并已尽力回滚。
 */
export async function changeMasterPassword(
  deps: RotateDeps,
  input: ChangeMasterInput
): Promise<ChangeMasterResult> {
  const iterations = input.iterations ?? PBKDF2_ITERATIONS;
  const main = await deps.listMain();

  // ① 逐条解密（用旧密钥）；有【任何一条】失败→整体中止，绝不开始上传
  const plains: Array<{ id: number; text: string }> = [];
  for (const row of main) {
    try {
      const text = await decryptString(input.oldMasterKey.key, row.payload);
      plains.push({ id: row.id, text });
    } catch {
      throw new RotateError(
        "DECRYPT_FAILED",
        `改主密码已整体中止：第 ${row.id} 条密文无法用旧主密码解开。请确认主密码正确后再试。`
      );
    }
  }

  // ② 新密钥 + 全量重加密 → staging 区（旧代仍留在 main 区）
  const newMasterKey = await deriveMasterKey(input.newPassword, input.newSaltB64, iterations);
  const staging: CachedSecret[] = [];
  const items: Array<{ id: number; payload: string }> = [];
  for (const p of plains) {
    const payload = await encryptString(newMasterKey.key, p.text);
    items.push({ id: p.id, payload });
    const src = main.find((r) => r.id === p.id);
    staging.push({
      id: p.id,
      ownerId: src?.ownerId ?? "",
      payload,
      keyEpoch: (src?.keyEpoch ?? 0) + 1,
      updatedAt: new Date().toISOString(),
      pending: false,
    });
  }
  await deps.writeStaging(staging);

  // ③ 校验串 + 可选的恢复码重包裹
  const kdfVerifier = await createKeyVerifier(newMasterKey);
  let recoveryBlob: string | undefined;
  if (input.recoveryCode && input.recoverySaltB64) {
    recoveryBlob = await rewrapRecovery(
      input.recoveryCode,
      input.recoverySaltB64,
      input.newSaltB64,
      newMasterKey,
      iterations
    );
  }

  // ④ 单个请求提交整批重写
  const res = await deps.rotateRemote({
    kdfSalt: input.newSaltB64,
    kdfSaltPrev: input.oldSaltB64,
    kdfVerifier,
    recoveryBlob,
    items,
  });

  if (!res.ok || !res.data) {
    // ⑤ 失败：用 main 区（旧代）整批覆盖回云端，回到一致状态；旧主密码仍可用
    try {
      await deps.rotateRemote({
        kdfSalt: input.oldSaltB64,
        kdfSaltPrev: input.oldSaltB64,
        kdfVerifier: input.oldVerifier,
        items: main.map((r) => ({ id: r.id, payload: r.payload })),
      });
    } catch {
      // 回滚请求本身也失败（如仍离线）：交由下次启动按 key_epoch 混杂检测再回滚，此处不掩盖原始错误
    }
    await deps.clearStaging();
    throw new RotateError("ROTATE_FAILED", "改主密码失败（已尝试回滚），主密码未变更，请稍后重试。");
  }

  // ⑥ 成功：staging 提升为 main
  await deps.replaceMain(staging);
  await deps.clearStaging();
  return { keyEpoch: res.data.keyEpoch, newMasterKey, recoveryBlob };
}
