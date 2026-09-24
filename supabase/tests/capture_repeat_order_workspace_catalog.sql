-- Supplement to the exact Capture repeat-order audit. Never apply as a migration.
do $capture_repeat_order_workspace_catalog$
declare
  reader oid := pg_catalog.to_regprocedure('app_private.read_capture_workspace_v3(uuid,jsonb)');
  app_api_oid oid := (select oid from pg_catalog.pg_roles where rolname='app_api');
begin
  if reader is null or app_api_oid is null then
    raise exception using errcode='55000', message='CAPTURE_REPEAT_ORDER_WORKSPACE_REQUIRED_OBJECT_MISSING';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_roles owner on owner.oid=p.proowner
    where p.oid=reader and p.prosecdef and p.provolatile='v'
      and owner.rolname='postgres' and owner.rolbypassrls
      and coalesce(pg_catalog.array_to_string(p.proconfig,','),'') in ('search_path=','search_path=""')
  ) then
    raise exception using errcode='55000', message='CAPTURE_REPEAT_ORDER_WORKSPACE_FUNCTION_SHAPE_REJECTED';
  end if;
  if not pg_catalog.has_function_privilege(app_api_oid,reader,'EXECUTE')
    or pg_catalog.has_function_privilege('anon',reader,'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated',reader,'EXECUTE')
    or pg_catalog.has_function_privilege('service_role',reader,'EXECUTE')
  then
    raise exception using errcode='55000', message='CAPTURE_REPEAT_ORDER_WORKSPACE_GRANTS_REJECTED';
  end if;
end
$capture_repeat_order_workspace_catalog$;
