do $audit$
declare
  restaurant_trigger_oid oid := pg_catalog.to_regprocedure('app_private.enforce_restaurant_time_zone()');
  order_trigger_oid oid := pg_catalog.to_regprocedure('app_private.enforce_order_restaurant_time_zone()');
  context_function_oid oid := pg_catalog.to_regprocedure(
    'app_private.read_branch_operational_context(uuid,uuid,uuid)'
  );
  function_definition text;
  grantee_name text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app'
      and relation.relname = 'restaurants'
      and attribute.attname = 'time_zone'
      and attribute.atttypid = 'text'::regtype
      and attribute.attnotnull
      and not attribute.attisdropped
      and not attribute.atthasdef
  ) then raise exception 'RESTAURANT_TIME_ZONE_COLUMN_REJECTED'; end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    join pg_catalog.pg_class as relation on relation.oid = constraint_record.conrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app'
      and relation.relname = 'restaurants'
      and constraint_record.conname = 'restaurants_time_zone_shape'
      and constraint_record.contype = 'c'
      and constraint_record.convalidated
  ) then raise exception 'RESTAURANT_TIME_ZONE_CONSTRAINT_REJECTED'; end if;

  if restaurant_trigger_oid is null or order_trigger_oid is null or context_function_oid is null then
    raise exception 'RESTAURANT_TIME_ZONE_FUNCTION_MISSING';
  end if;

  select pg_catalog.pg_get_functiondef(procedure.oid)
  into function_definition
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
  where procedure.oid = restaurant_trigger_oid
    and procedure.prosecdef
    and procedure.provolatile = 'v'
    and procedure.prorettype = 'trigger'::regtype
    and owner.rolname = 'postgres'
    and owner.rolbypassrls
    and coalesce(pg_catalog.array_to_string(procedure.proconfig, ','), '')
      in ('search_path=', 'search_path=""');
  if function_definition is null
    or position('pg_catalog.pg_timezone_names' in function_definition) = 0
    or position('time_zone.name = new.time_zone' in function_definition) = 0
  then raise exception 'RESTAURANT_TIME_ZONE_VALIDATOR_REJECTED'; end if;

  select pg_catalog.pg_get_functiondef(procedure.oid)
  into function_definition
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
  where procedure.oid = order_trigger_oid
    and procedure.prosecdef
    and procedure.provolatile = 'v'
    and procedure.prorettype = 'trigger'::regtype
    and owner.rolname = 'postgres'
    and owner.rolbypassrls
    and coalesce(pg_catalog.array_to_string(procedure.proconfig, ','), '')
      in ('search_path=', 'search_path=""');
  if function_definition is null
    or position('restaurant.id = new.restaurant_id' in function_definition) = 0
    or position('new.aggregate ->> ''timeZone'' is distinct from authoritative_time_zone' in function_definition) = 0
  then raise exception 'ORDER_TIME_ZONE_GUARD_REJECTED'; end if;

  select pg_catalog.pg_get_functiondef(procedure.oid)
  into function_definition
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
  where procedure.oid = context_function_oid
    and procedure.prosecdef
    and procedure.provolatile = 's'
    and procedure.prorettype = 'jsonb'::regtype
    and owner.rolname = 'postgres'
    and owner.rolbypassrls
    and coalesce(pg_catalog.array_to_string(procedure.proconfig, ','), '')
      in ('search_path=', 'search_path=""');
  if function_definition is null
    or position('membership.user_id = p_actor_id' in function_definition) = 0
    or position('membership.restaurant_id = p_restaurant_id' in function_definition) = 0
    or position('membership.branch_id = p_branch_id' in function_definition) = 0
    or position('restaurant.disabled_at is null' in function_definition) = 0
    or position('branch.disabled_at is null' in function_definition) = 0
    or position('membership.revoked_at is null' in function_definition) = 0
    or position('role_grant.revoked_at is null' in function_definition) = 0
    or position('''timeZone'', restaurant.time_zone' in function_definition) = 0
  then raise exception 'BRANCH_OPERATIONAL_CONTEXT_FUNCTION_REJECTED'; end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger as catalog_trigger
    join pg_catalog.pg_class as relation on relation.oid = catalog_trigger.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app'
      and relation.relname = 'restaurants'
      and catalog_trigger.tgname = 'restaurants_time_zone_iana'
      and catalog_trigger.tgfoid = restaurant_trigger_oid
      and catalog_trigger.tgenabled = 'O'
      and not catalog_trigger.tgisinternal
      and (catalog_trigger.tgtype & 1) = 1
      and (catalog_trigger.tgtype & 2) = 2
      and (catalog_trigger.tgtype & 4) = 4
      and (catalog_trigger.tgtype & 16) = 16
  ) then raise exception 'RESTAURANT_TIME_ZONE_TRIGGER_REJECTED'; end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger as catalog_trigger
    join pg_catalog.pg_class as relation on relation.oid = catalog_trigger.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app'
      and relation.relname = 'orders'
      and catalog_trigger.tgname = 'orders_restaurant_time_zone'
      and catalog_trigger.tgfoid = order_trigger_oid
      and catalog_trigger.tgenabled = 'O'
      and not catalog_trigger.tgisinternal
      and (catalog_trigger.tgtype & 1) = 1
      and (catalog_trigger.tgtype & 2) = 2
      and (catalog_trigger.tgtype & 4) = 4
      and (catalog_trigger.tgtype & 16) = 0
  ) then raise exception 'ORDER_TIME_ZONE_TRIGGER_REJECTED'; end if;

  foreach grantee_name in array array['public','anon','authenticated','service_role'] loop
    if pg_catalog.has_function_privilege(grantee_name, context_function_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege(grantee_name, restaurant_trigger_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege(grantee_name, order_trigger_oid, 'EXECUTE')
    then raise exception 'RESTAURANT_TIME_ZONE_FUNCTION_EXPOSED'; end if;
  end loop;

  if not pg_catalog.has_function_privilege('app_api', context_function_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('app_api', restaurant_trigger_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('app_api', order_trigger_oid, 'EXECUTE')
  then raise exception 'RESTAURANT_TIME_ZONE_APP_API_GRANTS_REJECTED'; end if;

  if exists (
    select 1 from app.restaurants as restaurant
    where not exists (
      select 1 from pg_catalog.pg_timezone_names as time_zone
      where time_zone.name = restaurant.time_zone
    )
  ) then raise exception 'RESTAURANT_TIME_ZONE_EXISTING_DATA_REJECTED'; end if;

  if exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app'
      and relation.relname in ('restaurants','orders')
      and (not relation.relrowsecurity or not relation.relforcerowsecurity)
  ) then raise exception 'RESTAURANT_TIME_ZONE_RLS_REJECTED'; end if;
end
$audit$;

select 1::integer as schema_version,
  23::integer as secured_tables,
  5::integer as policies,
  25::integer as security_definer_functions;
