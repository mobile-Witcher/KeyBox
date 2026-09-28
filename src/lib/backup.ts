/**
 * backup.ts —— R29 加密备份导出 / 导入（纯本机，只调用 crypto.ts 原语）。
 *
 * 边界：
 *   - 导出：把全部密文 payload（已是 `KB1:` 密文）+ 盐 + 校验串打成一个 `KBBK1:` 文件，**只落本机**。
 *   - 导入：用主密码解开备份文件，写回本地存储；**全程不依赖云端在线**（R29 ③）。
 *   - 备份文件里也【没有任何明文/密钥】：`KBBK1:` 只是用主密钥把 JSON（内含密文）再包一层。
 */
import {
  BACKUP_PREFIX,
  buildBackup,
  openBackup,
  type BackupItem,
  type BackupPlain,
  type MasterKey,
} from "./crypto";
import type { CachedSecret } from "./db";

/** 导出输入：全部密文行 + 账号盐/校验串 + 代数。 */
export interface BackupExportInput {
  masterKey: MasterKey;
  items: BackupItem[];
  kdfSalt: string;
  kdfVerifier: string;
  keyEpoch: number;
  exportedAt?: string;
}

/** 生成 `KBBK1:` 备份串（不写盘）。 */
export async function exportBackup(input: BackupExportInput): Promise<string> {
  return buildBackup(input.masterKey, {
    items: input.items,
    kdfSalt: input.kdfSalt,
    kdfVerifier: input.kdfVerifier,
    keyEpoch: input.keyEpoch,
    exportedAt: input.exportedAt,
  });
}

/** 解开备份串（主密码不对 / 文件被改都会抛错）。 */
export async function importBackup(masterKey: MasterKey, backupText: string): Promise<BackupPlain> {
  return openBackup(masterKey, backupText);
}

/** 把备份内容映射成本地缓存行（写回 IndexedDB 用；pending=false，ownerId 由调用方给）。 */
export function backupToCachedRows(plain: BackupPlain, ownerId: string): CachedSecret[] {
  return plain.items.map((item) => ({
    id: item.id,
    ownerId,
    payload: item.payload,
    keyEpoch: item.keyEpoch,
    updatedAt: plain.exportedAt,
    pending: false,
  }));
}

/** 生成带时间戳的备份文件名（如 keybox-backup-20260928-120000.kbbk）。 */
export function backupFileName(when: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  const stamp =
    `${when.getFullYear()}${p(when.getMonth() + 1)}${p(when.getDate())}` +
    `-${p(when.getHours())}${p(when.getMinutes())}${p(when.getSeconds())}`;
  return `keybox-backup-${stamp}.kbbk`;
}

/** 触发浏览器下载（本机保存；不经过任何网络）。 */
export function downloadBackup(backupText: string, fileName: string): void {
  const blob = new Blob([backupText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** 校验一段文本是否像 KeyBox 备份（前缀判断，避免误读任意文件）。 */
export function looksLikeBackup(text: string): boolean {
  return text.trim().startsWith(BACKUP_PREFIX);
}
