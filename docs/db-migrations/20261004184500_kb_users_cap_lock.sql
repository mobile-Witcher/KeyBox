CREATE OR REPLACE FUNCTION public.kb_enforce_user_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- R05 竞态加固：同一瞬间的并发开户先取事务级 advisory lock 串行化。
  -- 原实现仅 COUNT(*)：19/20 时两笔并发注册可能都读到 19 而双双通过，导致超编。
  -- 锁在事务结束时自动释放；kbRegister 的插入各有独立事务，故能真正排队。
  PERFORM pg_advisory_xact_lock(hashtext('kb_users_cap'));
  IF (SELECT count(*) FROM public.kb_users WHERE status <> 'deleted') >= 20 THEN
    RAISE EXCEPTION 'KB_USER_LIMIT_REACHED';
  END IF;
  RETURN NEW;
END;
$function$;
