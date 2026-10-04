# §6.4 真机端到端验证报告（2026-10-04）

> 交接书 §6.4「12 项逐条打勾」的执行记录。
> 环境：CloudBase `weichi-d4gfw5uo1334e0ffb`（ap-shanghai，PG 模式）；Windows 直跑版 `cc029f2`+（W7/W8 后）。
> 结论口径：**通过 / 不通过 / 机制已验证（待运行时确认） / 需修复**。

## 0. 本轮已完成的部分（服务端只读取证，未做任何写操作）

工具：CloudBase MCP（`queryPgDatabase` / `queryEnv`），全部为只读 SQL。

| 证据 | 结果 |
|---|---|
| `public.kb_users` / `kb_secrets` / `kb_invites` | 三表存在，RLS **已启用**（`relrowsecurity=true`） |
| `kb_users` 列 | uid / username / **login_hash** / role(默认 user) / **status**(默认 active) / kdf_salt / kdf_salt_prev / kdf_verifier / key_epoch / created_at / recovery_* |
| `kb_invites` 列 | id / **code UNIQUE** / **status(默认 'unused')** / created_by / created_at / **used_by** / **used_at** |
| `is_admin()` | SQL STABLE，**SECURITY INVOKER**，判据 `kb_users.uid = auth.uid() AND role='admin' AND status='active'` |
| `kb_admin_user_list()` | **SECURITY DEFINER** + `SET search_path=public` + `WHERE public.is_admin()`；返回 `uid, username, status, created_at, item_count` |
| `kb_rotate_master(...)` | 存在（主密钥轮换用） |
| **kb_* 上的触发器** | **无**（`pg_trigger` 查询为空） |
| `kb_secrets` 策略 | select/insert/update/delete 四条，判据**仅** `owner_id = auth.uid()` |
| `kb_users` 策略 | `select_self`（uid = auth.uid()）、`update_status_by_admin`（`is_admin()`） |

## A 组 · 登录 / 注册 / 管理链路（8 条）

| 编号 | 验收动作 | 结论 | 依据 / 备注 |
|---|---|---|---|
| **R01** | 首个管理员账号初始化 | ⏳ **待运行时**（需所有者手输） | `role` 默认 `user`、`status` 默认 `active`；管理员初始化由客户端/云函数写入 `role='admin'` ⇒ 必须真机跑一遍 |
| **R03** | 邀请码自助注册 + **码一次性失效**（复用应被拒） | ⏳ **待运行时**（机制具备） | `kb_invites.code` UNIQUE + `status='unused'` + `used_by/used_at` 字段齐备；但**没有任何触发器** ⇒ "一次性"由应用层保证，**必须实测复用同一码是否被拒** |
| **R04** | 邀请码生成 / 作废行为 | ⏳ **待运行时** | `status` 字段可承载 unused/used/revoked；生成与作废在应用层 |
| **R05** | 用户上限 20 人（第 21 个被拒） | ⚠️ **机制未落库** | 无约束、无触发器 ⇒ **上限完全由应用层把关**，数据库不阻止第 21 条 `kb_users` 插入。建议：真机测到第 21 个被拒；并考虑把上限做成 DB 侧约束/触发器（否则直连 REST 可绕过） |
| **R12** | 管理员用户列表（uid/用户名/状态/注册时间/条目数） | ✅ **机制已验证**（UI 待目视） | `kb_admin_user_list()` 返回字段与要求**逐项一致**，且 `WHERE is_admin()` |
| **R13** | 管理员停用/启用生效；被停用者 **≤1 分钟会话失效** | ❌ **发现缺口，需修复** | 见下节「安全缺口 1」 |
| **R14** | 管理员删除用户数据（置 `deleted`，不可撤销） | ⏳ **待运行时** | `status` 可承载 `deleted`；`kb_admin_user_list()` 已 `AND u.status <> 'deleted'`（列表隐藏已删用户）✓ 逻辑自洽；但**无触发器/无级联**，删除是应用层置位 |
| **R22** | 任意非管理员访问管理接口被拒（越权） | ✅ **机制已验证**（越权实测待跑） | `kb_admin_user_list()` 是 SECURITY DEFINER 但内部 `WHERE is_admin()` ⇒ 非管理员得到空集；`kb_users` 的状态更新策略同样要求 `is_admin()`。**待补**：用非管理员账号真调一次管理接口，确认被拒（空集/403） |

## 安全缺口（本轮发现的实质问题）

### 缺口 1（R13）：被停用用户仍可读写自己的密钥 —— 需修复

- `kb_secrets` 的四条策略判据**只有** `owner_id = auth.uid()`，**没有**校验 `kb_users.status='active'`；
- `kb_*` 上**没有触发器**做联动；
- 因此：管理员把某用户 `status` 改成 `disabled` 后，**该用户手中的 JWT 到期前仍可正常 select/insert/update/delete 自己的 `kb_secrets`**（`is_admin()` 只影响管理员权限，普通用户不受影响）。
- "≤1 分钟会话失效"目前只能由**客户端自觉**（读到自己的 `kb_users.status != active` 就锁屏）。客户端可以被绕过（直连 PostgREST）。

**建议修法（择一，需所有者批准后执行；涉及 RLS 属交接书 §4 禁区，我不擅自改）**：

```sql
-- 方案 A：在 kb_secrets 四条策略的判据里追加 active 校验
CREATE POLICY kb_secrets_select_own ON public.kb_secrets FOR SELECT TO authenticated
USING (
  owner_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.kb_users u
              WHERE u.uid = auth.uid() AND u.status = 'active')
);
-- （insert/update/delete 同理；update 的 WITH CHECK 也要带）
```

```sql
-- 方案 B：把判据收敛进一个函数（避免四处重复）
CREATE FUNCTION public.is_active_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.kb_users u
                 WHERE u.uid = auth.uid() AND u.status = 'active');
$$;
-- 然后策略里 AND public.is_active_user()
```

### 缺口 2（R05）：20 人上限没有数据库兜底

- 无约束/触发器 ⇒ 只要有人直连 REST 就能插入第 21 个 `kb_users`。
- 建议：加 `BEFORE INSERT` 触发器（`count(*) >= 20 → RAISE EXCEPTION`），或把开户收敛到一个 SECURITY DEFINER 函数里。

## B 组 · 多端并发登录（已修，待复测）

- 云端 `MaxDevice` 已由 1 改为 5（交接书 §6.4 B）。
- 底层 `refresh_token` 轮换仍在：任一端续期会作废旧 token。
- **待办（需所有者 + 多设备 + 时间）**：四端同时登录 → **各自静置 30 分钟**后操作 → 是否都能续期不互相顶掉。若互相顶掉，需要讨论"每端独立会话"。

## C 组 · 安卓真机

- 前次反馈的两处布局问题已修（`2943f02`，并移除网格视图），**尚未真机验证**。
- 待确认：列表渲染 / 编辑对话框 / 分类吸顶 / 同步冲突提示 / **9 套皮肤切换后的对比度与可读性**。

## D 组 · 鸿蒙端管理后台

- `075899e` 交付（邀请码 / 用户列表 / 停用启用 / 删除数据），**尚未真机验证**（需 DevEco/真机）。

## E 组 · Windows 端集成回归

| 项 | 交接书贴的旧结论 | 本轮状态 |
|---|---|---|
| 全局快捷键 `Ctrl+Shift+K` | ✅ | 待回归（W7/W8 未触碰该服务） |
| 窗口位置/尺寸记忆 | ✅ | 待回归 |
| 关闭最小化到托盘 + 托盘图标 | ❌（§6.1） | ✅ 已在 W6-A 修复并真机自证（`Created=true`）；W8 改标题栏后**需再点一次关闭确认** |
| 密钥列表显示 | ❌（§6.2） | ✅ W6-B 修复并自证；W7-E 卡片重做后需目视确认 |

## 需要所有者操作的清单（按顺序，约 15 分钟）

1. **R01**：全新环境/清库后，用你的手机号完成首个管理员初始化 → 看是否成功、`kb_users.role` 是否变成 `admin`（我可只读复核）。
2. **R03**：生成一个邀请码 → 用第二个账号注册成功 → **再次用同一个码注册，确认被拒**。
3. **R04**：作废一个未使用的邀请码 → 确认无法再用。
4. **R12**：进「管理」页（W7-F 后是**独立页面**）→ 核对 5 个字段是否齐全正确。
5. **R13**：停用第二个账号 → 该账号在 ≤1 分钟内被踢出/无法操作；**同时我会用刚才的缺口 1 复现"直连仍可读写"**（需你同意我发一次测试请求）。
6. **R14**：删除第二个账号 → 列表消失、数据置 `deleted`；确认不可撤销。
7. **R22**：用**非管理员**账号调用一次管理接口 → 应被拒。
8. **E 组回归**：打开桌面直跑版 → 快捷键唤起 / 移动缩放后重开 / 关闭最小化到托盘 / 新卡片列表是否正常显示真实密钥。
9. **C/D 组**：装安卓 APK 与鸿蒙 hap（需 DevEco）各跑一遍上述核心流程 + 9 皮肤对比度。

## 本轮未做 / 不能做

- **未做任何写操作**（未改 RLS、未改数据）——缺口 1/2 的修法已给出，等你批准。
- **B/C/D 组**需设备与时间（30 分钟静置、安卓真机、DevEco）。
- Android/iOS 之外的鸿蒙构建需本机 DevEco（交接书 §6.3 已注明）。

---

## 修复记录（2026-10-04，所有者授权后执行）

> 所有者明确指示"你先修复"。执行前已 `dryRun` 校验（判定 `security_change`、未写库），并预留回滚脚本 `docs/SQL-rollback-6.4-gaps.sql`。

| 缺口 | 修复 | 复核证据（只读 SQL） |
|---|---|---|
| **R13** 被停用用户仍可读写自己密钥 | 新增 `public.is_active_user()`（SECURITY DEFINER，判据 `uid=auth.uid() AND status='active'`）；`kb_secrets` 四条策略判据改为 `(owner_id = auth.uid()) AND is_active_user()` | `pg_policies`：四条策略 using/with_check 均为 `((owner_id = auth.uid()) AND is_active_user())` ✅ |
| **R05** 20 人上限无数据库兜底 | 新增 `public.kb_enforce_user_cap()` + 触发器 `kb_users_cap_before_insert`（BEFORE INSERT，`count(*) WHERE status <> 'deleted' >= 20` 即 `RAISE EXCEPTION 'KB_USER_LIMIT_REACHED'`） | `pg_trigger`：触发器已存在且定义符合；`pg_proc`：函数存在（returns trigger）✅ |

**未改动的部分**（有意保留）：
- `kb_users.kb_users_select_self` 仍是 `uid = auth.uid()`（不加 status 校验）—— 让被停用用户仍能读到自己的状态，客户端可据此给出"账号已停用"的明确提示，而不是一律报错。
- `is_admin()` / `kb_admin_user_list()` 未动。

**行为变化与影响面**：
- 停用用户**立即**（不再需要等 ≤1 分钟、也不再依赖客户端自觉）无法通过 API 读写 `kb_secrets`；其 JWT 虽未过期，数据层已拒绝。
- 正常用户（`status='active'`）不受任何影响；`TO authenticated` 角色范围未变。
- 第 21 个 `kb_users` 插入会被数据库拒绝（应用层需捕获并提示"用户数已达上限"）。

**R13 / R05 结论更新**：由「❌ 需修复 / ⚠️ 机制未落库」→ **✅ 已在数据层修复（待真机复测确认体验）**。

**执行路径说明（重要）**：`managePgDatabase(action=applyMigration)` **被拒**，原因是宿主把 MCP 的项目根设为 `C:\Users\29396\.dsh\profiles\desktop`（宿主配置目录），工具拒绝在该目录下落迁移文件。故改走工具在 `dryRun` 中建议的 `execute`（`confirm=true` + `allowDdlViaExecute=true`）。
**遗留**：若后续还要用 `applyMigration` / `deployApply` 等项目级能力，需把 MCP 的 `WORKSPACE_FOLDER_PATHS` 指向 `F:\project\keybox`（本文件即等价迁移留档）。