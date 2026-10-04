-- KeyBox 收紧执行权限迁移（migrationVersion=20260927195508，migrationName=tighten_function_execute）
-- 目标环境：CloudBase PostgreSQL（envId 属受保护信息，只放 .env.local，不进仓库）
-- 下发方式：managePgDatabase(action="applyMigration")；文件名与 migrationVersion 必须一致。
--
-- 背景（架构 §5.0.1 待办）：PostgreSQL 建函数时默认把 EXECUTE 授予 PUBLIC（proacl 里显示为 "=X/..."），
--   平台又显式加授了 anon。于是【未登录身份】也能“调用” is_admin() 与 kb_admin_user_list()。
--   实际危害【低】：真正的防线是函数体内自检（kb_admin_user_list 体内 WHERE public.is_admin()；
--   anon 调用时 auth.uid() 为空 → 返回 false / 0 行），与官方“PostgREST 不强制校验 GRANT EXECUTE、
--   不能把‘谁能调用’当防线”的提示一致。但仍是【多余敞口】——将来若有人误改函数体、去掉体内自检，
--   这个敞口就会变成真漏洞。故收回，只留 authenticated 与 service_role（纵深防御）。
--
-- 幂等：REVOKE / GRANT 可重复执行，结果一致。

-- 1) 收回 anon 与 PUBLIC 的 EXECUTE
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_admin_user_list() FROM anon;
REVOKE EXECUTE ON FUNCTION public.kb_admin_user_list() FROM PUBLIC;

-- 2) 只保留 authenticated（登录态，策略表达式与 RPC 调用需要）与 service_role（云函数服务端）
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;
GRANT EXECUTE ON FUNCTION public.kb_admin_user_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.kb_admin_user_list() TO service_role;
