do $catalog$
declare
  expected text[] := array['customers','customer_phones','customer_addresses','customer_party_snapshots','customer_fulfillment_snapshots','customer_command_events'];
  table_name text;
begin
  foreach table_name in array expected loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relname = table_name and c.relkind = 'r'
        and c.relrowsecurity and c.relforcerowsecurity
    ) then raise exception 'CUSTOMER_DIRECTORY_RLS_REJECTED:%', table_name; end if;
    if exists (
      select 1 from pg_catalog.pg_policy p
      join pg_catalog.pg_class c on c.oid = p.polrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relname = table_name
    ) then raise exception 'CUSTOMER_DIRECTORY_POLICY_REJECTED:%', table_name; end if;
    if exists (
      select 1 from pg_catalog.aclexplode(coalesce((
        select c.relacl from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app' and c.relname = table_name
      ), pg_catalog.acldefault('r', (select c.relowner from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app' and c.relname = table_name)))) acl
      join pg_catalog.pg_roles role on role.oid = acl.grantee
      where role.rolname in ('public','anon','authenticated','service_role','app_api')
    ) then raise exception 'CUSTOMER_DIRECTORY_GRANT_REJECTED:%', table_name; end if;
  end loop;

  if (select count(*) from pg_catalog.pg_constraint
      where conrelid = pg_catalog.to_regclass('app.customer_addresses')
        and conname in ('customer_addresses_customer_fk','customer_addresses_validation_branch_fk','customer_addresses_validation_valid')) <> 3
  then raise exception 'CUSTOMER_ADDRESS_CONSTRAINTS_REJECTED'; end if;

  if exists (
    select 1 from pg_catalog.pg_index i
    where i.indrelid = pg_catalog.to_regclass('app.customer_phones')
      and i.indisunique and pg_catalog.pg_get_indexdef(i.indexrelid) like '%normalized_value%'
  ) then raise exception 'CUSTOMER_PHONE_MUST_NOT_BE_UNIQUE_BY_VALUE'; end if;

  if (select count(*) from pg_catalog.pg_constraint
      where conrelid = pg_catalog.to_regclass('app.customer_fulfillment_snapshots')
        and conname in ('customer_fulfillment_snapshots_branch_fk','customer_fulfillment_snapshots_address_fk','customer_fulfillment_snapshots_party_fk')) <> 3
  then raise exception 'CUSTOMER_FULFILLMENT_SCOPE_REJECTED'; end if;

  if (select count(*) from pg_catalog.pg_constraint
      where conrelid = pg_catalog.to_regclass('app.customer_command_events')
        and conname in ('customer_command_events_actor_scope_fk','customer_command_events_customer_fk',
          'customer_command_events_idempotency_unique','customer_command_events_version_unique','customer_command_events_result_valid')) <> 5
  then raise exception 'CUSTOMER_COMMAND_JOURNAL_REJECTED'; end if;
end
$catalog$;
