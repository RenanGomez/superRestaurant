do $audit$
declare
  app_api_oid oid := (select oid from pg_catalog.pg_roles where rolname = 'app_api');
  create_order_oid oid := pg_catalog.to_regprocedure(
    'app_private.create_operational_order(uuid,uuid,jsonb,jsonb)'
  );
  list_orders_oid oid := pg_catalog.to_regprocedure(
    'app_private.list_active_table_orders(uuid,uuid,uuid,uuid)'
  );
  link_table_oid oid := pg_catalog.to_regclass('app.order_operational_shifts');
  create_definition text;
  list_definition text;
begin
  if app_api_oid is null or create_order_oid is null or list_orders_oid is null
    or link_table_oid is null
    or pg_catalog.to_regclass('app.operational_shifts') is null
  then
    raise exception using errcode = '55000', message = 'OPERATIONAL_ORDER_SHIFT_REQUIRED_OBJECT_MISSING';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    join pg_catalog.pg_roles as owner on owner.oid = relation.relowner
    where namespace.nspname = 'app'
      and relation.relname in ('operational_shifts', 'order_operational_shifts')
      and relation.relkind = 'r'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
      and owner.rolname = 'postgres'
  ) <> 2
  then
    raise exception using errcode = '55000', message = 'OPERATIONAL_ORDER_SHIFT_TABLE_SECURITY_REJECTED';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'app'
      and tablename in ('operational_shifts', 'order_operational_shifts')
  ) then
    raise exception using errcode = '55000', message = 'OPERATIONAL_ORDER_SHIFT_POLICY_REJECTED';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class as relation
    cross join lateral pg_catalog.aclexplode(
      coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
    ) as acl
    left join pg_catalog.pg_roles as grantee on grantee.oid = acl.grantee
    where relation.oid in (
      pg_catalog.to_regclass('app.operational_shifts'),
      link_table_oid
    )
      and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
      and (acl.grantee = 0 or grantee.rolname in ('anon', 'authenticated', 'service_role', 'app_api'))
  ) then
    raise exception using errcode = '55000', message = 'OPERATIONAL_ORDER_SHIFT_TABLE_GRANT_REJECTED';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where procedure.oid in (create_order_oid, list_orders_oid)
      and procedure.prosecdef
      and owner.rolname = 'postgres'
      and (
        (procedure.oid = create_order_oid and procedure.provolatile = 'v')
        or (procedure.oid = list_orders_oid and procedure.provolatile = 's')
      )
  ) <> 2
  then
    raise exception using errcode = '55000', message = 'OPERATIONAL_ORDER_SHIFT_FUNCTION_SECURITY_REJECTED';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedure
    cross join lateral pg_catalog.aclexplode(
      coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) as acl
    left join pg_catalog.pg_roles as grantee on grantee.oid = acl.grantee
    where procedure.oid in (create_order_oid, list_orders_oid)
      and acl.privilege_type = 'EXECUTE'
      and (acl.grantee = 0 or grantee.rolname in ('anon', 'authenticated', 'service_role'))
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc as procedure
    cross join lateral pg_catalog.aclexplode(
      coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) as acl
    where procedure.oid in (create_order_oid, list_orders_oid)
      and acl.grantee = app_api_oid
      and acl.privilege_type = 'EXECUTE'
  ) <> 2
  then
    raise exception using errcode = '55000', message = 'OPERATIONAL_ORDER_SHIFT_FUNCTION_GRANT_REJECTED';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = link_table_oid
      and conname = 'order_operational_shifts_pk'
      and contype = 'p'
      and pg_catalog.pg_get_constraintdef(oid) = 'PRIMARY KEY (restaurant_id, branch_id, order_id)'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = link_table_oid
      and conname = 'order_operational_shifts_order_fk'
      and contype = 'f'
      and confrelid = pg_catalog.to_regclass('app.orders')
      and pg_catalog.pg_get_constraintdef(oid) =
        'FOREIGN KEY (restaurant_id, branch_id, order_id) REFERENCES app.orders(restaurant_id, branch_id, id) ON DELETE RESTRICT'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = link_table_oid
      and conname = 'order_operational_shifts_shift_fk'
      and contype = 'f'
      and confrelid = pg_catalog.to_regclass('app.operational_shifts')
      and pg_catalog.pg_get_constraintdef(oid) =
        'FOREIGN KEY (restaurant_id, branch_id, shift_id) REFERENCES app.operational_shifts(restaurant_id, branch_id, id) ON DELETE RESTRICT'
  ) then
    raise exception using errcode = '55000', message = 'OPERATIONAL_ORDER_SHIFT_CONSTRAINT_REJECTED';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_index as idx
    join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = idx.indrelid
      and attribute.attnum = any(idx.indkey)
    where idx.indrelid = pg_catalog.to_regclass('app.orders')
      and idx.indisunique
      and attribute.attname = 'table_id'
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.pg_index
    where indrelid = link_table_oid and indisunique
  ) <> 1
  then
    raise exception using errcode = '55000', message = 'OPERATIONAL_ORDER_SHIFT_FALSE_TABLE_UNIQUENESS';
  end if;

  create_definition := pg_catalog.lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(create_order_oid), '\s+', ' ', 'g'
  ));
  list_definition := pg_catalog.lower(pg_catalog.regexp_replace(
    pg_catalog.pg_get_functiondef(list_orders_oid), '\s+', ' ', 'g'
  ));

  if pg_catalog.strpos(
    create_definition,
    'shift.restaurant_id = v_restaurant_id and shift.branch_id = v_branch_id and shift.id = p_shift_id and shift.status = ''open'''
  ) = 0
    or pg_catalog.strpos(create_definition, 'shift.opened_at <= v_occurred_at') = 0
    or pg_catalog.strpos(create_definition, 'for share') = 0
    or pg_catalog.strpos(
      create_definition,
      'app_private.persist_order_mutation(p_actor_id, 0, p_order, p_audit)'
    ) = 0
    or pg_catalog.strpos(
      create_definition,
      'insert into app.order_operational_shifts ( restaurant_id, branch_id, order_id, shift_id, linked_by )'
    ) = 0
    or pg_catalog.strpos(
      create_definition,
      'link.restaurant_id = v_restaurant_id and link.branch_id = v_branch_id and link.order_id = v_order_id and link.shift_id = p_shift_id'
    ) = 0
  then
    raise exception using errcode = '55000', message = 'OPERATIONAL_ORDER_SHIFT_ATOMIC_CREATE_REJECTED';
  end if;

  if pg_catalog.strpos(
    list_definition,
    'app_private.find_active_branch_membership(p_actor_id, p_restaurant_id, p_branch_id)'
  ) = 0
    or pg_catalog.strpos(
      list_definition,
      'dining_table.restaurant_id = p_restaurant_id and dining_table.branch_id = p_branch_id and dining_table.id = p_table_id'
    ) = 0
    or pg_catalog.strpos(list_definition, 'left join app.order_operational_shifts as link') = 0
    or pg_catalog.strpos(
      list_definition,
      'orders.restaurant_id = p_restaurant_id and orders.branch_id = p_branch_id and orders.table_id = p_table_id'
    ) = 0
    or pg_catalog.strpos(list_definition, 'orders.status in (''draft'', ''open'', ''partially_paid'')') = 0
    or pg_catalog.strpos(list_definition, '''shiftid'', active_order.shift_id') = 0
    or pg_catalog.strpos(list_definition, 'limit 101') = 0
  then
    raise exception using errcode = '55000', message = 'OPERATIONAL_ORDER_SHIFT_ACTIVE_READ_REJECTED';
  end if;

  if app_private.create_operational_order(null, null, '{}'::jsonb, '{}'::jsonb)
    <> '{"status":"conflict"}'::jsonb
    or app_private.list_active_table_orders(null, null, null, null) is not null
  then
    raise exception using errcode = '55000', message = 'OPERATIONAL_ORDER_SHIFT_FAIL_CLOSED_REJECTED';
  end if;
end
$audit$;
