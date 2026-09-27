-- KeyBox 初始迁移（migrationVersion=20260927193625，migrationName=init_keybox）
-- 目标环境：CloudBase PostgreSQL（envId 属受保护信息，只放 .env.local，不进仓库）
-- 下发方式：managePgDatabase(action="applyMigration")；文件名与 migrationVersion 必须一致。
-- 段落顺序有讲究：两个函数必须先于引用它们的 RLS 策略创建（策略表达式在建策略时即校验函数是否存在）。
-- 本文件包含：3 张业务表 DDL + 索引 + 表级 GRANT + 行级 RLS 策略（共 7 条）+ 2 个函数。

-- ============================================================
-- 1. 建表（三张；归属列一律 text，因 auth.uid() 返回 text 不是 uuid）
-- ============================================================
CREATE TABLE public.kb_users (
  uid            text PRIMARY KEY,
  username       text NOT NULL UNIQUE,
  login_hash     text NOT NULL,
  role           text NOT NULL DEFAULT 'user',
  status         text NOT NULL DEFAULT 'active',
  kdf_salt       text NOT NULL,
  kdf_salt_prev  text,
  kdf_verifier   text NOT NULL,
  key_epoch      integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.kb_secrets (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    text NOT NULL DEFAULT auth.uid(),
  payload     text NOT NULL,
  key_epoch   integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kb_secrets_owner_id_idx ON public.kb_secrets (owner_id);

CREATE TABLE public.kb_invites (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  status      text NOT NULL DEFAULT 'unused',
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  used_by     text,
  used_at     timestamptz
);

-- ============================================================
-- 2. 函数（必须先于策略创建）
-- ============================================================
-- 2.1 is_admin()：普通 INVOKER 函数，只读"调用者自己那一行"，
--     而 kb_users 的 SELECT 策略本就允许读自己，故无需绕过 RLS。R10/R13/R14 只用它。
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql
SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.kb_users u
    WHERE u.uid = auth.uid() AND u.role = 'admin' AND u.status = 'active'
  );
$$;

-- 2.2 kb_admin_user_list()：R12 跨用户列表 + 条目数。
--     这是全项目【唯一】的 SECURITY DEFINER 函数，因为它要读【他人】的行。
--     函数体内自检 is_admin()：非管理员返回 0 行（PostgREST 不强制校验 GRANT EXECUTE，不能把"谁能调"当防线）。
--     返回体不含任何密文列（无 payload / login_hash / kdf_*）。
CREATE OR REPLACE FUNCTION public.kb_admin_user_list()
RETURNS TABLE (uid text, username text, status text, created_at timestamptz, item_count bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT u.uid, u.username, u.status, u.created_at,
         COALESCE(c.cnt, 0)
  FROM public.kb_users u
  LEFT JOIN (SELECT owner_id, count(*) AS cnt FROM public.kb_secrets GROUP BY owner_id) c
    ON c.owner_id = u.uid
  WHERE public.is_admin()
    AND u.status <> 'deleted';
$$;

-- ============================================================
-- 3. kb_users：列级授权 + 2 条策略
-- ============================================================
ALTER TABLE public.kb_users ENABLE ROW LEVEL SECURITY;

-- 列级授权：login_hash / kdf_salt / kdf_salt_prev / kdf_verifier 永不授予客户端，管理员也看不到
GRANT SELECT (uid, username, role, status, key_epoch, created_at) ON public.kb_users TO authenticated;
-- 管理员只能改 status（停用/启用），改不了任何人的登录哈希
GRANT UPDATE (status) ON public.kb_users TO authenticated;
-- 服务端（云函数持 service_role）需要读写敏感列：R01/R04/R05/R11/R21 的前提
GRANT ALL ON public.kb_users TO service_role;

CREATE POLICY kb_users_select_self ON public.kb_users
  FOR SELECT TO authenticated
  USING ( uid = (select auth.uid()) );

-- R13：管理员改他人 status。用 INVOKER 版 is_admin()，不依赖 SECURITY DEFINER
CREATE POLICY kb_users_update_status_by_admin ON public.kb_users
  FOR UPDATE TO authenticated
  USING      ( (select public.is_admin()) )
  WITH CHECK ( (select public.is_admin()) );

-- ============================================================
-- 4. kb_secrets：表级授权 + 5 条策略（R08/R09/R10/R14 在此被表达）
-- ============================================================
ALTER TABLE public.kb_secrets ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_secrets TO authenticated;
GRANT ALL ON public.kb_secrets TO service_role;

-- R09：只能读自己的
CREATE POLICY kb_secrets_select_own ON public.kb_secrets
  FOR SELECT TO authenticated
  USING ( owner_id = (select auth.uid()) );

-- R08：INSERT 时 owner_id 必须等于自己；客户端伪造 owner_id 会被 WITH CHECK 拒绝
CREATE POLICY kb_secrets_insert_own ON public.kb_secrets
  FOR INSERT TO authenticated
  WITH CHECK ( owner_id = (select auth.uid()) );

CREATE POLICY kb_secrets_update_own ON public.kb_secrets
  FOR UPDATE TO authenticated
  USING      ( owner_id = (select auth.uid()) )
  WITH CHECK ( owner_id = (select auth.uid()) );

CREATE POLICY kb_secrets_delete_own ON public.kb_secrets
  FOR DELETE TO authenticated
  USING ( owner_id = (select auth.uid()) );

-- R10/R14：管理员可删他人。SELECT 策略里【没有】is_admin()，所以管理员仍读不到 payload。
-- PG 的 DELETE 有独立 FOR DELETE 策略，不要求先通过 SELECT 可见性。
CREATE POLICY kb_secrets_delete_by_admin ON public.kb_secrets
  FOR DELETE TO authenticated
  USING ( (select public.is_admin()) );

-- ============================================================
-- 5. kb_invites：不给客户端任何授权（0 条策略），仅服务端可读写
-- ============================================================
ALTER TABLE public.kb_invites ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.kb_invites TO service_role;
