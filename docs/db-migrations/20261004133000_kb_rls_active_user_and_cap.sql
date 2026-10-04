-- ============================================================================
-- §6.4 缺口修复（正向）· 2026-10-04 · 已在环境 weichi-d4gfw5uo1334e0ffb 执行并复核
-- 执行方式：CloudBase MCP managePgDatabase(action=execute, confirm=true, allowDdlViaExecute=true)
-- 说明：applyMigration 因宿主把 MCP 项目根设成 ~/.dsh/profiles/desktop 而被拒，
--       故改走 execute（工具 dryRun 亦建议此路径）；本文件为审计留档，等价于迁移文件。
-- 回滚：docs/SQL-rollback-6.4-gaps.sql
-- ============================================================================

-- 缺口 1（R13）：被停用用户不得再访问自己的密钥
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.kb_users u
    WHERE u.uid = auth.uid() AND u.status = 'active'
  );
$function$;

DROP POLICY IF EXISTS kb_secrets_select_own ON public.kb_secrets;
CREATE POLICY kb_secrets_select_own ON public.kb_secrets FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND public.is_active_user());

DROP POLICY IF EXISTS kb_secrets_insert_own ON public.kb_secrets;
CREATE POLICY kb_secrets_insert_own ON public.kb_secrets FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND public.is_active_user());

DROP POLICY IF EXISTS kb_secrets_update_own ON public.kb_secrets;
CREATE POLICY kb_secrets_update_own ON public.kb_secrets FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() AND public.is_active_user())
  WITH CHECK (owner_id = auth.uid() AND public.is_active_user());

DROP POLICY IF EXISTS kb_secrets_delete_own ON public.kb_secrets;
CREATE POLICY kb_secrets_delete_own ON public.kb_secrets FOR DELETE TO authenticated
  USING (owner_id = auth.uid() AND public.is_active_user());

-- 缺口 2（R05）：20 人上限加数据库兜底（删除态不计入）
CREATE OR REPLACE FUNCTION public.kb_enforce_user_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF (SELECT count(*) FROM public.kb_users WHERE status <> 'deleted') >= 20 THEN
    RAISE EXCEPTION 'KB_USER_LIMIT_REACHED';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS kb_users_cap_before_insert ON public.kb_users;
CREATE TRIGGER kb_users_cap_before_insert
BEFORE INSERT ON public.kb_users
FOR EACH ROW EXECUTE FUNCTION public.kb_enforce_user_cap();