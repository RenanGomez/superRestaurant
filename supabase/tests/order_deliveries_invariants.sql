-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises the delivery state machine (assign/dispatch/complete/fail), replay and conflict by
-- idempotency key, courier ownership, two-attempt cap, branch/restaurant isolation, the readers and
-- the atomic cash settlement through app_private.settle_delivery (failure persists nothing).
begin;
create function pg_temp.t_dcmd(
  p_restaurant uuid, p_branch uuid, p_order uuid, p_expected bigint, p_event uuid, p_key text, p_device uuid,
  p_now text, p_extra jsonb
) returns jsonb language sql as $f$
  select pg_catalog.jsonb_build_object(
    'schemaVersion',1,
    'scope',pg_catalog.jsonb_build_object('restaurantId',p_restaurant::text,'branchId',p_branch::text),
    'orderId',p_order::text,'expectedVersion',p_expected,'eventId',p_event::text,'idempotencyKey',p_key,
    'deviceId',p_device::text,'occurredAt',p_now
  ) || p_extra
$f$;
create function pg_temp.t_collect(
  p_restaurant uuid, p_branch uuid, p_session uuid, p_order uuid, p_session_version bigint, p_order_version bigint,
  p_payment uuid, p_amount bigint, p_seq bigint, p_event uuid, p_key text, p_device uuid, p_now text, p_extra jsonb
) returns jsonb language sql as $f$
  select pg_catalog.jsonb_build_object(
    'schemaVersion',1,
    'scope',pg_catalog.jsonb_build_object('restaurantId',p_restaurant::text,'branchId',p_branch::text),
    'cashRegisterSessionId',p_session::text,'cashRegisterExpectedVersion',p_session_version,
    'orderId',p_order::text,'orderExpectedVersion',p_order_version,'paymentId',p_payment::text,
    'amountMinor',p_amount,'method','cash','cardManualEvidence','null'::jsonb,
    'localSequence',p_seq,'eventId',p_event::text,'idempotencyKey',p_key,'deviceId',p_device::text,'occurredAt',p_now
  ) || p_extra
$f$;
create function pg_temp.t_settle(
  p_restaurant uuid, p_branch uuid, p_order uuid, p_delivery_version bigint, p_session uuid, p_session_version bigint,
  p_order_version bigint, p_payment uuid, p_seq bigint, p_event uuid, p_key text, p_device uuid, p_now text,
  p_tender jsonb, p_tip jsonb
) returns jsonb language sql as $f$
  select pg_temp.t_dcmd(p_restaurant,p_branch,p_order,p_delivery_version,p_event,p_key,p_device,p_now,
    pg_catalog.jsonb_build_object('orderExpectedVersion',p_order_version,'cashRegisterSessionId',p_session::text,
      'cashRegisterExpectedVersion',p_session_version,'paymentId',p_payment::text,'localSequence',p_seq,
      'tenderedAmountMinor',p_tender,'tipMinor',p_tip))
$f$;
create function pg_temp.t_pay(
  p_restaurant uuid, p_branch uuid, p_order uuid, p_payment uuid, p_event uuid, p_key text, p_amount bigint, p_extra jsonb
) returns jsonb language sql as $f$
  select pg_catalog.jsonb_build_object(
    'schemaVersion',1,'paymentId',p_payment::text,'eventId',p_event::text,'restaurantId',p_restaurant::text,
    'branchId',p_branch::text,'orderId',p_order::text,
    'amount',pg_catalog.jsonb_build_object('amountMinor',p_amount,'currency','MXN'),
    'method','cash','idempotencyKey',p_key,'state','captured'
  ) || p_extra
$f$;
create function pg_temp.t_mv(
  p_id uuid, p_event uuid, p_key text, p_restaurant uuid, p_branch uuid, p_session uuid, p_register uuid, p_shift uuid,
  p_cashier uuid, p_device uuid, p_seq bigint, p_type text, p_amount bigint, p_payment uuid, p_now text
) returns jsonb language sql as $f$
  select pg_catalog.jsonb_build_object(
    'movementId',p_id::text,'eventId',p_event::text,'idempotencyKey',p_key,'restaurantId',p_restaurant::text,
    'branchId',p_branch::text,'cashRegisterId',p_session::text,'registerId',p_register::text,'shiftId',p_shift::text,
    'cashierId',p_cashier::text,'actorId',p_cashier::text,'deviceId',p_device::text,'localSequence',p_seq,
    'occurredAt',p_now,'type',p_type,'direction','in',
    'amount',pg_catalog.jsonb_build_object('amountMinor',p_amount,'currency','MXN'),
    'source',pg_catalog.jsonb_build_object('type','payment','paymentId',p_payment::text)
  )
$f$;
do $order_deliveries_tests$
declare
  cashier uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  courier_a uuid := gen_random_uuid();
  courier_b uuid := gen_random_uuid();
  viewer uuid := gen_random_uuid();
  foreign_actor uuid := gen_random_uuid();
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_restaurant uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  m_cashier uuid := gen_random_uuid();
  m_a uuid := gen_random_uuid();
  m_b uuid := gen_random_uuid();
  m_viewer uuid := gen_random_uuid();
  m_foreign uuid := gen_random_uuid();
  v_register uuid := gen_random_uuid();
  v_shift uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  o_fail uuid := gen_random_uuid();
  o_cash uuid := gen_random_uuid();
  o_card uuid := gen_random_uuid();
  o_counter uuid := gen_random_uuid();
  pay_1 uuid := gen_random_uuid();
  pay_2 uuid := gen_random_uuid();
  pay_3 uuid := gen_random_uuid();
  tip_mv uuid := gen_random_uuid();
  now_text text := pg_catalog.to_char(pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  sess app.cash_register_sessions%rowtype;
  ord app.orders%rowtype;
  result jsonb;
  replayed jsonb;
  cmd jsonb;
  collect jsonb;
  pay jsonb;
  reg jsonb;
  n integer;
  k integer := 0;
  v_delivery_events integer;
begin
  if cashier is null then raise exception 'DELIVERY_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone) values
    (restaurant,'rollback-only deliveries','America/Hermosillo'),
    (other_restaurant,'rollback-only deliveries foreign','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (branch,restaurant,'rollback-only deliveries branch'),
    (other_branch,other_restaurant,'rollback-only deliveries foreign branch');
  insert into auth.users(id,email,raw_user_meta_data) values
    (courier_a,'local-courier-a@invalid.test','{"full_name":"Repartidor Uno"}'),
    (courier_b,'local-courier-b@invalid.test','{"name":"Repartidor Dos​"}'),
    (viewer,'local-viewer@invalid.test',null),
    (foreign_actor,'local-delivery-foreign@invalid.test',null);
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values
    (m_cashier,cashier,restaurant,branch,cashier),
    (m_a,courier_a,restaurant,branch,cashier),
    (m_b,courier_b,restaurant,branch,cashier),
    (m_viewer,viewer,restaurant,branch,cashier),
    (m_foreign,foreign_actor,other_restaurant,other_branch,cashier);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values
    (m_cashier,'cashier',cashier),(m_a,'courier',cashier),(m_b,'courier',cashier),
    (m_viewer,'viewer',cashier),(m_foreign,'cashier',cashier);

  insert into app.cash_register_sessions(
    id,restaurant_id,branch_id,register_id,shift_id,cashier_id,currency,status,opening_float_minor,aggregate,version,
    opened_at,opened_by
  ) values (
    v_session,restaurant,branch,v_register,v_shift,cashier,'MXN','open',10000,pg_catalog.jsonb_build_object(
      'schemaVersion',1,'cashRegisterId',v_session::text,'restaurantId',restaurant::text,'branchId',branch::text,
      'registerId',v_register::text,'shiftId',v_shift::text,'cashierId',cashier::text,'currency','MXN','status','open',
      'openingFloat',pg_catalog.jsonb_build_object('amountMinor',10000,'currency','MXN'),
      'openedByActorId',cashier::text,'openedAt',now_text,'openedDeviceId',device::text,'movements','[]'::jsonb
    ),1,pg_catalog.clock_timestamp(),cashier
  );
  insert into app.orders(id,restaurant_id,branch_id,channel,status,aggregate,version,created_by,updated_by)
  select o,restaurant,branch,ch,'open',pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',o::text,'restaurantId',restaurant::text,'branchId',branch::text,'channel',ch,
    'status','open','currency','MXN','timeZone','America/Hermosillo','items','[]'::jsonb
  ),1,cashier,cashier from (values (o_fail,'delivery'),(o_cash,'delivery'),(o_card,'delivery'),(o_counter,'counter')) as t(o,ch);

  -- Snapshots need a capture draft the test does not model: FK triggers are disabled for this insert only.
  execute 'set local session_replication_role = replica';
  insert into app.order_fulfillment_snapshots(restaurant_id,branch_id,order_id,capture_draft_id,capture_version,
    customer_id,fulfillment_channel,delivery_instructions,snapshot,confirmed_at,confirmed_by)
  select restaurant,branch,o,pg_catalog.md5(o::text)::uuid,1,null,'delivery',null,pg_catalog.jsonb_build_object(
      'schemaVersion',2,'orderId',o::text,'captureDraftId',pg_catalog.md5(o::text)::uuid::text,'captureVersion',1,
      'fulfillmentChannel','delivery','deliveryInstructions',null,
      'paymentIntent',pg_catalog.jsonb_build_object('schemaVersion',1,'method',m,'tenderedAmountMinor',null,'tipMinor',0)
    ),pg_catalog.clock_timestamp(),cashier
  from (values (o_cash,'cash'),(o_card,'card_manual')) as t(o,m);
  execute 'set local session_replication_role = origin';

  -- ---- Schema guards.
  begin
    insert into app.order_deliveries(restaurant_id,branch_id,order_id,courier_user_id,state,assigned_at,created_by,updated_by)
    values (restaurant,branch,o_fail,courier_a,'settled',now(),cashier,cashier);
    raise exception 'DELIVERY_SETTLED_WITHOUT_PAYMENT_ACCEPTED';
  exception when check_violation then null; end;
  begin
    insert into app.order_deliveries(restaurant_id,branch_id,order_id,courier_user_id,state,assigned_at,created_by,updated_by)
    values (restaurant,branch,o_fail,courier_a,'teleported',now(),cashier,cashier);
    raise exception 'DELIVERY_UNKNOWN_STATE_ACCEPTED';
  exception when check_violation then null; end;
  begin
    insert into app.order_deliveries(restaurant_id,branch_id,order_id,courier_user_id,state,attempt_count,assigned_at,created_by,updated_by)
    values (restaurant,branch,o_fail,courier_a,'assigned',3,now(),cashier,cashier);
    raise exception 'DELIVERY_THREE_ATTEMPTS_ACCEPTED';
  exception when check_violation then null; end;
  begin
    insert into app.order_deliveries(restaurant_id,branch_id,order_id,courier_user_id,state,assigned_at,created_by,updated_by)
    values (restaurant,other_branch,o_fail,courier_a,'assigned',now(),cashier,cashier);
    raise exception 'DELIVERY_CROSS_SCOPE_ORDER_ACCEPTED';
  exception when foreign_key_violation then null; end;
  if (select count(*) from app.order_deliveries)<>0 then raise exception 'DELIVERY_GUARD_PERSISTED_ROW'; end if;

  -- ---- Roles and the display name helper.
  if app_private.member_display_name(courier_a) is distinct from 'Repartidor Uno'
    or app_private.member_display_name(courier_b) is distinct from 'Repartidor Dos'
    or app_private.member_display_name(viewer) is not null
  then raise exception 'DELIVERY_DISPLAY_NAME_WRONG'; end if;

  -- ---- Assign: refusals first (nothing persists).
  execute 'set local role app_api';
  k := k + 1;
  cmd := pg_temp.t_dcmd(restaurant,branch,o_counter,0,gen_random_uuid(),'k-counter',device,now_text,pg_catalog.jsonb_build_object('courierUserId',courier_a::text));
  result := app_private.assign_delivery(cashier,cmd);
  if result->>'status'<>'conflict' then raise exception 'DELIVERY_NON_DELIVERY_ORDER_ASSIGNED'; end if;
  cmd := pg_temp.t_dcmd(restaurant,branch,o_fail,0,gen_random_uuid(),'k-viewer',device,now_text,pg_catalog.jsonb_build_object('courierUserId',courier_a::text));
  if (app_private.assign_delivery(viewer,cmd))->>'status'<>'forbidden' then raise exception 'DELIVERY_VIEWER_ASSIGNED'; end if;
  if (app_private.assign_delivery(courier_a,cmd))->>'status'<>'forbidden' then raise exception 'DELIVERY_COURIER_ASSIGNED_ITSELF'; end if;
  if (app_private.assign_delivery(foreign_actor,cmd))->>'status'<>'forbidden' then raise exception 'DELIVERY_FOREIGN_ACTOR_ASSIGNED'; end if;
  cmd := pg_temp.t_dcmd(restaurant,branch,o_fail,0,gen_random_uuid(),'k-nocourier',device,now_text,pg_catalog.jsonb_build_object('courierUserId',viewer::text));
  if (app_private.assign_delivery(cashier,cmd))->>'status'<>'conflict' then raise exception 'DELIVERY_NON_COURIER_ASSIGNED'; end if;
  cmd := pg_temp.t_dcmd(restaurant,branch,o_fail,0,gen_random_uuid(),'k-ghost',device,now_text,pg_catalog.jsonb_build_object('courierUserId',gen_random_uuid()::text));
  if (app_private.assign_delivery(cashier,cmd))->>'status'<>'conflict' then raise exception 'DELIVERY_GHOST_COURIER_ASSIGNED'; end if;
  cmd := pg_temp.t_dcmd(restaurant,branch,o_fail,0,gen_random_uuid(),'k-extra',device,now_text,pg_catalog.jsonb_build_object('courierUserId',courier_a::text,'amountMinor',5));
  if (app_private.assign_delivery(cashier,cmd))->>'status'<>'conflict' then raise exception 'DELIVERY_EXTRA_KEY_ACCEPTED'; end if;
  execute 'reset role';
  if (select count(*) from app.order_deliveries)<>0 or (select count(*) from app.order_delivery_events)<>0
  then raise exception 'DELIVERY_REFUSAL_PERSISTED'; end if;

  -- ---- Assign o_fail to courier A; replay; divergent replay; stale version.
  execute 'set local role app_api';
  cmd := pg_temp.t_dcmd(restaurant,branch,o_fail,0,gen_random_uuid(),'k-assign-1',device,now_text,pg_catalog.jsonb_build_object('courierUserId',courier_a::text));
  result := app_private.assign_delivery(cashier,cmd);
  if result->>'status'<>'saved' or result->'delivery'->>'state'<>'assigned' or (result->'delivery'->>'version')::bigint<>1
    or result->'delivery'->>'courierUserId'<>courier_a::text or (result->'delivery'->>'attemptCount')::integer<>0
  then raise exception 'DELIVERY_ASSIGN_FAILED'; end if;
  replayed := app_private.assign_delivery(cashier,cmd);
  if replayed->>'status'<>'replayed' or replayed->'delivery' is distinct from result->'delivery'
  then raise exception 'DELIVERY_ASSIGN_REPLAY_DIFFERS'; end if;
  if (app_private.assign_delivery(cashier,pg_catalog.jsonb_set(cmd,'{courierUserId}',to_jsonb(courier_b::text))))->>'status'<>'conflict'
  then raise exception 'DELIVERY_DIVERGENT_REPLAY_ACCEPTED'; end if;
  cmd := pg_temp.t_dcmd(restaurant,branch,o_fail,0,gen_random_uuid(),'k-assign-stale',device,now_text,pg_catalog.jsonb_build_object('courierUserId',courier_b::text));
  if (app_private.assign_delivery(cashier,cmd))->>'status'<>'conflict' then raise exception 'DELIVERY_STALE_VERSION_ACCEPTED'; end if;
  -- Reassigning to the same courier while assigned is a no-op conflict; to another courier is allowed.
  cmd := pg_temp.t_dcmd(restaurant,branch,o_fail,1,gen_random_uuid(),'k-assign-same',device,now_text,pg_catalog.jsonb_build_object('courierUserId',courier_a::text));
  if (app_private.assign_delivery(cashier,cmd))->>'status'<>'conflict' then raise exception 'DELIVERY_SAME_COURIER_REASSIGNED'; end if;
  cmd := pg_temp.t_dcmd(restaurant,branch,o_fail,1,gen_random_uuid(),'k-assign-2',device,now_text,pg_catalog.jsonb_build_object('courierUserId',courier_b::text));
  result := app_private.assign_delivery(cashier,cmd);
  if result->>'status'<>'saved' or (result->'delivery'->>'version')::bigint<>2 or result->'delivery'->>'courierUserId'<>courier_b::text
  then raise exception 'DELIVERY_REASSIGN_FAILED'; end if;
  -- Back to A for the rest of the flow.
  cmd := pg_temp.t_dcmd(restaurant,branch,o_fail,2,gen_random_uuid(),'k-assign-3',device,now_text,pg_catalog.jsonb_build_object('courierUserId',courier_a::text));
  result := app_private.assign_delivery(cashier,cmd);
  if (result->'delivery'->>'version')::bigint<>3 then raise exception 'DELIVERY_REASSIGN_BACK_FAILED'; end if;

  -- ---- Dispatch: another courier and a viewer cannot; the owner can; completing needs en_route.
  cmd := pg_temp.t_dcmd(restaurant,branch,o_fail,3,gen_random_uuid(),'k-dispatch-b',device,now_text,'{}');
  if (app_private.dispatch_delivery(courier_b,cmd))->>'status'<>'forbidden' then raise exception 'DELIVERY_FOREIGN_COURIER_DISPATCHED'; end if;
  if (app_private.dispatch_delivery(viewer,cmd))->>'status'<>'forbidden' then raise exception 'DELIVERY_VIEWER_DISPATCHED'; end if;
  if (app_private.dispatch_delivery(foreign_actor,cmd))->>'status'<>'forbidden' then raise exception 'DELIVERY_FOREIGN_ACTOR_DISPATCHED'; end if;
  cmd := pg_temp.t_dcmd(restaurant,branch,o_fail,3,gen_random_uuid(),'k-complete-early',device,now_text,'{}');
  if (app_private.complete_delivery(courier_a,cmd))->>'status'<>'conflict' then raise exception 'DELIVERY_COMPLETED_BEFORE_DISPATCH'; end if;
  cmd := pg_temp.t_dcmd(restaurant,branch,o_fail,3,gen_random_uuid(),'k-dispatch-a',device,now_text,'{}');
  result := app_private.dispatch_delivery(courier_a,cmd);
  if result->>'status'<>'saved' or result->'delivery'->>'state'<>'en_route' or (result->'delivery'->>'attemptCount')::integer<>1
    or result->'delivery'->'dispatchedAt' = 'null'::jsonb then raise exception 'DELIVERY_DISPATCH_FAILED'; end if;
  replayed := app_private.dispatch_delivery(courier_a,cmd);
  if replayed->>'status'<>'replayed' or replayed->'delivery' is distinct from result->'delivery' then raise exception 'DELIVERY_DISPATCH_REPLAY_DIFFERS'; end if;
  -- A manager cannot reuse the courier's key (keys are per actor) but can act with its own.
  -- ---- Fail needs a reason, then the order may be reassigned once more (attempt 2), then never again.
  cmd := pg_temp.t_dcmd(restaurant,branch,o_fail,4,gen_random_uuid(),'k-fail-1',device,now_text,pg_catalog.jsonb_build_object('reason',' '));
  if (app_private.fail_delivery(courier_a,cmd))->>'status'<>'conflict' then raise exception 'DELIVERY_FAIL_WITHOUT_REASON'; end if;
  cmd := pg_temp.t_dcmd(restaurant,branch,o_fail,4,gen_random_uuid(),'k-fail-1',device,now_text,pg_catalog.jsonb_build_object('reason','Nadie abrio'));
  result := app_private.fail_delivery(courier_a,cmd);
  if result->>'status'<>'saved' or result->'delivery'->>'state'<>'failed' or result->'delivery'->>'failedReason'<>'Nadie abrio'
  then raise exception 'DELIVERY_FAIL_FAILED'; end if;
  cmd := pg_temp.t_dcmd(restaurant,branch,o_fail,5,gen_random_uuid(),'k-assign-4',device,now_text,pg_catalog.jsonb_build_object('courierUserId',courier_b::text));
  result := app_private.assign_delivery(cashier,cmd);
  if result->>'status'<>'saved' or result->'delivery'->>'state'<>'assigned' or result->'delivery'->'failedReason'<>'null'::jsonb
    or (result->'delivery'->>'attemptCount')::integer<>1 then raise exception 'DELIVERY_RETRY_ASSIGN_FAILED'; end if;
  cmd := pg_temp.t_dcmd(restaurant,branch,o_fail,6,gen_random_uuid(),'k-dispatch-2',device,now_text,'{}');
  result := app_private.dispatch_delivery(cashier,cmd);
  if result->>'status'<>'saved' or (result->'delivery'->>'attemptCount')::integer<>2 then raise exception 'DELIVERY_SECOND_ATTEMPT_FAILED'; end if;
  cmd := pg_temp.t_dcmd(restaurant,branch,o_fail,7,gen_random_uuid(),'k-fail-2',device,now_text,pg_catalog.jsonb_build_object('reason','Direccion falsa'));
  result := app_private.fail_delivery(courier_b,cmd);
  if result->>'status'<>'saved' or result->'delivery'->>'state'<>'failed' then raise exception 'DELIVERY_SECOND_FAIL_FAILED'; end if;
  cmd := pg_temp.t_dcmd(restaurant,branch,o_fail,8,gen_random_uuid(),'k-assign-5',device,now_text,pg_catalog.jsonb_build_object('courierUserId',courier_a::text));
  if (app_private.assign_delivery(cashier,cmd))->>'status'<>'conflict' then raise exception 'DELIVERY_THIRD_ATTEMPT_ACCEPTED'; end if;
  execute 'reset role';
  select count(*) into v_delivery_events from app.order_delivery_events where order_id=o_fail;
  if v_delivery_events<>8 then raise exception 'DELIVERY_JOURNAL_COUNT_WRONG'; end if;
  -- The Order itself never moved.
  select * into ord from app.orders where id=o_fail;
  if ord.status<>'open' or ord.version<>1 then raise exception 'DELIVERY_TOUCHED_ORDER_STATE'; end if;
  -- Journal is append-only.
  begin
    update app.order_delivery_events set operation='delivery.assigned' where order_id=o_fail;
    raise exception 'DELIVERY_JOURNAL_UPDATE_ACCEPTED';
  exception when sqlstate '55000' then null; end;
  begin
    delete from app.order_delivery_events where order_id=o_fail;
    raise exception 'DELIVERY_JOURNAL_DELETE_ACCEPTED';
  exception when sqlstate '55000' then null; end;

  -- ---- Readers.
  execute 'set local role app_api';
  result := app_private.list_branch_deliveries(cashier,restaurant,branch);
  if exists (select 1 from pg_catalog.jsonb_array_elements(result->'deliveries') d where d->'delivery'->>'orderId'=o_counter::text)
  then raise exception 'DELIVERY_LIST_INCLUDED_COUNTER_ORDER'; end if;
  if pg_catalog.jsonb_array_length(result->'deliveries')<>3
    or not exists (select 1 from pg_catalog.jsonb_array_elements(result->'deliveries') d
      where d->'delivery'->>'orderId'=o_cash::text and d->'delivery'->>'state'='pending' and (d->'delivery'->>'version')::bigint=0
        and d->'snapshot'->'paymentIntent'->>'method'='cash')
    or not exists (select 1 from pg_catalog.jsonb_array_elements(result->'deliveries') d
      where d->'delivery'->>'orderId'=o_fail::text and d->'courierName'='"Repartidor Dos"'::jsonb and d->'delivery'->>'state'='failed')
  then raise exception 'DELIVERY_LIST_MANAGER_SHAPE_WRONG'; end if;
  result := app_private.list_branch_deliveries(courier_a,restaurant,branch);
  if pg_catalog.jsonb_array_length(result->'deliveries')<>0 then raise exception 'DELIVERY_LIST_COURIER_SAW_OTHERS'; end if;
  result := app_private.list_branch_deliveries(courier_b,restaurant,branch);
  if pg_catalog.jsonb_array_length(result->'deliveries')<>1 or result->'deliveries'->0->'delivery'->>'orderId'<>o_fail::text
  then raise exception 'DELIVERY_LIST_COURIER_OWN_WRONG'; end if;
  if (app_private.list_branch_deliveries(viewer,restaurant,branch))->>'status'<>'forbidden' then raise exception 'DELIVERY_LIST_VIEWER_ALLOWED'; end if;
  if (app_private.list_branch_deliveries(foreign_actor,restaurant,branch))->>'status'<>'forbidden' then raise exception 'DELIVERY_LIST_FOREIGN_ALLOWED'; end if;
  result := app_private.read_order_delivery_context(viewer,restaurant,branch,o_cash);
  if result->'delivery'->>'state'<>'pending' or result->'snapshot'->'paymentIntent'->>'method'<>'cash' then raise exception 'DELIVERY_CONTEXT_WRONG'; end if;
  result := app_private.read_order_delivery_context(viewer,restaurant,branch,o_counter);
  if result->'delivery' is distinct from 'null'::jsonb or result->'snapshot' is distinct from 'null'::jsonb then raise exception 'DELIVERY_CONTEXT_COUNTER_WRONG'; end if;
  if app_private.read_order_delivery_context(viewer,restaurant,branch,gen_random_uuid()) is not null then raise exception 'DELIVERY_CONTEXT_MISSING_NOT_NULL'; end if;
  if (app_private.read_order_delivery_context(foreign_actor,restaurant,branch,o_cash))->>'status'<>'forbidden' then raise exception 'DELIVERY_CONTEXT_FOREIGN_ALLOWED'; end if;
  -- Members: couriers only, no email, foreign actor refused.
  result := app_private.list_branch_members(cashier,restaurant,branch,array['courier']);
  if pg_catalog.jsonb_array_length(result->'members')<>2 or result::text like '%invalid.test%'
    or exists (select 1 from pg_catalog.jsonb_array_elements(result->'members') m where not (m->'roles' ? 'courier'))
  then raise exception 'DELIVERY_MEMBERS_COURIER_FILTER_WRONG'; end if;
  result := app_private.list_branch_members(cashier,restaurant,branch,null);
  if pg_catalog.jsonb_array_length(result->'members')<>4 then raise exception 'DELIVERY_MEMBERS_ALL_WRONG'; end if;
  if (app_private.list_branch_members(foreign_actor,restaurant,branch,null))->>'status'<>'forbidden' then raise exception 'DELIVERY_MEMBERS_FOREIGN_ALLOWED'; end if;
  if (app_private.list_branch_members(cashier,restaurant,branch,array['Bad Role']))->>'status'<>'forbidden' then raise exception 'DELIVERY_MEMBERS_BAD_ROLE_ACCEPTED'; end if;
  execute 'reset role';

  -- ---- Settlement: o_cash (cash intent). Reach `delivered` through the courier.
  execute 'set local role app_api';
  result := app_private.assign_delivery(cashier,pg_temp.t_dcmd(restaurant,branch,o_cash,0,gen_random_uuid(),'k-c-assign',device,now_text,pg_catalog.jsonb_build_object('courierUserId',courier_a::text)));
  result := app_private.dispatch_delivery(courier_a,pg_temp.t_dcmd(restaurant,branch,o_cash,1,gen_random_uuid(),'k-c-dispatch',device,now_text,'{}'));
  execute 'reset role';
  select * into sess from app.cash_register_sessions where id=v_session;
  select * into ord from app.orders where id=o_cash;
  -- Not delivered yet (en_route): refused.
  reg := pg_catalog.jsonb_set(sess.aggregate,'{movements}',sess.aggregate->'movements'
    || pg_catalog.jsonb_build_array(pg_temp.t_mv(pay_1,gen_random_uuid(),'k-s-early',restaurant,branch,v_session,v_register,v_shift,cashier,device,1,'cash_sale',5000,pay_1,now_text)));
  cmd := pg_temp.t_settle(restaurant,branch,o_cash,2,v_session,1,1,pay_1,1,gen_random_uuid(),'k-s-early',device,now_text,'null'::jsonb,'null'::jsonb);
  collect := pg_temp.t_collect(restaurant,branch,v_session,o_cash,1,1,pay_1,5000,1,(cmd->>'eventId')::uuid,'k-s-early',device,now_text,'{}');
  pay := pg_temp.t_pay(restaurant,branch,o_cash,pay_1,(cmd->>'eventId')::uuid,'k-s-early',5000,'{}');
  execute 'set local role app_api';
  result := app_private.settle_delivery(cashier,cmd,collect,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"paid"'),reg,5000,0);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'DELIVERY_SETTLED_BEFORE_DELIVERED'; end if;
  execute 'set local role app_api';
  result := app_private.complete_delivery(courier_a,pg_temp.t_dcmd(restaurant,branch,o_cash,2,gen_random_uuid(),'k-c-complete',device,now_text,'{}'));
  execute 'reset role';
  if result->'delivery'->>'state'<>'delivered' or (result->'delivery'->>'version')::bigint<>3 then raise exception 'DELIVERY_COMPLETE_FAILED'; end if;

  -- Refusals that must persist nothing: courier cannot settle, partial amount, tip without its movement.
  execute 'set local role app_api';
  cmd := pg_temp.t_settle(restaurant,branch,o_cash,3,v_session,1,1,pay_1,1,gen_random_uuid(),'k-s-1',device,now_text,'6000'::jsonb,'200'::jsonb);
  collect := pg_temp.t_collect(restaurant,branch,v_session,o_cash,1,1,pay_1,5000,1,(cmd->>'eventId')::uuid,'k-s-1',device,now_text,
    '{"tenderedAmountMinor":6000,"tipMinor":200}');
  pay := pg_temp.t_pay(restaurant,branch,o_cash,pay_1,(cmd->>'eventId')::uuid,'k-s-1',5000,
    '{"tenderedAmount":{"amountMinor":6000,"currency":"MXN"},"change":{"amountMinor":1000,"currency":"MXN"},"tip":{"amountMinor":200,"currency":"MXN"}}');
  reg := pg_catalog.jsonb_set(sess.aggregate,'{movements}',sess.aggregate->'movements'
    || pg_catalog.jsonb_build_array(
      pg_temp.t_mv(pay_1,(cmd->>'eventId')::uuid,'k-s-1',restaurant,branch,v_session,v_register,v_shift,cashier,device,1,'cash_sale',5000,pay_1,now_text),
      pg_temp.t_mv(tip_mv,gen_random_uuid(),'k-s-1:tip',restaurant,branch,v_session,v_register,v_shift,cashier,device,2,'tip_in',200,pay_1,now_text)));
  if (app_private.settle_delivery(courier_a,cmd,collect,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"paid"'),reg,5000,0))->>'status'<>'forbidden'
  then raise exception 'DELIVERY_COURIER_SETTLED'; end if;
  if (app_private.settle_delivery(foreign_actor,cmd,collect,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"paid"'),reg,5000,0))->>'status'<>'forbidden'
  then raise exception 'DELIVERY_FOREIGN_SETTLED'; end if;
  -- Partial balance (no partial delivery): collect amount below the remaining balance.
  if (app_private.settle_delivery(cashier,cmd,pg_catalog.jsonb_set(collect,'{amountMinor}','4000'),pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"paid"'),reg,5000,0))->>'status'<>'conflict'
  then raise exception 'DELIVERY_PARTIAL_SETTLEMENT_ACCEPTED'; end if;
  -- Collect command that does not restate the settlement.
  if (app_private.settle_delivery(cashier,cmd,pg_catalog.jsonb_set(collect,'{paymentId}',to_jsonb(gen_random_uuid()::text)),pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"paid"'),reg,5000,0))->>'status'<>'conflict'
  then raise exception 'DELIVERY_MISMATCHED_COLLECT_ACCEPTED'; end if;
  if (app_private.settle_delivery(cashier,cmd,pg_catalog.jsonb_set(collect,'{method}','"card_manual"'),pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"paid"'),reg,5000,0))->>'status'<>'conflict'
  then raise exception 'DELIVERY_NON_CASH_COLLECT_ACCEPTED'; end if;
  -- Atomicity: the collect rejects (register lacks the tip movement) => nothing persists, delivery stays delivered.
  if (app_private.settle_delivery(cashier,cmd,collect,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"paid"'),
      pg_catalog.jsonb_set(sess.aggregate,'{movements}',sess.aggregate->'movements'
        || pg_catalog.jsonb_build_array(pg_temp.t_mv(pay_1,(cmd->>'eventId')::uuid,'k-s-1',restaurant,branch,v_session,v_register,v_shift,cashier,device,1,'cash_sale',5000,pay_1,now_text))),
      5000,0))->>'status'<>'conflict'
  then raise exception 'DELIVERY_SETTLE_WITH_BAD_REGISTER_ACCEPTED'; end if;
  execute 'reset role';
  if (select count(*) from app.payments where restaurant_id=restaurant)<>0
    or (select count(*) from app.cash_movements where cash_register_session_id=v_session)<>0
    or (select state from app.order_deliveries where order_id=o_cash)<>'delivered'
    or (select count(*) from app.order_delivery_events where order_id=o_cash and operation='delivery.settled')<>0
    or (select status from app.orders where id=o_cash)<>'open'
  then raise exception 'DELIVERY_FAILED_SETTLEMENT_PERSISTED'; end if;

  -- Successful settlement: cash 5000, tender 6000 (change 1000), cash tip 200.
  execute 'set local role app_api';
  result := app_private.settle_delivery(cashier,cmd,collect,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"paid"'),reg,5000,0);
  execute 'reset role';
  if result->>'status'<>'saved' or result->'delivery'->>'state'<>'settled' or (result->'delivery'->>'version')::bigint<>4
    or result->'delivery'->>'settledPaymentId'<>pay_1::text or (result->'payment'->>'changeMinor')::bigint<>1000
    or (result->'payment'->>'tipMinor')::bigint<>200 or result->'payment'->>'orderStatus'<>'paid'
    or (result->'payment'->>'remainingBalanceMinor')::bigint<>0 or result->'payment'->>'replayed'<>'false'
  then raise exception 'DELIVERY_SETTLE_FAILED'; end if;
  if (select amount_minor from app.payments where id=pay_1)<>5000 or (select change_minor from app.payments where id=pay_1)<>1000
    or (select cash_to_collect_minor from app.order_deliveries where order_id=o_cash)<>5000
    or (select count(*) from app.cash_movements where cash_register_session_id=v_session and source_payment_id=pay_1)<>2
    or (select status from app.orders where id=o_cash)<>'paid'
  then raise exception 'DELIVERY_SETTLE_ROWS_WRONG'; end if;
  -- Replay by key returns the stored result (payment marked replayed) and creates nothing.
  execute 'set local role app_api';
  replayed := app_private.replay_delivery_settlement(cashier,cmd);
  if replayed->>'status'<>'replayed' or replayed->'delivery' is distinct from result->'delivery'
    or replayed->'payment'->>'replayed'<>'true' or replayed->'payment'->>'paymentId'<>pay_1::text
  then raise exception 'DELIVERY_SETTLE_REPLAY_HELPER_WRONG'; end if;
  replayed := app_private.settle_delivery(cashier,cmd,collect,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"paid"'),reg,5000,0);
  if replayed->>'status'<>'replayed' or replayed->'payment'->>'changeMinor'<>'1000' then raise exception 'DELIVERY_SETTLE_REPLAY_DIFFERS'; end if;
  if (app_private.replay_delivery_settlement(cashier,pg_catalog.jsonb_set(cmd,'{tipMinor}','300')))->>'status'<>'conflict'
  then raise exception 'DELIVERY_SETTLE_DIVERGENT_REPLAY_ACCEPTED'; end if;
  if app_private.replay_delivery_settlement(cashier,pg_temp.t_settle(restaurant,branch,o_cash,3,v_session,1,1,pay_1,1,gen_random_uuid(),'k-unknown',device,now_text,'null'::jsonb,'null'::jsonb)) is not null
  then raise exception 'DELIVERY_REPLAY_UNKNOWN_KEY_NOT_NULL'; end if;
  if (app_private.replay_delivery_settlement(foreign_actor,cmd))->>'status'<>'forbidden' then raise exception 'DELIVERY_REPLAY_FOREIGN_ALLOWED'; end if;
  execute 'reset role';
  if (select count(*) from app.payments where restaurant_id=restaurant)<>1
    or (select count(*) from app.cash_movements where cash_register_session_id=v_session)<>2
    or (select count(*) from app.order_delivery_events where order_id=o_cash and operation='delivery.settled')<>1
  then raise exception 'DELIVERY_SETTLE_REPLAY_DUPLICATED'; end if;
  -- A settled delivery cannot move any more, and the paid Order drops out of the active list.
  execute 'set local role app_api';
  if (app_private.assign_delivery(cashier,pg_temp.t_dcmd(restaurant,branch,o_cash,4,gen_random_uuid(),'k-c-after',device,now_text,pg_catalog.jsonb_build_object('courierUserId',courier_b::text))))->>'status'<>'conflict'
  then raise exception 'DELIVERY_SETTLED_REASSIGNED'; end if;
  result := app_private.list_branch_deliveries(cashier,restaurant,branch);
  if exists (select 1 from pg_catalog.jsonb_array_elements(result->'deliveries') d where d->'delivery'->>'orderId'=o_cash::text)
  then raise exception 'DELIVERY_SETTLED_STILL_LISTED'; end if;
  execute 'reset role';

  -- ---- A card/transfer intent never settles through a delivery: it is collected the normal way.
  execute 'set local role app_api';
  result := app_private.assign_delivery(cashier,pg_temp.t_dcmd(restaurant,branch,o_card,0,gen_random_uuid(),'k-k-assign',device,now_text,pg_catalog.jsonb_build_object('courierUserId',courier_a::text)));
  result := app_private.dispatch_delivery(cashier,pg_temp.t_dcmd(restaurant,branch,o_card,1,gen_random_uuid(),'k-k-dispatch',device,now_text,'{}'));
  result := app_private.complete_delivery(cashier,pg_temp.t_dcmd(restaurant,branch,o_card,2,gen_random_uuid(),'k-k-complete',device,now_text,'{}'));
  execute 'reset role';
  select * into sess from app.cash_register_sessions where id=v_session;
  select * into ord from app.orders where id=o_card;
  reg := pg_catalog.jsonb_set(sess.aggregate,'{movements}',sess.aggregate->'movements'
    || pg_catalog.jsonb_build_array(pg_temp.t_mv(pay_2,gen_random_uuid(),'k-card',restaurant,branch,v_session,v_register,v_shift,cashier,device,3,'cash_sale',3000,pay_2,now_text)));
  cmd := pg_temp.t_settle(restaurant,branch,o_card,3,v_session,sess.version,1,pay_2,3,gen_random_uuid(),'k-card',device,now_text,'null'::jsonb,'null'::jsonb);
  collect := pg_temp.t_collect(restaurant,branch,v_session,o_card,sess.version,1,pay_2,3000,3,(cmd->>'eventId')::uuid,'k-card',device,now_text,'{}');
  pay := pg_temp.t_pay(restaurant,branch,o_card,pay_2,(cmd->>'eventId')::uuid,'k-card',3000,'{}');
  execute 'set local role app_api';
  result := app_private.settle_delivery(cashier,cmd,collect,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"paid"'),reg,3000,0);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'DELIVERY_CARD_INTENT_SETTLED_AS_CASH'; end if;
  if (select count(*) from app.payments where order_id=o_card)<>0 then raise exception 'DELIVERY_CARD_INTENT_PERSISTED_PAYMENT'; end if;

  -- ---- Tables are not reachable by the API role or the Data API.
  begin
    execute 'set local role app_api';
    perform 1 from app.order_deliveries;
    execute 'reset role';
    raise exception 'DELIVERY_TABLE_READABLE_BY_API_ROLE';
  exception when insufficient_privilege then execute 'reset role'; end;
  if has_table_privilege('authenticated','app.order_deliveries','select')
    or has_table_privilege('anon','app.order_delivery_events','select')
    or has_function_privilege('authenticated','app_private.settle_delivery(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,bigint,bigint)','execute')
    or has_function_privilege('app_api','app_private.apply_delivery_transition(uuid,text,jsonb)','execute')
    or not has_function_privilege('app_api','app_private.settle_delivery(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,bigint,bigint)','execute')
  then raise exception 'DELIVERY_PRIVILEGES_WRONG'; end if;
  select count(*) into n from app.order_deliveries where restaurant_id=other_restaurant;
  if n<>0 then raise exception 'DELIVERY_FOREIGN_RESTAURANT_ROWS'; end if;
end $order_deliveries_tests$;
commit;
