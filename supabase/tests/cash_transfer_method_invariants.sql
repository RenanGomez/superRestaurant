-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises the transfer method of app_private.collect_simple_payment (through the delivery guard's public
-- name): total and partial collection, optional reference, tip on the payment only, no cash movement, no
-- tender, rejections, idempotent replay, report `transferCapturedMinor` and tenant isolation, plus the
-- app.payments CHECK shape.
begin;
create function pg_temp.tt_cmd(
  p_restaurant uuid, p_branch uuid, p_session uuid, p_order uuid, p_session_version bigint, p_order_version bigint,
  p_payment uuid, p_amount bigint, p_method text, p_seq bigint, p_event uuid, p_key text, p_device uuid,
  p_now text, p_extra jsonb
) returns jsonb language sql as $f$
  select pg_catalog.jsonb_build_object(
    'schemaVersion',1,
    'scope',pg_catalog.jsonb_build_object('restaurantId',p_restaurant::text,'branchId',p_branch::text),
    'cashRegisterSessionId',p_session::text,'cashRegisterExpectedVersion',p_session_version,
    'orderId',p_order::text,'orderExpectedVersion',p_order_version,'paymentId',p_payment::text,
    'amountMinor',p_amount,'method',p_method,
    'cardManualEvidence','null'::jsonb,
    'localSequence',p_seq,'eventId',p_event::text,'idempotencyKey',p_key,'deviceId',p_device::text,'occurredAt',p_now
  ) || p_extra
$f$;
create function pg_temp.tt_pay(
  p_restaurant uuid, p_branch uuid, p_order uuid, p_payment uuid, p_event uuid, p_key text,
  p_amount bigint, p_method text, p_extra jsonb
) returns jsonb language sql as $f$
  select pg_catalog.jsonb_build_object(
    'schemaVersion',1,'paymentId',p_payment::text,'eventId',p_event::text,'restaurantId',p_restaurant::text,
    'branchId',p_branch::text,'orderId',p_order::text,
    'amount',pg_catalog.jsonb_build_object('amountMinor',p_amount,'currency','MXN'),
    'method',p_method,'idempotencyKey',p_key,'state','captured'
  ) || p_extra
$f$;
do $cash_transfer_method_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  foreign_actor uuid := gen_random_uuid();
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_restaurant uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  membership uuid := gen_random_uuid();
  foreign_membership uuid := gen_random_uuid();
  v_register uuid := gen_random_uuid();
  v_shift uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  order_1 uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  pay_1 uuid := gen_random_uuid();
  pay_2 uuid := gen_random_uuid();
  pay_x uuid := gen_random_uuid();
  event_1 uuid := gen_random_uuid();
  event_2 uuid := gen_random_uuid();
  event_x uuid := gen_random_uuid();
  now_text text := pg_catalog.to_char(pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  sess app.cash_register_sessions%rowtype;
  ord app.orders%rowtype;
  result jsonb;
  replayed jsonb;
  report jsonb;
  cmd jsonb;
  pay jsonb;
  n integer;
begin
  if actor is null then raise exception 'CASH_TRANSFER_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone) values
    (restaurant,'rollback-only cash transfer','America/Hermosillo'),
    (other_restaurant,'rollback-only cash transfer foreign','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (branch,restaurant,'rollback-only cash transfer branch'),
    (other_branch,other_restaurant,'rollback-only cash transfer foreign branch');
  insert into auth.users(id,email) values (foreign_actor,'local-cash-transfer-foreign@invalid.test');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values
    (membership,actor,restaurant,branch,actor),
    (foreign_membership,foreign_actor,other_restaurant,other_branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values
    (membership,'cashier',actor),
    (foreign_membership,'cashier',actor);

  insert into app.cash_register_sessions(
    id,restaurant_id,branch_id,register_id,shift_id,cashier_id,currency,status,opening_float_minor,aggregate,version,
    opened_at,opened_by
  ) values (
    v_session,restaurant,branch,v_register,v_shift,actor,'MXN','open',10000,pg_catalog.jsonb_build_object(
      'schemaVersion',1,'cashRegisterId',v_session::text,'restaurantId',restaurant::text,'branchId',branch::text,
      'registerId',v_register::text,'shiftId',v_shift::text,'cashierId',actor::text,'currency','MXN','status','open',
      'openingFloat',pg_catalog.jsonb_build_object('amountMinor',10000,'currency','MXN'),
      'openedByActorId',actor::text,'openedAt',now_text,'openedDeviceId',device::text,'movements','[]'::jsonb
    ),1,pg_catalog.clock_timestamp(),actor
  );
  insert into app.orders(id,restaurant_id,branch_id,channel,status,aggregate,version,created_by,updated_by)
  values (order_1,restaurant,branch,'counter','open',pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',order_1::text,'restaurantId',restaurant::text,'branchId',branch::text,'channel','counter',
    'status','open','currency','MXN','timeZone','America/Hermosillo','items','[]'::jsonb
  ),1,actor,actor);

  -- ---- Schema guards: the table itself refuses a transfer with terminal evidence, a long reference or a tender.
  begin
    insert into app.payments(id,restaurant_id,branch_id,order_id,cash_register_session_id,method,amount_minor,currency,state,
      manual_provider,manual_terminal_id,aggregate,captured_at,captured_by)
    values(gen_random_uuid(),restaurant,branch,order_1,v_session,'transfer',200,'MXN','captured','p','t','{}'::jsonb,now(),actor);
    raise exception 'CASH_TRANSFER_TERMINAL_EVIDENCE_ACCEPTED';
  exception when check_violation then null; end;
  begin
    insert into app.payments(id,restaurant_id,branch_id,order_id,cash_register_session_id,method,amount_minor,currency,state,
      manual_reference,aggregate,captured_at,captured_by)
    values(gen_random_uuid(),restaurant,branch,order_1,v_session,'transfer',200,'MXN','captured',repeat('x',65),'{}'::jsonb,now(),actor);
    raise exception 'CASH_TRANSFER_LONG_REFERENCE_ACCEPTED';
  exception when check_violation then null; end;
  begin
    insert into app.payments(id,restaurant_id,branch_id,order_id,cash_register_session_id,method,amount_minor,currency,state,
      aggregate,captured_at,captured_by,tendered_amount_minor,change_minor)
    values(gen_random_uuid(),restaurant,branch,order_1,v_session,'transfer',200,'MXN','captured','{}'::jsonb,now(),actor,300,100);
    raise exception 'CASH_TRANSFER_TENDER_ACCEPTED';
  exception when check_violation then null; end;
  begin
    insert into app.payments(id,restaurant_id,branch_id,order_id,cash_register_session_id,method,amount_minor,currency,state,
      aggregate,captured_at,captured_by)
    values(gen_random_uuid(),restaurant,branch,order_1,v_session,'wire',200,'MXN','captured','{}'::jsonb,now(),actor);
    raise exception 'CASH_TRANSFER_UNKNOWN_METHOD_ACCEPTED';
  exception when check_violation then null; end;

  -- ---- Rejections (before any mutation).
  select * into sess from app.cash_register_sessions where id=v_session;
  select * into ord from app.orders where id=order_1;
  -- terminal evidence on a transfer
  cmd := pg_temp.tt_cmd(restaurant,branch,v_session,order_1,1,1,pay_x,2000,'transfer',1,event_x,'k-x',device,now_text,
    '{"cardManualEvidence":{"externalConfirmed":true,"provider":"Terminal","terminalId":"t-1","reference":null}}');
  pay := pg_temp.tt_pay(restaurant,branch,order_1,pay_x,event_x,'k-x',2000,'transfer','{}');
  execute 'set local role app_api';
  result := app_private.collect_simple_payment(actor,cmd,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"partially_paid"'),sess.aggregate,5000,0);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'CASH_TRANSFER_EVIDENCE_NOT_REJECTED'; end if;
  -- tender on a transfer
  cmd := pg_temp.tt_cmd(restaurant,branch,v_session,order_1,1,1,pay_x,2000,'transfer',1,event_x,'k-x',device,now_text,'{"tenderedAmountMinor":2500}');
  execute 'set local role app_api';
  result := app_private.collect_simple_payment(actor,cmd,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"partially_paid"'),sess.aggregate,5000,0);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'CASH_TRANSFER_TENDER_NOT_REJECTED'; end if;
  -- reference too long, padded, with a control character, or not a string
  foreach pay in array array[
    pg_catalog.jsonb_build_object('transferReference',repeat('x',65)),
    pg_catalog.jsonb_build_object('transferReference',' SPEI '),
    pg_catalog.jsonb_build_object('transferReference',''),
    pg_catalog.jsonb_build_object('transferReference',E'SP\nEI'),
    pg_catalog.jsonb_build_object('transferReference',12345)
  ] loop
    cmd := pg_temp.tt_cmd(restaurant,branch,v_session,order_1,1,1,pay_x,2000,'transfer',1,event_x,'k-x',device,now_text,pay);
    execute 'set local role app_api';
    result := app_private.collect_simple_payment(actor,cmd,
      pg_temp.tt_pay(restaurant,branch,order_1,pay_x,event_x,'k-x',2000,'transfer','{}'),
      pg_catalog.jsonb_set(ord.aggregate,'{status}','"partially_paid"'),sess.aggregate,5000,0);
    execute 'reset role';
    if result->>'status'<>'conflict' then raise exception 'CASH_TRANSFER_BAD_REFERENCE_NOT_REJECTED'; end if;
  end loop;
  pay := pg_temp.tt_pay(restaurant,branch,order_1,pay_x,event_x,'k-x',2000,'transfer','{}');
  -- a reference on a cash collection
  cmd := pg_temp.tt_cmd(restaurant,branch,v_session,order_1,1,1,pay_x,2000,'cash',1,event_x,'k-x',device,now_text,'{"transferReference":"SPEI-1"}');
  execute 'set local role app_api';
  result := app_private.collect_simple_payment(actor,cmd,pg_temp.tt_pay(restaurant,branch,order_1,pay_x,event_x,'k-x',2000,'cash','{}'),
    pg_catalog.jsonb_set(ord.aggregate,'{status}','"partially_paid"'),
    pg_catalog.jsonb_set(sess.aggregate,'{movements}',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'movementId',pay_x::text,'eventId',event_x::text,'idempotencyKey','k-x','restaurantId',restaurant::text,'branchId',branch::text,
      'cashRegisterId',v_session::text,'registerId',v_register::text,'shiftId',v_shift::text,'cashierId',actor::text,
      'actorId',actor::text,'deviceId',device::text,'localSequence',1,'occurredAt',now_text,'type','cash_sale','direction','in',
      'amount',pg_catalog.jsonb_build_object('amountMinor',2000,'currency','MXN'),
      'source',pg_catalog.jsonb_build_object('type','payment','paymentId',pay_x::text)))),5000,0);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'CASH_TRANSFER_REFERENCE_ON_CASH_NOT_REJECTED'; end if;
  -- a transfer that tries to append a cash movement to the register
  cmd := pg_temp.tt_cmd(restaurant,branch,v_session,order_1,1,1,pay_x,2000,'transfer',1,event_x,'k-x',device,now_text,'{}');
  execute 'set local role app_api';
  result := app_private.collect_simple_payment(actor,cmd,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"partially_paid"'),
    pg_catalog.jsonb_set(sess.aggregate,'{movements}',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('movementId',pay_x::text))),5000,0);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'CASH_TRANSFER_CASH_MOVEMENT_NOT_REJECTED'; end if;
  -- foreign branch actor
  cmd := pg_temp.tt_cmd(restaurant,branch,v_session,order_1,1,1,pay_x,2000,'transfer',1,event_x,'k-x',device,now_text,'{}');
  execute 'set local role app_api';
  result := app_private.collect_simple_payment(foreign_actor,cmd,pay,
    pg_catalog.jsonb_set(ord.aggregate,'{status}','"partially_paid"'),sess.aggregate,5000,0);
  execute 'reset role';
  if result->>'status'<>'forbidden' then raise exception 'CASH_TRANSFER_FOREIGN_ACTOR_ACCEPTED'; end if;
  select count(*) into n from app.payments where restaurant_id=restaurant;
  if n<>0 then raise exception 'CASH_TRANSFER_REJECTION_PERSISTED_PAYMENT'; end if;

  -- ---- Partial transfer with a reference and a tip: payment row only, register untouched.
  cmd := pg_temp.tt_cmd(restaurant,branch,v_session,order_1,1,1,pay_1,2000,'transfer',1,event_1,'k-t1',device,now_text,
    '{"transferReference":"SPEI-0001","tipMinor":100}');
  pay := pg_temp.tt_pay(restaurant,branch,order_1,pay_1,event_1,'k-t1',2000,'transfer','{"tip":{"amountMinor":100,"currency":"MXN"}}');
  execute 'set local role app_api';
  result := app_private.collect_simple_payment(actor,cmd,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"partially_paid"'),sess.aggregate,5000,0);
  execute 'reset role';
  if result->>'method'<>'transfer' or result->>'orderStatus'<>'partially_paid' or (result->>'remainingBalanceMinor')::bigint<>3000
    or result->'tenderedAmountMinor' is distinct from 'null'::jsonb or result->'changeMinor' is distinct from 'null'::jsonb
    or (result->>'tipMinor')::bigint<>100 or (result->>'amountMinor')::bigint<>2000
  then raise exception 'CASH_TRANSFER_PARTIAL_REJECTED'; end if;
  if (select manual_reference from app.payments where id=pay_1) is distinct from 'SPEI-0001'
    or (select manual_provider from app.payments where id=pay_1) is not null
    or (select tip_minor from app.payments where id=pay_1)<>100
    or (select tendered_amount_minor from app.payments where id=pay_1) is not null
  then raise exception 'CASH_TRANSFER_PAYMENT_COLUMNS_WRONG'; end if;
  select count(*) into n from app.cash_movements where cash_register_session_id=v_session;
  if n<>0 then raise exception 'CASH_TRANSFER_CREATED_CASH_MOVEMENT'; end if;
  if (select last_sequence from app_private.financial_device_sequences where device_id=device and branch_id=branch)<>1
  then raise exception 'CASH_TRANSFER_SEQUENCE_WRONG'; end if;

  -- ---- Idempotent replay and divergent replay.
  select * into ord from app.orders where id=order_1;
  execute 'set local role app_api';
  replayed := app_private.collect_simple_payment(actor,cmd,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"partially_paid"'),sess.aggregate,5000,0);
  execute 'reset role';
  if replayed->>'replayed'<>'true' or replayed->>'paymentId'<>pay_1::text or (replayed->>'tipMinor')::bigint<>100
  then raise exception 'CASH_TRANSFER_REPLAY_DIFFERS'; end if;
  select count(*) into n from app.payments where restaurant_id=restaurant;
  if n<>1 then raise exception 'CASH_TRANSFER_REPLAY_DUPLICATED_PAYMENT'; end if;
  execute 'set local role app_api';
  replayed := app_private.collect_simple_payment(actor,pg_catalog.jsonb_set(cmd,'{transferReference}','"SPEI-OTHER"'),pay,
    pg_catalog.jsonb_set(ord.aggregate,'{status}','"partially_paid"'),sess.aggregate,5000,0);
  execute 'reset role';
  if replayed->>'status'<>'conflict' then raise exception 'CASH_TRANSFER_DIVERGENT_REPLAY_ACCEPTED'; end if;

  -- ---- Final transfer without a reference pays the order.
  select * into sess from app.cash_register_sessions where id=v_session;
  select * into ord from app.orders where id=order_1;
  cmd := pg_temp.tt_cmd(restaurant,branch,v_session,order_1,sess.version,ord.version,pay_2,3000,'transfer',2,event_2,'k-t2',device,now_text,'{}');
  pay := pg_temp.tt_pay(restaurant,branch,order_1,pay_2,event_2,'k-t2',3000,'transfer','{}');
  execute 'set local role app_api';
  result := app_private.collect_simple_payment(actor,cmd,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"paid"'),sess.aggregate,5000,2000);
  execute 'reset role';
  if result->>'orderStatus'<>'paid' or (result->>'remainingBalanceMinor')::bigint<>0 or (result->>'tipMinor')::bigint<>0
  then raise exception 'CASH_TRANSFER_FINAL_REJECTED'; end if;
  if (select manual_reference from app.payments where id=pay_2) is not null then raise exception 'CASH_TRANSFER_REFERENCE_NOT_OPTIONAL'; end if;

  -- ---- Report: transfers apart, expected cash untouched, tips counted but not as cash tips.
  execute 'set local role app_api';
  report := app_private.read_cash_register_operational_report(actor,restaurant,branch,v_register,v_session,device);
  execute 'reset role';
  if (report->>'transferCapturedMinor')::bigint<>5000 or (report->>'cashCapturedMinor')::bigint<>0
    or (report->>'cardManualCapturedMinor')::bigint<>0 or (report->>'totalCapturedMinor')::bigint<>5000
    or (report->>'paymentCount')::bigint<>2 or (report->>'tipsMinor')::bigint<>100 or (report->>'cashTipsMinor')::bigint<>0
    or (report->>'movementCount')::bigint<>0
    or (report->'register'->>'expectedCashBalanceMinor')::bigint<>10000
  then raise exception 'CASH_TRANSFER_REPORT_WRONG'; end if;
  -- A foreign actor reads nothing from this branch, and our actor cannot read the foreign restaurant's register.
  execute 'set local role app_api';
  report := app_private.read_cash_register_operational_report(foreign_actor,restaurant,branch,v_register,v_session,device);
  execute 'reset role';
  if report->>'status'<>'forbidden' then raise exception 'CASH_TRANSFER_REPORT_FOREIGN_ACCEPTED'; end if;
  execute 'set local role app_api';
  report := app_private.read_cash_register_operational_report(actor,other_restaurant,other_branch,v_register,v_session,device);
  execute 'reset role';
  if report->>'status' is distinct from 'forbidden' then raise exception 'CASH_TRANSFER_REPORT_CROSS_TENANT_ACCEPTED'; end if;
end $cash_transfer_method_tests$;
commit;
