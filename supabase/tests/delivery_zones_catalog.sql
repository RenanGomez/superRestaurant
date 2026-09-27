-- Supplement to the exact delivery zone invariants test. Never apply as a migration.
do $delivery_zones_catalog$
declare
  list_fn oid := pg_catalog.to_regprocedure('app_private.list_delivery_zones(uuid,jsonb)');
  quote_fn oid := pg_catalog.to_regprocedure('app_private.list_active_delivery_zones_for_quote(uuid,uuid)');
  upsert_fn oid := pg_catalog.to_regprocedure('app_private.upsert_delivery_zone(uuid,jsonb)');
  app_api_oid oid := (select oid from pg_catalog.pg_roles where rolname = 'app_api');
begin
  if list_fn is null or quote_fn is null or upsert_fn is null or app_api_oid is null then
    raise exception using errcode = '55000', message = 'DELIVERY_ZONES_REQUIRED_OBJECT_MISSING';
  end if;

  -- Tables exist with the expected shape and RLS+FORCE, no direct grants to any role.
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relname = 'delivery_zones' and c.relrowsecurity and c.relforcerowsecurity
  ) or not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relname = 'delivery_zone_postal_codes' and c.relrowsecurity and c.relforcerowsecurity
  ) or not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relname = 'delivery_zone_command_events' and c.relrowsecurity and c.relforcerowsecurity
  ) then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_TABLE_SHAPE_REJECTED'; end if;

  if pg_catalog.has_table_privilege('public', 'app.delivery_zones', 'SELECT')
    or pg_catalog.has_table_privilege('anon', 'app.delivery_zones', 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', 'app.delivery_zones', 'SELECT')
    or pg_catalog.has_table_privilege('service_role', 'app.delivery_zones', 'SELECT')
    or pg_catalog.has_table_privilege('app_api', 'app.delivery_zones', 'SELECT')
  then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_TABLE_GRANTS_REJECTED'; end if;

  -- Functions: security definer, correct volatility, owned by a bypass-RLS postgres, and a
  -- fixed empty search_path (belt-and-suspenders against schema hijacking).
  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_roles owner on owner.oid = p.proowner
    where p.oid = list_fn and p.prosecdef and p.provolatile = 's'
      and owner.rolname = 'postgres' and owner.rolbypassrls
      and coalesce(pg_catalog.array_to_string(p.proconfig, ','), '') in ('search_path=', 'search_path=""')
  ) then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_LIST_FUNCTION_SHAPE_REJECTED'; end if;

  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_roles owner on owner.oid = p.proowner
    where p.oid = quote_fn and p.prosecdef and p.provolatile = 's'
      and owner.rolname = 'postgres' and owner.rolbypassrls
      and coalesce(pg_catalog.array_to_string(p.proconfig, ','), '') in ('search_path=', 'search_path=""')
  ) then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_QUOTE_FUNCTION_SHAPE_REJECTED'; end if;

  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_roles owner on owner.oid = p.proowner
    where p.oid = upsert_fn and p.prosecdef and p.provolatile = 'v'
      and owner.rolname = 'postgres' and owner.rolbypassrls
      and coalesce(pg_catalog.array_to_string(p.proconfig, ','), '') in ('search_path=', 'search_path=""')
  ) then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_UPSERT_FUNCTION_SHAPE_REJECTED'; end if;

  -- Grants: only app_api may execute; never public/anon/authenticated/service_role.
  if not pg_catalog.has_function_privilege(app_api_oid, list_fn, 'EXECUTE')
    or not pg_catalog.has_function_privilege(app_api_oid, quote_fn, 'EXECUTE')
    or not pg_catalog.has_function_privilege(app_api_oid, upsert_fn, 'EXECUTE')
    or pg_catalog.has_function_privilege('public', list_fn, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', list_fn, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', list_fn, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', list_fn, 'EXECUTE')
    or pg_catalog.has_function_privilege('public', quote_fn, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', quote_fn, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', quote_fn, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', quote_fn, 'EXECUTE')
    or pg_catalog.has_function_privilege('public', upsert_fn, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', upsert_fn, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', upsert_fn, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', upsert_fn, 'EXECUTE')
  then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_GRANTS_REJECTED'; end if;
end
$delivery_zones_catalog$;
