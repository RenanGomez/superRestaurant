-- Read-only pre-provisioning catalog audit. Run immediately after the product
-- migration with ON_ERROR_STOP, while app_api is deliberately NOLOGIN. It
-- creates no fixtures and changes no data. Use the runtime audit after the
-- private LOGIN provisioning step.
do $audit$
declare
  app_api_oid oid;
  directory_function oid;
  lookup_function oid;
  secured_tables integer;
  secured_functions integer;
begin
  select oid into app_api_oid from pg_catalog.pg_roles where rolname = 'app_api';
  if app_api_oid is null then
    raise exception 'CATALOG_AUDIT_APP_API_MISSING';
  end if;

  lookup_function := pg_catalog.to_regprocedure(
    'app_private.find_active_branch_membership(uuid,uuid,uuid)'
  );
  directory_function := pg_catalog.to_regprocedure(
    'app_private.list_active_branch_memberships(uuid)'
  );
  if directory_function is null then
    raise exception 'CATALOG_AUDIT_DIRECTORY_FUNCTION_MISSING';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_roles
    where oid = app_api_oid
      and (
        rolcanlogin
        or rolsuper
        or rolcreatedb
        or rolcreaterole
        or rolinherit
        or rolreplication
        or rolbypassrls
        or rolconnlimit <> -1
        or (
          rolvaliduntil is not null
          and rolvaliduntil is distinct from 'infinity'::timestamptz
        )
        or rolconfig is not null
      )
  ) then
    raise exception 'CATALOG_AUDIT_APP_API_PRIVILEGED';
  end if;

  if coalesce((
      select rolpassword is not null
      from pg_catalog.pg_authid
      where oid = app_api_oid
    ), true)
    or exists (
      select 1 from pg_catalog.pg_stat_activity where usename = 'app_api'
    )
  then
    raise exception 'CATALOG_AUDIT_APP_API_CREDENTIAL_OR_SESSION';
  end if;

  if pg_catalog.shobj_description(app_api_oid, 'pg_authid') is distinct from 'superRestaurant dedicated API capability role'
    or (
      select count(*)
      from pg_catalog.pg_auth_members
      where roleid = app_api_oid or member = app_api_oid
    ) <> 1
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
    raise exception 'CATALOG_AUDIT_APP_API_CONTAMINATED';
  end if;

  select count(*) into secured_tables
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'app'
    and c.relname in ('roles', 'restaurants', 'branches', 'memberships', 'membership_role_grants')
    and c.relrowsecurity
    and c.relforcerowsecurity;
  if secured_tables <> 5 then
    raise exception 'CATALOG_AUDIT_RLS_INCOMPLETE';
  end if;

  select count(*) into secured_functions
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  join pg_catalog.pg_roles as owner on owner.oid = p.proowner
  where (n.nspname, p.proname) in (
      ('app_rls', 'has_active_restaurant_membership'),
      ('app_rls', 'has_active_branch_membership'),
      ('app_rls', 'can_read_membership'),
      ('app_private', 'find_active_branch_membership'),
      ('app_private', 'list_active_branch_memberships')
    )
    and p.prosecdef
    and coalesce(array_to_string(p.proconfig, ','), '') in ('search_path=', 'search_path=""')
    and owner.rolname = 'postgres'
    and owner.rolbypassrls;
  if lookup_function is null
    or secured_functions <> 5
  then
    raise exception 'CATALOG_AUDIT_FUNCTION_OWNER_OR_SEARCH_PATH';
  end if;

  if not pg_catalog.has_schema_privilege('authenticated', 'app', 'USAGE')
    or pg_catalog.has_schema_privilege('anon', 'app', 'USAGE')
    or pg_catalog.has_schema_privilege('service_role', 'app', 'USAGE')
  then
    raise exception 'CATALOG_AUDIT_APP_SCHEMA_GRANTS';
  end if;

  if exists (
    select 1 from pg_catalog.pg_class where relowner = app_api_oid
    union all
    select 1 from pg_catalog.pg_proc where proowner = app_api_oid
    union all
    select 1 from pg_catalog.pg_namespace where nspowner = app_api_oid
    union all
    select 1 from pg_catalog.pg_type where typowner = app_api_oid
  ) then
    raise exception 'CATALOG_AUDIT_APP_API_OWNS_OBJECTS';
  end if;

  if exists (
    select 1
    from (values ('roles'), ('restaurants'), ('branches'), ('memberships'), ('membership_role_grants')) as names(table_name)
    where not pg_catalog.has_table_privilege('authenticated', format('app.%I', table_name), 'SELECT')
       or pg_catalog.has_table_privilege('authenticated', format('app.%I', table_name), 'INSERT')
       or pg_catalog.has_table_privilege('authenticated', format('app.%I', table_name), 'UPDATE')
       or pg_catalog.has_table_privilege('authenticated', format('app.%I', table_name), 'DELETE')
       or pg_catalog.has_table_privilege('anon', format('app.%I', table_name), 'SELECT')
       or pg_catalog.has_table_privilege('anon', format('app.%I', table_name), 'INSERT')
       or pg_catalog.has_table_privilege('anon', format('app.%I', table_name), 'UPDATE')
       or pg_catalog.has_table_privilege('anon', format('app.%I', table_name), 'DELETE')
       or pg_catalog.has_table_privilege('service_role', format('app.%I', table_name), 'SELECT')
       or pg_catalog.has_table_privilege('service_role', format('app.%I', table_name), 'INSERT')
       or pg_catalog.has_table_privilege('service_role', format('app.%I', table_name), 'UPDATE')
       or pg_catalog.has_table_privilege('service_role', format('app.%I', table_name), 'DELETE')
  ) then
    raise exception 'CATALOG_AUDIT_TABLE_GRANTS';
  end if;

  if not pg_catalog.has_function_privilege(
      'app_api',
      'app_private.find_active_branch_membership(uuid,uuid,uuid)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'app_private.find_active_branch_membership(uuid,uuid,uuid)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'app_private.find_active_branch_membership(uuid,uuid,uuid)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'service_role',
      'app_private.find_active_branch_membership(uuid,uuid,uuid)',
      'EXECUTE'
    )
  then
    raise exception 'CATALOG_AUDIT_PRIVATE_FUNCTION_GRANTS';
  end if;

  if not pg_catalog.has_function_privilege(app_api_oid, directory_function, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', directory_function, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', directory_function, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', directory_function, 'EXECUTE')
  then
    raise exception 'CATALOG_AUDIT_DIRECTORY_FUNCTION_GRANTS';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname in ('app_private', 'app_rls')
      and p.oid <> all (
        pg_catalog.array_remove(
          array[lookup_function, directory_function]::oid[],
          null::oid
        )
      )
      and pg_catalog.has_function_privilege(app_api_oid, p.oid, 'EXECUTE')
  ) then
    raise exception 'CATALOG_AUDIT_APP_API_EXTRA_FUNCTION';
  end if;

  if (select count(*) from pg_catalog.pg_policies where schemaname = 'app') <> 5
    or exists (
      select 1
      from pg_catalog.pg_policies
      where schemaname = 'app' and roles <> array['authenticated']::name[]
    )
  then
    raise exception 'CATALOG_AUDIT_POLICIES';
  end if;
end
$audit$;
