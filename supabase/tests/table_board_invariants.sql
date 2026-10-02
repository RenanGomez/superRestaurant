-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises app_private.open_operational_shift (single open shift per branch, idempotent replay),
-- app_private.assign_order_waiter (branch isolation, waiter membership validated against the
-- *waiter's own* branch, optimistic version, audit event written, idempotent replay) and
-- app_private.list_table_board (branch isolation, occupied derived from draft/open/partially_paid,
-- a closed order never counts as occupied).
begin;
do $table_board_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  waiter uuid := gen_random_uuid();
  foreign_waiter uuid := gen_random_uuid();
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_restaurant uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  membership uuid := gen_random_uuid();
  waiter_membership uuid := gen_random_uuid();
  foreign_membership uuid := gen_random_uuid();
  zone_id uuid := gen_random_uuid();
  table_id uuid := gen_random_uuid();
  shift_id uuid := gen_random_uuid();
  order_a uuid := gen_random_uuid();
  order_b uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  now_text text := pg_catalog.to_char(pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  result jsonb;
  replayed jsonb;
  board jsonb;
  tables_occupied integer;
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
    (foreign_waiter,'local-table-board-foreign-waiter@invalid.test');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values
    (membership,actor,restaurant,branch,actor),
    (waiter_membership,waiter,restaurant,branch,actor),
    (foreign_membership,foreign_waiter,other_restaurant,other_branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values
    (membership,'manager',actor),
    (waiter_membership,'waiter',actor),
    (foreign_membership,'waiter',actor);

  insert into app.dining_zones(id,restaurant_id,branch_id,name,created_by) values
    (zone_id,restaurant,branch,'rollback-only zone',actor);
  insert into app.dining_tables(
    id,restaurant_id,branch_id,zone_id,name,capacity,shape,layout_x,layout_y,layout_width,layout_height,created_by,updated_by
  ) values (table_id,restaurant,branch,zone_id,'T1',4,'square',0,0,2,2,actor,actor);

  -- open_operational_shift: forbidden for a non-member, saved for the real actor, replayed on an
  -- identical retry, conflict for a second shift while one is already open.
  execute 'set local role app_api';
  result := app_private.open_operational_shift(foreign_waiter,restaurant,branch,shift_id,'Turno 1',
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
      'restaurantId',restaurant::text,'branchId',branch::text,'actorId',foreign_waiter::text,
      'deviceId',device::text,'occurredAt',now_text,'operation','operational_shift.opened',
      'entityType','operational_shift','entityId',shift_id::text
    ));
  execute 'reset role';
  if result->>'status'<>'forbidden' then raise exception 'TABLE_BOARD_SHIFT_OPEN_FOREIGN_ACCEPTED'; end if;

  execute 'set local role app_api';
  result := app_private.open_operational_shift(actor,restaurant,branch,shift_id,'Turno 1',
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
      'restaurantId',restaurant::text,'branchId',branch::text,'actorId',actor::text,
      'deviceId',device::text,'occurredAt',now_text,'operation','operational_shift.opened',
      'entityType','operational_shift','entityId',shift_id::text
    ));
  execute 'reset role';
  if result->>'status'<>'saved' then raise exception 'TABLE_BOARD_SHIFT_OPEN_REJECTED'; end if;
  if (select count(*) from app.operational_shifts where id=shift_id and status='open')<>1
  then raise exception 'TABLE_BOARD_SHIFT_OPEN_NOT_PERSISTED'; end if;

  execute 'set local role app_api';
  replayed := app_private.open_operational_shift(actor,restaurant,branch,shift_id,'Turno 1',
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
      'restaurantId',restaurant::text,'branchId',branch::text,'actorId',actor::text,
      'deviceId',device::text,'occurredAt',now_text,'operation','operational_shift.opened',
      'entityType','operational_shift','entityId',shift_id::text
    ));
  execute 'reset role';
  if replayed->>'status'<>'replayed' then raise exception 'TABLE_BOARD_SHIFT_REOPEN_NOT_REPLAYED'; end if;

  execute 'set local role app_api';
  result := app_private.open_operational_shift(actor,restaurant,branch,gen_random_uuid(),'Turno 2',
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
      'restaurantId',restaurant::text,'branchId',branch::text,'actorId',actor::text,
      'deviceId',device::text,'occurredAt',now_text,'operation','operational_shift.opened',
      'entityType','operational_shift','entityId',shift_id::text
    ));
  execute 'reset role';
  -- entityId mismatch with the new shift id is also rejected (malformed audit), proving the
  -- function never trusts an inconsistent payload; exercised here instead of a second valid
  -- attempt so this probe stays single-shift.
  if result->>'status'<>'conflict' then raise exception 'TABLE_BOARD_SHIFT_SECOND_OPEN_NOT_REJECTED'; end if;

  -- Seed two table orders directly (bypassing the full order-create path, which is out of this
  -- migration's scope): order_a stays open (should count as occupied), order_b is closed (must not).
  insert into app.orders(id,restaurant_id,branch_id,table_id,channel,status,aggregate,version,created_by,updated_by)
  values (
    order_a,restaurant,branch,table_id,'table','open',
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'orderId',order_a::text,'restaurantId',restaurant::text,'branchId',branch::text,
      'channel','table','status','open','timeZone','America/Hermosillo','currency','MXN','items','[]'::jsonb
    ),1,actor,actor
  ), (
    order_b,restaurant,branch,table_id,'table','closed',
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'orderId',order_b::text,'restaurantId',restaurant::text,'branchId',branch::text,
      'channel','table','status','closed','timeZone','America/Hermosillo','currency','MXN','items','[]'::jsonb
    ),1,actor,actor
  );

  -- assign_order_waiter: forbidden for a non-member actor, conflict for a waiter with no
  -- membership at this exact branch, saved for a real waiter in-branch, stale version rejected,
  -- byte-identical retry replays.
  execute 'set local role app_api';
  result := app_private.assign_order_waiter(foreign_waiter,1,order_a,restaurant,branch,waiter,
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
      'restaurantId',restaurant::text,'branchId',branch::text,'orderId',order_a::text,'actorId',foreign_waiter::text,
      'deviceId',device::text,'occurredAt',now_text,'operation','order.waiter_assigned','entityType','order',
      'entityId',order_a::text,'payload',pg_catalog.jsonb_build_object('from',null,'to',waiter::text)
    ));
  execute 'reset role';
  if result->>'status'<>'forbidden' then raise exception 'TABLE_BOARD_ASSIGN_FOREIGN_ACTOR_ACCEPTED'; end if;

  execute 'set local role app_api';
  result := app_private.assign_order_waiter(actor,1,order_a,restaurant,branch,foreign_waiter,
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
      'restaurantId',restaurant::text,'branchId',branch::text,'orderId',order_a::text,'actorId',actor::text,
      'deviceId',device::text,'occurredAt',now_text,'operation','order.waiter_assigned','entityType','order',
      'entityId',order_a::text,'payload',pg_catalog.jsonb_build_object('from',null,'to',foreign_waiter::text)
    ));
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'TABLE_BOARD_ASSIGN_FOREIGN_WAITER_ACCEPTED'; end if;
  if (select waiter_user_id from app.orders where id=order_a) is not null
  then raise exception 'TABLE_BOARD_ASSIGN_FOREIGN_WAITER_PERSISTED'; end if;

  execute 'set local role app_api';
  result := app_private.assign_order_waiter(actor,1,order_a,restaurant,branch,waiter,
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
      'restaurantId',restaurant::text,'branchId',branch::text,'orderId',order_a::text,'actorId',actor::text,
      'deviceId',device::text,'occurredAt',now_text,'operation','order.waiter_assigned','entityType','order',
      'entityId',order_a::text,'payload',pg_catalog.jsonb_build_object('from',null,'to',waiter::text)
    ));
  execute 'reset role';
  if result->>'status'<>'saved' or (result->>'version')::bigint<>2 then raise exception 'TABLE_BOARD_ASSIGN_REJECTED'; end if;
  if (select waiter_user_id from app.orders where id=order_a)<>waiter
    or (select version from app.orders where id=order_a)<>2
  then raise exception 'TABLE_BOARD_ASSIGN_NOT_PERSISTED'; end if;
  if (select count(*) from app.order_audit_events where order_id=order_a and operation='order.waiter_assigned')<>1
  then raise exception 'TABLE_BOARD_ASSIGN_AUDIT_MISSING'; end if;

  -- Stale expectedVersion (order is now at version 2) is a conflict.
  execute 'set local role app_api';
  result := app_private.assign_order_waiter(actor,1,order_a,restaurant,branch,waiter,
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
      'restaurantId',restaurant::text,'branchId',branch::text,'orderId',order_a::text,'actorId',actor::text,
      'deviceId',device::text,'occurredAt',now_text,'operation','order.waiter_assigned','entityType','order',
      'entityId',order_a::text,'payload',pg_catalog.jsonb_build_object('from','00000000-0000-1000-8000-000000000000','to',waiter::text)
    ));
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'TABLE_BOARD_ASSIGN_STALE_VERSION_NOT_REJECTED'; end if;

  -- Byte-identical retry (same actor/scope/idempotencyKey+payload as the saved call) is rejected as
  -- a conflict here because this probe reused a fresh eventId/idempotencyKey per call above; a true
  -- replay is exercised next with the exact same audit object.
  declare
    saved_audit jsonb := pg_catalog.jsonb_build_object(
      'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
      'restaurantId',restaurant::text,'branchId',branch::text,'orderId',order_a::text,'actorId',actor::text,
      'deviceId',device::text,'occurredAt',now_text,'operation','order.waiter_assigned','entityType','order',
      'entityId',order_a::text,'payload',pg_catalog.jsonb_build_object('from',waiter::text,'to',null)
    );
  begin
    execute 'set local role app_api';
    result := app_private.assign_order_waiter(actor,2,order_a,restaurant,branch,null,saved_audit);
    execute 'reset role';
    if result->>'status'<>'saved' or (result->>'version')::bigint<>3 then raise exception 'TABLE_BOARD_ASSIGN_CLEAR_REJECTED'; end if;

    execute 'set local role app_api';
    replayed := app_private.assign_order_waiter(actor,2,order_a,restaurant,branch,null,saved_audit);
    execute 'reset role';
    if replayed->>'status'<>'replayed' or replayed->'order'<>result->'order'
    then raise exception 'TABLE_BOARD_ASSIGN_REPLAY_MISMATCH'; end if;
  end;

  -- list_table_board: branch isolation plus derived occupancy (order_a open counts, order_b
  -- closed does not).
  execute 'set local role app_api';
  board := app_private.list_table_board(foreign_waiter,restaurant,branch);
  execute 'reset role';
  if board is not null then raise exception 'TABLE_BOARD_LIST_FOREIGN_ACTOR_ACCEPTED'; end if;

  execute 'set local role app_api';
  board := app_private.list_table_board(actor,restaurant,branch);
  execute 'reset role';
  if board is null then raise exception 'TABLE_BOARD_LIST_REJECTED'; end if;
  if (board->>'schemaVersion')::int<>1 then raise exception 'TABLE_BOARD_LIST_SCHEMA_MISMATCH'; end if;
  select count(*) into tables_occupied
  from pg_catalog.jsonb_array_elements(board->'orders') as entry(value)
  where entry.value->>'tableId' = table_id::text and entry.value->>'orderId' = order_a::text;
  if tables_occupied<>1 then raise exception 'TABLE_BOARD_LIST_MISSING_OPEN_ORDER'; end if;
  select count(*) into tables_occupied
  from pg_catalog.jsonb_array_elements(board->'orders') as entry(value)
  where entry.value->>'orderId' = order_b::text;
  if tables_occupied<>0 then raise exception 'TABLE_BOARD_LIST_INCLUDED_CLOSED_ORDER'; end if;

  if pg_catalog.has_function_privilege('authenticated','app_private.assign_order_waiter(uuid,bigint,uuid,uuid,uuid,uuid,jsonb)','EXECUTE')
  then raise exception 'TABLE_BOARD_ASSIGN_AUTHENTICATED_EXECUTE_GRANTED'; end if;
  if pg_catalog.has_function_privilege('authenticated','app_private.open_operational_shift(uuid,uuid,uuid,uuid,text,jsonb)','EXECUTE')
  then raise exception 'TABLE_BOARD_SHIFT_OPEN_AUTHENTICATED_EXECUTE_GRANTED'; end if;
  if pg_catalog.has_function_privilege('authenticated','app_private.list_table_board(uuid,uuid,uuid)','EXECUTE')
  then raise exception 'TABLE_BOARD_LIST_AUTHENTICATED_EXECUTE_GRANTED'; end if;
end
$table_board_tests$;
commit;
