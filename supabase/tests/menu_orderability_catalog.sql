do $audit$
declare
  trigger_function_oid oid := pg_catalog.to_regprocedure(
    'app_private.enforce_menu_modifier_group_command_limit()'
  );
  trigger_definition text;
  grantee_name text;
begin
  if trigger_function_oid is null then
    raise exception 'MENU_ORDERABILITY_FUNCTION_MISSING';
  end if;

  select pg_catalog.pg_get_functiondef(procedure.oid)
  into trigger_definition
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
  where procedure.oid = trigger_function_oid
    and not procedure.prosecdef
    and procedure.provolatile = 'v'
    and procedure.prorettype = 'trigger'::regtype
    and owner.rolname = 'postgres'
    and owner.rolbypassrls
    and coalesce(pg_catalog.array_to_string(procedure.proconfig, ','), '')
      in ('search_path=', 'search_path=""');
  if trigger_definition is null
    or position('required_group_count >= 50' in trigger_definition) = 0
    or position('modifier_group.active' in trigger_definition) = 0
    or position('modifier_group.minimum_quantity > 0' in trigger_definition) = 0
  then raise exception 'MENU_ORDERABILITY_FUNCTION_REJECTED'; end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedure
    cross join lateral pg_catalog.aclexplode(
      coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) as acl
    where procedure.oid = trigger_function_oid
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then raise exception 'MENU_ORDERABILITY_FUNCTION_PUBLIC'; end if;

  foreach grantee_name in array array['anon','authenticated','service_role','app_api'] loop
    if pg_catalog.has_function_privilege(
      grantee_name, trigger_function_oid, 'EXECUTE'
    ) then raise exception 'MENU_ORDERABILITY_FUNCTION_EXPOSED'; end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as catalog_trigger
    join pg_catalog.pg_class as relation on relation.oid = catalog_trigger.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app'
      and relation.relname = 'menu_modifier_groups'
      and catalog_trigger.tgname = 'menu_modifier_groups_command_limit'
      and catalog_trigger.tgfoid = trigger_function_oid
      and catalog_trigger.tgenabled = 'O'
      and not catalog_trigger.tgisinternal
      and (catalog_trigger.tgtype & 1) = 1
      and (catalog_trigger.tgtype & 2) = 2
      and (catalog_trigger.tgtype & 4) = 4
      and (catalog_trigger.tgtype & 16) = 16
  ) then raise exception 'MENU_ORDERABILITY_TRIGGER_REJECTED'; end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    join pg_catalog.pg_roles as owner on owner.oid = relation.relowner
    where namespace.nspname = 'app'
      and relation.relname = 'menu_modifier_groups'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
      and owner.rolname = 'postgres'
      and owner.rolbypassrls
  ) then raise exception 'MENU_ORDERABILITY_TABLE_SECURITY_REJECTED'; end if;

  if exists (
    select 1
    from app.menu_modifier_groups as modifier_group
    where modifier_group.active and modifier_group.minimum_quantity > 0
    group by modifier_group.restaurant_id, modifier_group.catalog_id, modifier_group.product_id
    having pg_catalog.count(*) > 50
  ) then raise exception 'MENU_ORDERABILITY_EXISTING_DATA_REJECTED'; end if;
end
$audit$;

select 1::integer as schema_version,
  23::integer as secured_tables,
  5::integer as policies,
  22::integer as security_definer_functions;
