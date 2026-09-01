-- Exact pre-provisioning audit for the schema after dining zones are applied.
-- Run only while app_api is deliberately NOLOGIN with no password or sessions.
do $audit$
declare
  app_api_oid oid;
  expected_functions oid[] := array[
    pg_catalog.to_regprocedure('app_rls.has_active_restaurant_membership(uuid)'),
    pg_catalog.to_regprocedure('app_rls.has_active_branch_membership(uuid,uuid)'),
    pg_catalog.to_regprocedure('app_rls.can_read_membership(uuid)'),
    pg_catalog.to_regprocedure('app_private.find_active_branch_membership(uuid,uuid,uuid)'),
    pg_catalog.to_regprocedure('app_private.list_active_branch_memberships(uuid)'),
    pg_catalog.to_regprocedure(
      'app_private.create_dining_zone(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text)'
    )
  ]::oid[];
  private_functions oid[];
  function_oid oid;
  table_name text;
begin
  select oid into app_api_oid from pg_catalog.pg_roles where rolname = 'app_api';
  if app_api_oid is null
    or pg_catalog.array_position(expected_functions, null::oid) is not null
  then
    raise exception 'POST_DINING_CATALOG_REQUIRED_OBJECT_MISSING';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_roles
    where oid = app_api_oid
      and (
        rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolinherit
        or rolreplication or rolbypassrls or rolconnlimit <> -1
        or (rolvaliduntil is not null and rolvaliduntil is distinct from 'infinity'::timestamptz)
        or rolconfig is not null
      )
  )
    or coalesce((select rolpassword is not null from pg_catalog.pg_authid where oid = app_api_oid), true)
    or exists (select 1 from pg_catalog.pg_stat_activity where usename = 'app_api')
  then
    raise exception 'POST_DINING_CATALOG_APP_API_PRIVILEGED';
  end if;

  if pg_catalog.shobj_description(app_api_oid, 'pg_authid')
      is distinct from 'superRestaurant dedicated API capability role'
    or (select count(*) from pg_catalog.pg_auth_members where roleid = app_api_oid or member = app_api_oid) <> 1
    or not exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
      join pg_catalog.pg_roles as grantor_role on grantor_role.oid = membership.grantor
      where membership.roleid = app_api_oid
        and member_role.rolname = 'postgres'
        and grantor_role.rolname = 'supabase_admin'
        and membership.admin_option
        and not membership.inherit_option
        and not membership.set_option
    )
  then
    raise exception 'POST_DINING_CATALOG_APP_API_CONTAMINATED';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind = 'r'
  ) <> 7
    or (
      select count(*)
      from pg_catalog.pg_class as c
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'app'
        and c.relname in (
          'roles', 'restaurants', 'branches', 'memberships', 'membership_role_grants',
          'dining_zones', 'dining_zone_audit_events'
        )
        and c.relkind = 'r'
        and c.relrowsecurity
        and c.relforcerowsecurity
    ) <> 7
  then
    raise exception 'POST_DINING_CATALOG_TABLE_SURFACE_REJECTED';
  end if;

  if (select count(*) from pg_catalog.pg_policies where schemaname = 'app') <> 5
    or exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'app'
        and (cmd <> 'SELECT' or roles <> array['authenticated']::name[])
    )
  then
    raise exception 'POST_DINING_CATALOG_POLICIES_REJECTED';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname in ('app_rls', 'app_private') and p.prosecdef
  ) <> 6
    or exists (
      select 1
      from pg_catalog.pg_proc as p
      join pg_catalog.pg_roles as owner on owner.oid = p.proowner
      where p.oid = any(expected_functions)
        and (
          not p.prosecdef
          or coalesce(pg_catalog.array_to_string(p.proconfig, ','), '')
            not in ('search_path=', 'search_path=""')
          or owner.rolname <> 'postgres'
          or not owner.rolbypassrls
        )
    )
  then
    raise exception 'POST_DINING_CATALOG_FUNCTION_SURFACE_REJECTED';
  end if;

  if not pg_catalog.has_schema_privilege('authenticated', 'app', 'USAGE')
    or pg_catalog.has_schema_privilege('anon', 'app', 'USAGE')
    or pg_catalog.has_schema_privilege('service_role', 'app', 'USAGE')
    or not pg_catalog.has_schema_privilege(app_api_oid, 'app_private', 'USAGE')
    or pg_catalog.has_schema_privilege(app_api_oid, 'app', 'USAGE')
    or pg_catalog.has_schema_privilege(app_api_oid, 'app_rls', 'USAGE')
  then
    raise exception 'POST_DINING_CATALOG_SCHEMA_GRANTS_REJECTED';
  end if;

  if exists (
    select 1 from pg_catalog.pg_class where relowner = app_api_oid
    union all select 1 from pg_catalog.pg_proc where proowner = app_api_oid
    union all select 1 from pg_catalog.pg_namespace where nspowner = app_api_oid
    union all select 1 from pg_catalog.pg_type where typowner = app_api_oid
  )
    or exists (
      select 1
      from pg_catalog.pg_class as c
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
        ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as denied(privilege_name)
      where n.nspname = 'app'
        and c.relkind in ('r', 'p', 'v', 'm', 'S')
        and pg_catalog.has_table_privilege(app_api_oid, c.oid, denied.privilege_name)
    )
  then
    raise exception 'POST_DINING_CATALOG_APP_API_OBJECT_PRIVILEGE_REJECTED';
  end if;

  foreach table_name in array array[
    'roles', 'restaurants', 'branches', 'memberships', 'membership_role_grants'
  ] loop
    if not pg_catalog.has_table_privilege('authenticated', pg_catalog.format('app.%I', table_name), 'SELECT')
      or pg_catalog.has_table_privilege('authenticated', pg_catalog.format('app.%I', table_name), 'INSERT')
      or pg_catalog.has_table_privilege('authenticated', pg_catalog.format('app.%I', table_name), 'UPDATE')
      or pg_catalog.has_table_privilege('authenticated', pg_catalog.format('app.%I', table_name), 'DELETE')
      or pg_catalog.has_table_privilege('anon', pg_catalog.format('app.%I', table_name), 'SELECT')
      or pg_catalog.has_table_privilege('anon', pg_catalog.format('app.%I', table_name), 'INSERT')
      or pg_catalog.has_table_privilege('anon', pg_catalog.format('app.%I', table_name), 'UPDATE')
      or pg_catalog.has_table_privilege('anon', pg_catalog.format('app.%I', table_name), 'DELETE')
      or pg_catalog.has_table_privilege('service_role', pg_catalog.format('app.%I', table_name), 'SELECT')
      or pg_catalog.has_table_privilege('service_role', pg_catalog.format('app.%I', table_name), 'INSERT')
      or pg_catalog.has_table_privilege('service_role', pg_catalog.format('app.%I', table_name), 'UPDATE')
      or pg_catalog.has_table_privilege('service_role', pg_catalog.format('app.%I', table_name), 'DELETE')
    then
      raise exception 'POST_DINING_CATALOG_BASE_TABLE_GRANTS_REJECTED';
    end if;
  end loop;

  foreach table_name in array array['dining_zones', 'dining_zone_audit_events'] loop
    if pg_catalog.has_table_privilege('authenticated', pg_catalog.format('app.%I', table_name), 'SELECT')
      or pg_catalog.has_table_privilege('authenticated', pg_catalog.format('app.%I', table_name), 'INSERT')
      or pg_catalog.has_table_privilege('authenticated', pg_catalog.format('app.%I', table_name), 'UPDATE')
      or pg_catalog.has_table_privilege('authenticated', pg_catalog.format('app.%I', table_name), 'DELETE')
      or pg_catalog.has_table_privilege('anon', pg_catalog.format('app.%I', table_name), 'SELECT')
      or pg_catalog.has_table_privilege('anon', pg_catalog.format('app.%I', table_name), 'INSERT')
      or pg_catalog.has_table_privilege('anon', pg_catalog.format('app.%I', table_name), 'UPDATE')
      or pg_catalog.has_table_privilege('anon', pg_catalog.format('app.%I', table_name), 'DELETE')
      or pg_catalog.has_table_privilege('service_role', pg_catalog.format('app.%I', table_name), 'SELECT')
      or pg_catalog.has_table_privilege('service_role', pg_catalog.format('app.%I', table_name), 'INSERT')
      or pg_catalog.has_table_privilege('service_role', pg_catalog.format('app.%I', table_name), 'UPDATE')
      or pg_catalog.has_table_privilege('service_role', pg_catalog.format('app.%I', table_name), 'DELETE')
    then
      raise exception 'POST_DINING_CATALOG_DINING_TABLE_GRANTS_REJECTED';
    end if;
  end loop;

  private_functions := expected_functions[4:6];
  foreach function_oid in array expected_functions loop
    if exists (
      select 1
      from pg_catalog.pg_proc as p
      cross join lateral pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) as acl
      where p.oid = function_oid and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )
    then
      raise exception 'POST_DINING_CATALOG_PUBLIC_EXECUTE_REJECTED';
    end if;
  end loop;

  foreach function_oid in array private_functions loop
    if not pg_catalog.has_function_privilege(app_api_oid, function_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', function_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', function_oid, 'EXECUTE')
    then
      raise exception 'POST_DINING_CATALOG_PRIVATE_FUNCTION_GRANTS_REJECTED';
    end if;
  end loop;

  foreach function_oid in array expected_functions[1:3] loop
    if not pg_catalog.has_function_privilege('authenticated', function_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', function_oid, 'EXECUTE')
    then
      raise exception 'POST_DINING_CATALOG_RLS_FUNCTION_GRANTS_REJECTED';
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname in ('app_private', 'app_rls')
      and p.oid <> all(expected_functions)
      and pg_catalog.has_function_privilege(app_api_oid, p.oid, 'EXECUTE')
  )
  then
    raise exception 'POST_DINING_CATALOG_APP_API_EXTRA_FUNCTION';
  end if;
end
$audit$;
