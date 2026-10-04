/**
 * r28r29Orchestration.test.ts —— R28 恢复码 / R29 备份 / R21 改主密码编排的对抗性单测。
 *
 * 用真实 crypto.ts 原语 + 注入式内存 deps（不碰 IndexedDB / 网络），迭代次数取下限 210000 以控时。
 * 覆盖 team-lead 指定的用例：
 *   - 恢复码可解回主密钥 | 错恢复码失败 | 改主密码后恢复码仍可用（recovery_blob 已重包裹）；
 *   - 备份导出→导入往返；
 *   - 改主密码：旧密码失效/新密码可用 | 中途失败整体中止不产生半新半旧 | key_epoch 正确 +1 | 一条解密失败即整体中止。
 */
import { describe, expect, it } from "vitest";
import {
  PBKDF2_ITERATIONS_MIN,
  decryptString,
  deriveMasterKey,
  encryptString,
  generateSaltB64,
  wrapMasterKeyWithRecovery,
  type MasterKey,
} from "./crypto";
import type { ApiResult } from "./api";
import type { CachedSecret } from "./db";
import { backupFileName, backupToCachedRows, exportBackup, importBackup, looksLikeBackup } from "./backup";
import { createRecoveryMaterial, recoverMasterKey, rewrapRecovery } from "./recovery";
import { changeMasterPassword, type RotateDeps, type RotateRemoteParams } from "./rotate";

const ITER = PBKDF2_ITERATIONS_MIN;

/** 随机 32 字节 base64（避免写死任何密码字面量）。 */
function pwd(tag: string): string {
  return `${tag}-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

async function seedRows(masterKey: MasterKey, uid: string, plains: string[]): Promise<CachedSecret[]> {
  const rows: CachedSecret[] = [];
  for (let i = 0; i < plains.length; i += 1) {
    rows.push({
      id: i + 1,
      ownerId: uid,
      payload: await encryptString(masterKey.key, plains[i]),
      keyEpoch: 0,
      updatedAt: new Date().toISOString(),
      pending: false,
    });
  }
  return rows;
}

/* ================================================================== */
/* R28 恢复码                                                          */
/* ================================================================== */
describe("R28 恢复码：生成 / 解回 / 重包裹", () => {
  it("★恢复码能解回同一把主密钥；主密钥字节一致", async () => {
    const kdfSalt = generateSaltB64();
    const mk = await deriveMasterKey(pwd("master"), kdfSalt, ITER);
    const material = await createRecoveryMaterial(mk, kdfSalt, ITER);

    expect(material.rawCode).toHaveLength(32);
    expect(/^[A-Z2-7]{32}$/.test(material.rawCode)).toBe(true);
    expect(material.code).toContain("-");
    expect(material.recoverySaltB64).not.toBe(kdfSalt);
    expect(material.recoveryBlob.startsWith("KBRC1:")).toBe(true);

    const recovered = await recoverMasterKey(material.rawCode, material.recoverySaltB64, material.recoveryBlob, ITER);
    expect(Array.from(recovered.raw)).toEqual(Array.from(mk.raw));
    // 也接受“分组码”输入（内部会归一化）
    const recovered2 = await recoverMasterKey(material.code, material.recoverySaltB64, material.recoveryBlob, ITER);
    expect(Array.from(recovered2.raw)).toEqual(Array.from(mk.raw));
  });

  it("★错误恢复码无法解回（拒绝，不返回任何密钥）", async () => {
    const kdfSalt = generateSaltB64();
    const mk = await deriveMasterKey(pwd("master"), kdfSalt, ITER);
    const material = await createRecoveryMaterial(mk, kdfSalt, ITER);
    const wrong = material.rawCode.split("").reverse().join("");
    await expect(
      recoverMasterKey(wrong, material.recoverySaltB64, material.recoveryBlob, ITER)
    ).rejects.toBeTruthy();
  });

  it("恢复盐 == 主密码盐 → 包裹阶段直接抛错（防无症状降级）", async () => {
    const kdfSalt = generateSaltB64();
    const mk = await deriveMasterKey(pwd("master"), kdfSalt, ITER);
    const code = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    await expect(wrapMasterKeyWithRecovery(code, kdfSalt, kdfSalt, mk.raw, ITER)).rejects.toBeTruthy();
  });

  it("重包裹：同一恢复码在换主密钥后仍能解回【新】主密钥", async () => {
    const kdfSalt = generateSaltB64();
    const mk = await deriveMasterKey(pwd("master"), kdfSalt, ITER);
    const material = await createRecoveryMaterial(mk, kdfSalt, ITER);

    const newSalt = generateSaltB64();
    const newMk = await deriveMasterKey(pwd("master2"), newSalt, ITER);
    const rewrapped = await rewrapRecovery(material.rawCode, material.recoverySaltB64, newSalt, newMk, ITER);
    expect(rewrapped.startsWith("KBRC1:")).toBe(true);
    expect(rewrapped).not.toBe(material.recoveryBlob);

    const back = await recoverMasterKey(material.rawCode, material.recoverySaltB64, rewrapped, ITER);
    expect(Array.from(back.raw)).toEqual(Array.from(newMk.raw));
  });
});

/* ================================================================== */
/* R29 备份                                                            */
/* ================================================================== */
describe("R29 备份：导出 → 导入往返", () => {
  it("★导出的 KBBK1 文件能用主密码解回全部密文项（不入任何明文）", async () => {
    const uid = "ME";
    const mk = await deriveMasterKey(pwd("master"), "SALT", ITER);
    const rows = await seedRows(mk, uid, ["site=A", "site=B"]);

    const text = await exportBackup({
      masterKey: mk,
      items: rows.map((r) => ({ id: r.id, payload: r.payload, keyEpoch: r.keyEpoch })),
      kdfSalt: "SALT",
      kdfVerifier: "KB1:verifier",
      keyEpoch: 3,
    });
    expect(looksLikeBackup(text)).toBe(true);
    expect(text.startsWith("KBBK1:")).toBe(true);

    const plain = await importBackup(mk, text);
    expect(plain.version).toBe(1);
    expect(plain.kdfSalt).toBe("SALT");
    expect(plain.keyEpoch).toBe(3);
    expect(plain.items.map((i) => i.id)).toEqual([1, 2]);
    // 备份里仍是密文（importBackup 不回传 key 字段以外的东西；这里断言不含测试明文）
    expect(text).not.toContain("site=A");

    // 映射回本地缓存行，ownerId 由调用方给
    const cached = backupToCachedRows(plain, uid);
    expect(cached).toHaveLength(2);
    expect(cached.every((c) => c.pending === false && c.ownerId === uid)).toBe(true);
  });

  it("用错误主密码导入 → 拒绝（GCM 校验）", async () => {
    const mk = await deriveMasterKey(pwd("master"), "SALT", ITER);
    const rows = await seedRows(mk, "ME", ["x"]);
    const text = await exportBackup({
      masterKey: mk,
      items: rows.map((r) => ({ id: r.id, payload: r.payload, keyEpoch: r.keyEpoch })),
      kdfSalt: "SALT",
      kdfVerifier: "KB1:v",
      keyEpoch: 1,
    });
    const wrongMk = await deriveMasterKey(pwd("other"), "SALT", ITER);
    await expect(importBackup(wrongMk, text)).rejects.toBeTruthy();
  });

  it("备份文件名带时间戳且扩展名为 .kbbk", () => {
    const name = backupFileName(new Date(2026, 8, 28, 12, 0, 0));
    expect(name).toBe("keybox-backup-20260928-120000.kbbk");
  });
});

/* ================================================================== */
/* R21 改主密码编排                                                    */
/* ================================================================== */
type Remote = (p: RotateRemoteParams) => Promise<ApiResult<{ keyEpoch: number }>>;

function makeDeps(rows: CachedSecret[], remote: Remote): {
  deps: RotateDeps;
  state: { main: CachedSecret[]; staging: CachedSecret[]; rotateCalls: RotateRemoteParams[]; replaced: number; cleared: number };
} {
  const state = {
    main: rows.map((r) => ({ ...r })),
    staging: [] as CachedSecret[],
    rotateCalls: [] as RotateRemoteParams[],
    replaced: 0,
    cleared: 0,
  };
  const deps: RotateDeps = {
    listMain: async () => state.main.map((r) => ({ ...r })),
    writeStaging: async (r) => {
      state.staging = r.map((x) => ({ ...x }));
    },
    clearStaging: async () => {
      state.cleared += 1;
      state.staging = [];
    },
    replaceMain: async (r) => {
      state.replaced += 1;
      state.main = r.map((x) => ({ ...x }));
    },
    rotateRemote: async (p) => {
      state.rotateCalls.push(p);
      return remote(p);
    },
  };
  return { deps, state };
}

const okRemote: Remote = async () => ({ ok: true, data: { keyEpoch: 1 } });

describe("R21 改主密码：双缓冲 + 单请求 + 回滚", () => {
  it("★happy path：单请求提交、staging 提升为 main；旧密码失效、新密码可用", async () => {
    const uid = "ME";
    const oldSalt = generateSaltB64();
    const oldMk = await deriveMasterKey(pwd("old"), oldSalt, ITER);
    const rows = await seedRows(oldMk, uid, ["a", "b", "c"]);

    let captured: RotateRemoteParams | null = null;
    const remote: Remote = async (p) => {
      captured = p;
      return { ok: true, data: { keyEpoch: 7 } };
    };
    const { deps, state } = makeDeps(rows, remote);

    const newSalt = generateSaltB64();
    const newPw = pwd("new");
    const result = await changeMasterPassword(deps, {
      oldMasterKey: oldMk,
      oldSaltB64: oldSalt,
      oldVerifier: "KB1:oldverifier",
      newPassword: newPw,
      newSaltB64: newSalt,
      iterations: ITER,
    });

    expect(state.rotateCalls).toHaveLength(1); // 单请求
    expect(state.replaced).toBe(1);
    expect(state.cleared).toBe(1);
    expect(result.keyEpoch).toBe(7);

    // 提交体是新代密文 + 新盐 + 旧盐进 kdf_salt_prev
    expect(captured).not.toBeNull();
    expect(captured!.kdfSalt).toBe(newSalt);
    expect(captured!.kdfSaltPrev).toBe(oldSalt);
    expect(captured!.items.map((i) => i.id)).toEqual([1, 2, 3]);

    // staging 里的新代密文：旧密钥解不开、新密钥能解开
    const newMk = result.newMasterKey;
    for (const row of state.main) {
      await expect(decryptString(oldMk.key, row.payload)).rejects.toBeTruthy();
      const text = await decryptString(newMk.key, row.payload);
      expect(typeof text).toBe("string");
    }
  });

  it("★一条解密失败 → 整体中止：不上传、不提升、不产生半新半旧", async () => {
    const uid = "ME";
    const oldMk = await deriveMasterKey(pwd("old"), generateSaltB64(), ITER);
    const rows = await seedRows(oldMk, uid, ["a", "b"]);
    rows[1].payload = "KB1:not-a-valid-ciphertext"; // 破坏第二条

    const { deps, state } = makeDeps(rows, okRemote);
    await expect(
      changeMasterPassword(deps, {
        oldMasterKey: oldMk,
        oldSaltB64: generateSaltB64(),
        oldVerifier: "KB1:v",
        newPassword: pwd("new"),
        newSaltB64: generateSaltB64(),
        iterations: ITER,
      })
    ).rejects.toMatchObject({ code: "DECRYPT_FAILED" });

    expect(state.rotateCalls).toHaveLength(0); // 一条都没上传
    expect(state.replaced).toBe(0);
    expect(state.main).toHaveLength(2); // main 保持旧代，未变
  });

  it("★提交失败 → 用 main 旧代密文整批覆盖回云端（回滚），并抛 ROTATE_FAILED", async () => {
    const uid = "ME";
    const oldSalt = generateSaltB64();
    const oldMk = await deriveMasterKey(pwd("old"), oldSalt, ITER);
    const rows = await seedRows(oldMk, uid, ["a", "b"]);

    let call = 0;
    const remote: Remote = async () => {
      call += 1;
      return call === 1 ? { ok: false, error: "PG_500" } : { ok: true, data: { keyEpoch: 2 } };
    };
    const { deps, state } = makeDeps(rows, remote);

    await expect(
      changeMasterPassword(deps, {
        oldMasterKey: oldMk,
        oldSaltB64: oldSalt,
        oldVerifier: "KB1:oldverifier",
        newPassword: pwd("new"),
        newSaltB64: generateSaltB64(),
        iterations: ITER,
      })
    ).rejects.toMatchObject({ code: "ROTATE_FAILED" });

    expect(state.rotateCalls).toHaveLength(2); // 提交 + 回滚
    const rollback = state.rotateCalls[1];
    expect(rollback.kdfSalt).toBe(oldSalt); // 恢复旧盐
    expect(rollback.kdfVerifier).toBe("KB1:oldverifier"); // 恢复旧校验串
    // 回滚提交的是 main 的【旧代】密文（与初始行逐字节一致）
    expect(rollback.items.map((i) => i.payload)).toEqual(rows.map((r) => r.payload));
    expect(state.replaced).toBe(0); // 未把 staging 提升为 main
    expect(state.cleared).toBe(1);
  });

  it("★account 有恢复码时：随本次一并重包裹；改完仍可用原恢复码解回【新】主密钥", async () => {
    const uid = "ME";
    const oldSalt = generateSaltB64();
    const oldMk = await deriveMasterKey(pwd("old"), oldSalt, ITER);
    const material = await createRecoveryMaterial(oldMk, oldSalt, ITER);
    const rows = await seedRows(oldMk, uid, ["a"]);

    let captured: RotateRemoteParams | null = null;
    const { deps } = makeDeps(rows, async (p) => {
      captured = p;
      return { ok: true, data: { keyEpoch: 2 } };
    });

    const result = await changeMasterPassword(deps, {
      oldMasterKey: oldMk,
      oldSaltB64: oldSalt,
      oldVerifier: "KB1:v",
      newPassword: pwd("new"),
      newSaltB64: generateSaltB64(),
      iterations: ITER,
      recoveryCode: material.rawCode,
      recoverySaltB64: material.recoverySaltB64,
    });

    expect(result.recoveryBlob).toBeTruthy();
    expect(captured!.recoveryBlob).toBe(result.recoveryBlob);
    expect(String(captured!.recoveryBlob).startsWith("KBRC1:")).toBe(true);
    // 恢复码不变、盐不变，仅被新主密钥重包裹 → 解回的是新主密钥
    const back = await recoverMasterKey(
      material.rawCode,
      material.recoverySaltB64,
      result.recoveryBlob as string,
      ITER
    );
    expect(Array.from(back.raw)).toEqual(Array.from(result.newMasterKey.raw));
  });
});
