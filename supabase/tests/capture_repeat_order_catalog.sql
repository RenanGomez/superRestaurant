-- Supplement to the exact Customer Order history audit. Never apply as a migration.
do $capture_repeat_order_catalog$
declare
  plan_table oid := pg_catalog.to_regclass('app.capture_repeat_order_plans');
  journal_table oid := pg_catalog.to_regclass('app.capture_command_events');
  repeat_function oid := pg_catalog.to_regprocedure(
    'app_private.repeat_customer_order_into_capture(uuid,jsonb,jsonb)'
  );
  clear_function oid := pg_catalog.to_regprocedure(
    'app_private.clear_capture_repeat_order_plan_for_context()'
  );
  app_api_oid oid := (select oid from pg_catalog.pg_roles where rolname='app_api');
begin
  if plan_table is null or journal_table is null or repeat_function is null
    or clear_function is null or app_api_oid is null
  then
    raise exception using errcode='55000', message='CAPTURE_REPEAT_ORDER_REQUIRED_OBJECT_MISSING';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class relation
    join pg_catalog.pg_roles owner on owner.oid=relation.relowner
    where relation.oid=plan_table and relation.relkind='r'
      and relation.relrowsecurity and relation.relforcerowsecurity
      and owner.rolname='postgres' and owner.rolbypassrls
  ) or exists (
    select 1 from pg_catalog.pg_policy where polrelid=plan_table
  ) or exists (
    select 1 from pg_catalog.pg_class relation
    cross join lateral pg_catalog.aclexplode(
      coalesce(relation.relacl,pg_catalog.acldefault('r',relation.relowner))
    ) acl
    where relation.oid=plan_table and acl.grantee<>relation.relowner
  ) then
    raise exception using errcode='55000', message='CAPTURE_REPEAT_ORDER_TABLE_SECURITY_REJECTED';
  end if;

  if (
    select pg_catalog.count(*) from pg_catalog.pg_constraint
    where conrelid=plan_table and convalidated
  )<>8 or (
    select pg_catalog.count(*) from pg_catalog.pg_constraint
    where conrelid=plan_table and conname in (
      'capture_repeat_order_plans_pk','capture_repeat_order_plans_capture_fk',
      'capture_repeat_order_plans_customer_fk','capture_repeat_order_plans_source_order_fk',
      'capture_repeat_order_plans_catalog_fk','capture_repeat_order_plans_version_valid',
      'capture_repeat_order_plans_payload_valid','capture_repeat_order_plans_updated_by_fkey'
    )
  )<>8 then
    raise exception using errcode='55000', message='CAPTURE_REPEAT_ORDER_CONSTRAINTS_REJECTED';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid=plan_table and conname='capture_repeat_order_plans_capture_fk'
      and contype='f' and confrelid=pg_catalog.to_regclass('app.capture_drafts')
      and pg_catalog.array_length(conkey,1)=3 and confdeltype='r'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid=plan_table and conname='capture_repeat_order_plans_customer_fk'
      and contype='f' and confrelid=pg_catalog.to_regclass('app.customers')
      and pg_catalog.array_length(conkey,1)=2 and confdeltype='r'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid=plan_table and conname='capture_repeat_order_plans_source_order_fk'
      and contype='f' and confrelid=pg_catalog.to_regclass('app.orders')
      and pg_catalog.array_length(conkey,1)=3 and confdeltype='r'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid=plan_table and conname='capture_repeat_order_plans_catalog_fk'
      and contype='f' and confrelid=pg_catalog.to_regclass('app.menu_catalogs')
      and pg_catalog.array_length(conkey,1)=2 and confdeltype='r'
  ) then
    raise exception using errcode='55000', message='CAPTURE_REPEAT_ORDER_SCOPE_REJECTED';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid=pg_catalog.to_regclass('app.capture_drafts')
      and tgname='capture_drafts_clear_repeat_order_plan_for_context'
      and tgfoid=clear_function and tgenabled='O' and not tgisinternal
  ) then
    raise exception using errcode='55000', message='CAPTURE_REPEAT_ORDER_CLEAR_TRIGGER_REJECTED';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_roles owner on owner.oid=p.proowner
    where p.oid=repeat_function and p.prosecdef and p.provolatile='v'
      and owner.rolname='postgres' and owner.rolbypassrls
      and coalesce(pg_catalog.array_to_string(p.proconfig,','),'') in ('search_path=','search_path=""')
  ) or not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_roles owner on owner.oid=p.proowner
    where p.oid=clear_function and not p.prosecdef and p.provolatile='v'
      and owner.rolname='postgres'
      and coalesce(pg_catalog.array_to_string(p.proconfig,','),'') in ('search_path=','search_path=""')
  ) then
    raise exception using errcode='55000', message='CAPTURE_REPEAT_ORDER_FUNCTION_SHAPE_REJECTED';
  end if;

  if not pg_catalog.has_function_privilege(app_api_oid,repeat_function,'EXECUTE')
    or pg_catalog.has_function_privilege('anon',repeat_function,'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated',repeat_function,'EXECUTE')
    or pg_catalog.has_function_privilege('service_role',repeat_function,'EXECUTE')
    or pg_catalog.has_function_privilege(app_api_oid,clear_function,'EXECUTE')
    or pg_catalog.has_function_privilege('anon',clear_function,'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated',clear_function,'EXECUTE')
    or pg_catalog.has_function_privilege('service_role',clear_function,'EXECUTE')
  then
    raise exception using errcode='55000', message='CAPTURE_REPEAT_ORDER_GRANTS_REJECTED';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid=journal_table and conname='capture_events_operation_valid'
      and contype='c' and convalidated
      and pg_catalog.pg_get_constraintdef(oid) like '%capture.order_repeated%'
      and pg_catalog.pg_get_constraintdef(oid) like '%capture.confirmed%'
  ) then
    raise exception using errcode='55000', message='CAPTURE_REPEAT_ORDER_JOURNAL_REJECTED';
  end if;
end
$capture_repeat_order_catalog$;
