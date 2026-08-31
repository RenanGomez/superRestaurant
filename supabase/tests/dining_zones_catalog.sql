do $audit$
declare
  function_oid oid := pg_catalog.to_regprocedure(
    'app_private.create_dining_zone(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text)'
  );
  table_name text;
  grantee_name text;
  privilege_name text;
begin
  foreach table_name in array array['dining_zones', 'dining_zone_audit_events'] loop
    if pg_catalog.to_regclass('app.' || table_name) is null then
      raise exception 'DINING_ZONES_AUDIT_TABLE_MISSING';
    end if;
    if not exists (
      select 1
      from pg_catalog.pg_class as c
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'app'
        and c.relname = table_name
        and c.relrowsecurity
        and c.relforcerowsecurity
    ) then
      raise exception 'DINING_ZONES_AUDIT_RLS_REJECTED';
    end if;
  end loop;

  if function_oid is null or not exists (
    select 1
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_roles as owner on owner.oid = p.proowner
    where p.oid = function_oid
      and p.prosecdef
      and p.provolatile = 'v'
      and coalesce(pg_catalog.array_to_string(p.proconfig, ','), '') in ('search_path=', 'search_path=""')
      and owner.rolname = 'postgres'
      and owner.rolbypassrls
  ) then
    raise exception 'DINING_ZONES_AUDIT_FUNCTION_REJECTED';
  end if;

  if not pg_catalog.has_function_privilege('app_api', function_oid, 'EXECUTE') then
    raise exception 'DINING_ZONES_AUDIT_APP_API_EXECUTE_MISSING';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_proc as p
    cross join lateral pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) as acl
    where p.oid = function_oid
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'DINING_ZONES_AUDIT_PUBLIC_EXECUTE_REJECTED';
  end if;
  foreach grantee_name in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_function_privilege(grantee_name, function_oid, 'EXECUTE') then
      raise exception 'DINING_ZONES_AUDIT_CLIENT_EXECUTE_REJECTED';
    end if;
  end loop;

  foreach table_name in array array['app.dining_zones', 'app.dining_zone_audit_events'] loop
    if exists (
      select 1
      from pg_catalog.pg_class as c
      cross join lateral pg_catalog.aclexplode(
        coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
      ) as acl
      where c.oid = pg_catalog.to_regclass(table_name)
        and acl.grantee = 0
    ) then
      raise exception 'DINING_ZONES_AUDIT_PUBLIC_TABLE_GRANT_REJECTED';
    end if;
    foreach grantee_name in array array['anon', 'authenticated', 'service_role', 'app_api'] loop
      foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
        if pg_catalog.has_table_privilege(grantee_name, table_name, privilege_name) then
          raise exception 'DINING_ZONES_AUDIT_TABLE_GRANT_REJECTED';
        end if;
      end loop;
    end loop;
  end loop;
end
$audit$;

select
  1::integer as schema_version,
  2::integer as secured_tables,
  1::integer as security_definer_functions;
