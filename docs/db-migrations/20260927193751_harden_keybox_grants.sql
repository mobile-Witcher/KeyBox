-- KeyBox 授权加固迁移（migrationVersion=20260927193751，migrationName=harden_keybox_grants）
-- 背景（实测发现）：平台对 public schema 设置了 DEFAULT PRIVILEGES，任何新表在 CREATE 时会被
--   自动授予 anon=SELECT、authenticated=ALL（含 TRUNCATE / REFERENCES / TRIGGER / MAINTAIN），
--   这会【覆盖】初始迁移里的列级 GRANT —— 例如 authenticated 对 kb_users 拿到表级 SELECT，
--   于是自己那一行的 login_hash / kdf_salt / kdf_verifier 也能读到，违背架构 5.1「列级授权挡住 login_hash」。
-- 本迁移显式收回这些默认授权，再按架构文档 5.1 / 5.2 / 5.3 精确授予。
-- 幂等：REVOKE/GRANT 可重复执行，结果一致。

-- 1) kb_users：客户端只能读 6 个非敏感列、只能改 status
REVOKE ALL ON public.kb_users FROM anon;
REVOKE ALL ON public.kb_users FROM authenticated;
GRANT SELECT (uid, username, role, status, key_epoch, created_at) ON public.kb_users TO authenticated;
GRANT UPDATE (status) ON public.kb_users TO authenticated;
GRANT ALL ON public.kb_users TO service_role;
-- 2) kb_invites：客户端零授权（仅服务端 service_role 可读写）；连自增序列也收回
REVOKE ALL ON public.kb_invites FROM anon;
REVOKE ALL ON public.kb_invites FROM authenticated;
REVOKE ALL ON SEQUENCE public.kb_invites_id_seq FROM anon;
REVOKE ALL ON SEQUENCE public.kb_invites_id_seq FROM authenticated;
GRANT ALL ON public.kb_invites TO service_role;
-- 3) kb_secrets：客户端表级只给 CRUD 四权（能不能碰到哪几行由 RLS 决定）
REVOKE ALL ON public.kb_secrets FROM anon;
REVOKE ALL ON public.kb_secrets FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_secrets TO authenticated;
GRANT ALL ON public.kb_secrets TO service_role;
-- 4) kb_secrets 自增序列：客户端 INSERT 需要 USAGE/SELECT；收回 anon
REVOKE ALL ON SEQUENCE public.kb_secrets_id_seq FROM anon;
GRANT USAGE, SELECT ON SEQUENCE public.kb_secrets_id_seq TO authenticated;
