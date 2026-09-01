do $audit$
declare table_name text; function_name text; function_oid oid; grantee_name text;
begin
  foreach table_name in array array['dining_tables','dining_table_audit_events'] loop
    if pg_catalog.to_regclass('app.' || table_name) is null then raise exception 'DINING_TABLES_AUDIT_TABLE_MISSING'; end if;
    if not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relname=table_name and c.relrowsecurity and c.relforcerowsecurity) then raise exception 'DINING_TABLES_AUDIT_RLS_REJECTED'; end if;
    foreach grantee_name in array array['anon','authenticated','service_role','app_api'] loop
      if pg_catalog.has_any_column_privilege(grantee_name, 'app.' || table_name, 'SELECT,INSERT,UPDATE,REFERENCES') or pg_catalog.has_table_privilege(grantee_name, 'app.' || table_name, 'DELETE,TRUNCATE,TRIGGER') then raise exception 'DINING_TABLES_AUDIT_TABLE_GRANT_REJECTED'; end if;
    end loop;
  end loop;
  foreach function_name in array array[
    'app_private.list_dining_layout(uuid,uuid,uuid)',
    'app_private.create_dining_table(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text,integer,integer,integer,integer)',
    'app_private.update_dining_table_layout(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,integer,integer,integer,integer)'
  ] loop
    function_oid := pg_catalog.to_regprocedure(function_name);
    if function_oid is null or not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner where p.oid=function_oid and p.prosecdef and coalesce(pg_catalog.array_to_string(p.proconfig,','),'') in ('search_path=','search_path=""') and r.rolname='postgres' and r.rolbypassrls) then raise exception 'DINING_TABLES_AUDIT_FUNCTION_REJECTED'; end if;
    if not pg_catalog.has_function_privilege('app_api',function_oid,'EXECUTE') then raise exception 'DINING_TABLES_AUDIT_EXECUTE_MISSING'; end if;
    foreach grantee_name in array array['anon','authenticated','service_role'] loop if pg_catalog.has_function_privilege(grantee_name,function_oid,'EXECUTE') then raise exception 'DINING_TABLES_AUDIT_CLIENT_EXECUTE_REJECTED'; end if; end loop;
  end loop;
end $audit$;
select 1::integer as schema_version, 2::integer as secured_tables, 3::integer as security_definer_functions;
