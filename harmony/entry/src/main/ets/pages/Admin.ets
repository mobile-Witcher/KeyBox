/**
 * Admin.ets —— 管理员后台（R02 邀请码 / R12 用户列表 / R13 停用启用 / R14 删除数据）。
 *
 * 照 Web 端 src/pages/AdminPage.tsx 行为对齐：
 *   - 邀请码区：生成（展示一次供复制）/ 复制（30 秒剪贴板护栏同用户端）/ 作废（二次确认）
 *     + 已开户数 / 上限 20 与满员提示条。
 *   - 用户列表区：用户名 / uid / 状态 / 注册时间 / 条目数 + 停用启用 + 删除数据（二次确认）。
 *     自己那一行不渲染停用/删除按钮（防呆不是权限：服务端 is_admin()/CANNOT_DELETE_SELF 兜底）。
 *   - 界面纪律：不得出现任何「查看密钥」入口；底栏明示管理员看不到任何人的密钥内容。
 *   - 数据来源：列表走直连 RPC kb_admin_user_list、停用走直连 RDB PATCH（lib/admin.ts 同构，
 *     封装在 kbapi.ets）；删除走云函数 kbAdminDeleteUserData（唯一 service_role 路径）。
 *
 * 权限：仅 Vault 页 role=admin 时显示入口；非管理员调用会被服务端 is_admin() 拒绝，错误原样展示。
 * 主题：颜色一律走 --kb-* 语义令牌（c()），9 皮肤 × 深浅自动生效。
 */
import { router } from '@kit.ArkUI';
import { pasteboard } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import {
  adminListUsers, adminSetUserStatus, adminDeleteUserDataRemote,
  inviteCreateRemote, inviteRevokeRemote, KbAdminUserRow
} from '../lib/kbapi';
import { clearMasterKeyRaw, clearTokens } from '../lib/session';
import { colorsOf, SkinId, ThemeColors, resolveDark } from '../lib/theme';

const TAG: string = 'KeyBoxAdmin';

/** R02：20 人开户上限（与云端 lib.js 的 USER_LIMIT 对应）。 */
const USER_LIMIT: number = 20;

/** 用户列表渲染项。 */
class AdminUserItem {
  uid: string = '';
  username: string = '';
  status: string = '';
  createdAt: string = '';
  itemCount: number = 0;
}

/** 把 ISO 时间格式化为本地可读短串；解析失败原样返回。 */
function fmtTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) {
    return iso === '' ? '—' : iso;
  }
  return new Date(t).toLocaleString();
}

@Entry
@Component
struct Admin {
  @StorageProp('skin') skin: string = 'default';
  @StorageProp('darkMode') darkMode: string = 'system';
  @StorageProp('systemDark') systemDark: boolean = false;
  @State users: AdminUserItem[] = [];
  @State loading: boolean = true;
  @State busy: boolean = false;
  @State status: string = '';
  @State statusColor: string = '#64748b';
  @State inviteCode: string = '';
  @State confirmMode: string = ''; // '' | 'revoke' | 'disable' | 'delete'
  @State confirmUser: AdminUserItem | null = null;
  @State copyCountdown: number = 0;
  private copyTimerId: number = -1;

  c(): ThemeColors {
    return colorsOf(this.skin as SkinId, resolveDark(this.darkMode, this.systemDark));
  }

  aboutToAppear(): void {
    void this.reload();
  }

  aboutToDisappear(): void {
    if (this.copyTimerId >= 0) {
      clearInterval(this.copyTimerId);
      this.copyTimerId = -1;
    }
  }

  async reload(): Promise<void> {
    const accessToken = AppStorage.get<string>('accessToken') ?? '';
    this.busy = true;
    try {
      const rows = await adminListUsers(accessToken);
      const items: AdminUserItem[] = [];
      for (const r of rows) {
        const it = new AdminUserItem();
        it.uid = r.uid;
        it.username = r.username;
        it.status = r.status;
        it.createdAt = r.createdAt;
        it.itemCount = r.itemCount;
        items.push(it);
      }
      this.users = items;
    } catch (e) {
      // 非 admin 访问会被服务端 is_admin() 拒绝，错误原样展示
      this.status = '加载用户列表失败：' + (e as Error).message;
      this.statusColor = this.c().danger;
      hilog.error(0x0000, TAG, 'adminListUsers failed: %{public}s', (e as Error).message);
    } finally {
      this.busy = false;
      this.loading = false;
    }
  }

  myUid(): string {
    return AppStorage.get<string>('uid') ?? '';
  }

  isFull(): boolean {
    return this.users.length >= USER_LIMIT;
  }

  // ── R02：邀请码 ──

  async createInvite(): Promise<void> {
    const accessToken = AppStorage.get<string>('accessToken') ?? '';
    this.busy = true;
    this.status = '';
    try {
      const inv = await inviteCreateRemote(accessToken);
      this.inviteCode = inv.code;
      this.status = '已生成一次性邀请码，复制后发给新同事（用一次即失效）。';
      this.statusColor = this.c().success;
    } catch (e) {
      this.status = '生成邀请码失败：' + (e as Error).message;
      this.statusColor = this.c().danger;
    } finally {
      this.busy = false;
    }
  }

  /** 复制邀请码（30 秒自动清空剪贴板，与用户端 R25 护栏同语义）。 */
  copyInvite(): void {
    if (this.inviteCode === '') {
      return;
    }
    if (this.copyTimerId >= 0) {
      clearInterval(this.copyTimerId);
      this.copyTimerId = -1;
    }
    const data = pasteboard.createData('text/plain', this.inviteCode);
    pasteboard.getSystemPasteboard().setData(data);
    this.copyCountdown = 30;
    this.status = '已复制邀请码，30 秒后自动清空剪贴板';
    this.statusColor = this.c().success;
    let left = 30;
    this.copyTimerId = setInterval(() => {
      left -= 1;
      if (left > 0) {
        this.copyCountdown = left;
        this.status = '已复制邀请码，' + left + ' 秒后自动清空剪贴板';
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

  async revokeInvite(): Promise<void> {
    if (this.inviteCode === '') {
      return;
    }
    const accessToken = AppStorage.get<string>('accessToken') ?? '';
    this.busy = true;
    this.confirmMode = '';
    this.status = '';
    try {
      await inviteRevokeRemote(this.inviteCode, accessToken);
      this.inviteCode = '';
      this.status = '邀请码已作废。';
      this.statusColor = this.c().success;
    } catch (e) {
      this.status = '作废邀请码失败：' + (e as Error).message;
      this.statusColor = this.c().danger;
    } finally {
      this.busy = false;
    }
  }

  // ── R13：停用 / 启用 ──

  async toggleStatus(row: AdminUserItem): Promise<void> {
    const next = row.status === 'active' ? 'disabled' : 'active';
    const verb = next === 'disabled' ? '停用' : '启用';
    const accessToken = AppStorage.get<string>('accessToken') ?? '';
    this.busy = true;
    this.confirmMode = '';
    this.status = '';
    try {
      await adminSetUserStatus(row.uid, next, accessToken);
      this.status = `已${verb}用户「${row.username}」。`;
      this.statusColor = this.c().success;
      await this.reload();
    } catch (e) {
      this.status = '更新用户状态失败：' + (e as Error).message;
      this.statusColor = this.c().danger;
    } finally {
      this.busy = false;
    }
  }

  // ── R14：删除用户数据 ──

  async deleteData(row: AdminUserItem): Promise<void> {
    const accessToken = AppStorage.get<string>('accessToken') ?? '';
    this.busy = true;
    this.confirmMode = '';
    this.status = '';
    try {
      const deletedCount = await adminDeleteUserDataRemote(row.uid, accessToken);
      this.status = `已删除用户「${row.username}」的 ${deletedCount} 条记录，该用户已置为 deleted。`;
      this.statusColor = this.c().success;
      await this.reload();
    } catch (e) {
      this.status = '删除用户数据失败：' + (e as Error).message;
      this.statusColor = this.c().danger;
    } finally {
      this.busy = false;
    }
  }

  signOut(): void {
    AppStorage.setOrCreate('uid', '');
    AppStorage.setOrCreate('accessToken', '');
    clearMasterKeyRaw();
    void clearTokens();
    router.replaceUrl({ url: 'pages/Index' });
  }

  statusPillText(status: string): string {
    if (status === 'active') {
      return '正常';
    }
    if (status === 'deleted') {
      return '已删除';
    }
    return '已停用';
  }

  build() {
    Stack() {
      Column() {
        // ── 顶栏 ──
        Row({ space: 10 }) {
          Text('KeyBox · 管理后台')
            .fontSize(16)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.c().text)
          Blank()
          Text('返回密钥库')
            .fontSize(13)
            .fontColor(this.c().muted)
            .onClick(() => {
              router.back();
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

        if (this.status !== '') {
          Text(this.status)
            .fontSize(12)
            .fontColor(this.statusColor)
            .width('100%')
            .textAlign(TextAlign.Start)
            .padding({ left: 16, right: 16, bottom: 4 })
        }

        Scroll() {
          Column({ space: 14 }) {
            // ── 邀请码区（R02） ──
            Column({ space: 10 }) {
              Row() {
                Text('邀请码')
                  .fontSize(15)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.c().text)
                Blank()
                Text(`已开户 ${this.users.length} / 上限 ${USER_LIMIT}`)
                  .fontSize(12)
                  .fontColor(this.c().muted)
              }
              .width('100%')

              if (this.isFull()) {
                Text(`已达 ${USER_LIMIT} 人上限，无法再开户。如需腾出名额，请「删除数据」将某用户软删（status=deleted）。`)
                  .fontSize(12)
                  .fontColor(this.c().warning)
                  .width('100%')
              }

              if (this.inviteCode === '') {
                Button(this.isFull() ? '已满员' : '生成邀请码')
                  .height(38)
                  .fontSize(13)
                  .backgroundColor(this.c().primary)
                  .fontColor(this.c().primaryContrast)
                  .enabled(!this.busy && !this.isFull())
                  .onClick(() => {
                    void this.createInvite();
                  })
                Text('尚未生成邀请码。')
                  .fontSize(12)
                  .fontColor(this.c().muted)
              } else {
                Row({ space: 10 }) {
                  Text(this.inviteCode)
                    .fontSize(14)
                    .fontFamily('monospace')
                    .fontColor(this.c().text)
                    .backgroundColor(this.c().surface2)
                    .padding({ left: 10, right: 10, top: 6, bottom: 6 })
                    .borderRadius(8)
                    .layoutWeight(1)
                    .maxLines(1)
                  Text(this.copyCountdown > 0 ? '已复制' : '复制')
                    .fontSize(13)
                    .fontColor(this.c().primary)
                    .onClick(() => {
                      this.copyInvite();
                    })
                  Text('作废')
                    .fontSize(13)
                    .fontColor(this.c().danger)
                    .enabled(!this.busy)
                    .onClick(() => {
                      this.confirmMode = 'revoke'; // 二次确认
                    })
                }
                .width('100%')
              }
            }
            .alignItems(HorizontalAlign.Start)
            .width('100%')
            .padding(14)
            .backgroundColor(this.c().surface)
            .borderRadius(this.c().radiusCard)
            .border({ width: 0.5, color: this.c().border })

            // ── 用户列表区（R12/R13/R14） ──
            Column({ space: 10 }) {
              Row() {
                Text(`用户（${this.users.length}）`)
                  .fontSize(15)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.c().text)
                Blank()
                Text('刷新')
                  .fontSize(13)
                  .fontColor(this.c().primary)
                  .enabled(!this.busy)
                  .onClick(() => {
                    void this.reload();
                  })
              }
              .width('100%')

              if (this.loading) {
                Text('正在读取用户列表…').fontSize(12).fontColor(this.c().muted)
              } else if (this.users.length === 0) {
                Text('暂无用户。')
                  .fontSize(12)
                  .fontColor(this.c().muted)
                  .width('100%')
                  .textAlign(TextAlign.Center)
                  .padding(24)
              } else {
                ForEach(this.users, (row: AdminUserItem) => {
                  Column({ space: 6 }) {
                    Row({ space: 8 }) {
                      Text(row.username === '' ? '（未命名）' : row.username)
                        .fontSize(14)
                        .fontWeight(FontWeight.Medium)
                        .fontColor(this.c().text)
                        .layoutWeight(1)
                        .maxLines(1)
                      Text(this.statusPillText(row.status))
                        .fontSize(11)
                        .fontColor(row.status === 'active' ? this.c().success : this.c().muted)
                        .padding({ left: 8, right: 8, top: 2, bottom: 2 })
                        .borderRadius(10)
                        .backgroundColor(this.c().surface2)
                    }
                    .width('100%')

                    Text(row.uid)
                      .fontSize(11)
                      .fontFamily('monospace')
                      .fontColor(this.c().muted)
                      .width('100%')
                      .maxLines(1)

                    Row({ space: 12 }) {
                      Text('注册：' + fmtTime(row.createdAt))
                        .fontSize(11)
                        .fontColor(this.c().muted)
                        .layoutWeight(1)
                        .maxLines(1)
                      Text(`条目 ${row.itemCount}`)
                        .fontSize(11)
                        .fontColor(this.c().muted)
                    }
                    .width('100%')

                    // 自己那一行：不渲染停用/删除按钮（防呆不是权限，服务端另有自检兜底）
                    if (row.uid === this.myUid() && this.myUid() !== '') {
                      Text('（不能停用自己，请用另一个管理员操作）')
                        .fontSize(11)
                        .fontColor(this.c().muted)
                        .width('100%')
                      Text('（不能删除自己的数据，请联系另一位管理员）')
                        .fontSize(11)
                        .fontColor(this.c().muted)
                        .width('100%')
                    } else {
                      Row({ space: 10 }) {
                        Button(row.status === 'active' ? '停用' : '启用')
                          .layoutWeight(1)
                          .height(32)
                          .fontSize(12)
                          .backgroundColor(this.c().surface2)
                          .fontColor(this.c().text)
                          .enabled(!this.busy)
                          .onClick(() => {
                            this.confirmUser = row;
                            this.confirmMode = row.status === 'active' ? 'disable' : '';
                            if (this.confirmMode === '') {
                              // 启用无破坏性，直接执行（与 Web 端一致：仅停用需确认）
                              void this.toggleStatus(row);
                            }
                          })
                        Button('删除数据')
                          .layoutWeight(1)
                          .height(32)
                          .fontSize(12)
                          .backgroundColor(this.c().danger)
                          .fontColor(this.c().primaryContrast)
                          .enabled(!this.busy)
                          .onClick(() => {
                            this.confirmUser = row;
                            this.confirmMode = 'delete'; // 二次确认
                          })
                      }
                      .width('100%')
                    }
                  }
                  .alignItems(HorizontalAlign.Start)
                  .width('100%')
                  .padding(12)
                  .backgroundColor(this.c().surface)
                  .borderRadius(this.c().radiusCard)
                  .border({ width: 0.5, color: this.c().border })
                }, (row: AdminUserItem) => row.uid)
              }
            }
            .alignItems(HorizontalAlign.Start)
            .width('100%')

            // 底栏纪律（与 Web 端一致）
            Text('管理员看不到任何人的密钥内容，仅可停用与删除。')
              .fontSize(11)
              .fontColor(this.c().muted)
              .width('100%')
              .textAlign(TextAlign.Center)
              .padding({ top: 4, bottom: 12 })
          }
          .width('100%')
          .padding({ left: 16, right: 16, bottom: 24 })
        }
        .layoutWeight(1)
        .align(Alignment.Top)
        .scrollBar(BarState.Off)
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.c().bg)
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])

      // ── 作废邀请码二次确认 ──
      if (this.confirmMode === 'revoke') {
        this.ConfirmDialog('作废邀请码？', '作废后该码不能再用于注册。确认作废？', '作废', () => {
          void this.revokeInvite();
        })
      }

      // ── 停用用户二次确认 ──
      if (this.confirmMode === 'disable' && this.confirmUser !== null) {
        this.ConfirmDialog('确认停用？',
          `停用用户「${this.confirmUser.username}」？其已登录会话将在 ≤1 分钟内失效。`, '停用', () => {
          const row = this.confirmUser;
          if (row !== null) {
            void this.toggleStatus(row);
          }
        })
      }

      // ── 删除用户数据二次确认 ──
      if (this.confirmMode === 'delete' && this.confirmUser !== null) {
        this.ConfirmDialog('确认删除数据？',
          `确定删除用户「${this.confirmUser.username}」的全部密钥数据？\n` +
          `将删除其 ${this.confirmUser.itemCount} 条记录，并把该用户置为 deleted（无法再登录）。\n` +
          `此操作不可撤销。`, '删除', () => {
          const row = this.confirmUser;
          if (row !== null) {
            void this.deleteData(row);
          }
        })
      }
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  ConfirmDialog(title: string, body: string, actionLabel: string, action: () => void) {
    Column() {
      Column({ space: 12 }) {
        Text(title)
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.c().text)
        Text(body)
          .fontSize(12)
          .fontColor(this.c().text)
        Row({ space: 10 }) {
          Button('取消')
            .layoutWeight(1)
            .backgroundColor(this.c().surface2)
            .fontColor(this.c().text)
            .onClick(() => {
              this.confirmMode = '';
              this.confirmUser = null;
            })
          Button(actionLabel)
            .layoutWeight(1)
            .backgroundColor(this.c().danger)
            .fontColor(this.c().primaryContrast)
            .onClick(() => {
              action();
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
}
