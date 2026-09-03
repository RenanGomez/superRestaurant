-- Exact additive audit for Order persistence, KDS recovery and Realtime notification storage.
do $audit$
declare
  app_api_oid oid;
  expected_functions oid[] := array[
    pg_catalog.to_regprocedure('app_private.read_order(uuid,uuid,uuid,uuid)'),
    pg_catalog.to_regprocedure('app_private.persist_order_mutation(uuid,bigint,jsonb,jsonb)'),
    pg_catalog.to_regprocedure('app_private.recover_kds_events(uuid,uuid,uuid,text,bigint,integer)')
  ]::oid[];
  expected_app_tables text[] := array['orders','order_audit_events','kds_events'];
  function_oid oid;
  table_name text;
begin
  select oid into app_api_oid from pg_catalog.pg_roles where rolname='app_api';
  if app_api_oid is null or pg_catalog.array_position(expected_functions,null::oid) is not null
    or pg_catalog.to_regclass('app_private.kds_branch_cursors') is null
  then raise exception 'ORDERS_REALTIME_REQUIRED_OBJECT_MISSING'; end if;

  foreach table_name in array expected_app_tables loop
    if not exists(
      select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app' and c.relname=table_name and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity
    ) then raise exception 'ORDERS_REALTIME_TABLE_SECURITY_REJECTED'; end if;
    if pg_catalog.has_table_privilege(app_api_oid,pg_catalog.format('app.%I',table_name),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or pg_catalog.has_table_privilege('anon',pg_catalog.format('app.%I',table_name),'SELECT,INSERT,UPDATE,DELETE')
      or pg_catalog.has_table_privilege('authenticated',pg_catalog.format('app.%I',table_name),'SELECT,INSERT,UPDATE,DELETE')
      or pg_catalog.has_table_privilege('service_role',pg_catalog.format('app.%I',table_name),'SELECT,INSERT,UPDATE,DELETE')
    then raise exception 'ORDERS_REALTIME_TABLE_GRANT_REJECTED'; end if;
  end loop;

  if not exists(
    select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='app_private' and c.relname='kds_branch_cursors' and c.relkind='r'
      and c.relrowsecurity and c.relforcerowsecurity
  ) or pg_catalog.has_table_privilege(app_api_oid,'app_private.kds_branch_cursors','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  then raise exception 'ORDERS_REALTIME_CURSOR_TABLE_REJECTED'; end if;

  foreach function_oid in array expected_functions loop
    if not exists(
      select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles owner on owner.oid=p.proowner
      where p.oid=function_oid and p.prosecdef and owner.rolname='postgres' and owner.rolbypassrls
        and coalesce(pg_catalog.array_to_string(p.proconfig,','),'') in ('search_path=','search_path=""')
    ) or exists(
      select 1 from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      where p.oid=function_oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
    ) or not pg_catalog.has_function_privilege(app_api_oid,function_oid,'EXECUTE')
      or pg_catalog.has_function_privilege('anon',function_oid,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',function_oid,'EXECUTE')
      or pg_catalog.has_function_privilege('service_role',function_oid,'EXECUTE')
    then raise exception 'ORDERS_REALTIME_FUNCTION_SECURITY_REJECTED'; end if;
  end loop;

  if (select count(*) from pg_catalog.pg_constraint where conrelid='app.orders'::regclass
      and conname in ('orders_branch_scope_fk','orders_table_scope_fk','orders_scope_id_unique','orders_aggregate_valid')) <> 4
    or (select count(*) from pg_catalog.pg_constraint where conrelid='app.order_audit_events'::regclass
      and conname in ('order_audit_order_scope_fk','order_audit_idempotency_unique','order_audit_payload_valid','order_audit_result_valid')) <> 4
    or (select count(*) from pg_catalog.pg_constraint where conrelid='app.kds_events'::regclass
      and conname in ('kds_event_audit_fk','kds_event_order_scope_fk','kds_event_cursor_unique','kds_event_station_valid')) <> 4
  then raise exception 'ORDERS_REALTIME_CONSTRAINTS_REJECTED'; end if;

  if not exists(select 1 from pg_catalog.pg_indexes where schemaname='app' and indexname='orders_branch_status_idx')
    or not exists(select 1 from pg_catalog.pg_indexes where schemaname='app' and indexname='orders_table_open_idx')
    or not exists(select 1 from pg_catalog.pg_indexes where schemaname='app' and indexname='order_audit_order_idx')
    or not exists(select 1 from pg_catalog.pg_indexes where schemaname='app' and indexname='kds_events_recovery_idx')
  then raise exception 'ORDERS_REALTIME_INDEXES_REJECTED'; end if;
end
$audit$;
