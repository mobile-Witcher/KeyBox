-- KeyBox R21 改主密码·整批重写（migrationVersion=20260928041000，migrationName=kb_rotate_master_fn）
-- 目标环境：CloudBase PostgreSQL（envId 属受保护信息，只放 .env.local，不进仓库）
-- 下发方式：managePgDatabase(action="applyMigration")；文件名与 migrationVersion 必须一致。
--
-- 背景（架构 §6.3 / §7）：改主密码要【一次性覆盖本人全部密文】并同时推进 kb_users.key_epoch。
--   PostgREST 无法在“单个请求”里逐行写入不同的 payload（PATCH 只能把同一值写给所有命中行；
--   而 kb_secrets.id 是 GENERATED ALWAYS 标识列，bulk upsert 也不能显式带 id）。
--   因此把“整批覆盖”下沉为一个数据库函数：函数体是一个事务，一条 UPDATE ... FROM
--   jsonb_to_recordset(...) 一次改完所有行，从而做到**单请求 + 原子 + 不逐条提交**。
--
-- ⚠️ 现状注记（待控制台配置后验证）：
--   1) 调用端点：云函数 kbRotateMaster 走 `POST {网关}/v1/rdb/rest/rpc/kb_rotate_master`
--      （PostgREST 的 /rpc/{函数名}；架构 §5 已注明“所有角色都能调 /rpc/{函数名}，PostgREST 不强制
--      校验 GRANT EXECUTE”）。该端点在本项目尚未实测，需部署后核验一次。
--   2) 角色护栏依赖 `request.jwt.claims.role`：PostgREST 标准键名。若网关的 claim 键名不同，
--      本函数会 **fail-closed**（service_role 路径被拒、报错），**绝不会**误放行→不构成安全漏洞，
--      只是 R21 暂不可用；核验到正确键名后改此处即可。
--
-- 安全护栏（PostgREST 不强制 GRANT EXECUTE，故函数体必须自检，不能把“谁能调”当防线）：
--   - service_role（云函数持 API Key）→ 放行；
--   - authenticated（携带用户 JWT）→ 只允许轮换【自己】的行（p_uid 必须等于 auth.uid()）；
--   - anon / 其它 → auth.uid() 为 NULL 且非 service_role → 拒绝。
--   - 归属校验：传入的每个 id 都必须属于 p_uid；且 id 集合与云端当前行【完全一致】
--     （漏一条＝残留旧代密文＝半新半旧；多一条＝越权；两者都 fail-closed）。
--
-- 幂等：CREATE OR REPLACE + REVOKE/GRANT，可重复执行，结果一致。

CREATE OR REPLACE FUNCTION public.kb_rotate_master(
  p_uid           text,
  p_kdf_salt      text,
  p_kdf_salt_prev text,
  p_kdf_verifier  text,
  p_recovery_blob text,
  p_items         jsonb
) RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_role    text := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
  v_epoch   integer;
  v_new     integer;
  v_owned   integer;
  v_given   integer;
  v_bad     integer;
BEGIN
  -- ① 身份护栏（fail-closed）
  IF v_role <> 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() <> p_uid THEN
      RAISE EXCEPTION 'ROTATE_FORBIDDEN';
    END IF;
  END IF;

  -- ② 取当前代数并加行锁（防并发同时改主密码）
  SELECT key_epoch INTO v_epoch FROM public.kb_users WHERE uid = p_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;
  v_new := coalesce(v_epoch, 0) + 1;

  -- ③ 归属 + 集合一致性校验（逐条校验 owner_id = p_uid）
  SELECT count(*) INTO v_given
    FROM jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) AS it(id bigint);
  SELECT count(*) INTO v_owned
    FROM public.kb_secrets WHERE owner_id = p_uid;
  SELECT count(*) INTO v_bad
    FROM jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) AS it(id bigint)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.kb_secrets s WHERE s.id = it.id AND s.owner_id = p_uid
   );
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ROTATE_FORBIDDEN';
  END IF;
  IF v_given <> v_owned THEN
    RAISE EXCEPTION 'ROTATE_SET_MISMATCH';
  END IF;

  -- ④ 整批覆盖密文（一条语句、同一事务；不逐条提交）
  UPDATE public.kb_secrets s
     SET payload    = it.payload,
         key_epoch  = v_new,
         updated_at = now()
    FROM jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) AS it(id bigint, payload text)
   WHERE s.id = it.id
     AND s.owner_id = p_uid;

  -- ⑤ 推进用户行：新盐 / 旧盐（回滚窗口）/ 新校验串 / key_epoch+1；
  --    若本次带了重包裹后的 recovery_blob，则一并更新（否则保留原值）。
  UPDATE public.kb_users
     SET kdf_salt       = p_kdf_salt,
         kdf_salt_prev  = p_kdf_salt_prev,
         kdf_verifier   = p_kdf_verifier,
         key_epoch      = v_new,
         recovery_blob  = CASE
                            WHEN p_recovery_blob IS NULL OR p_recovery_blob = ''
                              THEN recovery_blob
                            ELSE p_recovery_blob
                          END
   WHERE uid = p_uid;

  RETURN v_new;
END;
$$;
-- 授权：EXECUTE 只给 service_role（并收回默认给 PUBLIC 的 EXECUTE）。
-- 注意：PostgREST 不强制校验 GRANT EXECUTE，故函数体自检才是真正防线；此处仍按最小授权收口。
REVOKE EXECUTE ON FUNCTION public.kb_rotate_master(text, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_rotate_master(text, text, text, text, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.kb_rotate_master(text, text, text, text, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.kb_rotate_master(text, text, text, text, text, jsonb) TO service_role;
