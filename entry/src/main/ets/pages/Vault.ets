/**
 * Vault.ets —— 密钥列表页（Phase 2：主题系统 + 一多断点版）。
 *
 * 响应式：媒体查询 600vp 分界——窄屏单列卡片；折叠屏展开/平板双列 Grid。
 * 主题：@StorageProp 驱动（skin/dark/wide 三键），colorsOf() 给出全套语义色；
 *       外观选择弹层可切 9 皮肤 × 明暗，全局即时生效。
 * 流程：RDB REST 拉本人密文（KB1）→ 本地解密渲染 → 增删改查（本机加密后上传）。
 * R19 搜索：纯本机内存过滤（site/url/website/model/note/tags 小写包含），关键词不出设备。
 * R18 分类：collectTags 收集 → 下拉选择器过滤 → 选中后可重命名/删除（批量重加密上传）。
 * 同步：拉取服务端 → 与本机按 updated_at 比对 → 双向补齐；冲突弹选择（保留本机/用服务端）。
 */
import { router } from '@kit.ArkUI';
import { mediaquery } from '@kit.ArkUI';
import { pasteboard } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import {
  fetchSecretRows, insertSecretRow, updateSecretRow, deleteSecretRow, KbSecretRow
} from '../lib/kbapi';
import { kb1Decrypt, kb1Encrypt } from '../lib/kbcrypto';
import { getMasterKeyRaw, clearMasterKeyRaw, clearTokens } from '../lib/session';
import { colorsOf, SKINS, ThemeColors, SkinId, SkinDef, resolveDark } from '../lib/theme';
import { savePrefs } from '../lib/prefs';

const TAG: string = 'KeyBoxVault';

/** 一条密钥的明文字段（与 Web 端 SecretPlain 对齐；旧数据缺字段补空串）。 */
interface SecretPlain {
  site: string;
  url: string;
  website: string;
  model: string;
  key: string;
  note: string;
}

/** 密文 payload 的 JSON 结构（tags 缺失时序列化整个省略键，与旧数据互通）。 */
class SecretWire {
  site: string = '';
  url: string = '';
  website: string = '';
  model: string = '';
  key: string = '';
  note: string = '';
  tags: string[] | undefined = undefined;
}

/** 把明文 + tags 序列化成 payload JSON；tags 为空时整个省略 tags 键。 */
function serializePlain(p: SecretPlain, tags: string[]): string {
  const w = new SecretWire();
  w.site = p.site;
  w.url = p.url;
  w.website = p.website;
  w.model = p.model;
  w.key = p.key;
  w.note = p.note;
  w.tags = tags.length > 0 ? tags : undefined;
  return JSON.stringify(w);
}

/** 解析 payload JSON → SecretPlain（容错：缺字段补空串）。 */
function toPlain(w: SecretWire): SecretPlain {
  return {
    site: typeof w.site === 'string' ? w.site : '',
    url: typeof w.url === 'string' ? w.url : '',
    website: typeof w.website === 'string' ? w.website : '',
    model: typeof w.model === 'string' ? w.model : '',
    key: typeof w.key === 'string' ? w.key : '',
    note: typeof w.note === 'string' ? w.note : ''
  };
}

/** 解析 payload JSON → tags（容错：缺失/非数组补空数组）。 */
function toTags(w: SecretWire): string[] {
  if (!Array.isArray(w.tags)) {
    return [];
  }
  const out: string[] = [];
  for (const t of w.tags) {
    if (typeof t === 'string' && t !== '' && out.indexOf(t) < 0) {
      out.push(t);
    }
  }
  return out;
}

/** 列表渲染项。 */
class VaultItem {
  id: number = 0;
  site: string = '';
  url: string = '';
  website: string = '';
  model: string = '';
  key: string = '';
  note: string = '';
  tags: string[] = [];
  updatedAt: string = '';
  decryptError: boolean = false;
  decryptErrMsg: string = '';
}

/** 分类统计项（与 Web 端 TagCount 对齐）。 */
interface TagCount {
  name: string;
  count: number;
}

/** 一处同步冲突（两边都有但 updated_at 不同）。 */
interface SyncConflictInfo {
  id: number;
  site: string;
  localUpdatedAt: string;
  remoteUpdatedAt: string;
  remotePayload: string;
  remoteKeyEpoch: number;
}

/** ISO 时间转本地可读短串；解析失败原样返回。 */
function fmtTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) {
    return iso;
  }
  return new Date(t).toLocaleString();
}

@Entry
@Component
struct Vault {
  @StorageProp('skin') skin: string = 'default';
  @StorageProp('darkMode') darkMode: string = 'system';
  @StorageProp('systemDark') systemDark: boolean = false;
  @StorageProp('wide') isWide: boolean = false;
  @State items: VaultItem[] = [];
  @State loading: boolean = true;
  @State status: string = '';
  @State statusColor: string = '#64748b';
  @State dialogMode: string = '';
  @State editId: number = 0;
  @State fSite: string = '';
  @State fUrl: string = '';
  @State fWebsite: string = '';
  @State fModel: string = '';
  @State fKey: string = '';
  @State fNote: string = '';
  @State fTags: string = '';
  @State revealedKeys: string = '|';
  @State showAppearance: boolean = false;
  @State copyCountdown: number = 0;
  // R19：搜索关键词（纯本机，不出设备）
  @State searchKw: string = '';
  // R18：分类过滤与选择器
  @State activeTag: string | null = null;
  @State showTagMenu: boolean = false;
  @State fTagName: string = '';
  // 同步
  @State syncing: boolean = false;
  @State pendingConflicts: SyncConflictInfo[] = [];
  private copyTimerId: number = -1;
  private mqWide: mediaquery.MediaQueryListener | null = null;

  /** 当前皮肤的颜色集（随 skin/dark 变化自动刷新 UI）。 */
  c(): ThemeColors {
    return colorsOf(this.skin as SkinId, resolveDark(this.darkMode, this.systemDark));
  }

  aboutToAppear(): void {
    // 断点：≥600vp 视为宽屏（折叠屏展开/平板），双列
    this.mqWide = mediaquery.matchMediaSync('(min-width: 600vp)');
    this.mqWide.on('change', (result: mediaquery.MediaQueryResult) => {
      AppStorage.setOrCreate('wide', result.matches as boolean);
    });
    AppStorage.setOrCreate('wide', this.mqWide.matches as boolean);
    void this.load();
  }

  /** 解密单行密文 → 渲染项（单条失败不阻断整表）。 */
  private async decryptRow(r: KbSecretRow, raw: Uint8Array, keyEpoch: number): Promise<VaultItem> {
    const it = new VaultItem();
    it.id = r.id;
    it.updatedAt = r.updated_at;
    if (r.key_epoch !== keyEpoch) {
      it.decryptError = true;
      it.decryptErrMsg = `密文代数 ${r.key_epoch} 与当前 ${keyEpoch} 不一致`;
    } else {
      try {
        const w = JSON.parse(await kb1Decrypt(raw, r.payload)) as SecretWire;
        const p = toPlain(w);
        it.site = p.site;
        it.url = p.url;
        it.website = p.website;
        it.model = p.model;
        it.key = p.key;
        it.note = p.note;
        it.tags = toTags(w);
      } catch (e) {
        it.decryptError = true;
        it.decryptErrMsg = (e as Error).message;
        hilog.error(0x0000, TAG, 'decrypt row %{public}d failed: %{public}s',
          r.id, (e as Error).message);
      }
    }
    return it;
  }

  async load(): Promise<void> {
    const uid = AppStorage.get<string>('uid') ?? '';
    const accessToken = AppStorage.get<string>('accessToken') ?? '';
    const raw = getMasterKeyRaw() ?? new Uint8Array(0);
    const keyEpoch = AppStorage.get<number>('keyEpoch') ?? 0;
    this.loading = true;
    try {
      const rows = await fetchSecretRows(uid, accessToken);
      const items: VaultItem[] = [];
      for (const r of rows) {
        items.push(await this.decryptRow(r, raw, keyEpoch));
      }
      this.items = items;
    } catch (e) {
      this.status = '加载失败：' + (e as Error).message;
      this.statusColor = this.c().danger;
    } finally {
      this.loading = false;
    }
  }

  // ── R19：搜索 + R18：分类过滤（纯本机内存，不发网络请求） ──

  /** 过滤后的可见列表：分类 + 关键词（site/url/website/model/note/tags 小写包含）。 */
  filteredItems(): VaultItem[] {
    const kw = this.searchKw.trim().toLowerCase();
    const out: VaultItem[] = [];
    for (const it of this.items) {
      if (it.decryptError) {
        // 解密失败的条目：仅在没有筛选条件时保留展示（与 Web 端 filterItems 行为一致）
        if (this.activeTag === null && kw === '') {
          out.push(it);
        }
        continue;
      }
      if (this.activeTag !== null && it.tags.indexOf(this.activeTag) < 0) {
        continue;
      }
      if (kw !== '') {
        const hay = (it.site + ' ' + it.url + ' ' + it.website + ' ' + it.model +
          ' ' + it.note + ' ' + it.tags.join(' ')).toLowerCase();
        if (hay.indexOf(kw) < 0) {
          continue;
        }
      }
      out.push(it);
    }
    return out;
  }

  /** 收集全部分类及条数（collectTags 模式，按名称排序）。 */
  tagCounts(): TagCount[] {
    const names: string[] = [];
    const counts: number[] = [];
    for (const it of this.items) {
      if (it.decryptError) {
        continue;
      }
      for (const t of it.tags) {
        const idx = names.indexOf(t);
        if (idx >= 0) {
          counts[idx] += 1;
        } else {
          names.push(t);
          counts.push(1);
        }
      }
    }
    const out: TagCount[] = [];
    for (let i = 0; i < names.length; i++) {
      out.push({ name: names[i], count: counts[i] });
    }
    out.sort((a: TagCount, b: TagCount): number => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    return out;
  }

  /** 某分类影响的条目数（删除前提示用）。 */
  countByTag(tag: string): number {
    let n = 0;
    for (const it of this.items) {
      if (!it.decryptError && it.tags.indexOf(tag) >= 0) {
        n += 1;
      }
    }
    return n;
  }

  /** 渲染项 → 明文（重加密/上传前用）。 */
  private itemToPlain(it: VaultItem): SecretPlain {
    return {
      site: it.site,
      url: it.url,
      website: it.website,
      model: it.model,
      key: it.key,
      note: it.note
    };
  }

  private indexOfId(id: number): number {
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].id === id) {
        return i;
      }
    }
    return -1;
  }

  // ── 同步 ──

  /**
   * 同步编排：拉取服务端列表 → 与本机按 updated_at 逐条比对：
   *   服务端有本机无 → 拉取解密入库；本机有服务端无 → 加密上传；
   *   两边都有但 updated_at 不同 → 记入冲突，弹选择（保留本机/用服务端）。
   */
  async runSync(): Promise<void> {
    if (this.syncing) {
      return;
    }
    const uid = AppStorage.get<string>('uid') ?? '';
    const accessToken = AppStorage.get<string>('accessToken') ?? '';
    const raw = getMasterKeyRaw() ?? new Uint8Array(0);
    const keyEpoch = AppStorage.get<number>('keyEpoch') ?? 0;
    this.syncing = true;
    try {
      const rows = await fetchSecretRows(uid, accessToken);
      const remoteIds: number[] = [];
      for (const r of rows) {
        remoteIds.push(r.id);
      }
      const localMap = new Map<number, VaultItem>();
      for (const it of this.items) {
        localMap.set(it.id, it);
      }
      const newItems: VaultItem[] = [];
      const conflicts: SyncConflictInfo[] = [];
      let pulled = 0;
      // 服务端 → 本机
      for (const r of rows) {
        const local = localMap.get(r.id);
        if (local === undefined) {
          newItems.push(await this.decryptRow(r, raw, keyEpoch));
          pulled += 1;
        } else if (!this.sameTimestamp(r.updated_at, local.updatedAt)) {
          conflicts.push({
            id: r.id,
            site: local.site,
            localUpdatedAt: local.updatedAt,
            remoteUpdatedAt: r.updated_at,
            remotePayload: r.payload,
            remoteKeyEpoch: r.key_epoch
          });
          newItems.push(local); // 冲突未决前先保留本机版本
        } else {
          newItems.push(local);
        }
      }
      // 本机 → 服务端（服务端已不存在的 id：重新插入）
      let pushed = 0;
      for (const it of this.items) {
        if (remoteIds.indexOf(it.id) < 0) {
          const payload = await kb1Encrypt(raw, serializePlain(this.itemToPlain(it), it.tags));
          await insertSecretRow(payload, keyEpoch, accessToken);
          pushed += 1;
          newItems.push(it); // 本地版本先保留，load() 后以服务端新 id 为准
        }
      }
      this.items = newItems;
      this.pendingConflicts = conflicts;
      let msg = '已同步';
      if (pulled + pushed > 0) {
        msg += ' · ' + (pulled + pushed) + ' 条更新';
      }
      if (conflicts.length > 0) {
        msg += ' · ' + conflicts.length + ' 处冲突待处理';
      }
      this.status = msg;
      this.statusColor = conflicts.length > 0 ? this.c().warning : this.c().success;
      await this.load();
      if (conflicts.length > 0) {
        this.dialogMode = 'conflict';
      }
    } catch (e) {
      // 网络失败：提示错误但不打断页面
      this.status = '同步失败：' + (e as Error).message;
      this.statusColor = this.c().danger;
    } finally {
      this.syncing = false;
    }
  }

  /** updated_at 是否视作相同（先比原文，再比时间戳，容格式差异）。 */
  private sameTimestamp(a: string, b: string): boolean {
    if (a === b) {
      return true;
    }
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    return !Number.isNaN(ta) && !Number.isNaN(tb) && ta === tb;
  }

  /** 冲突裁决：useRemote=true 用服务端覆盖本机；false 保留本机并加密上传。 */
  async resolveConflicts(useRemote: boolean): Promise<void> {
    const list = this.pendingConflicts;
    if (list.length === 0) {
      this.dialogMode = '';
      return;
    }
    const accessToken = AppStorage.get<string>('accessToken') ?? '';
    const raw = getMasterKeyRaw() ?? new Uint8Array(0);
    const keyEpoch = AppStorage.get<number>('keyEpoch') ?? 0;
    this.busyGuard(true);
    try {
      const newItems: VaultItem[] = this.items.slice();
      for (const cf of list) {
        const idx = this.indexOfId(cf.id);
        if (useRemote) {
          const row: KbSecretRow = {
            id: cf.id,
            payload: cf.remotePayload,
            key_epoch: cf.remoteKeyEpoch,
            updated_at: cf.remoteUpdatedAt
          };
          const it = await this.decryptRow(row, raw, keyEpoch);
          if (idx >= 0) {
            newItems[idx] = it;
          } else {
            newItems.push(it);
          }
        } else {
          if (idx >= 0) {
            const it = newItems[idx];
            const payload = await kb1Encrypt(raw, serializePlain(this.itemToPlain(it), it.tags));
            await updateSecretRow(cf.id, payload, keyEpoch, accessToken);
          }
        }
      }
      this.items = newItems;
      this.pendingConflicts = [];
      this.dialogMode = '';
      await this.load();
      this.status = '冲突已处理：' + (useRemote ? '已采用服务端版本' : '已保留本机版本');
      this.statusColor = this.c().success;
    } catch (e) {
      this.status = '冲突处理失败：' + (e as Error).message;
      this.statusColor = this.c().danger;
    } finally {
      this.busyGuard(false);
    }
  }

  // ── R18：分类重命名 / 删除（mapTagChange 模式：本机改 tags → 重加密 → 既有接口上传） ──

  /** 对选中分类执行重命名（next=新名）或删除（next=null）。不新增网络接口。 */
  async applyTagChange(oldName: string, next: string | null): Promise<void> {
    const accessToken = AppStorage.get<string>('accessToken') ?? '';
    const raw = getMasterKeyRaw() ?? new Uint8Array(0);
    const keyEpoch = AppStorage.get<number>('keyEpoch') ?? 0;
    const changed: VaultItem[] = [];
    for (const it of this.items) {
      if (!it.decryptError && it.tags.indexOf(oldName) >= 0) {
        changed.push(it);
      }
    }
    if (changed.length === 0) {
      this.activeTag = next;
      this.dialogMode = '';
      return;
    }
    this.busyGuard(true);
    try {
      for (const it of changed) {
        // mapTagChange：重命名去重；删除则从 tags 中移除该分类
        const newTags: string[] = [];
        for (const t of it.tags) {
          if (t === oldName) {
            if (next !== null && newTags.indexOf(next) < 0) {
              newTags.push(next);
            }
          } else if (newTags.indexOf(t) < 0) {
            newTags.push(t);
          }
        }
        const payload = await kb1Encrypt(raw, serializePlain(this.itemToPlain(it), newTags));
        await updateSecretRow(it.id, payload, keyEpoch, accessToken);
      }
      if (this.activeTag === oldName) {
        this.activeTag = next;
      }
      this.dialogMode = '';
      await this.load();
      const action = next === null ? '删除' : '重命名';
      this.status = `已${action}分类「${oldName}」${next === null ? '' : '→「' + next + '」'}，共更新 ${changed.length} 条密钥`;
      this.statusColor = this.c().success;
    } catch (e) {
      this.status = (next === null ? '删除' : '重命名') + '分类失败：' + (e as Error).message;
      this.statusColor = this.c().danger;
    } finally {
      this.busyGuard(false);
    }
  }

  isRevealed(id: number): boolean {
    return this.revealedKeys.indexOf('|' + id + '|') >= 0;
  }

  toggleReveal(id: number): void {
    if (this.isRevealed(id)) {
      this.revealedKeys = this.revealedKeys.split('|' + id + '|').join('|');
    } else {
      this.revealedKeys = this.revealedKeys + id + '|';
    }
  }

  copyText(text: string, tip: string): void {
    if (text === '') return;
    if (this.copyTimerId >= 0) {
      clearInterval(this.copyTimerId);
      this.copyTimerId = -1;
    }
    const systemPasteboard = pasteboard.getSystemPasteboard();
    const data = pasteboard.createData('text/plain', text);
    systemPasteboard.setData(data);
    this.copyCountdown = 30;
    this.status = '已复制：' + tip + '，30 秒后自动清空剪贴板';
    this.statusColor = this.c().success;
    let left = 30;
    this.copyTimerId = setInterval(() => {
      left -= 1;
      if (left > 0) {
        this.copyCountdown = left;
        this.status = '已复制：' + tip + '，' + left + ' 秒后自动清空剪贴板';
        return;
      }
      if (this.copyTimerId >= 0) {
        clearInterval(this.copyTimerId);
        this.copyTimerId = -1;
      }
      this.copyCountdown = 0;
      const empty = pasteboard.createData('text/plain', '');
      pasteboard.getSystemPasteboard().setData(empty);
      this.status = '剪贴板已自动清空';
    }, 1000);
  }

  openNew(): void {
    this.editId = 0;
    this.dialogMode = 'new';
    this.fSite = '';
    this.fUrl = '';
    this.fWebsite = '';
    this.fModel = '';
    this.fKey = '';
    this.fNote = '';
    this.fTags = '';
  }

  openEdit(it: VaultItem): void {
    this.editId = it.id;
    this.dialogMode = 'edit';
    this.fSite = it.site;
    this.fUrl = it.url;
    this.fWebsite = it.website;
    this.fModel = it.model;
    this.fKey = it.key;
    this.fNote = it.note;
    this.fTags = it.tags.join(',');
  }

  closeDialog(): void {
    this.dialogMode = '';
  }

  busyGuard(on: boolean): void {
    this.loading = on;
  }

  /** 解析分类输入框（逗号分隔）→ 去重去空。 */
  private parseTagsInput(): string[] {
    const out: string[] = [];
    const parts = this.fTags.split(',');
    for (const raw of parts) {
      const t = raw.trim();
      if (t !== '' && out.indexOf(t) < 0) {
        out.push(t);
      }
    }
    return out;
  }

  async saveDialog(): Promise<void> {
    if (this.fSite.trim() === '') {
      this.status = '站点名不能为空';
      this.statusColor = this.c().danger;
      return;
    }
    if (this.fKey === '') {
      this.status = '密钥不能为空';
      this.statusColor = this.c().danger;
      return;
    }
    const uid = AppStorage.get<string>('uid') ?? '';
    const accessToken = AppStorage.get<string>('accessToken') ?? '';
    const raw = getMasterKeyRaw() ?? new Uint8Array(0);
    const keyEpoch = AppStorage.get<number>('keyEpoch') ?? 0;
    // 编辑既有条目时保留其原有分类（本批未在对话框外提供逐条改分类入口）
    let tags: string[] = this.parseTagsInput();
    if (this.editId !== 0) {
      const idx = this.indexOfId(this.editId);
      if (idx >= 0 && this.fTags.trim() === '') {
        tags = this.items[idx].tags;
      }
    }
    const plain: SecretPlain = {
      site: this.fSite.trim(),
      url: this.fUrl.trim(),
      website: this.fWebsite.trim(),
      model: this.fModel.trim(),
      key: this.fKey,
      note: this.fNote.trim()
    };
    this.busyGuard(true);
    try {
      const payload = await kb1Encrypt(raw, serializePlain(plain, tags));
      if (this.editId === 0) {
        await insertSecretRow(payload, keyEpoch, accessToken);
      } else {
        await updateSecretRow(this.editId, payload, keyEpoch, accessToken);
      }
      this.closeDialog();
      await this.load();
      this.status = '已保存';
      this.statusColor = this.c().success;
    } catch (e) {
      this.status = '保存失败：' + (e as Error).message;
      this.statusColor = this.c().danger;
    } finally {
      this.busyGuard(false);
    }
  }

  async remove(it: VaultItem): Promise<void> {
    const accessToken = AppStorage.get<string>('accessToken') ?? '';
    this.busyGuard(true);
    try {
      await deleteSecretRow(it.id, accessToken);
      await this.load();
      this.status = '已删除：' + it.site;
      this.statusColor = this.c().success;
    } catch (e) {
      this.status = '删除失败：' + (e as Error).message;
      this.statusColor = this.c().danger;
    } finally {
      this.busyGuard(false);
    }
  }

  aboutToDisappear(): void {
    if (this.copyTimerId >= 0) {
      clearInterval(this.copyTimerId);
      this.copyTimerId = -1;
    }
  }

  signOut(): void {
    AppStorage.setOrCreate('uid', '');
    AppStorage.setOrCreate('accessToken', '');
    clearMasterKeyRaw();
    void clearTokens(); // 清持久化登录态
    router.replaceUrl({ url: 'pages/Index' });
  }

  build() {
    Stack() {
      Column() {
        // ── 顶栏 ──
        Row({ space: 10 }) {
          Text('KeyBox')
            .fontSize(18)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.c().text)
          Blank()
          Text('外观')
            .fontSize(13)
            .fontColor(this.c().muted)
            .onClick(() => {
              this.showAppearance = !this.showAppearance;
            })
          Text('退出登录')
            .fontSize(13)
            .fontColor(this.c().muted)
            .onClick(() => {
              this.signOut();
            })
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 10, bottom: 10 })

        // ── 搜索行（R19：纯本机过滤，关键词不出设备） ──
        Row({ space: 8 }) {
          TextInput({ placeholder: '搜索站点、接口地址、模型名…', text: this.searchKw })
            .height(36)
            .fontSize(13)
            .layoutWeight(1)
            .backgroundColor(this.c().surface2)
            .fontColor(this.c().text)
            .placeholderColor(this.c().muted)
            .onChange((v: string) => {
              this.searchKw = v;
            })
          if (this.searchKw !== '') {
            Text('清除')
              .fontSize(12)
              .fontColor(this.c().primary)
              .onClick(() => {
                this.searchKw = '';
              })
          }
        }
        .width('100%')
        .padding({ left: 16, right: 16, bottom: 8 })

        // ── 工具行 ──
        Row({ space: 8 }) {
          Text(this.filteredItems().length === this.items.length
            ? `我的密钥（${this.items.length}）`
            : `我的密钥（${this.filteredItems().length} / 共 ${this.items.length}）`)
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.c().text)
          Blank()
          Text(this.activeTag === null ? '分类：全部 ▾' : `分类：${this.activeTag} ▾`)
            .fontSize(13)
            .fontColor(this.activeTag === null ? this.c().muted : this.c().primary)
            .maxLines(1)
            .onClick(() => {
              this.showTagMenu = !this.showTagMenu;
            })
          Button(this.syncing ? '同步中…' : '同步')
            .height(34)
            .fontSize(13)
            .backgroundColor(this.c().surface2)
            .fontColor(this.c().text)
            .enabled(!this.syncing)
            .opacity(this.syncing ? 0.5 : 1)
            .onClick(() => {
              void this.runSync();
            })
          Button('+ 新增')
            .height(34)
            .fontSize(13)
            .backgroundColor(this.c().primary)
            .fontColor(this.c().primaryContrast)
            .onClick(() => {
              this.openNew();
            })
        }
        .width('100%')
        .padding({ left: 16, right: 16, bottom: 4 })

        // 构建标识行（与 Web 端一致，验收后移除）
        Text('build b20261001-02（验收后移除）')
          .fontSize(10)
          .fontColor(this.c().muted)
          .opacity(0.6)
          .width('100%')
          .textAlign(TextAlign.Start)
          .padding({ left: 16, right: 16, bottom: 6 })

        if (this.activeTag !== null) {
          Text(`标签：${this.activeTag}`)
            .fontSize(12)
            .fontColor(this.c().muted)
            .width('100%')
            .textAlign(TextAlign.Start)
            .padding({ left: 16, right: 16, bottom: 4 })
        }

        if (this.status !== '') {
          Text(this.status)
            .fontSize(12)
            .fontColor(this.statusColor)
            .padding({ left: 16, right: 16 })
        }

        // 冲突待处理提示条（参照 Web 端 ConflictNotice 形态）
        if (this.pendingConflicts.length > 0 && this.dialogMode !== 'conflict') {
          Row({ space: 10 }) {
            Text(`检测到 ${this.pendingConflicts.length} 处同步冲突`)
              .fontSize(12)
              .fontColor(this.c().warning)
              .layoutWeight(1)
            Text('处理')
              .fontSize(12)
              .fontColor(this.c().primary)
              .onClick(() => {
                this.dialogMode = 'conflict';
              })
          }
          .width('100%')
          .padding({ left: 16, right: 16, top: 4, bottom: 4 })
        }

        // ── 列表：窄屏单列 / 宽屏双列 ──
        if (this.loading && this.items.length === 0) {
          Column() {
            Text('加载中…').fontSize(13).fontColor(this.c().muted)
          }.width('100%').padding(40)
        } else if (this.items.length === 0) {
          Column() {
            Text('还没有密钥。点右上「+ 新增」开始。')
              .fontSize(13)
              .fontColor(this.c().muted)
          }.width('100%').padding(40)
        } else if (this.filteredItems().length === 0) {
          Column() {
            Text('没有匹配的密钥。试试调整搜索词或分类筛选。')
              .fontSize(13)
              .fontColor(this.c().muted)
          }.width('100%').padding(40)
        } else {
          Scroll() {
            Grid() {
              ForEach(this.filteredItems(), (it: VaultItem) => {
                GridItem() {
                  this.SecretCard(it)
                }
              }, (it: VaultItem) => it.id.toString())
            }
            .columnsTemplate(this.isWide ? '1fr 1fr' : '1fr')
            .columnsGap(12)
            .rowsGap(12)
            .width('100%')
            .padding({ left: 16, right: 16, bottom: 24 })
          }
          .layoutWeight(1)
          .align(Alignment.Top)
          .scrollBar(BarState.Off)
        }
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.c().bg)
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])

      // ── 分类选择下拉弹层（R18） ──
      if (this.showTagMenu) {
        Column() {
          Column({ space: 4 }) {
            Text('选择分类')
              .fontSize(13)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.c().muted)
              .padding({ bottom: 4 })
            // 「全部」
            Row({ space: 8 }) {
              Text('全部')
                .fontSize(14)
                .fontColor(this.activeTag === null ? this.c().primary : this.c().text)
                .layoutWeight(1)
              Text(this.items.length.toString())
                .fontSize(12)
                .fontColor(this.c().muted)
                .padding({ left: 8, right: 8, top: 1, bottom: 1 })
                .borderRadius(10)
                .backgroundColor(this.c().surface2)
            }
            .width('100%')
            .padding(8)
            .borderRadius(8)
            .backgroundColor(this.activeTag === null ? this.c().surface2 : Color.Transparent)
            .onClick(() => {
              this.activeTag = null;
              this.showTagMenu = false;
            })
            // 各分类 + 条数徽章
            ForEach(this.tagCounts(), (t: TagCount) => {
              Row({ space: 8 }) {
                Text(t.name)
                  .fontSize(14)
                  .fontColor(this.activeTag === t.name ? this.c().primary : this.c().text)
                  .layoutWeight(1)
                  .maxLines(1)
                Text(t.count.toString())
                  .fontSize(12)
                  .fontColor(this.c().muted)
                  .padding({ left: 8, right: 8, top: 1, bottom: 1 })
                  .borderRadius(10)
                  .backgroundColor(this.c().surface2)
              }
              .width('100%')
              .padding(8)
              .borderRadius(8)
              .backgroundColor(this.activeTag === t.name ? this.c().surface2 : Color.Transparent)
              .onClick(() => {
                this.activeTag = t.name;
                this.showTagMenu = false; // 选中即收起
              })
            }, (t: TagCount) => t.name)
            // 选中某分类后：重命名 / 删除（R18 分类管理）
            if (this.activeTag !== null) {
              Divider()
                .color(this.c().border)
                .margin({ top: 4, bottom: 4 })
              Row({ space: 10 }) {
                Button('重命名分类')
                  .layoutWeight(1)
                  .height(34)
                  .fontSize(12)
                  .backgroundColor(this.c().surface2)
                  .fontColor(this.c().text)
                  .onClick(() => {
                    this.fTagName = this.activeTag ?? '';
                    this.showTagMenu = false;
                    this.dialogMode = 'tagRename';
                  })
                Button('删除分类')
                  .layoutWeight(1)
                  .height(34)
                  .fontSize(12)
                  .backgroundColor(this.c().danger)
                  .fontColor(this.c().primaryContrast)
                  .onClick(() => {
                    this.showTagMenu = false;
                    this.dialogMode = 'tagDelete'; // 二次确认对话框
                  })
              }
              .width('100%')
            }
          }
          .alignItems(HorizontalAlign.Start)
          .width('80%')
          .padding(14)
          .backgroundColor(this.c().surface)
          .borderRadius(12)
          .border({ width: 0.5, color: this.c().border })
        }
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.35)')
        .justifyContent(FlexAlign.Start)
        .alignItems(HorizontalAlign.Center)
        .padding({ top: 96 })
        .onClick(() => {
          this.showTagMenu = false;
        })
      }

      // ── 外观选择弹层 ──
      if (this.showAppearance) {
        Column() {
          Column({ space: 10 }) {
            Text('皮肤')
              .fontSize(13)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.c().muted)
            Scroll() {
              Column({ space: 6 }) {
                ForEach(SKINS, (s: SkinDef) => {
                  Row({ space: 8 }) {
                    Text(s.label)
                      .fontSize(14)
                      .fontColor(this.skin === s.id ? this.c().primary : this.c().text)
                    Blank()
                    Text(this.skin === s.id ? '✓' : '')
                      .fontSize(13)
                      .fontColor(this.c().primary)
                  }
                  .width('100%')
                  .padding(8)
                  .borderRadius(8)
                  .backgroundColor(this.skin === s.id ? this.c().surface2 : Color.Transparent)
                  .onClick(() => {
                    AppStorage.setOrCreate('skin', s.id);
                    void savePrefs(s.id, this.darkMode);
                  })
                }, (s: SkinDef) => s.id)
              }
              .width('100%')
            }
            .height(180)

            Text('明暗（默认跟随系统）')
              .fontSize(13)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.c().muted)
              .margin({ top: 4 })
            Row({ space: 6 }) {
              Button('跟随系统')
                .layoutWeight(1)
                .height(38)
                .fontSize(12)
                .backgroundColor(this.darkMode === 'system' ? this.c().primary : this.c().surface2)
                .fontColor(this.darkMode === 'system' ? this.c().primaryContrast : this.c().text)
                .onClick(() => {
                  AppStorage.setOrCreate('darkMode', 'system');
                  void savePrefs(this.skin, 'system');
                })
              Button('浅色')
                .layoutWeight(1)
                .height(38)
                .fontSize(12)
                .backgroundColor(this.darkMode === 'light' ? this.c().primary : this.c().surface2)
                .fontColor(this.darkMode === 'light' ? this.c().primaryContrast : this.c().text)
                .onClick(() => {
                  AppStorage.setOrCreate('darkMode', 'light');
                  void savePrefs(this.skin, 'light');
                })
              Button('深色')
                .layoutWeight(1)
                .height(38)
                .fontSize(12)
                .backgroundColor(this.darkMode === 'dark' ? this.c().primary : this.c().surface2)
                .fontColor(this.darkMode === 'dark' ? this.c().primaryContrast : this.c().text)
                .onClick(() => {
                  AppStorage.setOrCreate('darkMode', 'dark');
                  void savePrefs(this.skin, 'dark');
                })
            }
            .width('100%')

            Button('完成')
              .width('100%')
              .height(38)
              .backgroundColor(this.c().primary)
              .fontColor(this.c().primaryContrast)
              .onClick(() => {
                this.showAppearance = false;
              })
          }
          .alignItems(HorizontalAlign.Start)
          .width('86%')
          .padding(16)
          .backgroundColor(this.c().surface)
          .borderRadius(16)
        }
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .justifyContent(FlexAlign.Center)
        .onClick(() => {
          this.showAppearance = false;
        })
      }

      // ── 编辑/新增对话框 ──
      if (this.dialogMode === 'new' || this.dialogMode === 'edit') {
        Column() {
          Scroll() {
            Column({ space: 10 }) {
              Text(this.dialogMode === 'new' ? '新增密钥' : '编辑密钥')
                .fontSize(16)
                .fontWeight(FontWeight.Medium)
                .fontColor(this.c().text)
              TextInput({ placeholder: '站点名（必填）', text: this.fSite })
                .height(42)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .onChange((v: string) => {
                  this.fSite = v;
                })
              TextInput({ placeholder: '接口地址（API URL）', text: this.fUrl })
                .height(42)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .onChange((v: string) => {
                  this.fUrl = v;
                })
              TextInput({ placeholder: '官网 / 控制台', text: this.fWebsite })
                .height(42)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .onChange((v: string) => {
                  this.fWebsite = v;
                })
              TextInput({ placeholder: '模型名（可多个）', text: this.fModel })
                .height(42)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .onChange((v: string) => {
                  this.fModel = v;
                })
              TextInput({ placeholder: '密钥（必填）', text: this.fKey })
                .height(42)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .onChange((v: string) => {
                  this.fKey = v;
                })
              TextInput({ placeholder: '备注（可选）', text: this.fNote })
                .height(42)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .onChange((v: string) => {
                  this.fNote = v;
                })
              TextInput({ placeholder: '分类（逗号分隔，可选）', text: this.fTags })
                .height(42)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .onChange((v: string) => {
                  this.fTags = v;
                })
              Row({ space: 10 }) {
                Button('取消')
                  .layoutWeight(1)
                  .backgroundColor(this.c().surface2)
                  .fontColor(this.c().text)
                  .onClick(() => {
                    this.closeDialog();
                  })
                Button('保存')
                  .layoutWeight(1)
                  .backgroundColor(this.c().primary)
                  .fontColor(this.c().primaryContrast)
                  .onClick(() => {
                    void this.saveDialog();
                  })
              }
              .width('100%')
              .margin({ top: 6 })
            }
            .alignItems(HorizontalAlign.Start)
            .width('100%')
            .padding(18)
          }
          .width('92%')
          .constraintSize({ maxHeight: '86%' })
          .backgroundColor(this.c().surface)
          .borderRadius(this.c().radiusCard)
        }
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .justifyContent(FlexAlign.Center)
        .align(Alignment.Center)
      }

      // ── 分类重命名对话框（R18） ──
      if (this.dialogMode === 'tagRename') {
        Column() {
          Column({ space: 12 }) {
            Text(`重命名分类「${this.activeTag ?? ''}」`)
              .fontSize(15)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.c().text)
            TextInput({ placeholder: '新分类名', text: this.fTagName })
              .height(42)
              .backgroundColor(this.c().surface2)
              .fontColor(this.c().text)
              .onChange((v: string) => {
                this.fTagName = v;
              })
            Text('将批量更新所有带该分类的密钥（重新加密后上传）。')
              .fontSize(11)
              .fontColor(this.c().muted)
            Row({ space: 10 }) {
              Button('取消')
                .layoutWeight(1)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .onClick(() => {
                  this.closeDialog();
                })
              Button('确认')
                .layoutWeight(1)
                .backgroundColor(this.c().primary)
                .fontColor(this.c().primaryContrast)
                .onClick(() => {
                  const next = this.fTagName.trim();
                  if (next === '') {
                    this.status = '分类名不能为空';
                    this.statusColor = this.c().danger;
                    return;
                  }
                  const oldName = this.activeTag ?? '';
                  if (next === oldName) {
                    this.closeDialog();
                    return;
                  }
                  void this.applyTagChange(oldName, next);
                })
            }
            .width('100%')
          }
          .alignItems(HorizontalAlign.Start)
          .width('86%')
          .padding(18)
          .backgroundColor(this.c().surface)
          .borderRadius(this.c().radiusCard)
        }
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .justifyContent(FlexAlign.Center)
        .align(Alignment.Center)
      }

      // ── 分类删除二次确认对话框（R18） ──
      if (this.dialogMode === 'tagDelete') {
        Column() {
          Column({ space: 12 }) {
            Text('删除分类')
              .fontSize(15)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.c().text)
            Text(`删除分类「${this.activeTag ?? ''}」会从 ${this.countByTag(this.activeTag ?? '')} 条密钥上移除该分类（密钥本身保留）。确认删除？`)
              .fontSize(13)
              .fontColor(this.c().text)
            Row({ space: 10 }) {
              Button('取消')
                .layoutWeight(1)
                .backgroundColor(this.c().surface2)
                .fontColor(this.c().text)
                .onClick(() => {
                  this.closeDialog();
                })
              Button('删除')
                .layoutWeight(1)
                .backgroundColor(this.c().danger)
                .fontColor(this.c().primaryContrast)
                .onClick(() => {
                  void this.applyTagChange(this.activeTag ?? '', null);
                })
            }
            .width('100%')
          }
          .alignItems(HorizontalAlign.Start)
          .width('86%')
          .padding(18)
          .backgroundColor(this.c().surface)
          .borderRadius(this.c().radiusCard)
        }
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .justifyContent(FlexAlign.Center)
        .align(Alignment.Center)
      }

      // ── 同步冲突选择对话框 ──
      if (this.dialogMode === 'conflict') {
        Column() {
          Column({ space: 12 }) {
            Text(`检测到 ${this.pendingConflicts.length} 处同步冲突`)
              .fontSize(15)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.c().text)
            Text('同一条密钥在本机与服务端都有更新（更新时间不一致）。请选择保留哪一侧：')
              .fontSize(12)
              .fontColor(this.c().muted)
            Scroll() {
              Column({ space: 6 }) {
                ForEach(this.pendingConflicts, (cf: SyncConflictInfo) => {
                  Column({ space: 2 }) {
                    Text(`#${cf.id} ${cf.site === '' ? '（未命名）' : cf.site}`)
                      .fontSize(13)
                      .fontColor(this.c().text)
                    Text(`本机 ${fmtTime(cf.localUpdatedAt)} · 服务端 ${fmtTime(cf.remoteUpdatedAt)}`)
                      .fontSize(11)
                      .fontColor(this.c().muted)
                  }
                  .alignItems(HorizontalAlign.Start)
                  .width('100%')
                  .padding(8)
                  .borderRadius(8)
                  .backgroundColor(this.c().surface2)
                }, (cf: SyncConflictInfo) => cf.id.toString())
              }
              .width('100%')
            }
            .constraintSize({ maxHeight: 180 })
            Row({ space: 10 }) {
              Button('保留本机')
                .layoutWeight(1)
                .height(38)
                .backgroundColor(this.c().primary)
                .fontColor(this.c().primaryContrast)
                .onClick(() => {
                  void this.resolveConflicts(false);
                })
              Button('用服务端')
                .layoutWeight(1)
                .height(38)
                .backgroundColor(this.c().primary)
                .fontColor(this.c().primaryContrast)
                .onClick(() => {
                  void this.resolveConflicts(true);
                })
            }
            .width('100%')
            Text('稍后处理')
              .fontSize(12)
              .fontColor(this.c().muted)
              .padding(6)
              .onClick(() => {
                this.closeDialog();
              })
          }
          .alignItems(HorizontalAlign.Start)
          .width('88%')
          .padding(18)
          .backgroundColor(this.c().surface)
          .borderRadius(this.c().radiusCard)
        }
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .justifyContent(FlexAlign.Center)
        .align(Alignment.Center)
      }
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  SecretCard(it: VaultItem) {
    Column({ space: 8 }) {
      Row() {
        Text(it.site === '' ? '（未命名）' : it.site)
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.c().text)
          .layoutWeight(1)
        Text('复制站点')
          .fontSize(12)
          .fontColor(this.c().primary)
          .onClick(() => {
            this.copyText(it.site, it.site);
          })
      }
      .width('100%')

      if (it.decryptError) {
        Text('解密失败：' + it.decryptErrMsg)
          .fontSize(11)
          .fontColor(this.c().danger)
          .width('100%')
      }

      if (it.tags.length > 0) {
        Row({ space: 6 }) {
          ForEach(it.tags, (t: string) => {
            Text(t)
              .fontSize(11)
              .fontColor(this.c().primary)
              .padding({ left: 8, right: 8, top: 2, bottom: 2 })
              .borderRadius(10)
              .backgroundColor(this.c().surface2)
          }, (t: string) => t)
        }
        .width('100%')
      }

      this.FieldRow('接口地址', it.url)
      this.FieldRow('官网', it.website)
      this.FieldRow('模型名', it.model)
      this.FieldRow('备注', it.note)

      Row({ space: 8 }) {
        Text('密钥')
          .fontSize(12)
          .fontColor(this.c().muted)
          .width(52)
        Text(this.isRevealed(it.id) ? it.key : '••••••••')
          .fontSize(12)
          .fontFamily('monospace')
          .fontColor(this.c().text)
          .layoutWeight(1)
          .maxLines(2)
        Text(this.isRevealed(it.id) ? '隐藏' : '显示')
          .fontSize(12)
          .fontColor(this.c().primary)
          .onClick(() => {
            this.toggleReveal(it.id);
          })
        Text('复制')
          .fontSize(12)
          .fontColor(this.isRevealed(it.id) ? this.c().primary : this.c().muted)
          .onClick(() => {
            if (this.isRevealed(it.id)) {
              this.copyText(it.key, it.site + ' 的密钥');
            }
          })
      }
      .width('100%')

      Row({ space: 10 }) {
        Button('编辑')
          .layoutWeight(1)
          .height(34)
          .fontSize(13)
          .backgroundColor(this.c().surface2)
          .fontColor(this.c().text)
          .onClick(() => {
            this.openEdit(it);
          })
        Button('删除')
          .layoutWeight(1)
          .height(34)
          .fontSize(13)
          .backgroundColor(this.c().danger)
          .fontColor(this.c().primaryContrast)
          .onClick(() => {
            void this.remove(it);
          })
      }
      .width('100%')
      .margin({ top: 4 })
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding(14)
    .backgroundColor(this.c().surface)
    .borderRadius(this.c().radiusCard)
    .border({ width: 0.5, color: this.c().border })
  }

  @Builder
  FieldRow(label: string, value: string) {
    if (value !== '') {
      Row({ space: 8 }) {
        Text(label)
          .fontSize(12)
          .fontColor(this.c().muted)
          .width(52)
        Text(value)
          .fontSize(12)
          .fontColor(this.c().text)
          .layoutWeight(1)
          .maxLines(1)
        Text('复制')
          .fontSize(12)
          .fontColor(this.c().primary)
          .onClick(() => {
            this.copyText(value, label);
          })
      }
      .width('100%')
    }
  }
}
