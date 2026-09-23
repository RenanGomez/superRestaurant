-- Supplement to the exact post-D4 global audit. Never apply as a migration.
do $customer_order_history_catalog$
declare
  function_oid oid := pg_catalog.to_regprocedure(
    'app_private.list_customer_recent_orders(uuid,jsonb)'
  );
  snapshot_table oid := pg_catalog.to_regclass('app.order_fulfillment_snapshots');
  app_api_oid oid := (select oid from pg_catalog.pg_roles where rolname='app_api');
begin
  if function_oid is null or snapshot_table is null or app_api_oid is null then
    raise exception using errcode='55000', message='CUSTOMER_ORDER_HISTORY_REQUIRED_OBJECT_MISSING';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_roles owner on owner.oid=p.proowner
    where p.oid=function_oid and p.prosecdef and p.provolatile='s'
      and owner.rolname='postgres' and owner.rolbypassrls
      and coalesce(pg_catalog.array_to_string(p.proconfig,','),'') in ('search_path=','search_path=""')
  ) then
    raise exception using errcode='55000', message='CUSTOMER_ORDER_HISTORY_FUNCTION_REJECTED';
  end if;

  if not pg_catalog.has_function_privilege(app_api_oid,function_oid,'EXECUTE')
    or pg_catalog.has_function_privilege('anon',function_oid,'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated',function_oid,'EXECUTE')
    or pg_catalog.has_function_privilege('service_role',function_oid,'EXECUTE')
    or exists (
      select 1 from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(
        coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))
      ) acl
      where p.oid=function_oid and acl.privilege_type='EXECUTE'
        and acl.grantee not in (p.proowner,app_api_oid)
    )
  then
    raise exception using errcode='55000', message='CUSTOMER_ORDER_HISTORY_GRANTS_REJECTED';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_index
    where indrelid=snapshot_table and not indisunique and indpred is not null
      and pg_catalog.pg_get_indexdef(indexrelid) like
        '%(restaurant_id, branch_id, customer_id, confirmed_at DESC, order_id DESC)%'
      and pg_catalog.pg_get_expr(indpred,indrelid) like '%customer_id IS NOT NULL%'
  ) then
    raise exception using errcode='55000', message='CUSTOMER_ORDER_HISTORY_INDEX_REJECTED';
  end if;
end
$customer_order_history_catalog$;
