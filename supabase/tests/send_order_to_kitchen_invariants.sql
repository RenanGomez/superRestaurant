-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises app_private.send_order_to_kitchen (S9.1 r12): atomic open+send batch, command-level
-- idempotency (byte-identical retry replays; same key with a different payload is a conflict), a
-- stale expectedVersion is a conflict with zero effects, a mid-batch step failure rolls back the
-- whole batch (atomicity), and a tenant without a real membership at the order's own scope never
-- gets more than conflict/forbidden back.
begin;
do $send_order_to_kitchen_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  other_actor uuid := gen_random_uuid();
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_restaurant uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  membership uuid := gen_random_uuid();
  other_membership uuid := gen_random_uuid();
  test_order_id uuid := gen_random_uuid();
  item1 uuid := gen_random_uuid();
  item2 uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  now_at timestamptz := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
  now_text text := pg_catalog.to_char(pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  snapshot jsonb := pg_catalog.jsonb_build_object(
    'catalogVersion','11111111-1111-1111-1111-111111111111','productId','22222222-2222-2222-2222-222222222222',
    'name','Taco','sku','TACO','stationId','kitchen','unit','piece',
    'unitPrice',pg_catalog.jsonb_build_object('amountMinor',4900,'currency','MXN'),
    'modifiers',pg_catalog.jsonb_build_array()
  );
  v1 jsonb;
  v2 jsonb;
  v3 jsonb;
  step_open jsonb;
  step_item1 jsonb;
  step_item2 jsonb;
  command jsonb;
  steps jsonb;
  result jsonb;
  replayed jsonb;
  bad_payload_command jsonb;
  audit_count_before integer;
  audit_count_after integer;
  command_count integer;
begin
  if actor is null then raise exception 'SEND_ORDER_TO_KITCHEN_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone) values
    (restaurant,'rollback-only send-to-kitchen','America/Hermosillo'),
    (other_restaurant,'rollback-only send-to-kitchen foreign','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (branch,restaurant,'rollback-only send-to-kitchen branch'),
    (other_branch,other_restaurant,'rollback-only send-to-kitchen foreign branch');
  insert into auth.users(id,email) values (other_actor,'local-send-to-kitchen-foreign@invalid.test');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values
    (membership,actor,restaurant,branch,actor),
    (other_membership,other_actor,other_restaurant,other_branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values
    (membership,'waiter',actor),
    (other_membership,'waiter',actor);

  v1 := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',test_order_id::text,'restaurantId',restaurant::text,'branchId',branch::text,
    'channel','counter','currency','MXN','timeZone','America/Hermosillo','status','draft','items','[]'::jsonb
  );
  execute 'set local role app_api';
  result := app_private.persist_order_mutation(actor,0,v1,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'restaurantId',restaurant::text,'branchId',branch::text,'orderId',test_order_id::text,'actorId',actor::text,
    'deviceId',device::text,'occurredAt',now_text,'operation','order.created','entityType','order',
    'entityId',test_order_id::text,'to','draft'
  ));
  if result->>'status'<>'saved' then raise exception 'SEND_ORDER_TO_KITCHEN_SETUP_CREATE_REJECTED'; end if;

  v2 := pg_catalog.jsonb_set(v1,'{items}',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'orderItemId',item1::text,'snapshot',snapshot,'quantity',1,'restaurantId',restaurant::text,
    'branchId',branch::text,'status','pending','note',null
  )));
  result := app_private.persist_order_mutation(actor,1,v2,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'restaurantId',restaurant::text,'branchId',branch::text,'orderId',test_order_id::text,'actorId',actor::text,
    'deviceId',device::text,'occurredAt',now_text,'operation','order.item_added','entityType','order_item',
    'entityId',item1::text,'orderItemId',item1::text
  ));
  if result->>'status'<>'saved' then raise exception 'SEND_ORDER_TO_KITCHEN_SETUP_ITEM1_REJECTED'; end if;

  v3 := pg_catalog.jsonb_set(v2,'{items}',(v2->'items') || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'orderItemId',item2::text,'snapshot',snapshot,'quantity',1,'restaurantId',restaurant::text,
    'branchId',branch::text,'status','pending','note',null
  )));
  result := app_private.persist_order_mutation(actor,2,v3,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'restaurantId',restaurant::text,'branchId',branch::text,'orderId',test_order_id::text,'actorId',actor::text,
    'deviceId',device::text,'occurredAt',now_text,'operation','order.item_added','entityType','order_item',
    'entityId',item2::text,'orderItemId',item2::text
  ));
  if result->>'status'<>'saved' then raise exception 'SEND_ORDER_TO_KITCHEN_SETUP_ITEM2_REJECTED'; end if;
  execute 'reset role';

  -- order is now version 3: draft, item1 pending, item2 pending.
  command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'orderId',test_order_id::text,'orderItemIds',pg_catalog.jsonb_build_array(item1::text,item2::text),
    'expectedVersion',3,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'deviceId',device::text,'occurredAt',now_text
  );

  step_open := pg_catalog.jsonb_build_object('order',pg_catalog.jsonb_set(v3,'{status}','"open"'::jsonb),
    'audit',pg_catalog.jsonb_build_object(
      'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
      'restaurantId',restaurant::text,'branchId',branch::text,'orderId',test_order_id::text,'actorId',actor::text,
      'deviceId',device::text,'occurredAt',now_text,'operation','order.state_changed','entityType','order',
      'entityId',test_order_id::text,'from','draft','to','open'
    ));
  step_item1 := pg_catalog.jsonb_build_object(
    'order',pg_catalog.jsonb_set(step_open->'order','{items,0,status}','"sent"'::jsonb),
    'audit',pg_catalog.jsonb_build_object(
      'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
      'restaurantId',restaurant::text,'branchId',branch::text,'orderId',test_order_id::text,'actorId',actor::text,
      'deviceId',device::text,'occurredAt',now_text,'operation','order_item.state_changed','entityType','order_item',
      'entityId',item1::text,'orderItemId',item1::text,'from','pending','to','sent'
    ));
  step_item2 := pg_catalog.jsonb_build_object(
    'order',pg_catalog.jsonb_set(step_item1->'order','{items,1,status}','"sent"'::jsonb),
    'audit',pg_catalog.jsonb_build_object(
      'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
      'restaurantId',restaurant::text,'branchId',branch::text,'orderId',test_order_id::text,'actorId',actor::text,
      'deviceId',device::text,'occurredAt',now_text,'operation','order_item.state_changed','entityType','order_item',
      'entityId',item2::text,'orderItemId',item2::text,'from','pending','to','sent'
    ));
  steps := pg_catalog.jsonb_build_array(step_open,step_item1,step_item2);

  -- Atomicity: a mid-batch step whose expectation no longer matches the current aggregate (here,
  -- item2's step wrongly still claims it starts 'pending' after a first attempt already advanced
  -- it -- simulated directly by asserting the real current status is 'pending' and poisoning the
  -- *second* step's 'from' to an impossible value) must roll back everything already applied by
  -- the earlier steps in the same call, including the 'open' transition and item1's send.
  audit_count_before := (select count(*) from app.order_audit_events where order_id=test_order_id);
  command_count := (select count(*) from app.order_command_events where order_id=test_order_id);
  execute 'set local role app_api';
  result := app_private.send_order_to_kitchen(actor,3,
    pg_catalog.jsonb_set(command,'{idempotencyKey}',to_jsonb(gen_random_uuid()::text)),
    pg_catalog.jsonb_set(steps,'{2,audit,from}','"sent"'::jsonb));
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'SEND_ORDER_TO_KITCHEN_ATOMICITY_NOT_REJECTED'; end if;
  audit_count_after := (select count(*) from app.order_audit_events where order_id=test_order_id);
  if audit_count_after<>audit_count_before then raise exception 'SEND_ORDER_TO_KITCHEN_ATOMICITY_LEAKED_EVENTS'; end if;
  if (select count(*) from app.order_command_events where order_id=test_order_id)<>command_count
  then raise exception 'SEND_ORDER_TO_KITCHEN_ATOMICITY_LEAKED_COMMAND'; end if;
  if (select version from app.orders where id=test_order_id)<>3
  then raise exception 'SEND_ORDER_TO_KITCHEN_ATOMICITY_VERSION_ADVANCED'; end if;

  -- A stale expectedVersion is a conflict with zero effects, even with an otherwise well-formed
  -- command/steps pair.
  execute 'set local role app_api';
  result := app_private.send_order_to_kitchen(actor,2,
    pg_catalog.jsonb_set(pg_catalog.jsonb_set(command,'{idempotencyKey}',to_jsonb(gen_random_uuid()::text)),'{expectedVersion}','2'::jsonb),
    steps);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'SEND_ORDER_TO_KITCHEN_STALE_VERSION_NOT_REJECTED'; end if;
  if (select count(*) from app.order_audit_events where order_id=test_order_id)<>audit_count_before
  then raise exception 'SEND_ORDER_TO_KITCHEN_STALE_VERSION_LEAKED_EVENTS'; end if;

  -- The real, well-formed batch: version 3 -> 6 (open + 2 sends), one command event recorded.
  execute 'set local role app_api';
  result := app_private.send_order_to_kitchen(actor,3,command,steps);
  execute 'reset role';
  if result->>'status'<>'saved' or (result->>'version')::bigint<>6
    or pg_catalog.jsonb_array_length(result->'kdsEvents')<>3
  then raise exception 'SEND_ORDER_TO_KITCHEN_APPLY_REJECTED'; end if;
  if (select version from app.orders where id=test_order_id)<>6
    or (select status from app.orders where id=test_order_id)<>'open'
  then raise exception 'SEND_ORDER_TO_KITCHEN_APPLY_NOT_PERSISTED'; end if;
  if (select count(*) from app.order_command_events where order_id=test_order_id and idempotency_key=command->>'idempotencyKey')<>1
  then raise exception 'SEND_ORDER_TO_KITCHEN_COMMAND_EVENT_MISSING'; end if;

  -- Byte-identical retry (same actor/scope/idempotencyKey, same payload) replays the stored result.
  execute 'set local role app_api';
  replayed := app_private.send_order_to_kitchen(actor,3,command,steps);
  execute 'reset role';
  if replayed->>'status'<>'replayed' or (replayed->>'version')::bigint<>6
    or replayed->'order'<>result->'order'
  then raise exception 'SEND_ORDER_TO_KITCHEN_REPLAY_MISMATCH'; end if;
  if (select count(*) from app.order_audit_events where order_id=test_order_id)<>audit_count_before+3
  then raise exception 'SEND_ORDER_TO_KITCHEN_REPLAY_DUPLICATED_EVENTS'; end if;

  -- Same idempotency key, different payload (expectedVersion differs) is a conflict, not a replay.
  bad_payload_command := pg_catalog.jsonb_set(command,'{expectedVersion}','3'::jsonb);
  execute 'set local role app_api';
  result := app_private.send_order_to_kitchen(actor,3,
    pg_catalog.jsonb_set(bad_payload_command,'{orderItemIds}',pg_catalog.jsonb_build_array(item1::text)),steps);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'SEND_ORDER_TO_KITCHEN_KEY_REUSE_ACCEPTED'; end if;

  -- A principal with no membership at the order's own restaurant/branch never gets more than
  -- conflict/forbidden back, and leaves no new events.
  audit_count_before := (select count(*) from app.order_audit_events where order_id=test_order_id);
  execute 'set local role app_api';
  result := app_private.send_order_to_kitchen(other_actor,6,
    pg_catalog.jsonb_set(pg_catalog.jsonb_set(command,'{idempotencyKey}',to_jsonb(gen_random_uuid()::text)),
      '{expectedVersion}','6'::jsonb),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'order',pg_catalog.jsonb_set(result->'order','{status}','"open"'::jsonb),
      'audit',pg_catalog.jsonb_build_object(
        'schemaVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
        'restaurantId',restaurant::text,'branchId',branch::text,'orderId',test_order_id::text,'actorId',other_actor::text,
        'deviceId',device::text,'occurredAt',now_text,'operation','order.state_changed','entityType','order',
        'entityId',test_order_id::text,'from','open','to','open'
      ))));
  execute 'reset role';
  if result->>'status' not in ('conflict','forbidden') then raise exception 'SEND_ORDER_TO_KITCHEN_FOREIGN_ACTOR_ACCEPTED'; end if;
  if (select count(*) from app.order_audit_events where order_id=test_order_id)<>audit_count_before
  then raise exception 'SEND_ORDER_TO_KITCHEN_FOREIGN_ACTOR_LEAKED_EVENTS'; end if;

  if pg_catalog.has_function_privilege('authenticated','app_private.send_order_to_kitchen(uuid,bigint,jsonb,jsonb)','EXECUTE')
  then raise exception 'SEND_ORDER_TO_KITCHEN_AUTHENTICATED_EXECUTE_GRANTED'; end if;
end
$send_order_to_kitchen_tests$;
commit;
