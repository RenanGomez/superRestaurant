-- Exact global catalog audit after Order/KDS Realtime persistence is applied.
do $audit$
declare
  app_api_oid oid;
  expected_app_tables text[] := array[
    'roles','restaurants','branches','memberships','membership_role_grants',
    'dining_zones','dining_zone_audit_events','dining_tables','dining_table_audit_events',
    'menu_catalogs','menu_categories','menu_products','menu_modifier_groups','menu_modifier_options','menu_catalog_heads','menu_catalog_audit_events',
    'orders','order_audit_events','kds_events'
  ];
  allowed_app_api_functions oid[] := array[
    pg_catalog.to_regprocedure('app_private.find_active_branch_membership(uuid,uuid,uuid)'),
    pg_catalog.to_regprocedure('app_private.list_active_branch_memberships(uuid)'),
    pg_catalog.to_regprocedure('app_private.create_dining_zone(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text)'),
    pg_catalog.to_regprocedure('app_private.list_dining_layout(uuid,uuid,uuid)'),
    pg_catalog.to_regprocedure('app_private.create_dining_table(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text,integer,integer,integer,integer)'),
    pg_catalog.to_regprocedure('app_private.update_dining_table_layout(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,integer,integer,integer,integer)'),
    pg_catalog.to_regprocedure('app_private.get_menu_catalog(uuid,uuid,uuid)'),
    pg_catalog.to_regprocedure('app_private.save_menu_catalog(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,uuid,text,jsonb)'),
    pg_catalog.to_regprocedure('app_private.read_order(uuid,uuid,uuid,uuid)'),
    pg_catalog.to_regprocedure('app_private.persist_order_mutation(uuid,bigint,jsonb,jsonb)'),
    pg_catalog.to_regprocedure('app_private.recover_kds_events(uuid,uuid,uuid,text,bigint,integer)')
  ]::oid[];
  expected_security_definer_functions oid[] := array[
    pg_catalog.to_regprocedure('app_rls.has_active_restaurant_membership(uuid)'),
    pg_catalog.to_regprocedure('app_rls.has_active_branch_membership(uuid,uuid)'),
    pg_catalog.to_regprocedure('app_rls.can_read_membership(uuid)'),
    pg_catalog.to_regprocedure('app_private.find_active_branch_membership(uuid,uuid,uuid)'),
    pg_catalog.to_regprocedure('app_private.list_active_branch_memberships(uuid)'),
    pg_catalog.to_regprocedure('app_private.create_dining_zone(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text)'),
    pg_catalog.to_regprocedure('app_private.list_dining_layout(uuid,uuid,uuid)'),
    pg_catalog.to_regprocedure('app_private.create_dining_table(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text,integer,integer,integer,integer)'),
    pg_catalog.to_regprocedure('app_private.update_dining_table_layout(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,integer,integer,integer,integer)'),
    pg_catalog.to_regprocedure('app_private.build_menu_catalog_state(uuid,uuid,uuid,boolean)'),
    pg_catalog.to_regprocedure('app_private.get_menu_catalog(uuid,uuid,uuid)'),
    pg_catalog.to_regprocedure('app_private.save_menu_catalog(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,uuid,text,jsonb)'),
    pg_catalog.to_regprocedure('app_private.read_order(uuid,uuid,uuid,uuid)'),
    pg_catalog.to_regprocedure('app_private.persist_order_mutation(uuid,bigint,jsonb,jsonb)'),
    pg_catalog.to_regprocedure('app_private.recover_kds_events(uuid,uuid,uuid,text,bigint,integer)')
  ]::oid[];
  table_name text;
  function_oid oid;
begin
  select oid into app_api_oid from pg_catalog.pg_roles where rolname='app_api';
  if app_api_oid is null
    or pg_catalog.array_position(allowed_app_api_functions,null::oid) is not null
    or pg_catalog.array_position(expected_security_definer_functions,null::oid) is not null
  then raise exception 'POST_ORDERS_REQUIRED_OBJECT_MISSING'; end if;

  if (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app' and c.relkind='r') <> 19
    or (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app' and c.relkind='r' and c.relname=any(expected_app_tables) and c.relrowsecurity and c.relforcerowsecurity) <> 19
    or (select count(*) from pg_catalog.pg_policies where schemaname='app') <> 5
    or (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('app_rls','app_private') and p.prosecdef) <> 15
  then raise exception 'POST_ORDERS_SURFACE_REJECTED'; end if;

  if not exists(
    select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='app_private' and c.relname='kds_branch_cursors' and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity
  ) then raise exception 'POST_ORDERS_CURSOR_REJECTED'; end if;

  if not pg_catalog.has_schema_privilege('authenticated','app','USAGE')
    or pg_catalog.has_schema_privilege('anon','app','USAGE')
    or pg_catalog.has_schema_privilege('service_role','app','USAGE')
    or not pg_catalog.has_schema_privilege(app_api_oid,'app_private','USAGE')
    or pg_catalog.has_schema_privilege(app_api_oid,'app','USAGE')
    or pg_catalog.has_schema_privilege(app_api_oid,'app_rls','USAGE')
  then raise exception 'POST_ORDERS_SCHEMA_GRANTS_REJECTED'; end if;

  if exists(select 1 from pg_catalog.pg_class where relowner=app_api_oid)
    or exists(select 1 from pg_catalog.pg_proc where proowner=app_api_oid)
    or exists(select 1 from pg_catalog.pg_namespace where nspowner=app_api_oid)
    or exists(select 1 from pg_catalog.pg_type where typowner=app_api_oid)
    or exists(
      select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) denied(privilege_name)
      where n.nspname in ('app','app_private') and c.relkind in ('r','p','v','m','S')
        and pg_catalog.has_table_privilege(app_api_oid,c.oid,denied.privilege_name)
    )
  then raise exception 'POST_ORDERS_APP_API_OBJECT_PRIVILEGE_REJECTED'; end if;

  foreach table_name in array expected_app_tables[1:5] loop
    if not pg_catalog.has_table_privilege('authenticated',pg_catalog.format('app.%I',table_name),'SELECT')
      or pg_catalog.has_table_privilege('authenticated',pg_catalog.format('app.%I',table_name),'INSERT,UPDATE,DELETE')
    then raise exception 'POST_ORDERS_BASE_TABLE_GRANTS_REJECTED'; end if;
  end loop;
  foreach table_name in array expected_app_tables[6:19] loop
    if pg_catalog.has_table_privilege('authenticated',pg_catalog.format('app.%I',table_name),'SELECT,INSERT,UPDATE,DELETE')
      or pg_catalog.has_table_privilege('anon',pg_catalog.format('app.%I',table_name),'SELECT,INSERT,UPDATE,DELETE')
      or pg_catalog.has_table_privilege('service_role',pg_catalog.format('app.%I',table_name),'SELECT,INSERT,UPDATE,DELETE')
    then raise exception 'POST_ORDERS_SERVER_TABLE_GRANTS_REJECTED'; end if;
  end loop;

  foreach function_oid in array expected_security_definer_functions loop
    if not exists(
      select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles owner on owner.oid=p.proowner
      where p.oid=function_oid and p.prosecdef and owner.rolname='postgres' and owner.rolbypassrls
        and coalesce(pg_catalog.array_to_string(p.proconfig,','),'') in ('search_path=','search_path=""')
    ) or exists(
      select 1 from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      where p.oid=function_oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
    ) then raise exception 'POST_ORDERS_FUNCTION_SECURITY_REJECTED'; end if;
  end loop;

  foreach function_oid in array allowed_app_api_functions loop
    if not pg_catalog.has_function_privilege(app_api_oid,function_oid,'EXECUTE')
    then raise exception 'POST_ORDERS_APP_API_EXECUTE_MISSING'; end if;
  end loop;
  if exists(
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('app_private','app_rls') and p.oid <> all(allowed_app_api_functions)
      and pg_catalog.has_function_privilege(app_api_oid,p.oid,'EXECUTE')
  ) then raise exception 'POST_ORDERS_APP_API_EXTRA_FUNCTION'; end if;
end
$audit$;
