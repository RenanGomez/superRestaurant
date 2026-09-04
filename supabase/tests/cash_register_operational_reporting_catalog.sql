-- Exact additive audit for the non-fiscal operational cash-register report.
do $audit$
declare
  app_api_oid oid;
  object_oid oid;
begin
  select oid into app_api_oid from pg_catalog.pg_roles where rolname = 'app_api';
  if app_api_oid is null then raise exception 'FINANCIAL_REPORT_REQUIRED_ROLE_MISSING'; end if;

  object_oid := pg_catalog.to_regprocedure(
    'app_private.read_cash_register_operational_report(uuid,uuid,uuid,uuid,uuid,uuid)'
  );
  if object_oid is null or not exists(
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_roles owner on owner.oid = p.proowner
    where p.oid = object_oid
      and p.prosecdef
      and p.provolatile = 's'
      and p.prorettype = 'jsonb'::pg_catalog.regtype
      and owner.rolname = 'postgres'
      and owner.rolbypassrls
      and coalesce(pg_catalog.array_to_string(p.proconfig, ','), '') in ('search_path=', 'search_path=""')
  ) then raise exception 'FINANCIAL_REPORT_FUNCTION_SECURITY_REJECTED'; end if;

  if not pg_catalog.has_function_privilege(app_api_oid, object_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', object_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', object_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', object_oid, 'EXECUTE')
    or exists(
      select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) acl
      where p.oid = object_oid and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )
  then raise exception 'FINANCIAL_REPORT_FUNCTION_GRANT_REJECTED'; end if;

  if not exists(
    select 1 from pg_catalog.pg_description d
    where d.objoid = object_oid
      and d.description like 'Authorized non-fiscal operational register summary%'
  ) then raise exception 'FINANCIAL_REPORT_NON_FISCAL_CONTRACT_MISSING'; end if;
end
$audit$;
