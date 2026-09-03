-- Exact additive audit for the active KDS ticket projection.
do $audit$
declare
  app_api_oid oid;
  function_oid oid := pg_catalog.to_regprocedure(
    'app_private.list_kds_tickets(uuid,uuid,uuid,text)'
  );
begin
  select oid into app_api_oid from pg_catalog.pg_roles where rolname = 'app_api';
  if app_api_oid is null or function_oid is null
  then raise exception 'KDS_TICKET_REQUIRED_OBJECT_MISSING'; end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_roles owner on owner.oid = p.proowner
    where p.oid = function_oid
      and p.prosecdef
      and p.provolatile = 's'
      and p.prorettype = 'jsonb'::pg_catalog.regtype
      and owner.rolname = 'postgres'
      and owner.rolbypassrls
      and coalesce(pg_catalog.array_to_string(p.proconfig, ','), '')
        in ('search_path=', 'search_path=""')
  ) then raise exception 'KDS_TICKET_FUNCTION_SECURITY_REJECTED'; end if;

  if not pg_catalog.has_function_privilege(app_api_oid, function_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE')
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
  then raise exception 'KDS_TICKET_FUNCTION_GRANT_REJECTED'; end if;
end
$audit$;
