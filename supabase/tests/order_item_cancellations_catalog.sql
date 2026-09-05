-- Exact additive audit for server-authorized OrderItem cancellation.
do $audit$
declare
  app_api_oid oid;
  helper_oid oid := pg_catalog.to_regprocedure(
    'app_private.actor_can_cancel_order_item(uuid,uuid,uuid,text)'
  );
  persistence_oid oid := pg_catalog.to_regprocedure(
    'app_private.persist_order_item_cancellation(uuid,bigint,jsonb,jsonb)'
  );
  function_oid oid;
begin
  select oid into app_api_oid from pg_catalog.pg_roles where rolname = 'app_api';
  if app_api_oid is null or helper_oid is null or persistence_oid is null
  then raise exception 'ORDER_ITEM_CANCELLATION_REQUIRED_OBJECT_MISSING'; end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_roles owner on owner.oid = p.proowner
    where p.oid = helper_oid
      and p.prosecdef
      and p.provolatile = 's'
      and p.prorettype = 'boolean'::pg_catalog.regtype
      and owner.rolname = 'postgres'
      and owner.rolbypassrls
      and coalesce(pg_catalog.array_to_string(p.proconfig, ','), '')
        in ('search_path=', 'search_path=""')
  ) or not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_roles owner on owner.oid = p.proowner
    where p.oid = persistence_oid
      and p.prosecdef
      and p.provolatile = 'v'
      and p.prorettype = 'jsonb'::pg_catalog.regtype
      and owner.rolname = 'postgres'
      and owner.rolbypassrls
      and coalesce(pg_catalog.array_to_string(p.proconfig, ','), '')
        in ('search_path=', 'search_path=""')
  ) then raise exception 'ORDER_ITEM_CANCELLATION_FUNCTION_SECURITY_REJECTED'; end if;

  foreach function_oid in array array[helper_oid, persistence_oid]::oid[] loop
    if pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', function_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', function_oid, 'EXECUTE')
      or exists (
        select 1
        from pg_catalog.pg_proc p
        cross join lateral pg_catalog.aclexplode(
          coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
        ) acl
        where p.oid = function_oid
          and acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    then raise exception 'ORDER_ITEM_CANCELLATION_PUBLIC_GRANT_REJECTED'; end if;
  end loop;

  if pg_catalog.has_function_privilege(app_api_oid, helper_oid, 'EXECUTE')
    or not pg_catalog.has_function_privilege(app_api_oid, persistence_oid, 'EXECUTE')
  then raise exception 'ORDER_ITEM_CANCELLATION_APP_API_GRANT_REJECTED'; end if;
end
$audit$;
