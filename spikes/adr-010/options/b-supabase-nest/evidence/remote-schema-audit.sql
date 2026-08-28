-- ADR-010 option B: read-only remote schema audit.
-- This script reads PostgreSQL catalogs only. It never reads business rows,
-- prints object definitions, or changes persistent state.
begin transaction isolation level repeatable read read only;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

with
expected_schemas(schema_name) as (
  values ('adr010_b'::text), ('adr010_b_private'::text)
),
expected_roles(role_name) as (
  values ('anon'::text), ('authenticated'::text), ('service_role'::text)
),
expected_tables(table_name, is_read_surface, policy_name) as (
  values
    ('restaurants'::text, true,  'restaurants_select_scoped'::text),
    ('branches',         true,  'branches_select_scoped'),
    ('memberships',      true,  'memberships_select_self_scoped'),
    ('bootstrap_users',  false, null),
    ('orders',           true,  'orders_select_scoped'),
    ('order_lines',      true,  'order_lines_select_scoped'),
    ('order_line_snapshots', true, 'snapshots_select_scoped'),
    ('order_idempotency', true, 'idempotency_select_scoped'),
    ('audit_log',        true,  'audit_select_scoped'),
    ('kds_events',       true,  'kds_select_scoped'),
    ('payments',         false, null),
    ('refunds',          false, null),
    ('cash_movements',   false, null),
    ('financial_audit_log', false, null)
),
expected_functions(function_name, identity_arguments) as (
  values
    ('adr010_b_bootstrap_auth_memberships'::text, 'jsonb'::text),
    ('adr010_b_revoke_bootstrap_membership', 'uuid, uuid'),
    ('adr010_b_cleanup_auth_bootstrap', 'jsonb'),
    ('adr010_b_create_order', 'jsonb'),
    ('adr010_b_prevent_financial_mutation', ''),
    ('adr010_b_create_cash_payment', 'jsonb'),
    ('adr010_b_refund_cash_payment', 'jsonb'),
    ('adr010_b_claim_device_sequence', 'text, bigint')
),
expected_schema_acl(schema_name, grantee, privilege_type) as (
  values
    ('adr010_b'::text, 'anon'::text, 'USAGE'::text),
    ('adr010_b', 'authenticated', 'USAGE')
),
expected_table_acl(table_name, grantee, privilege_type) as (
  select table_name, 'authenticated'::text, 'SELECT'::text
  from expected_tables
  where is_read_surface
),
actual_schema_acl as (
  select
    namespace.nspname::text as schema_name,
    coalesce(grantee.rolname, 'PUBLIC')::text as grantee,
    privilege.privilege_type::text as privilege_type
  from pg_catalog.pg_namespace namespace
  cross join lateral pg_catalog.aclexplode(
    coalesce(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))
  ) privilege
  left join pg_catalog.pg_roles grantee on grantee.oid = privilege.grantee
  where namespace.nspname in (select schema_name from expected_schemas)
    and (privilege.grantee = 0 or grantee.rolname in (select role_name from expected_roles))
),
actual_table_acl as (
  select
    relation.relname::text as table_name,
    coalesce(grantee.rolname, 'PUBLIC')::text as grantee,
    privilege.privilege_type::text as privilege_type
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  cross join lateral pg_catalog.aclexplode(
    coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
  ) privilege
  left join pg_catalog.pg_roles grantee on grantee.oid = privilege.grantee
  where namespace.nspname = 'adr010_b'
    and relation.relkind in ('r', 'p')
    and (privilege.grantee = 0 or grantee.rolname in (select role_name from expected_roles))
),
actual_sequence_acl as (
  select
    relation.relname::text as sequence_name,
    coalesce(grantee.rolname, 'PUBLIC')::text as grantee,
    privilege.privilege_type::text as privilege_type
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  cross join lateral pg_catalog.aclexplode(
    coalesce(relation.relacl, pg_catalog.acldefault('S', relation.relowner))
  ) privilege
  left join pg_catalog.pg_roles grantee on grantee.oid = privilege.grantee
  where namespace.nspname = 'adr010_b'
    and relation.relkind = 'S'
    and (privilege.grantee = 0 or grantee.rolname in (select role_name from expected_roles))
),
actual_functions as (
  select
    catalog_procedure.oid,
    catalog_procedure.proname::text as function_name,
    pg_catalog.oidvectortypes(catalog_procedure.proargtypes)::text as identity_arguments,
    catalog_procedure.prosecdef,
    exists (
      select 1
      from unnest(coalesce(catalog_procedure.proconfig, array[]::text[])) setting
      where setting = 'search_path=""'
    ) as has_empty_search_path
  from pg_catalog.pg_proc catalog_procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = catalog_procedure.pronamespace
  where namespace.nspname = 'adr010_b_private'
),
actual_function_acl as (
  select
    actual_function.function_name,
    actual_function.identity_arguments,
    coalesce(grantee.rolname, 'PUBLIC')::text as grantee,
    privilege.privilege_type::text as privilege_type
  from actual_functions actual_function
  join pg_catalog.pg_proc catalog_procedure on catalog_procedure.oid = actual_function.oid
  cross join lateral pg_catalog.aclexplode(
    coalesce(catalog_procedure.proacl, pg_catalog.acldefault('f', catalog_procedure.proowner))
  ) privilege
  left join pg_catalog.pg_roles grantee on grantee.oid = privilege.grantee
  where privilege.grantee = 0
     or grantee.rolname in (select role_name from expected_roles)
),
actual_policies as (
  select
    relation.relname::text as table_name,
    catalog_policy.polname::text as policy_name,
    catalog_policy.polcmd,
    catalog_policy.polpermissive,
    catalog_policy.polroles,
    lower(pg_catalog.pg_get_expr(catalog_policy.polqual, catalog_policy.polrelid)) as using_expression,
    catalog_policy.polwithcheck is null as has_no_with_check
  from pg_catalog.pg_policy catalog_policy
  join pg_catalog.pg_class relation on relation.oid = catalog_policy.polrelid
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'adr010_b'
),
expected_policy_validation as (
  select
    expected.table_name,
    expected.policy_name,
    actual.policy_name is not null
      and actual.polcmd = 'r'
      and actual.polpermissive
      and actual.has_no_with_check
      and actual.polroles = array[(select oid from pg_catalog.pg_roles where rolname = 'authenticated')]::oid[]
      and actual.using_expression like '%auth.uid()%'
      and actual.using_expression like '%revoked_at is null%'
      and (
        (expected.table_name = 'memberships' and actual.using_expression like '%user_id%')
        or (expected.table_name = 'restaurants' and actual.using_expression like '%restaurant_id%')
        or (
          expected.table_name not in ('memberships', 'restaurants')
          and actual.using_expression like '%restaurant_id%'
          and actual.using_expression like '%branch_id%'
        )
      ) as is_valid
  from expected_tables expected
  left join actual_policies actual
    on actual.table_name = expected.table_name
   and actual.policy_name = expected.policy_name
  where expected.is_read_surface
),
constraint_columns as (
  select
    relation.relname::text as table_name,
    catalog_constraint.contype,
    referenced.relname::text as referenced_table,
    array_agg(local_attribute.attname::text order by constraint_key.ordinality) as local_columns,
    array_agg(referenced_attribute.attname::text order by constraint_key.ordinality)
      filter (where referenced_attribute.attname is not null) as referenced_columns
  from pg_catalog.pg_constraint catalog_constraint
  join pg_catalog.pg_class relation on relation.oid = catalog_constraint.conrelid
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  left join pg_catalog.pg_class referenced on referenced.oid = catalog_constraint.confrelid
  cross join lateral unnest(catalog_constraint.conkey, catalog_constraint.confkey)
    with ordinality as constraint_key(local_attribute_number, referenced_attribute_number, ordinality)
  join pg_catalog.pg_attribute local_attribute
    on local_attribute.attrelid = relation.oid
   and local_attribute.attnum = constraint_key.local_attribute_number
  left join pg_catalog.pg_attribute referenced_attribute
    on referenced_attribute.attrelid = referenced.oid
   and referenced_attribute.attnum = constraint_key.referenced_attribute_number
  where namespace.nspname = 'adr010_b'
    and catalog_constraint.contype in ('f', 'u')
  group by relation.relname, catalog_constraint.contype, referenced.relname, catalog_constraint.oid
),
expected_tenant_foreign_keys(table_name, local_columns, referenced_table, referenced_columns) as (
  values
    ('memberships'::text, array['restaurant_id', 'branch_id']::text[], 'branches'::text, array['restaurant_id', 'id']::text[]),
    ('orders', array['restaurant_id', 'branch_id'], 'branches', array['restaurant_id', 'id']),
    ('order_lines', array['restaurant_id', 'branch_id', 'order_id'], 'orders', array['restaurant_id', 'branch_id', 'id']),
    ('order_line_snapshots', array['restaurant_id', 'branch_id', 'line_id'], 'order_lines', array['restaurant_id', 'branch_id', 'id']),
    ('order_idempotency', array['restaurant_id', 'branch_id', 'order_id'], 'orders', array['restaurant_id', 'branch_id', 'id']),
    ('audit_log', array['restaurant_id', 'branch_id', 'order_id'], 'orders', array['restaurant_id', 'branch_id', 'id']),
    ('kds_events', array['restaurant_id', 'branch_id', 'order_id'], 'orders', array['restaurant_id', 'branch_id', 'id']),
    ('payments', array['restaurant_id', 'branch_id', 'order_id'], 'orders', array['restaurant_id', 'branch_id', 'id']),
    ('refunds', array['restaurant_id', 'branch_id', 'order_id'], 'orders', array['restaurant_id', 'branch_id', 'id']),
    ('refunds', array['restaurant_id', 'branch_id', 'payment_id', 'order_id'], 'payments', array['restaurant_id', 'branch_id', 'id', 'order_id'])
),
expected_idempotency_uniques(table_name, local_columns) as (
  values
    ('orders'::text, array['restaurant_id', 'branch_id', 'idempotency_key']::text[]),
    ('order_idempotency', array['restaurant_id', 'branch_id', 'idempotency_key']::text[]),
    ('payments', array['restaurant_id', 'branch_id', 'idempotency_key']::text[]),
    ('refunds', array['restaurant_id', 'branch_id', 'idempotency_key']::text[])
),
request_payload_column as (
  select
    attribute.attnotnull,
    catalog_type.typname = 'jsonb' as is_jsonb
  from pg_catalog.pg_attribute attribute
  join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  join pg_catalog.pg_type catalog_type on catalog_type.oid = attribute.atttypid
  where namespace.nspname = 'adr010_b'
    and relation.relname in ('orders', 'payments', 'refunds')
    and attribute.attname = 'request_payload'
    and attribute.attnum > 0
    and not attribute.attisdropped
),
request_payload_check as (
  select count(*)::bigint as matching_count
  from pg_catalog.pg_constraint catalog_constraint
  join pg_catalog.pg_class relation on relation.oid = catalog_constraint.conrelid
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'adr010_b'
    and relation.relname in ('orders', 'payments', 'refunds')
    and catalog_constraint.contype = 'c'
    and lower(pg_catalog.pg_get_constraintdef(catalog_constraint.oid)) like '%jsonb_typeof(request_payload)%'
    and lower(pg_catalog.pg_get_constraintdef(catalog_constraint.oid)) like '%''object''%'
),
cash_movement_global_sequence_index as (
  select count(*)::bigint as matching_count
  from pg_catalog.pg_index index_metadata
  join pg_catalog.pg_class index_relation on index_relation.oid = index_metadata.indexrelid
  join pg_catalog.pg_class table_relation on table_relation.oid = index_metadata.indrelid
  join pg_catalog.pg_namespace namespace on namespace.oid = table_relation.relnamespace
  where namespace.nspname = 'adr010_b'
    and table_relation.relname = 'cash_movements'
    and index_relation.relname = 'cash_movements_device_sequence_global_uidx'
    and index_metadata.indisunique
    and index_metadata.indpred is null
    and index_metadata.indexprs is null
    and (
      select array_agg(attribute.attname::text order by index_key.ordinality)
      from unnest(index_metadata.indkey) with ordinality index_key(attnum, ordinality)
      join pg_catalog.pg_attribute attribute
        on attribute.attrelid = table_relation.oid
       and attribute.attnum = index_key.attnum
    ) = array['device_id', 'local_sequence']::text[]
),
checks(check_name, passed, observed_count, expected_count) as (
  select
    'expected_roles_present',
    count(*) = 3,
    count(*)::bigint,
    3::bigint
  from pg_catalog.pg_roles
  where rolname in (select role_name from expected_roles)

  union all
  select
    'schemas_present_exactly',
    count(*) = 2,
    count(*)::bigint,
    2::bigint
  from pg_catalog.pg_namespace
  where nspname in (select schema_name from expected_schemas)

  union all
  select
    'expected_tables_present',
    count(*) = 14,
    count(*)::bigint,
    14::bigint
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'adr010_b'
    and relation.relkind in ('r', 'p')
    and relation.relname in (select table_name from expected_tables)

  union all
  select
    'unexpected_tables_absent',
    count(*) = 0,
    count(*)::bigint,
    0::bigint
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname in (select schema_name from expected_schemas)
    and relation.relkind in ('r', 'p')
    and not ((namespace.nspname = 'adr010_b' and relation.relname in (select table_name from expected_tables))
      or (namespace.nspname = 'adr010_b_private' and relation.relname = 'device_sequences'))

  union all
  select
    'all_expected_tables_rls_enabled',
    count(*) = 14,
    count(*)::bigint,
    14::bigint
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  join expected_tables expected on expected.table_name = relation.relname
  where namespace.nspname = 'adr010_b' and relation.relrowsecurity

  union all
  select
    'all_expected_tables_rls_forced',
    count(*) = 14,
    count(*)::bigint,
    14::bigint
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  join expected_tables expected on expected.table_name = relation.relname
  where namespace.nspname = 'adr010_b' and relation.relforcerowsecurity

  union all
  select
    'device_sequence_cursor_present_and_rls',
    count(*) = 1 and bool_and(relation.relrowsecurity and relation.relforcerowsecurity),
    count(*)::bigint,
    1::bigint
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'adr010_b_private'
    and relation.relname = 'device_sequences'
    and relation.relkind in ('r', 'p')

  union all
  select
    'device_sequence_cursor_data_api_writes_absent',
    count(*) = 0,
    count(*)::bigint,
    0::bigint
  from expected_roles data_api_role
  where pg_catalog.has_table_privilege(data_api_role.role_name, 'adr010_b_private.device_sequences', 'INSERT')
     or pg_catalog.has_table_privilege(data_api_role.role_name, 'adr010_b_private.device_sequences', 'UPDATE')
     or pg_catalog.has_table_privilege(data_api_role.role_name, 'adr010_b_private.device_sequences', 'DELETE')

  union all
  select
    'select_policies_exact_and_scoped',
    count(*) filter (where is_valid) = 9,
    count(*) filter (where is_valid)::bigint,
    9::bigint
  from expected_policy_validation

  union all
  select
    'unexpected_policies_absent',
    count(*) = 0,
    count(*)::bigint,
    0::bigint
  from actual_policies actual
  where not exists (
    select 1 from expected_tables expected
    where expected.table_name = actual.table_name
      and expected.policy_name = actual.policy_name
  )

  union all
  select
    'schema_grants_exact_for_data_api_roles',
    not exists (select schema_name, grantee, privilege_type from actual_schema_acl except select * from expected_schema_acl)
      and not exists (select * from expected_schema_acl except select schema_name, grantee, privilege_type from actual_schema_acl),
    (select count(*) from actual_schema_acl)::bigint,
    (select count(*) from expected_schema_acl)::bigint

  union all
  select
    'table_grants_exact_for_data_api_roles',
    not exists (select table_name, grantee, privilege_type from actual_table_acl except select * from expected_table_acl)
      and not exists (select * from expected_table_acl except select table_name, grantee, privilege_type from actual_table_acl),
    (select count(*) from actual_table_acl)::bigint,
    (select count(*) from expected_table_acl)::bigint

  union all
  select
    'sequence_grants_absent_for_data_api_roles',
    count(*) = 0,
    count(*)::bigint,
    0::bigint
  from actual_sequence_acl

  union all
  select
    'bootstrap_users_unreadable_by_data_api_roles',
    count(*) = 0,
    count(*)::bigint,
    0::bigint
  from actual_table_acl
  where table_name = 'bootstrap_users' and privilege_type = 'SELECT'

  union all
  select
    'bootstrap_users_effectively_unreadable_by_data_api_roles',
    count(*) filter (
      where pg_catalog.has_table_privilege(role_name, 'adr010_b.bootstrap_users', 'SELECT')
    ) = 0,
    count(*) filter (
      where pg_catalog.has_table_privilege(role_name, 'adr010_b.bootstrap_users', 'SELECT')
    )::bigint,
    0::bigint
  from expected_roles

  union all
  select
    'private_functions_present_exactly',
    count(*) = 8
      and count(*) filter (where expected.function_name is not null) = 8,
    count(*) filter (where expected.function_name is not null)::bigint,
    8::bigint
  from actual_functions actual
  left join expected_functions expected
    on expected.function_name = actual.function_name
   and expected.identity_arguments = actual.identity_arguments

  union all
  select
    'exposed_schema_functions_absent',
    count(*) = 0,
    count(*)::bigint,
    0::bigint
  from pg_catalog.pg_proc catalog_procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = catalog_procedure.pronamespace
  where namespace.nspname = 'adr010_b'

  union all
  select
    'private_functions_security_definer',
    count(*) filter (where actual.prosecdef) = 7,
    count(*) filter (where actual.prosecdef)::bigint,
    7::bigint
  from actual_functions actual
  join expected_functions expected
    on expected.function_name = actual.function_name
   and expected.identity_arguments = actual.identity_arguments

  union all
  select
    'private_functions_empty_search_path',
    count(*) filter (where actual.has_empty_search_path) = 8,
    count(*) filter (where actual.has_empty_search_path)::bigint,
    8::bigint
  from actual_functions actual
  join expected_functions expected
    on expected.function_name = actual.function_name
   and expected.identity_arguments = actual.identity_arguments

  union all
  select
    'private_function_execute_grants_absent',
    count(*) = 0,
    count(*)::bigint,
    0::bigint
  from actual_function_acl
  where privilege_type = 'EXECUTE'

  union all
  select
    'private_function_effective_execute_absent_for_data_api_roles',
    count(*) = 0,
    count(*)::bigint,
    0::bigint
  from actual_functions actual
  cross join expected_roles data_api_role
  where pg_catalog.has_function_privilege(data_api_role.role_name, actual.oid, 'EXECUTE')

  union all
  select
    'tenant_composite_foreign_keys_present',
    count(*) = 10,
    count(*)::bigint,
    10::bigint
  from expected_tenant_foreign_keys expected
  where exists (
    select 1 from constraint_columns actual
    where actual.contype = 'f'
      and actual.table_name = expected.table_name
      and actual.local_columns = expected.local_columns
      and actual.referenced_table = expected.referenced_table
      and actual.referenced_columns = expected.referenced_columns
  )

  union all
  select
    'idempotency_unique_constraints_present',
    count(*) = 4,
    count(*)::bigint,
    4::bigint
  from expected_idempotency_uniques expected
  where exists (
    select 1 from constraint_columns actual
    where actual.contype = 'u'
      and actual.table_name = expected.table_name
      and actual.local_columns = expected.local_columns
  )

  union all
  select
    'request_payload_jsonb_not_null',
    count(*) filter (where is_jsonb and attnotnull) = 3,
    count(*) filter (where is_jsonb and attnotnull)::bigint,
    3::bigint
  from request_payload_column

  union all
  select
    'request_payload_object_check_present',
    matching_count >= 3,
    matching_count,
    3::bigint
  from request_payload_check

  union all
  select
    'cash_movements_global_device_sequence_unique_index_present',
    matching_count = 1,
    matching_count,
    1::bigint
  from cash_movement_global_sequence_index

  union all
  select
    'expected_migration_versions_applied_once',
    count(*) = 5 and count(distinct version::text) = 5,
    count(*)::bigint,
    5::bigint
  from supabase_migrations.schema_migrations
  where version::text in ('20260825000100', '20260826000100', '20260827000100', '20260828000100', '20260829000100')
)
select check_name, passed, observed_count, expected_count
from checks
order by check_name;

rollback;
