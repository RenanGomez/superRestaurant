-- Rollback-only invariants for order account label (app_private.set_order_account_label).
-- Tests set/clear, length 61 rejection, idempotent replay, version CAS, foreign scope rejection,
-- and audit trail recording with server-derived `from`.
begin;

create function pg_temp.t_label_audit(
  p_actor uuid, p_order uuid, p_restaurant uuid, p_branch uuid, p_device uuid, p_now text, p_to text, p_idem text default null
) returns jsonb language sql as $f$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'eventId', gen_random_uuid()::text,
    'idempotencyKey', coalesce(p_idem, gen_random_uuid()::text),
    'restaurantId', p_restaurant::text,
    'branchId', p_branch::text,
    'orderId', p_order::text,
    'actorId', p_actor::text,
    'deviceId', p_device::text,
    'occurredAt', p_now,
    'operation', 'order.account_label_set',
    'entityType', 'order',
    'entityId', p_order::text,
    'payload', pg_catalog.jsonb_build_object('to', p_to)
  )
$f$;

do $account_label_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  foreign_actor uuid := gen_random_uuid();
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_restaurant uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  membership uuid := gen_random_uuid();
  foreign_membership uuid := gen_random_uuid();
  zone_id uuid := gen_random_uuid();
  table_id uuid := gen_random_uuid();
  foreign_zone uuid := gen_random_uuid();
  foreign_table uuid := gen_random_uuid();
  order_a uuid := gen_random_uuid();
  order_b uuid := gen_random_uuid();
  foreign_order uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  now_text text := pg_catalog.to_char(pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  result jsonb;
  replayed jsonb;
  board jsonb;
  work_tray jsonb;
  read_result jsonb;
  audit jsonb;
  audit_key text := gen_random_uuid()::text;
  n integer;
begin
  if actor is null then raise exception 'ACCOUNT_LABEL_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id, name, time_zone) values
    (restaurant, 'rollback restaurant', 'America/Hermosillo'),
    (other_restaurant, 'rollback foreign restaurant', 'America/Hermosillo');
  insert into app.branches(id, restaurant_id, name) values
    (branch, restaurant, 'rollback branch'),
    (other_branch, other_restaurant, 'rollback foreign branch');
  insert into auth.users(id, email) values
    (foreign_actor, 'foreign-actor@invalid.test');
  insert into app.memberships(id, user_id, restaurant_id, branch_id, granted_by) values
    (membership, actor, restaurant, branch, actor),
    (foreign_membership, foreign_actor, other_restaurant, other_branch, actor);
  insert into app.membership_role_grants(membership_id, role_code, granted_by) values
    (membership, 'manager', actor),
    (foreign_membership, 'manager', actor);

  insert into app.dining_zones(id, restaurant_id, branch_id, name, created_by) values
    (zone_id, restaurant, branch, 'Z1', actor),
    (foreign_zone, other_restaurant, other_branch, 'FZ', actor);
  insert into app.dining_tables(
    id, restaurant_id, branch_id, zone_id, name, capacity, shape, layout_x, layout_y, layout_width, layout_height, created_by, updated_by
  ) values
    (table_id, restaurant, branch, zone_id, 'T1', 4, 'square', 0, 0, 2, 2, actor, actor),
    (foreign_table, other_restaurant, other_branch, foreign_zone, 'FT', 4, 'square', 0, 0, 2, 2, actor, actor);

  -- Seed order_a (open), order_b (closed), foreign_order (in other restaurant/branch)
  insert into app.orders(id, restaurant_id, branch_id, table_id, channel, status, aggregate, version, created_by, updated_by)
  values (
    order_a, restaurant, branch, table_id, 'table', 'open',
    pg_catalog.jsonb_build_object(
      'schemaVersion', 1, 'orderId', order_a::text, 'restaurantId', restaurant::text, 'branchId', branch::text,
      'channel', 'table', 'status', 'open', 'timeZone', 'America/Hermosillo', 'currency', 'MXN', 'items', '[]'::jsonb
    ), 1, actor, actor
  ), (
    order_b, restaurant, branch, table_id, 'table', 'closed',
    pg_catalog.jsonb_build_object(
      'schemaVersion', 1, 'orderId', order_b::text, 'restaurantId', restaurant::text, 'branchId', branch::text,
      'channel', 'table', 'status', 'closed', 'timeZone', 'America/Hermosillo', 'currency', 'MXN', 'items', '[]'::jsonb
    ), 1, actor, actor
  ), (
    foreign_order, other_restaurant, other_branch, foreign_table, 'table', 'open',
    pg_catalog.jsonb_build_object(
      'schemaVersion', 1, 'orderId', foreign_order::text, 'restaurantId', other_restaurant::text, 'branchId', other_branch::text,
      'channel', 'table', 'status', 'open', 'timeZone', 'America/Hermosillo', 'currency', 'MXN', 'items', '[]'::jsonb
    ), 1, actor, actor
  );

  -- 1. Non-member actor: forbidden
  audit := pg_temp.t_label_audit(foreign_actor, order_a, restaurant, branch, device, now_text, 'Mesa VIP');
  execute 'set local role app_api';
  result := app_private.set_order_account_label(foreign_actor, 1, order_a, restaurant, branch, 'Mesa VIP', audit);
  execute 'reset role';
  if result->>'status' <> 'forbidden' then raise exception 'ACCOUNT_LABEL_FOREIGN_ACTOR_ACCEPTED'; end if;

  -- 2. Cross-scope order: conflict/forbidden, not mutated
  audit := pg_temp.t_label_audit(actor, foreign_order, restaurant, branch, device, now_text, 'Mesa VIP');
  execute 'set local role app_api';
  result := app_private.set_order_account_label(actor, 1, foreign_order, restaurant, branch, 'Mesa VIP', audit);
  execute 'reset role';
  if result->>'status' not in ('conflict', 'forbidden') then raise exception 'ACCOUNT_LABEL_CROSS_SCOPE_ACCEPTED'; end if;
  if (select account_label from app.orders where id = foreign_order) is not null
    or (select version from app.orders where id = foreign_order) <> 1
  then raise exception 'ACCOUNT_LABEL_CROSS_SCOPE_MUTATED'; end if;

  -- 3. Closed order: conflict, not mutated
  audit := pg_temp.t_label_audit(actor, order_b, restaurant, branch, device, now_text, 'Mesa VIP');
  execute 'set local role app_api';
  result := app_private.set_order_account_label(actor, 1, order_b, restaurant, branch, 'Mesa VIP', audit);
  execute 'reset role';
  if result->>'status' <> 'conflict'
    or (select account_label from app.orders where id = order_b) is not null
    or (select version from app.orders where id = order_b) <> 1
  then raise exception 'ACCOUNT_LABEL_CLOSED_ORDER_ACCEPTED'; end if;

  -- 4. Length 61 characters: rejected
  audit := pg_temp.t_label_audit(actor, order_a, restaurant, branch, device, now_text, repeat('x', 61));
  execute 'set local role app_api';
  result := app_private.set_order_account_label(actor, 1, order_a, restaurant, branch, repeat('x', 61), audit);
  execute 'reset role';
  if result->>'status' <> 'conflict' then raise exception 'ACCOUNT_LABEL_61_CHARS_ACCEPTED'; end if;

  -- 5. Set label ('Juan') from null: saved, version +1, audit recorded with from = null
  audit := pg_temp.t_label_audit(actor, order_a, restaurant, branch, device, now_text, 'Juan', audit_key);
  execute 'set local role app_api';
  result := app_private.set_order_account_label(actor, 1, order_a, restaurant, branch, 'Juan', audit);
  execute 'reset role';
  if result->>'status' <> 'saved' or (result->>'version')::bigint <> 2
    or result#>>'{order,accountLabel}' <> 'Juan'
  then raise exception 'ACCOUNT_LABEL_SET_FAILED'; end if;
  if (select account_label from app.orders where id = order_a) <> 'Juan'
    or (select version from app.orders where id = order_a) <> 2
  then raise exception 'ACCOUNT_LABEL_NOT_PERSISTED'; end if;

  -- Check audit event
  select count(*) into n from app.order_audit_events
  where order_id = order_a and operation = 'order.account_label_set' and result_order_version = 2
    and (event_payload->'payload'->>'from') is null
    and (event_payload->'payload'->>'to') = 'Juan';
  if n <> 1 then raise exception 'ACCOUNT_LABEL_AUDIT_NOT_STORED'; end if;

  -- 6. Replay: exact same command replays
  execute 'set local role app_api';
  replayed := app_private.set_order_account_label(actor, 1, order_a, restaurant, branch, 'Juan', audit);
  execute 'reset role';
  if replayed->>'status' <> 'replayed' or replayed->'order' <> result->'order'
    or (replayed->>'version')::bigint <> 2
  then raise exception 'ACCOUNT_LABEL_REPLAY_MISMATCH'; end if;

  -- 7. Replay with different expectedVersion: conflict
  execute 'set local role app_api';
  result := app_private.set_order_account_label(actor, 2, order_a, restaurant, branch, 'Juan', audit);
  execute 'reset role';
  if result->>'status' <> 'conflict' then raise exception 'ACCOUNT_LABEL_REPLAY_DIFF_VERSION_ACCEPTED'; end if;

  -- 8. Stale expectedVersion: conflict
  audit := pg_temp.t_label_audit(actor, order_a, restaurant, branch, device, now_text, 'Pedro');
  execute 'set local role app_api';
  result := app_private.set_order_account_label(actor, 1, order_a, restaurant, branch, 'Pedro', audit);
  execute 'reset role';
  if result->>'status' <> 'conflict' then raise exception 'ACCOUNT_LABEL_STALE_VERSION_ACCEPTED'; end if;

  -- 9. Clear label (Juan -> null): saved, version 3, audit from = 'Juan', to = null
  audit := pg_temp.t_label_audit(actor, order_a, restaurant, branch, device, now_text, null);
  execute 'set local role app_api';
  result := app_private.set_order_account_label(actor, 2, order_a, restaurant, branch, null, audit);
  execute 'reset role';
  if result->>'status' <> 'saved' or (result->>'version')::bigint <> 3
    or result#>>'{order,accountLabel}' is not null
  then raise exception 'ACCOUNT_LABEL_CLEAR_FAILED'; end if;
  if (select account_label from app.orders where id = order_a) is not null
    or (select version from app.orders where id = order_a) <> 3
  then raise exception 'ACCOUNT_LABEL_NOT_CLEARED'; end if;

  select count(*) into n from app.order_audit_events
  where order_id = order_a and operation = 'order.account_label_set' and result_order_version = 3
    and (event_payload->'payload'->>'from') = 'Juan'
    and (event_payload->'payload'->>'to') is null;
  if n <> 1 then raise exception 'ACCOUNT_LABEL_CLEAR_AUDIT_NOT_STORED'; end if;

  -- Set again to 'Carlos' (version 3 -> 4) to verify readers
  audit := pg_temp.t_label_audit(actor, order_a, restaurant, branch, device, now_text, 'Carlos');
  execute 'set local role app_api';
  result := app_private.set_order_account_label(actor, 3, order_a, restaurant, branch, 'Carlos', audit);
  execute 'reset role';
  if result->>'status' <> 'saved' or (result->>'version')::bigint <> 4 then
    raise exception 'ACCOUNT_LABEL_RESET_FAILED';
  end if;

  -- 10. app_private.read_order emits accountLabel
  execute 'set local role app_api';
  read_result := app_private.read_order(actor, restaurant, branch, order_a);
  execute 'reset role';
  if read_result is null or read_result->>'accountLabel' <> 'Carlos' then
    raise exception 'READ_ORDER_ACCOUNT_LABEL_MISMATCH';
  end if;

  -- 11. app_private.list_table_board emits accountLabel
  execute 'set local role app_api';
  board := app_private.list_table_board(actor, restaurant, branch);
  execute 'reset role';
  if board is null or not exists (
    select 1 from jsonb_array_elements(board->'orders') ord
    where ord->>'orderId' = order_a::text and ord->>'accountLabel' = 'Carlos'
  ) then
    raise exception 'LIST_TABLE_BOARD_ACCOUNT_LABEL_MISMATCH';
  end if;

  -- 12. app_private.list_branch_order_work_items emits accountLabel
  execute 'set local role app_api';
  work_tray := app_private.list_branch_order_work_items(actor, pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('restaurantId', restaurant::text, 'branchId', branch::text),
    'limit', 10,
    'after', null,
    'channel', null
  ));
  execute 'reset role';
  if work_tray is null or not exists (
    select 1 from jsonb_array_elements(work_tray->'orders') ord
    where ord->>'orderId' = order_a::text and ord->>'accountLabel' = 'Carlos'
  ) then
    raise exception 'LIST_BRANCH_ORDER_WORK_ITEMS_ACCOUNT_LABEL_MISMATCH';
  end if;

end
$account_label_tests$;

rollback;
