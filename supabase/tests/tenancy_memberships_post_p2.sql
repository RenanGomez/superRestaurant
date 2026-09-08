-- Exact read-only global catalog audit after the five P2 migrations.
-- Remote migration history is intentionally verified separately with the Supabase CLI.
do $audit$
declare
  app_api_oid oid := (select oid from pg_catalog.pg_roles where rolname = 'app_api');
  authenticated_oid oid := (select oid from pg_catalog.pg_roles where rolname = 'authenticated');
  postgres_oid oid := (select oid from pg_catalog.pg_roles where rolname = 'postgres');
  expected_app_tables text[] := array[
    'roles','restaurants','branches','memberships','membership_role_grants',
    'dining_zones','dining_zone_audit_events','dining_tables','dining_table_audit_events',
    'menu_catalogs','menu_categories','menu_products','menu_modifier_groups','menu_modifier_options','menu_catalog_heads','menu_catalog_audit_events',
    'orders','order_audit_events','kds_events',
    'cash_register_sessions','payments','cash_movements','financial_audit_events',
    'operational_shifts','order_operational_shifts'
  ];
  client_read_tables text[] := array[
    'roles','restaurants','branches','memberships','membership_role_grants'
  ];
  expected_private_tables text[] := array[
    'kds_branch_cursors','financial_device_sequences'
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
    pg_catalog.to_regprocedure('app_private.recover_kds_events(uuid,uuid,uuid,text,bigint,integer)'),
    pg_catalog.to_regprocedure('app_private.list_kds_tickets(uuid,uuid,uuid,text)'),
    pg_catalog.to_regprocedure('app_private.read_cash_register(uuid,uuid,uuid,uuid,uuid)'),
    pg_catalog.to_regprocedure('app_private.replay_financial_command(uuid,text,jsonb)'),
    pg_catalog.to_regprocedure('app_private.open_cash_register(uuid,jsonb,jsonb)'),
    pg_catalog.to_regprocedure('app_private.collect_simple_payment(uuid,jsonb,jsonb,jsonb,jsonb,bigint,bigint)'),
    pg_catalog.to_regprocedure('app_private.close_cash_register(uuid,jsonb,jsonb)'),
    pg_catalog.to_regprocedure('app_private.read_cash_register_operational_report(uuid,uuid,uuid,uuid,uuid,uuid)'),
    pg_catalog.to_regprocedure('app_private.list_active_operational_shifts(uuid,uuid,uuid)'),
    pg_catalog.to_regprocedure('app_private.create_operational_order(uuid,uuid,jsonb,jsonb)'),
    pg_catalog.to_regprocedure('app_private.list_active_table_orders(uuid,uuid,uuid,uuid)'),
    pg_catalog.to_regprocedure('app_private.persist_order_item_cancellation(uuid,bigint,jsonb,jsonb)'),
    pg_catalog.to_regprocedure('app_private.read_branch_operational_context(uuid,uuid,uuid)')
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
    pg_catalog.to_regprocedure('app_private.recover_kds_events(uuid,uuid,uuid,text,bigint,integer)'),
    pg_catalog.to_regprocedure('app_private.list_kds_tickets(uuid,uuid,uuid,text)'),
    pg_catalog.to_regprocedure('app_private.read_cash_register(uuid,uuid,uuid,uuid,uuid)'),
    pg_catalog.to_regprocedure('app_private.replay_financial_command(uuid,text,jsonb)'),
    pg_catalog.to_regprocedure('app_private.open_cash_register(uuid,jsonb,jsonb)'),
    pg_catalog.to_regprocedure('app_private.collect_simple_payment(uuid,jsonb,jsonb,jsonb,jsonb,bigint,bigint)'),
    pg_catalog.to_regprocedure('app_private.close_cash_register(uuid,jsonb,jsonb)'),
    pg_catalog.to_regprocedure('app_private.read_cash_register_operational_report(uuid,uuid,uuid,uuid,uuid,uuid)'),
    pg_catalog.to_regprocedure('app_private.list_active_operational_shifts(uuid,uuid,uuid)'),
    pg_catalog.to_regprocedure('app_private.create_operational_order(uuid,uuid,jsonb,jsonb)'),
    pg_catalog.to_regprocedure('app_private.list_active_table_orders(uuid,uuid,uuid,uuid)'),
    pg_catalog.to_regprocedure('app_private.actor_can_cancel_order_item(uuid,uuid,uuid,text)'),
    pg_catalog.to_regprocedure('app_private.persist_order_item_cancellation(uuid,bigint,jsonb,jsonb)'),
    pg_catalog.to_regprocedure('app_private.enforce_restaurant_time_zone()'),
    pg_catalog.to_regprocedure('app_private.enforce_order_restaurant_time_zone()'),
    pg_catalog.to_regprocedure('app_private.read_branch_operational_context(uuid,uuid,uuid)')
  ]::oid[];
  expected_non_definer_functions oid[] := array[
    pg_catalog.to_regprocedure('app_private.jsonb_has_exact_keys(jsonb,text[])'),
    pg_catalog.to_regprocedure('app_private.enforce_menu_modifier_group_command_limit()')
  ]::oid[];
  function_oid oid;
  table_name text;
begin
  if app_api_oid is null or authenticated_oid is null or postgres_oid is null
    or pg_catalog.array_position(allowed_app_api_functions, null::oid) is not null
    or pg_catalog.array_position(expected_security_definer_functions, null::oid) is not null
    or pg_catalog.array_position(expected_non_definer_functions, null::oid) is not null
  then raise exception 'POST_P2_REQUIRED_OBJECT_MISSING'; end if;

  if (select pg_catalog.count(*) from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app' and relation.relkind = 'r') <> 25
    or (select pg_catalog.count(*) from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      join pg_catalog.pg_roles as owner on owner.oid = relation.relowner
      where namespace.nspname = 'app' and relation.relkind = 'r'
        and relation.relname = any(expected_app_tables)
        and relation.relrowsecurity and relation.relforcerowsecurity
        and owner.rolname = 'postgres' and owner.rolbypassrls) <> 25
  then raise exception 'POST_P2_TABLE_SURFACE_REJECTED'; end if;

  foreach table_name in array expected_app_tables loop
    if exists (
      select 1
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      cross join lateral pg_catalog.aclexplode(
        coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
      ) as acl
      where namespace.nspname = 'app' and relation.relname = table_name
        and acl.grantee <> relation.relowner
        and not (
          table_name = any(client_read_tables)
          and acl.grantee = authenticated_oid
          and acl.privilege_type = 'SELECT'
          and not acl.is_grantable
        )
    ) or (
      table_name = any(client_read_tables)
      and not pg_catalog.has_table_privilege(authenticated_oid, pg_catalog.format('app.%I', table_name), 'SELECT')
    )
    then raise exception 'POST_P2_TABLE_GRANTS_REJECTED'; end if;
  end loop;

  if (select pg_catalog.count(*) from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      join pg_catalog.pg_roles as owner on owner.oid = relation.relowner
      where namespace.nspname = 'app_private' and relation.relkind = 'r'
        and relation.relname = any(expected_private_tables)
        and relation.relrowsecurity and relation.relforcerowsecurity
        and owner.rolname = 'postgres' and owner.rolbypassrls) <> 2
    or exists (
      select 1 from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      cross join lateral pg_catalog.aclexplode(
        coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
      ) as acl
      where namespace.nspname = 'app_private'
        and relation.relname = any(expected_private_tables)
        and acl.grantee <> relation.relowner
    )
  then raise exception 'POST_P2_PRIVATE_TABLE_SECURITY_REJECTED'; end if;

  if (select pg_catalog.count(*) from pg_catalog.pg_policy as policy
      join pg_catalog.pg_class as relation on relation.oid = policy.polrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app') <> 5
    or exists (
      select 1
      from pg_catalog.pg_policy as policy
      join pg_catalog.pg_class as relation on relation.oid = policy.polrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      left join (values
        ('roles','roles_authenticated_read'),
        ('restaurants','restaurants_active_member_read'),
        ('branches','branches_active_member_read'),
        ('memberships','memberships_self_active_read'),
        ('membership_role_grants','membership_role_grants_self_active_read')
      ) as expected(table_name, policy_name)
        on expected.table_name = relation.relname and expected.policy_name = policy.polname
      where namespace.nspname = 'app'
        and (expected.policy_name is null or policy.polcmd <> 'r' or not policy.polpermissive
          or policy.polroles <> array[authenticated_oid]::oid[] or policy.polwithcheck is not null)
    )
  then raise exception 'POST_P2_POLICY_SURFACE_REJECTED'; end if;

  if (select pg_catalog.count(*) from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname in ('app_rls','app_private') and procedure.prosecdef) <> 30
    or (select pg_catalog.count(*) from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname in ('app_rls','app_private')) <> 32
  then raise exception 'POST_P2_FUNCTION_SURFACE_REJECTED'; end if;

  foreach function_oid in array expected_security_definer_functions loop
    if not exists (
      select 1 from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
      where procedure.oid = function_oid and procedure.prosecdef
        and owner.rolname = 'postgres' and owner.rolbypassrls
        and coalesce(pg_catalog.array_to_string(procedure.proconfig, ','), '')
          in ('search_path=', 'search_path=""')
    ) or exists (
      select 1 from pg_catalog.pg_proc as procedure
      cross join lateral pg_catalog.aclexplode(
        coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
      ) as acl
      where procedure.oid = function_oid and acl.grantee <> procedure.proowner
        and not (
          acl.privilege_type = 'EXECUTE' and not acl.is_grantable
          and (
            (function_oid = any(expected_security_definer_functions[1:3]) and acl.grantee = authenticated_oid)
            or (function_oid = any(allowed_app_api_functions) and acl.grantee = app_api_oid)
          )
        )
    ) then raise exception 'POST_P2_FUNCTION_SECURITY_REJECTED'; end if;
  end loop;

  foreach function_oid in array expected_security_definer_functions[1:3] loop
    if not pg_catalog.has_function_privilege(authenticated_oid, function_oid, 'EXECUTE')
    then raise exception 'POST_P2_RLS_EXECUTE_MISSING'; end if;
  end loop;

  foreach function_oid in array allowed_app_api_functions loop
    if not pg_catalog.has_function_privilege(app_api_oid, function_oid, 'EXECUTE')
    then raise exception 'POST_P2_APP_API_EXECUTE_MISSING'; end if;
  end loop;

  foreach function_oid in array expected_non_definer_functions loop
    if not exists (
      select 1 from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
      where procedure.oid = function_oid and not procedure.prosecdef
        and owner.rolname = 'postgres' and owner.rolbypassrls
        and coalesce(pg_catalog.array_to_string(procedure.proconfig, ','), '')
          in ('search_path=', 'search_path=""')
    ) or exists (
      select 1 from pg_catalog.pg_proc as procedure
      cross join lateral pg_catalog.aclexplode(
        coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
      ) as acl
      where procedure.oid = function_oid and acl.grantee <> procedure.proowner
    ) then raise exception 'POST_P2_HELPER_SECURITY_REJECTED'; end if;
  end loop;

  if exists (
    select 1 from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('app_private','app_rls')
      and procedure.oid <> all(allowed_app_api_functions)
      and pg_catalog.has_function_privilege(app_api_oid, procedure.oid, 'EXECUTE')
  ) or exists (select 1 from pg_catalog.pg_class where relowner = app_api_oid)
    or exists (select 1 from pg_catalog.pg_proc where proowner = app_api_oid)
    or exists (select 1 from pg_catalog.pg_namespace where nspowner = app_api_oid)
    or exists (select 1 from pg_catalog.pg_type where typowner = app_api_oid)
  then raise exception 'POST_P2_APP_API_SURFACE_REJECTED'; end if;

  if exists (
    select 1
    from pg_catalog.pg_namespace as namespace
    join pg_catalog.pg_roles as owner on owner.oid = namespace.nspowner
    where namespace.nspname in ('app','app_private','app_rls')
      and (owner.rolname <> 'postgres' or not owner.rolbypassrls)
  ) or exists (
    select 1
    from pg_catalog.pg_namespace as namespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))
    ) as acl
    where namespace.nspname in ('app','app_private','app_rls')
      and acl.grantee <> namespace.nspowner
      and not (
        acl.privilege_type = 'USAGE' and not acl.is_grantable
        and (
          (namespace.nspname = 'app' and acl.grantee = authenticated_oid)
          or (namespace.nspname = 'app_rls' and acl.grantee = authenticated_oid)
          or (namespace.nspname = 'app_private' and acl.grantee = app_api_oid)
        )
      )
  )
  then raise exception 'POST_P2_SCHEMA_GRANTS_REJECTED'; end if;

  if not exists (
    select 1 from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = pg_catalog.to_regclass('app.restaurants')
      and attribute.attname = 'time_zone' and attribute.atttypid = 'text'::pg_catalog.regtype
      and attribute.attnotnull and not attribute.attisdropped and not attribute.atthasdef
  ) then raise exception 'POST_P2_TIME_ZONE_COLUMN_REJECTED'; end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger as catalog_trigger
    where catalog_trigger.tgrelid = pg_catalog.to_regclass('app.menu_modifier_groups')
      and catalog_trigger.tgname = 'menu_modifier_groups_command_limit'
      and catalog_trigger.tgfoid = expected_non_definer_functions[2]
      and catalog_trigger.tgenabled = 'O' and not catalog_trigger.tgisinternal
  ) or not exists (
    select 1 from pg_catalog.pg_trigger as catalog_trigger
    where catalog_trigger.tgrelid = pg_catalog.to_regclass('app.restaurants')
      and catalog_trigger.tgname = 'restaurants_time_zone_iana'
      and catalog_trigger.tgfoid = expected_security_definer_functions[28]
      and catalog_trigger.tgenabled = 'O' and not catalog_trigger.tgisinternal
  ) or not exists (
    select 1 from pg_catalog.pg_trigger as catalog_trigger
    where catalog_trigger.tgrelid = pg_catalog.to_regclass('app.orders')
      and catalog_trigger.tgname = 'orders_restaurant_time_zone'
      and catalog_trigger.tgfoid = expected_security_definer_functions[29]
      and catalog_trigger.tgenabled = 'O' and not catalog_trigger.tgisinternal
  ) then raise exception 'POST_P2_TRIGGER_SURFACE_REJECTED'; end if;
end
$audit$;
