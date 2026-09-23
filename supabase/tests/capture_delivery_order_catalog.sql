-- Supplement to the exact post-continuity global audit. Never apply as a migration.
do $capture_delivery_order_catalog$
declare
  capture_table oid := pg_catalog.to_regclass('app.capture_drafts');
  journal_table oid := pg_catalog.to_regclass('app.capture_command_events');
  snapshot_table oid := pg_catalog.to_regclass('app.order_fulfillment_snapshots');
  clear_trigger_function oid := pg_catalog.to_regprocedure(
    'app_private.clear_capture_delivery_instructions_for_channel()'
  );
  instruction_function oid := pg_catalog.to_regprocedure(
    'app_private.set_capture_delivery_instructions(uuid,jsonb)'
  );
  workspace_function oid := pg_catalog.to_regprocedure(
    'app_private.read_capture_workspace_v2(uuid,jsonb)'
  );
  suggestion_function oid := pg_catalog.to_regprocedure(
    'app_private.list_capture_delivery_instruction_suggestions(uuid,jsonb)'
  );
  confirm_function oid := pg_catalog.to_regprocedure(
    'app_private.confirm_capture_draft(uuid,jsonb,jsonb,jsonb)'
  );
begin
  if capture_table is null or journal_table is null or snapshot_table is null
    or clear_trigger_function is null or instruction_function is null
    or workspace_function is null or suggestion_function is null or confirm_function is null
  then
    raise exception using errcode = '55000', message = 'CAPTURE_DELIVERY_ORDER_REQUIRED_OBJECT_MISSING';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = capture_table and attname = 'delivery_instructions'
      and atttypid = 'text'::pg_catalog.regtype and attnum > 0 and not attisdropped and not attnotnull
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = capture_table and conname = 'capture_drafts_delivery_instructions_valid'
      and contype = 'c' and convalidated
      and pg_catalog.pg_get_constraintdef(oid) like '%char_length(delivery_instructions) >= 1%'
      and pg_catalog.pg_get_constraintdef(oid) like '%char_length(delivery_instructions) <= 500%'
  ) then
    raise exception using errcode = '55000', message = 'CAPTURE_DELIVERY_INSTRUCTIONS_COLUMN_REJECTED';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = capture_table
      and tgname = 'capture_drafts_clear_delivery_instructions_for_channel'
      and tgfoid = clear_trigger_function and tgenabled = 'O' and not tgisinternal
  ) then
    raise exception using errcode = '55000', message = 'CAPTURE_DELIVERY_INSTRUCTIONS_TRIGGER_REJECTED';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = journal_table and conname = 'capture_events_operation_valid'
      and contype = 'c' and convalidated
      and pg_catalog.pg_get_constraintdef(oid) like '%capture.delivery_instructions_changed%'
      and pg_catalog.pg_get_constraintdef(oid) like '%capture.confirmed%'
  ) then
    raise exception using errcode = '55000', message = 'CAPTURE_DELIVERY_ORDER_JOURNAL_REJECTED';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class as relation
    join pg_catalog.pg_roles as owner on owner.oid = relation.relowner
    where relation.oid = snapshot_table and relation.relkind = 'r'
      and relation.relrowsecurity and relation.relforcerowsecurity
      and owner.rolname = 'postgres' and owner.rolbypassrls
  ) or exists (
    select 1 from pg_catalog.pg_policy where polrelid = snapshot_table
  ) or exists (
    select 1 from pg_catalog.pg_class as relation
    cross join lateral pg_catalog.aclexplode(
      coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
    ) as acl
    where relation.oid = snapshot_table and acl.grantee <> relation.relowner
  ) then
    raise exception using errcode = '55000', message = 'ORDER_FULFILLMENT_SNAPSHOT_SECURITY_REJECTED';
  end if;

  if (
    select pg_catalog.count(*) from pg_catalog.pg_constraint
    where conrelid = snapshot_table and convalidated
  ) <> 10 or (
    select pg_catalog.count(*) from pg_catalog.pg_constraint
    where conrelid = snapshot_table and conname in (
      'order_fulfillment_snapshots_pk','order_fulfillment_snapshots_order_fk',
      'order_fulfillment_snapshots_capture_fk','order_fulfillment_snapshots_customer_fk',
      'order_fulfillment_snapshots_confirmed_by_fkey',
      'order_fulfillment_snapshots_capture_unique','order_fulfillment_snapshots_version_valid',
      'order_fulfillment_snapshots_channel_valid','order_fulfillment_snapshots_instructions_valid',
      'order_fulfillment_snapshots_payload_valid'
    )
  ) <> 10 then
    raise exception using errcode = '55000', message = 'ORDER_FULFILLMENT_SNAPSHOT_CONSTRAINTS_REJECTED';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = snapshot_table and conname = 'order_fulfillment_snapshots_order_fk'
      and contype = 'f' and confrelid = pg_catalog.to_regclass('app.orders')
      and pg_catalog.array_length(conkey, 1) = 3 and confdeltype = 'r'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = snapshot_table and conname = 'order_fulfillment_snapshots_capture_fk'
      and contype = 'f' and confrelid = capture_table
      and pg_catalog.array_length(conkey, 1) = 3 and confdeltype = 'r'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = snapshot_table and conname = 'order_fulfillment_snapshots_customer_fk'
      and contype = 'f' and confrelid = pg_catalog.to_regclass('app.customers')
      and pg_catalog.array_length(conkey, 1) = 2 and confdeltype = 'r'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = snapshot_table and conname = 'order_fulfillment_snapshots_confirmed_by_fkey'
      and contype = 'f' and confrelid = pg_catalog.to_regclass('auth.users')
      and pg_catalog.array_length(conkey, 1) = 1 and confdeltype = 'r'
  ) then
    raise exception using errcode = '55000', message = 'ORDER_FULFILLMENT_SNAPSHOT_SCOPE_REJECTED';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_index
    where indrelid = snapshot_table and not indisunique and indpred is not null
      and pg_catalog.pg_get_indexdef(indexrelid) like
        '%(restaurant_id, branch_id, customer_id, confirmed_at DESC, order_id)%'
      and pg_catalog.pg_get_expr(indpred, indrelid) like
        '%customer_id IS NOT NULL%delivery_instructions IS NOT NULL%'
  ) then
    raise exception using errcode = '55000', message = 'ORDER_FULFILLMENT_SNAPSHOT_HISTORY_INDEX_REJECTED';
  end if;

  if (
    select pg_catalog.count(*) from pg_catalog.pg_proc
    where oid in (instruction_function, workspace_function, suggestion_function, confirm_function)
      and prosecdef and provolatile in ('s', 'v')
  ) <> 4 or not exists (
    select 1 from pg_catalog.pg_proc where oid = confirm_function and provolatile = 'v'
  ) or not exists (
    select 1 from pg_catalog.pg_proc where oid = suggestion_function and provolatile = 's'
  ) then
    raise exception using errcode = '55000', message = 'CAPTURE_DELIVERY_ORDER_FUNCTION_SHAPE_REJECTED';
  end if;
end
$capture_delivery_order_catalog$;
