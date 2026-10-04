-- KeyBox R28 恢复码迁移（migrationVersion=20260928034647，migrationName=recovery_code_columns）
-- 目标环境：CloudBase PostgreSQL（envId 属受保护信息，只放 .env.local，不进仓库）
-- 下发方式：managePgDatabase(action="applyMigration")；文件名与 migrationVersion 必须一致。
--
-- 背景（R28）：注册/初始化时生成一次性恢复码，用其【独立】派生的恢复密钥 RK 把【主密钥】包裹成
--   recovery_blob（`KBRC1:` 密文，架构 §6 R28 原语）。这样主密码遗忘时，凭恢复码可解回主密钥，
--   从而解密全部密文。恢复码本身【不落库】，库里只存包裹后的密文；恢复码明文也绝不出现在任何列。
--
-- 四列（列名经 team-lead 裁决：确认列为 recovery_ack_at，不用 recovery_used_at）：
--   recovery_salt       text         恢复密钥派生盐（base64，16B 随机；必须独立于 kdf_salt，绝不复用）
--   recovery_blob       text         `KBRC1:` + base64( IV ‖ AES-GCM(RK, MK) )，不含恢复码/主密钥明文
--   recovery_created_at timestamptz  写入恢复材料的时间（NULL＝该账号尚无恢复码）
--   recovery_ack_at     timestamptz  用户勾选“我已抄下并自行保管”的时间；为 NULL ⇒ 前端持续提醒
--
-- 可空性：四列【全部可空（NULL）】。理由：
--   ① 存量行（本迁移前建立的账号）没有恢复材料，若 NOT NULL 会直接使迁移在 ALTER 时报错而失败；
--   ② recovery_ack_at 的语义就是“尚未确认＝NULL”，必须可空（持久提醒据此判定，无需额外布尔列）；
--   ③ 恢复码是“可后补”的增强项，不阻断开户主流程，故 recovery_* 允许先空、后由用户补设。
--
-- ⚠️ 授权（R28 关键）：新增列【绝不】授予客户端。
--   kb_users 对 authenticated 只有【列级】SELECT（6 个非敏感列），对 anon 零授权；
--   PG 的列级授权【不会】因 ADD COLUMN 自动扩展到新列，故新列天然零授权——但这里仍显式重申
--   REVOKE/GRANT（与 harden_keybox_grants 同口径），把“只放开 6 列”写成自洽、可复核的封闭集，
--   防止任何平台默认权限（DEFAULT PRIVILEGES）意外把 recovery_* 带出去。
--   客户端永远读不到 recovery_salt / recovery_blob；其读写一律经云函数（service_role）。
--
-- 幂等：ADD COLUMN IF NOT EXISTS + REVOKE/GRANT 均可重复执行，结果一致。

-- 1) 加四列（全部可空；使用 IF NOT EXISTS 保证幂等）
ALTER TABLE public.kb_users
  ADD COLUMN IF NOT EXISTS recovery_salt       text,
  ADD COLUMN IF NOT EXISTS recovery_blob       text,
  ADD COLUMN IF NOT EXISTS recovery_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_ack_at     timestamptz;
-- 2) 重申 kb_users 的客户端列级授权（自洽封闭集；recovery_* 不在其中 ⇒ 对 anon / authenticated 零授权）
REVOKE ALL ON public.kb_users FROM anon;
REVOKE ALL ON public.kb_users FROM authenticated;
GRANT SELECT (uid, username, role, status, key_epoch, created_at) ON public.kb_users TO authenticated;
GRANT UPDATE (status) ON public.kb_users TO authenticated;
-- 服务端（云函数持 service_role）需读写敏感列（含 recovery_*）：R01/R04/R05/R11/R21/R28 的前提
GRANT ALL ON public.kb_users TO service_role;
