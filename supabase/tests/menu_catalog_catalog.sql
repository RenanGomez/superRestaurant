do $audit$
declare
  table_name text;
  function_name text;
  function_oid oid;
  grantee_name text;
begin
  foreach table_name in array array[
    'menu_catalogs', 'menu_categories', 'menu_products', 'menu_modifier_groups',
    'menu_modifier_options', 'menu_catalog_heads', 'menu_catalog_audit_events'
  ] loop
    if pg_catalog.to_regclass('app.' || table_name) is null then
      raise exception 'MENU_CATALOG_AUDIT_TABLE_MISSING';
    end if;
    if not exists (
      select 1 from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      join pg_catalog.pg_roles as owner on owner.oid = relation.relowner
      where namespace.nspname = 'app' and relation.relname = table_name
        and relation.relrowsecurity and relation.relforcerowsecurity
        and owner.rolname = 'postgres' and owner.rolbypassrls
    ) then raise exception 'MENU_CATALOG_AUDIT_RLS_REJECTED'; end if;
    foreach grantee_name in array array['anon','authenticated','service_role','app_api'] loop
      if pg_catalog.has_any_column_privilege(
        grantee_name, 'app.' || table_name, 'SELECT,INSERT,UPDATE,REFERENCES'
      ) or pg_catalog.has_table_privilege(
        grantee_name, 'app.' || table_name, 'DELETE,TRUNCATE,TRIGGER'
      ) then raise exception 'MENU_CATALOG_AUDIT_TABLE_GRANT_REJECTED'; end if;
    end loop;
  end loop;

  foreach function_name in array array[
    'app_private.build_menu_catalog_state(uuid,uuid,uuid,boolean)',
    'app_private.get_menu_catalog(uuid,uuid,uuid)',
    'app_private.save_menu_catalog(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,uuid,text,jsonb)'
  ] loop
    function_oid := pg_catalog.to_regprocedure(function_name);
    if function_oid is null or not exists (
      select 1 from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
      where procedure.oid = function_oid and procedure.prosecdef
        and coalesce(pg_catalog.array_to_string(procedure.proconfig, ','), '')
          in ('search_path=', 'search_path=""')
        and owner.rolname = 'postgres' and owner.rolbypassrls
    ) then raise exception 'MENU_CATALOG_AUDIT_FUNCTION_REJECTED'; end if;
    foreach grantee_name in array array['anon','authenticated','service_role'] loop
      if pg_catalog.has_function_privilege(grantee_name, function_oid, 'EXECUTE')
      then raise exception 'MENU_CATALOG_AUDIT_CLIENT_EXECUTE_REJECTED'; end if;
    end loop;
  end loop;

  if not pg_catalog.has_function_privilege(
    'app_api', 'app_private.get_menu_catalog(uuid,uuid,uuid)', 'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'app_api',
    'app_private.save_menu_catalog(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,uuid,text,jsonb)',
    'EXECUTE'
  ) then raise exception 'MENU_CATALOG_AUDIT_EXECUTE_MISSING'; end if;
  if pg_catalog.has_function_privilege(
    'app_api', 'app_private.build_menu_catalog_state(uuid,uuid,uuid,boolean)', 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'app_api', 'app_private.jsonb_has_exact_keys(jsonb,text[])', 'EXECUTE'
  ) then raise exception 'MENU_CATALOG_AUDIT_HELPER_EXPOSED'; end if;
end $audit$;

select 1::integer as schema_version, 7::integer as secured_tables,
  3::integer as security_definer_functions, 2::integer as app_api_functions;
