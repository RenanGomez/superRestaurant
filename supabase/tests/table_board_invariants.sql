-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises app_private.open_operational_shift (journal + idempotent replay, server-side opened_at),
-- app_private.assign_order_waiter (branch isolation, cross-scope order, waiter membership, active
-- status only, optimistic version, server-derived audit `from`, replay) and
-- app_private.list_table_board (branch isolation, derived occupancy, explicit limit_exceeded).
begin;
create function pg_temp.t_audit(
  p_actor uuid, p_order uuid, p_restaurant uuid, p_branch uuid, p_device uuid, p_now text, p_to text
) returns jsonb language sql as $f$
  select pg_catalog.jsonb_build_object(
    'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'restaurantId',p_restaurant::text,'branchId',p_branch::text,'orderId',p_order::text,'actorId',p_actor::text,
    'deviceId',p_device::text,'occurredAt',p_now,'operation','order.waiter_assigned','entityType','order',
    'entityId',p_order::text,'payload',pg_catalog.jsonb_build_object('to',p_to)
  )
$f$;
do $table_board_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  waiter uuid := gen_random_uuid();
  waiter_b uuid := gen_random_uuid();
  foreign_waiter uuid := gen_random_uuid();
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_restaurant uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  membership uuid := gen_random_uuid();
  waiter_membership uuid := gen_random_uuid();
  waiter_b_membership uuid := gen_random_uuid();
  foreign_membership uuid := gen_random_uuid();
  zone_id uuid := gen_random_uuid();
  table_id uuid := gen_random_uuid();
  foreign_zone uuid := gen_random_uuid();
  foreign_table uuid := gen_random_uuid();
  v_shift uuid := gen_random_uuid();
  order_a uuid := gen_random_uuid();
  order_b uuid := gen_random_uuid();
  foreign_order uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  now_text text := pg_catalog.to_char(pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  future_text text := pg_catalog.to_char((pg_catalog.clock_timestamp() + interval '2 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  result jsonb;
  replayed jsonb;
  board jsonb;
  shift_audit jsonb;
  assign_audit jsonb;
  reassign_audit jsonb;
  past_text text;
  null_order uuid := gen_random_uuid();
  null_order_json jsonb;
  null_audit jsonb;
  deleted_table uuid := gen_random_uuid();
  deleted_order uuid := gen_random_uuid();
  slow_order uuid := gen_random_uuid();
  closed_order uuid := gen_random_uuid();
  audit jsonb;
  n integer;
begin
  if actor is null then raise exception 'TABLE_BOARD_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone) values
    (restaurant,'rollback-only table board','America/Hermosillo'),
    (other_restaurant,'rollback-only table board foreign','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (branch,restaurant,'rollback-only table board branch'),
    (other_branch,other_restaurant,'rollback-only table board foreign branch');
  insert into auth.users(id,email) values
    (waiter,'local-table-board-waiter@invalid.test'),
    (waiter_b,'local-table-board-waiter-b@invalid.test'),
    (foreign_waiter,'local-table-board-foreign-waiter@invalid.test');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values
    (membership,actor,restaurant,branch,actor),
    (waiter_membership,waiter,restaurant,branch,actor),
    (waiter_b_membership,waiter_b,restaurant,branch,actor),
    (foreign_membership,foreign_waiter,other_restaurant,other_branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values
    (membership,'manager',actor),
    (waiter_membership,'waiter',actor),
    (waiter_b_membership,'waiter',actor),
    (foreign_membership,'waiter',actor);

  insert into app.dining_zones(id,restaurant_id,branch_id,name,created_by) values
    (zone_id,restaurant,branch,'rollback-only zone',actor),
    (foreign_zone,other_restaurant,other_branch,'rollback-only foreign zone',actor);
  insert into app.dining_tables(
    id,restaurant_id,branch_id,zone_id,name,capacity,shape,layout_x,layout_y,layout_width,layout_height,created_by,updated_by
  ) values
    (table_id,restaurant,branch,zone_id,'T1',4,'square',0,0,2,2,actor,actor),
    (foreign_table,other_restaurant,other_branch,foreign_zone,'F1',4,'square',0,0,2,2,actor,actor);

  -- open_operational_shift. occurredAt is a device clock two days ahead: opened_at must still be
  -- the server clock so create_operational_order's `opened_at <= occurred_at` cannot be blocked.
  shift_audit := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'restaurantId',restaurant::text,'branchId',branch::text,'actorId',actor::text,
    'deviceId',device::text,'occurredAt',future_text,'operation','operational_shift.opened',
    'entityType','operational_shift','entityId',v_shift::text
  );
  audit := pg_catalog.jsonb_set(shift_audit,'{actorId}',to_jsonb(foreign_waiter::text));
  execute 'set local role app_api';
  result := app_private.open_operational_shift(foreign_waiter,restaurant,branch,v_shift,'Turno 1',audit);
  execute 'reset role';
  if result->>'status'<>'forbidden' then raise exception 'TABLE_BOARD_SHIFT_OPEN_FOREIGN_ACCEPTED'; end if;

  execute 'set local role app_api';
  result := app_private.open_operational_shift(actor,restaurant,branch,v_shift,'Turno 1',shift_audit);
  execute 'reset role';
  if result->>'status'<>'saved' then raise exception 'TABLE_BOARD_SHIFT_OPEN_REJECTED'; end if;
  if (select opened_at from app.operational_shifts where id=v_shift) > pg_catalog.clock_timestamp()
  then raise exception 'TABLE_BOARD_SHIFT_OPENED_AT_NOT_SERVER_CLOCK'; end if;
  select count(*) into n from app.operational_shift_events where shift_id=v_shift and idempotency_key=shift_audit->>'idempotencyKey';
  if n<>1 then raise exception 'TABLE_BOARD_SHIFT_EVENT_NOT_PERSISTED'; end if;

  execute 'set local role app_api';
  replayed := app_private.open_operational_shift(actor,restaurant,branch,v_shift,'Turno 1',shift_audit);
  execute 'reset role';
  if replayed->>'status'<>'replayed' then raise exception 'TABLE_BOARD_SHIFT_REOPEN_NOT_REPLAYED'; end if;
  select count(*) into n from app.operational_shift_events where restaurant_id=restaurant;
  if n<>1 then raise exception 'TABLE_BOARD_SHIFT_REPLAY_DUPLICATED_EVENT'; end if;

  execute 'set local role app_api';
  result := app_private.open_operational_shift(actor,restaurant,branch,v_shift,'Turno distinto',shift_audit);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'TABLE_BOARD_SHIFT_KEY_REUSE_ACCEPTED'; end if;

  audit := pg_catalog.jsonb_set(pg_catalog.jsonb_set(shift_audit,'{eventId}',to_jsonb(gen_random_uuid()::text)),
    '{idempotencyKey}',to_jsonb(gen_random_uuid()::text));
  execute 'set local role app_api';
  result := app_private.open_operational_shift(actor,restaurant,branch,gen_random_uuid(),'Turno 2',audit);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'TABLE_BOARD_SHIFT_SECOND_OPEN_NOT_REJECTED'; end if;

  -- create_operational_order: membership is the server-side shift state only. A device clock two
  -- days behind (occurredAt before the shift's server opened_at) still creates the order in the
  -- open shift; once the shift is closed, creation is rejected.
  past_text := pg_catalog.to_char((pg_catalog.clock_timestamp() - interval '2 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  execute 'set local role app_api';
  result := app_private.create_operational_order(actor,v_shift,
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'orderId',slow_order::text,'restaurantId',restaurant::text,'branchId',branch::text,
      'channel','counter','currency','MXN','timeZone','America/Hermosillo','status','draft','items','[]'::jsonb),
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
      'restaurantId',restaurant::text,'branchId',branch::text,'orderId',slow_order::text,'actorId',actor::text,
      'deviceId',device::text,'occurredAt',past_text,'operation','order.created','entityType','order',
      'entityId',slow_order::text,'to','draft'));
  execute 'reset role';
  if result->>'status'<>'saved' then raise exception 'TABLE_BOARD_SLOW_CLOCK_ORDER_REJECTED'; end if;
  select count(*) into n from app.order_operational_shifts where order_id=slow_order and shift_id=v_shift;
  if n<>1 then raise exception 'TABLE_BOARD_SLOW_CLOCK_ORDER_NOT_LINKED'; end if;

  -- p_shift_id null: SQL resolves the single open shift, after the command-identity lookup.
  null_order_json := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',null_order::text,'restaurantId',restaurant::text,'branchId',branch::text,
    'channel','counter','currency','MXN','timeZone','America/Hermosillo','status','draft','items','[]'::jsonb);
  null_audit := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'restaurantId',restaurant::text,'branchId',branch::text,'orderId',null_order::text,'actorId',actor::text,
    'deviceId',device::text,'occurredAt',now_text,'operation','order.created','entityType','order',
    'entityId',null_order::text,'to','draft');
  execute 'set local role app_api';
  result := app_private.create_operational_order(actor,null,null_order_json,null_audit);
  execute 'reset role';
  if result->>'status'<>'saved' then raise exception 'TABLE_BOARD_NULL_SHIFT_ORDER_REJECTED'; end if;
  select count(*) into n from app.order_operational_shifts where order_id=null_order and shift_id=v_shift;
  if n<>1 then raise exception 'TABLE_BOARD_NULL_SHIFT_ORDER_NOT_LINKED'; end if;

  update app.operational_shifts set status='closed', closed_at=pg_catalog.clock_timestamp(), closed_by=actor
  where id=v_shift;
  execute 'set local role app_api';
  result := app_private.create_operational_order(actor,v_shift,
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'orderId',closed_order::text,'restaurantId',restaurant::text,'branchId',branch::text,
      'channel','counter','currency','MXN','timeZone','America/Hermosillo','status','draft','items','[]'::jsonb),
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
      'restaurantId',restaurant::text,'branchId',branch::text,'orderId',closed_order::text,'actorId',actor::text,
      'deviceId',device::text,'occurredAt',now_text,'operation','order.created','entityType','order',
      'entityId',closed_order::text,'to','draft'));
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'TABLE_BOARD_CLOSED_SHIFT_ORDER_ACCEPTED'; end if;
  if exists (select 1 from app.orders where id=closed_order) then raise exception 'TABLE_BOARD_CLOSED_SHIFT_ORDER_PERSISTED'; end if;

  -- Identical retry after the shift closed replays; a new null-shift create with no open shift conflicts.
  execute 'set local role app_api';
  replayed := app_private.create_operational_order(actor,null,null_order_json,null_audit);
  execute 'reset role';
  if replayed->>'status'<>'replayed' then raise exception 'TABLE_BOARD_NULL_SHIFT_RETRY_NOT_REPLAYED'; end if;
  execute 'set local role app_api';
  result := app_private.create_operational_order(actor,null,
    pg_catalog.jsonb_set(null_order_json,'{orderId}',to_jsonb(closed_order::text)),
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
      'restaurantId',restaurant::text,'branchId',branch::text,'orderId',closed_order::text,'actorId',actor::text,
      'deviceId',device::text,'occurredAt',now_text,'operation','order.created','entityType','order',
      'entityId',closed_order::text,'to','draft'));
  execute 'reset role';
  if result->>'status'<>'conflict' or exists (select 1 from app.orders where id=closed_order)
  then raise exception 'TABLE_BOARD_NULL_SHIFT_NO_OPEN_SHIFT_ACCEPTED'; end if;

  -- Seed orders: order_a open, order_b closed, foreign_order in another restaurant/branch.
  insert into app.orders(id,restaurant_id,branch_id,table_id,channel,status,aggregate,version,created_by,updated_by)
  values (
    order_a,restaurant,branch,table_id,'table','open',
    pg_catalog.jsonb_build_object('schemaVersion',1,'orderId',order_a::text,'restaurantId',restaurant::text,'branchId',branch::text,
      'channel','table','status','open','timeZone','America/Hermosillo','currency','MXN','items','[]'::jsonb),1,actor,actor
  ), (
    order_b,restaurant,branch,table_id,'table','closed',
    pg_catalog.jsonb_build_object('schemaVersion',1,'orderId',order_b::text,'restaurantId',restaurant::text,'branchId',branch::text,
      'channel','table','status','closed','timeZone','America/Hermosillo','currency','MXN','items','[]'::jsonb),1,actor,actor
  ), (
    foreign_order,other_restaurant,other_branch,foreign_table,'table','open',
    pg_catalog.jsonb_build_object('schemaVersion',1,'orderId',foreign_order::text,'restaurantId',other_restaurant::text,'branchId',other_branch::text,
      'channel','table','status','open','timeZone','America/Hermosillo','currency','MXN','items','[]'::jsonb),1,actor,actor
  );

  -- non-member actor: forbidden
  audit := pg_temp.t_audit(foreign_waiter,order_a,restaurant,branch,device,now_text,waiter::text);
  execute 'set local role app_api';
  result := app_private.assign_order_waiter(foreign_waiter,1,order_a,restaurant,branch,waiter,audit);
  execute 'reset role';
  if result->>'status'<>'forbidden' then raise exception 'TABLE_BOARD_ASSIGN_FOREIGN_ACTOR_ACCEPTED'; end if;

  -- waiter without membership at this branch: conflict, nothing persisted
  audit := pg_temp.t_audit(actor,order_a,restaurant,branch,device,now_text,foreign_waiter::text);
  execute 'set local role app_api';
  result := app_private.assign_order_waiter(actor,1,order_a,restaurant,branch,foreign_waiter,audit);
  execute 'reset role';
  if result->>'status'<>'conflict' or (select waiter_user_id from app.orders where id=order_a) is not null
  then raise exception 'TABLE_BOARD_ASSIGN_FOREIGN_WAITER_ACCEPTED'; end if;

  -- cross-scope order id: never mutates
  audit := pg_temp.t_audit(actor,foreign_order,restaurant,branch,device,now_text,waiter::text);
  execute 'set local role app_api';
  result := app_private.assign_order_waiter(actor,1,foreign_order,restaurant,branch,waiter,audit);
  execute 'reset role';
  if result->>'status' not in ('conflict','forbidden') then raise exception 'TABLE_BOARD_ASSIGN_CROSS_SCOPE_ACCEPTED'; end if;
  audit := pg_temp.t_audit(actor,foreign_order,other_restaurant,other_branch,device,now_text,waiter::text);
  execute 'set local role app_api';
  result := app_private.assign_order_waiter(actor,1,foreign_order,other_restaurant,other_branch,waiter,audit);
  execute 'reset role';
  if result->>'status' not in ('conflict','forbidden') then raise exception 'TABLE_BOARD_ASSIGN_CROSS_SCOPE_DIRECT_ACCEPTED'; end if;
  if (select waiter_user_id from app.orders where id=foreign_order) is not null
    or (select version from app.orders where id=foreign_order)<>1
  then raise exception 'TABLE_BOARD_ASSIGN_CROSS_SCOPE_MUTATED'; end if;

  -- closed order: conflict without mutation
  audit := pg_temp.t_audit(actor,order_b,restaurant,branch,device,now_text,waiter::text);
  execute 'set local role app_api';
  result := app_private.assign_order_waiter(actor,1,order_b,restaurant,branch,waiter,audit);
  execute 'reset role';
  if result->>'status'<>'conflict'
    or (select waiter_user_id from app.orders where id=order_b) is not null
    or (select version from app.orders where id=order_b)<>1
  then raise exception 'TABLE_BOARD_ASSIGN_CLOSED_ORDER_ACCEPTED'; end if;

  -- assign (from null), then replay of the exact command
  assign_audit := pg_temp.t_audit(actor,order_a,restaurant,branch,device,now_text,waiter::text);
  execute 'set local role app_api';
  result := app_private.assign_order_waiter(actor,1,order_a,restaurant,branch,waiter,assign_audit);
  execute 'reset role';
  if result->>'status'<>'saved' or (result->>'version')::bigint<>2 then raise exception 'TABLE_BOARD_ASSIGN_REJECTED'; end if;
  if (select waiter_user_id from app.orders where id=order_a)<>waiter then raise exception 'TABLE_BOARD_ASSIGN_NOT_PERSISTED'; end if;
  if (select event_payload->'payload'->>'from' from app.order_audit_events
      where order_id=order_a and operation='order.waiter_assigned' and result_order_version=2) is not null
  then raise exception 'TABLE_BOARD_ASSIGN_FIRST_FROM_NOT_NULL'; end if;
  execute 'set local role app_api';
  replayed := app_private.assign_order_waiter(actor,1,order_a,restaurant,branch,waiter,assign_audit);
  execute 'reset role';
  if replayed->>'status'<>'replayed' or replayed->'order'<>result->'order' then raise exception 'TABLE_BOARD_ASSIGN_REPLAY_MISMATCH'; end if;

  -- same command (same key + payload) but a different expectedVersion is a conflict, not a replay
  execute 'set local role app_api';
  result := app_private.assign_order_waiter(actor,2,order_a,restaurant,branch,waiter,assign_audit);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'TABLE_BOARD_ASSIGN_REPLAY_WITH_DIFFERENT_VERSION_ACCEPTED'; end if;

  -- stale expectedVersion
  audit := pg_temp.t_audit(actor,order_a,restaurant,branch,device,now_text,waiter::text);
  execute 'set local role app_api';
  result := app_private.assign_order_waiter(actor,1,order_a,restaurant,branch,waiter,audit);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'TABLE_BOARD_ASSIGN_STALE_VERSION_NOT_REJECTED'; end if;

  -- reassign A -> B: audit `from` is server-derived (A)
  reassign_audit := pg_temp.t_audit(actor,order_a,restaurant,branch,device,now_text,waiter_b::text);
  execute 'set local role app_api';
  result := app_private.assign_order_waiter(actor,2,order_a,restaurant,branch,waiter_b,reassign_audit);
  execute 'reset role';
  if result->>'status'<>'saved' or (result->>'version')::bigint<>3 then raise exception 'TABLE_BOARD_REASSIGN_REJECTED'; end if;
  if (select event_payload->'payload'->>'from' from app.order_audit_events
      where order_id=order_a and operation='order.waiter_assigned' and result_order_version=3)<>waiter::text
  then raise exception 'TABLE_BOARD_REASSIGN_FROM_NOT_PREVIOUS_WAITER'; end if;

  -- clear (B -> null)
  audit := pg_temp.t_audit(actor,order_a,restaurant,branch,device,now_text,null);
  execute 'set local role app_api';
  result := app_private.assign_order_waiter(actor,3,order_a,restaurant,branch,null,audit);
  execute 'reset role';
  if result->>'status'<>'saved' or (select waiter_user_id from app.orders where id=order_a) is not null
  then raise exception 'TABLE_BOARD_ASSIGN_CLEAR_REJECTED'; end if;

  -- waiter_b's membership is revoked afterwards: an identical retry of the already-applied
  -- command still replays; a brand-new command for the revoked waiter is a conflict.
  update app.memberships set revoked_at = pg_catalog.clock_timestamp(), revoked_by = actor, revocation_reason = 'rollback-only test'
  where id = waiter_b_membership;
  execute 'set local role app_api';
  replayed := app_private.assign_order_waiter(actor,2,order_a,restaurant,branch,waiter_b,reassign_audit);
  execute 'reset role';
  if replayed->>'status'<>'replayed' then raise exception 'TABLE_BOARD_REASSIGN_REPLAY_BLOCKED_BY_REVOKED_MEMBERSHIP'; end if;
  audit := pg_temp.t_audit(actor,order_a,restaurant,branch,device,now_text,waiter_b::text);
  execute 'set local role app_api';
  result := app_private.assign_order_waiter(actor,4,order_a,restaurant,branch,waiter_b,audit);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'TABLE_BOARD_ASSIGN_REVOKED_WAITER_ACCEPTED'; end if;

  -- list_table_board: isolation and derived occupancy
  execute 'set local role app_api';
  board := app_private.list_table_board(foreign_waiter,restaurant,branch);
  execute 'reset role';
  if board is not null then raise exception 'TABLE_BOARD_LIST_FOREIGN_ACTOR_ACCEPTED'; end if;

  execute 'set local role app_api';
  board := app_private.list_table_board(actor,restaurant,branch);
  execute 'reset role';
  if board is null or (board->>'schemaVersion')::int<>1 then raise exception 'TABLE_BOARD_LIST_REJECTED'; end if;
  select count(*) into n from pg_catalog.jsonb_array_elements(board->'orders') as entry(value)
    where entry.value->>'orderId' = order_a::text and entry.value->>'tableId' = table_id::text;
  if n<>1 then raise exception 'TABLE_BOARD_LIST_MISSING_OPEN_ORDER'; end if;
  select count(*) into n from pg_catalog.jsonb_array_elements(board->'orders') as entry(value)
    where entry.value->>'orderId' in (order_b::text, foreign_order::text);
  if n<>0 then raise exception 'TABLE_BOARD_LIST_LEAKED_INACTIVE_OR_FOREIGN_ORDER'; end if;

  -- an active order on a soft-deleted table is still returned (the API surfaces it as unassigned)
  insert into app.dining_tables(
    id,restaurant_id,branch_id,zone_id,name,capacity,shape,layout_x,layout_y,layout_width,layout_height,created_by,updated_by,deleted_at
  ) values (deleted_table,restaurant,branch,zone_id,'D1',4,'square',4,4,2,2,actor,actor,pg_catalog.clock_timestamp());
  insert into app.orders(id,restaurant_id,branch_id,table_id,channel,status,aggregate,version,created_by,updated_by)
  values (deleted_order,restaurant,branch,deleted_table,'table','open',
    pg_catalog.jsonb_build_object('schemaVersion',1,'orderId',deleted_order::text,'restaurantId',restaurant::text,'branchId',branch::text,
      'channel','table','status','open','timeZone','America/Hermosillo','currency','MXN','items','[]'::jsonb),1,actor,actor);
  execute 'set local role app_api';
  board := app_private.list_table_board(actor,restaurant,branch);
  execute 'reset role';
  select count(*) into n from pg_catalog.jsonb_array_elements(board->'orders') as entry(value)
    where entry.value->>'orderId' = deleted_order::text and entry.value->>'tableId' = deleted_table::text;
  if n<>1 then raise exception 'TABLE_BOARD_LIST_DROPPED_DELETED_TABLE_ORDER'; end if;

  -- explicit limit_exceeded instead of a silently truncated list (cap is 500 active orders)
  insert into app.orders(id,restaurant_id,branch_id,table_id,channel,status,aggregate,version,created_by,updated_by)
  select g.id,restaurant,branch,table_id,'table','open',
    pg_catalog.jsonb_build_object('schemaVersion',1,'orderId',g.id::text,'restaurantId',restaurant::text,'branchId',branch::text,
      'channel','table','status','open','timeZone','America/Hermosillo','currency','MXN','items','[]'::jsonb),1,actor,actor
  from (select gen_random_uuid() as id from pg_catalog.generate_series(1,500)) as g;
  execute 'set local role app_api';
  board := app_private.list_table_board(actor,restaurant,branch);
  execute 'reset role';
  if board is distinct from '{"status":"limit_exceeded"}'::jsonb then raise exception 'TABLE_BOARD_LIST_TRUNCATED_SILENTLY'; end if;

  if pg_catalog.has_function_privilege('authenticated','app_private.assign_order_waiter(uuid,bigint,uuid,uuid,uuid,uuid,jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('authenticated','app_private.open_operational_shift(uuid,uuid,uuid,uuid,text,jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('authenticated','app_private.list_table_board(uuid,uuid,uuid)','EXECUTE')
  then raise exception 'TABLE_BOARD_AUTHENTICATED_EXECUTE_GRANTED'; end if;
end
$table_board_tests$;
commit;
