# Android A6 批施工图（管理后台 · 收官批）

> 状态：待派工（阻塞于 worker 模型 5h 配额，重置 2026-10-01 21:16 +0800）
> 仓库：mobile-Witcher/KeyBox-Android（Kotlin + Compose + M3）

## 契约来源（唯一权威）

| 来源 | 路径 | 用途 |
|---|---|---|
| 鸿蒙已验证实现 | `F:/KeyBox-harmony/entry/src/main/ets/pages/Admin.ets` | 直接移植的语义蓝本 |
| Web 契约 | `F:/KeyBox/src/lib/admin.ts` + `src\lib\api.ts` | 接口入参/返回结构 |
| Web 界面 | `F:/KeyBox/src/pages/AdminPage.tsx` | 交互与文案 |
| 云函数通道 | 本仓库 `app/.../data/KbApi.kt` 的 `invokeFunction` | A5 已封装，直接复用 |

## 四项任务

### 1. 用户列表
- `POST /v1/rdb/rest/rpc/kb_admin_user_list`（Bearer access_token）——直连 RPC，不套云函数
- 返回字段白名单：uid / username / status / created_at / item_count（无 role 列，无任何密文列）
- UI：卡片（用户名 + 状态胶囊 + uid 等宽小字 + 注册时间 + 条目数）+ 刷新按钮
- status 三态：active / disabled / deleted（deleted = 软删）

### 2. 邀请码（R02）
- 生成：`invokeFunction("kbInviteCreate")` → 码**展示一次**（等宽字体 + 背景块）+ 复制（**30s 自动清空剪贴板，R25 同语义**）
- 作废：`kbInviteRevoke`（二次确认）——**仅本次会话刚生成的码可作废**（kb_invites 对客户端零授权，与 Web 同限制）
- 顶部「已开户 N / 上限 20」计数；满员时琥珀提示条 + 禁用生成按钮（USER_LIMIT=20）

### 3. 用户停用 / 启用（R13）
- `PATCH /v1/rdb/rest/kb_users?uid=eq.{uid}`，**只提交 {status} 单列**（列级 GRANT(status) + 管理员 RLS 兜底）
- 停用需二次确认（文案含「会话将在 ≤1 分钟内失效」）；启用直接执行
- 自己那一行不渲染停用/删除按钮（防呆）

### 4. 删除用户数据（R14）
- `invokeFunction("kbAdminDeleteUserData")`（全项目唯一 service_role 路径）
- 二次确认含条目数 + 「不可撤销 / 置为 deleted」警示；完成提示删除条数
- 防呆同 3；`CANNOT_DELETE_SELF` 错误原样展示

## 权限判定与挂载
- `role === 'admin'` 才显示「管理」入口（复用 A5 已实现的 fetchMyRole）；非 admin / 拉取失败一律不显示
- 覆盖层承载（照 A5 SecurityPanelOverlay 模式）
- **界面纪律**：底栏常驻「管理员看不到任何人的密钥内容，仅可停用与删除」，全页无任何查看密钥入口

## 硬约束
1. `:core-crypto` 零改动（compare API 应验 0 变更）
2. R25 护栏 / R19 搜索 / R18 分类 / A4 同步 / A5 安全面板 全部保持
3. M3 主题，无新大依赖；构建标识行保留

## 验收标准（主理人独立复核）
- CI 全绿（gradle test + assembleDebug）
- compare API：core-crypto 0 变更
- 特征抽查：kb_admin_user_list / kbInviteCreate / kbInviteRevoke / kbAdminDeleteUserData / status 三态 / 满员 20 / 防呆自己不可删 / 管理员免责声明 / role 判定入口
- 汇报 commit hash + 文件清单 + 四项摘要
