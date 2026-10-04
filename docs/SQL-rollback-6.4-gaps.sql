-- ============================================================================
-- 回滚脚本：撤销 §6.4 缺口修复（2026-10-04）
-- 用途：若迁移导致异常（例如客户端被误拦），执行本文件即可恢复改动前的行为。
-- 改动前状态（已核对，见 docs/VERIFY-6.4-device-e2e-2026-10-04.md）：
--   · kb_secrets 四条策略判据 = owner_id = auth.uid()  （无 status 校验）
--   · kb_* 上无任何触发器
--   · public 下无 is_active_user() / kb_enforce_user_cap()
-- ============================================================================

-- 1) 还原 kb_secrets 四条策略（去掉 active 校验）
DROP POLICY IF EXISTS kb_secrets_select_own ON public.kb_secrets;
CREATE POLICY kb_secrets_select_own ON public.kb_secrets FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid() AS uid));

DROP POLICY IF EXISTS kb_secrets_insert_own ON public.kb_secrets;
CREATE POLICY kb_secrets_insert_own ON public.kb_secrets FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid() AS uid));

DROP POLICY IF EXISTS kb_secrets_update_own ON public.kb_secrets;
CREATE POLICY kb_secrets_update_own ON public.kb_secrets FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid() AS uid))
  WITH CHECK (owner_id = (SELECT auth.uid() AS uid));

DROP POLICY IF EXISTS kb_secrets_delete_own ON public.kb_secrets;
CREATE POLICY kb_secrets_delete_own ON public.kb_secrets FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid() AS uid));

-- 2) 移除 20 人上限触发器与函数
DROP TRIGGER IF EXISTS kb_users_cap_before_insert ON public.kb_users;
DROP FUNCTION IF EXISTS public.kb_enforce_user_cap();

-- 3) 移除 active 判据函数
DROP FUNCTION IF EXISTS public.is_active_user();
