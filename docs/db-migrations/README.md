# 数据库迁移归档（CloudBase PG）

**权威位置**是项目根下的 `F:\project\keybox\cloudbase\migrations\`（CloudBase CLI 的 `tcb db pg migration` 读写处）。
本目录是**只读归档副本**，随 KeyBox 仓一起纳入版本控制，便于审计与追齐。

## 迁移历史（远端 `weichi-d4gfw5uo1334e0ffb`）

| 版本 | 名称 | 说明 |
|---|---|---|
| 20260927193625 | init_keybox | 建表 kb_users / kb_secrets / kb_invites + 初始 RLS |
| 20260927193751 | harden_keybox_grants | 收敛 grant |
| 20260927195508 | tighten_function_execute | 收紧函数 EXECUTE 权限 |
| 20260927201318 | drop_kb_secrets_delete_by_admin | 移除管理员删他人密钥的策略 |
| 20260928034647 | recovery_code_columns | 恢复码相关列 |
| 20260928041000 | kb_rotate_master_fn | 主密钥轮换函数 |
| 20261004133000 | kb_rls_active_user_and_cap | **2026-10-04 §6.4 缺口修复**：`is_active_user()` + kb_secrets 四条策略加 active 校验（R13）；`kb_enforce_user_cap()` + BEFORE INSERT 触发器（R05） |

> 最后一条当时因 MCP 项目根未配置而**无法走 applyMigration**，改用 `execute` 执行后以 `repairMigration` 补录进历史；
> 回滚脚本见 `../SQL-rollback-6.4-gaps.sql`，验证记录见 `../VERIFY-6.4-device-e2e-2026-10-04.md`。

## 常用命令

```powershell
# 从远端拉全量历史到本地（权威目录）
#   工具：CloudBase MCP managePgDatabase(action="fetchMigration")
# 查看已应用历史
#   工具：managePgDatabase(action="listMigrations")
# 新建迁移（推荐：后续统一走 applyMigration，会自动落文件并校验）
#   managePgDatabase(action="applyMigration", migrationName=..., migrationVersion=<14位>, sql=..., confirm=true)
```