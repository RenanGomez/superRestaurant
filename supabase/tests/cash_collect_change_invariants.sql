-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises app_private.collect_simple_payment (cash tender + change, cash tip as a `tip_in`
-- movement, card tip on the payment only, rejections, idempotent replay, branch isolation),
-- app_private.read_cash_register_operational_report (tips and movements) and
-- app_private.close_cash_register (expected balance with and without cash tips).
begin;
create function pg_temp.t_cmd(
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
    'cardManualEvidence',case when p_method='cash' then 'null'::jsonb
      else pg_catalog.jsonb_build_object('externalConfirmed',true,'provider','Terminal','terminalId','t-1','reference',null) end,
    'localSequence',p_seq,'eventId',p_event::text,'idempotencyKey',p_key,'deviceId',p_device::text,'occurredAt',p_now
  ) || p_extra
$f$;
create function pg_temp.t_pay(
  p_restaurant uuid, p_branch uuid, p_order uuid, p_payment uuid, p_event uuid, p_key text,
  p_amount bigint, p_method text, p_extra jsonb
) returns jsonb language sql as $f$
  select pg_catalog.jsonb_build_object(
    'schemaVersion',1,'paymentId',p_payment::text,'eventId',p_event::text,'restaurantId',p_restaurant::text,
    'branchId',p_branch::text,'orderId',p_order::text,
    'amount',pg_catalog.jsonb_build_object('amountMinor',p_amount,'currency','MXN'),
    'method',p_method,'idempotencyKey',p_key,'state','captured'
  ) || case when p_method='cash' then '{}'::jsonb
    else pg_catalog.jsonb_build_object('cardManualEvidence',
      pg_catalog.jsonb_build_object('externalConfirmed',true,'provider','Terminal','terminalId','t-1')) end
  || p_extra
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
do $cash_collect_change_tests$
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
  order_2 uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  pay_a uuid := gen_random_uuid();
  pay_card uuid := gen_random_uuid();
  pay_b uuid := gen_random_uuid();
  pay_x uuid := gen_random_uuid();
  now_text text := pg_catalog.to_char(pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  sess app.cash_register_sessions%rowtype;
  ord app.orders%rowtype;
  result jsonb;
  replayed jsonb;
  report jsonb;
  cmd jsonb;
  pay jsonb;
  reg jsonb;
  tip_movement uuid := gen_random_uuid();
  tip_event uuid := gen_random_uuid();
  event_a uuid := gen_random_uuid();
  event_card uuid := gen_random_uuid();
  event_b uuid := gen_random_uuid();
  event_x uuid := gen_random_uuid();
  event_close uuid := gen_random_uuid();
  n integer;
begin
  if actor is null then raise exception 'CASH_COLLECT_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone) values
    (restaurant,'rollback-only cash collect','America/Hermosillo'),
    (other_restaurant,'rollback-only cash collect foreign','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (branch,restaurant,'rollback-only cash collect branch'),
    (other_branch,other_restaurant,'rollback-only cash collect foreign branch');
  insert into auth.users(id,email) values (foreign_actor,'local-cash-collect-foreign@invalid.test');
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
  select o,restaurant,branch,'counter','open',pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',o::text,'restaurantId',restaurant::text,'branchId',branch::text,'channel','counter',
    'status','open','currency','MXN','timeZone','America/Hermosillo','items','[]'::jsonb
  ),1,actor,actor from (values (order_1),(order_2)) as t(o);

  -- ---- Schema guards: the table itself refuses an inconsistent tender, a card tender, a bad tip and a tip_in with a reason.
  select * into sess from app.cash_register_sessions where id=v_session;
  begin
    insert into app.payments(id,restaurant_id,branch_id,order_id,cash_register_session_id,method,amount_minor,currency,state,
      aggregate,captured_at,captured_by,tendered_amount_minor,change_minor)
    values(gen_random_uuid(),restaurant,branch,order_1,v_session,'cash',200,'MXN','captured','{}'::jsonb,now(),actor,300,50);
    raise exception 'CASH_COLLECT_BAD_CHANGE_ACCEPTED';
  exception when check_violation then null; end;
  begin
    insert into app.payments(id,restaurant_id,branch_id,order_id,cash_register_session_id,method,amount_minor,currency,state,
      manual_provider,manual_terminal_id,aggregate,captured_at,captured_by,tendered_amount_minor,change_minor)
    values(gen_random_uuid(),restaurant,branch,order_1,v_session,'card_manual',200,'MXN','captured','p','t','{}'::jsonb,now(),actor,300,100);
    raise exception 'CASH_COLLECT_CARD_TENDER_ACCEPTED';
  exception when check_violation then null; end;
  begin
    insert into app.payments(id,restaurant_id,branch_id,order_id,cash_register_session_id,method,amount_minor,currency,state,
      aggregate,captured_at,captured_by,tendered_amount_minor,change_minor)
    values(gen_random_uuid(),restaurant,branch,order_1,v_session,'cash',200,'MXN','captured','{}'::jsonb,now(),actor,100,-100);
    raise exception 'CASH_COLLECT_TENDER_BELOW_AMOUNT_ACCEPTED';
  exception when check_violation then null; end;
  begin
    insert into app.payments(id,restaurant_id,branch_id,order_id,cash_register_session_id,method,amount_minor,currency,state,
      aggregate,captured_at,captured_by,tip_minor)
    values(gen_random_uuid(),restaurant,branch,order_1,v_session,'cash',200,'MXN','captured','{}'::jsonb,now(),actor,-1);
    raise exception 'CASH_COLLECT_NEGATIVE_TIP_ACCEPTED';
  exception when check_violation then null; end;

  -- ---- Rejections (before any mutation).
  select * into sess from app.cash_register_sessions where id=v_session;
  select * into ord from app.orders where id=order_1;
  reg := pg_catalog.jsonb_set(sess.aggregate,'{movements}',sess.aggregate->'movements'
    || pg_catalog.jsonb_build_array(pg_temp.t_mv(pay_x,event_x,'k-x',restaurant,branch,v_session,v_register,v_shift,actor,device,1,'cash_sale',2000,pay_x,now_text)));
  -- tendered below amount
  cmd := pg_temp.t_cmd(restaurant,branch,v_session,order_1,1,1,pay_x,2000,'cash',1,event_x,'k-x',device,now_text,'{"tenderedAmountMinor":1999,"tipMinor":0}');
  pay := pg_temp.t_pay(restaurant,branch,order_1,pay_x,event_x,'k-x',2000,'cash','{}');
  execute 'set local role app_api';
  result := app_private.collect_simple_payment(actor,cmd,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"partially_paid"'),reg,5000,0);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'CASH_COLLECT_TENDER_BELOW_AMOUNT_NOT_REJECTED'; end if;
  -- tender with a card
  cmd := pg_temp.t_cmd(restaurant,branch,v_session,order_1,1,1,pay_x,2000,'card_manual',1,event_x,'k-x',device,now_text,'{"tenderedAmountMinor":2500}');
  pay := pg_temp.t_pay(restaurant,branch,order_1,pay_x,event_x,'k-x',2000,'card_manual','{}');
  execute 'set local role app_api';
  result := app_private.collect_simple_payment(actor,cmd,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"partially_paid"'),sess.aggregate,5000,0);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'CASH_COLLECT_CARD_TENDER_NOT_REJECTED'; end if;
  -- negative tip
  cmd := pg_temp.t_cmd(restaurant,branch,v_session,order_1,1,1,pay_x,2000,'cash',1,event_x,'k-x',device,now_text,'{"tipMinor":-5}');
  pay := pg_temp.t_pay(restaurant,branch,order_1,pay_x,event_x,'k-x',2000,'cash','{}');
  execute 'set local role app_api';
  result := app_private.collect_simple_payment(actor,cmd,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"partially_paid"'),reg,5000,0);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'CASH_COLLECT_NEGATIVE_TIP_NOT_REJECTED'; end if;
  -- command states a tender the Payment aggregate does not carry
  cmd := pg_temp.t_cmd(restaurant,branch,v_session,order_1,1,1,pay_x,2000,'cash',1,event_x,'k-x',device,now_text,'{"tenderedAmountMinor":3000}');
  pay := pg_temp.t_pay(restaurant,branch,order_1,pay_x,event_x,'k-x',2000,'cash','{}');
  execute 'set local role app_api';
  result := app_private.collect_simple_payment(actor,cmd,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"partially_paid"'),reg,5000,0);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'CASH_COLLECT_UNBACKED_TENDER_NOT_REJECTED'; end if;
  -- wrong change in the Payment aggregate
  cmd := pg_temp.t_cmd(restaurant,branch,v_session,order_1,1,1,pay_x,2000,'cash',1,event_x,'k-x',device,now_text,'{"tenderedAmountMinor":3000}');
  pay := pg_temp.t_pay(restaurant,branch,order_1,pay_x,event_x,'k-x',2000,'cash',
    '{"tenderedAmount":{"amountMinor":3000,"currency":"MXN"},"change":{"amountMinor":999,"currency":"MXN"}}');
  execute 'set local role app_api';
  result := app_private.collect_simple_payment(actor,cmd,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"partially_paid"'),reg,5000,0);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'CASH_COLLECT_WRONG_CHANGE_NOT_REJECTED'; end if;
  -- cash tip without its tip_in movement in the register
  cmd := pg_temp.t_cmd(restaurant,branch,v_session,order_1,1,1,pay_x,2000,'cash',1,event_x,'k-x',device,now_text,'{"tipMinor":300}');
  pay := pg_temp.t_pay(restaurant,branch,order_1,pay_x,event_x,'k-x',2000,'cash','{"tip":{"amountMinor":300,"currency":"MXN"}}');
  execute 'set local role app_api';
  result := app_private.collect_simple_payment(actor,cmd,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"partially_paid"'),reg,5000,0);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'CASH_COLLECT_TIP_WITHOUT_MOVEMENT_NOT_REJECTED'; end if;
  -- foreign branch actor
  execute 'set local role app_api';
  result := app_private.collect_simple_payment(foreign_actor,
    pg_temp.t_cmd(restaurant,branch,v_session,order_1,1,1,pay_x,2000,'cash',1,event_x,'k-x',device,now_text,'{}'),
    pg_temp.t_pay(restaurant,branch,order_1,pay_x,event_x,'k-x',2000,'cash','{}'),
    pg_catalog.jsonb_set(ord.aggregate,'{status}','"partially_paid"'),reg,5000,0);
  execute 'reset role';
  if result->>'status'<>'forbidden' then raise exception 'CASH_COLLECT_FOREIGN_ACTOR_ACCEPTED'; end if;
  select count(*) into n from app.payments where restaurant_id=restaurant;
  if n<>0 then raise exception 'CASH_COLLECT_REJECTION_PERSISTED_PAYMENT'; end if;

  -- ---- A: exact cash, no tender keys at all (legacy shape) -> no tender, no change, no tip.
  reg := pg_catalog.jsonb_set(sess.aggregate,'{movements}',sess.aggregate->'movements'
    || pg_catalog.jsonb_build_array(pg_temp.t_mv(pay_a,event_a,'k-a',restaurant,branch,v_session,v_register,v_shift,actor,device,1,'cash_sale',2000,pay_a,now_text)));
  cmd := pg_temp.t_cmd(restaurant,branch,v_session,order_1,1,1,pay_a,2000,'cash',1,event_a,'k-a',device,now_text,'{}');
  pay := pg_temp.t_pay(restaurant,branch,order_1,pay_a,event_a,'k-a',2000,'cash','{}');
  execute 'set local role app_api';
  result := app_private.collect_simple_payment(actor,cmd,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"partially_paid"'),reg,5000,0);
  execute 'reset role';
  if result->>'orderStatus'<>'partially_paid' or (result->>'remainingBalanceMinor')::bigint<>3000
    or result->'tenderedAmountMinor' is distinct from 'null'::jsonb or result->'changeMinor' is distinct from 'null'::jsonb
    or (result->>'tipMinor')::bigint<>0 then raise exception 'CASH_COLLECT_EXACT_CASH_REJECTED'; end if;

  -- ---- Card payment with a tip: recorded on the Payment only, no cash movement, no sequence gap.
  select * into sess from app.cash_register_sessions where id=v_session;
  select * into ord from app.orders where id=order_2;
  cmd := pg_temp.t_cmd(restaurant,branch,v_session,order_2,2,1,pay_card,1000,'card_manual',2,event_card,'k-card',device,now_text,'{"tipMinor":100}');
  pay := pg_temp.t_pay(restaurant,branch,order_2,pay_card,event_card,'k-card',1000,'card_manual','{"tip":{"amountMinor":100,"currency":"MXN"}}');
  execute 'set local role app_api';
  result := app_private.collect_simple_payment(actor,cmd,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"partially_paid"'),sess.aggregate,4000,0);
  execute 'reset role';
  if (result->>'tipMinor')::bigint<>100 or result->'tenderedAmountMinor' is distinct from 'null'::jsonb
    or result->'changeMinor' is distinct from 'null'::jsonb then raise exception 'CASH_COLLECT_CARD_TIP_REJECTED'; end if;
  select count(*) into n from app.cash_movements where cash_register_session_id=v_session and movement_type='tip_in';
  if n<>0 then raise exception 'CASH_COLLECT_CARD_TIP_CREATED_MOVEMENT'; end if;

  -- ---- B: cash with change and a cash tip -> two movements, sequence consumes 3 and 4.
  select * into sess from app.cash_register_sessions where id=v_session;
  select * into ord from app.orders where id=order_1;
  reg := pg_catalog.jsonb_set(sess.aggregate,'{movements}',sess.aggregate->'movements'
    || pg_catalog.jsonb_build_array(
      pg_temp.t_mv(pay_b,event_b,'k-b',restaurant,branch,v_session,v_register,v_shift,actor,device,3,'cash_sale',3000,pay_b,now_text),
      pg_temp.t_mv(tip_movement,tip_event,'k-b:tip',restaurant,branch,v_session,v_register,v_shift,actor,device,4,'tip_in',500,pay_b,now_text)));
  cmd := pg_temp.t_cmd(restaurant,branch,v_session,order_1,3,2,pay_b,3000,'cash',3,event_b,'k-b',device,now_text,
    '{"tenderedAmountMinor":5000,"tipMinor":500}');
  pay := pg_temp.t_pay(restaurant,branch,order_1,pay_b,event_b,'k-b',3000,'cash',
    '{"tenderedAmount":{"amountMinor":5000,"currency":"MXN"},"change":{"amountMinor":2000,"currency":"MXN"},"tip":{"amountMinor":500,"currency":"MXN"}}');
  execute 'set local role app_api';
  result := app_private.collect_simple_payment(actor,cmd,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"paid"'),reg,5000,2000);
  execute 'reset role';
  if result->>'orderStatus'<>'paid' or (result->>'remainingBalanceMinor')::bigint<>0
    or (result->>'tenderedAmountMinor')::bigint<>5000 or (result->>'changeMinor')::bigint<>2000
    or (result->>'tipMinor')::bigint<>500 or (result->>'amountMinor')::bigint<>3000
  then raise exception 'CASH_COLLECT_CHANGE_AND_TIP_REJECTED'; end if;
  if (select amount_minor from app.payments where id=pay_b)<>3000
    or (select tendered_amount_minor from app.payments where id=pay_b)<>5000
    or (select change_minor from app.payments where id=pay_b)<>2000
    or (select tip_minor from app.payments where id=pay_b)<>500
  then raise exception 'CASH_COLLECT_PAYMENT_COLUMNS_WRONG'; end if;
  select count(*) into n from app.cash_movements where cash_register_session_id=v_session and movement_type='tip_in'
    and source_payment_id=pay_b and amount_minor=500 and local_sequence=4 and direction='in';
  if n<>1 then raise exception 'CASH_COLLECT_TIP_MOVEMENT_MISSING'; end if;
  if (select last_sequence from app_private.financial_device_sequences where device_id=device and branch_id=branch)<>4
  then raise exception 'CASH_COLLECT_SEQUENCE_NOT_ADVANCED_BY_TIP'; end if;

  -- ---- Idempotent replay returns the same change and creates nothing.
  select * into sess from app.cash_register_sessions where id=v_session;
  select * into ord from app.orders where id=order_1;
  execute 'set local role app_api';
  replayed := app_private.collect_simple_payment(actor,cmd,pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"paid"'),reg,5000,2000);
  execute 'reset role';
  if replayed->>'replayed'<>'true' or (replayed->>'changeMinor')::bigint<>2000 or (replayed->>'tipMinor')::bigint<>500
    or replayed->>'paymentId'<>pay_b::text then raise exception 'CASH_COLLECT_REPLAY_DIFFERS'; end if;
  select count(*) into n from app.payments where restaurant_id=restaurant;
  if n<>3 then raise exception 'CASH_COLLECT_REPLAY_DUPLICATED_PAYMENT'; end if;
  select count(*) into n from app.cash_movements where cash_register_session_id=v_session;
  if n<>3 then raise exception 'CASH_COLLECT_REPLAY_DUPLICATED_MOVEMENT'; end if;
  -- A divergent command under the same key is a conflict, not a second collection.
  execute 'set local role app_api';
  replayed := app_private.collect_simple_payment(actor,
    pg_catalog.jsonb_set(cmd,'{tenderedAmountMinor}','6000'),pay,pg_catalog.jsonb_set(ord.aggregate,'{status}','"paid"'),reg,5000,2000);
  execute 'reset role';
  if replayed->>'status'<>'conflict' then raise exception 'CASH_COLLECT_DIVERGENT_REPLAY_ACCEPTED'; end if;

  -- ---- Report: tips apart from sales, expected cash includes the cash tip only, movements listed.
  execute 'set local role app_api';
  report := app_private.read_cash_register_operational_report(actor,restaurant,branch,v_register,v_session,device);
  execute 'reset role';
  if (report->>'tipsMinor')::bigint<>600 or (report->>'cashTipsMinor')::bigint<>500
    or (report->>'cashCapturedMinor')::bigint<>5000 or (report->>'cardManualCapturedMinor')::bigint<>1000
    or (report->>'totalCapturedMinor')::bigint<>6000 or (report->>'movementCount')::bigint<>3
    or pg_catalog.jsonb_array_length(report->'movements')<>3
    or (report->'register'->>'expectedCashBalanceMinor')::bigint<>15500
    or (report->>'nextLocalSequence')::bigint<>5
  then raise exception 'CASH_COLLECT_REPORT_WRONG'; end if;
  if not exists (select 1 from pg_catalog.jsonb_array_elements(report->'movements') m
    where m->>'type'='tip_in' and (m->>'amountMinor')::bigint=500 and m->>'sourcePaymentId'=pay_b::text
      and m->'sourceRefundId'='null'::jsonb and m->>'direction'='in')
  then raise exception 'CASH_COLLECT_REPORT_TIP_MOVEMENT_MISSING'; end if;
  -- A foreign actor reads nothing from this branch.
  execute 'set local role app_api';
  report := app_private.read_cash_register_operational_report(foreign_actor,restaurant,branch,v_register,v_session,device);
  execute 'reset role';
  if report->>'status'<>'forbidden' then raise exception 'CASH_COLLECT_REPORT_FOREIGN_ACCEPTED'; end if;

  -- ---- Close: expected = float + cash sales + cash tips; a card tip never reaches the till.
  select * into sess from app.cash_register_sessions where id=v_session;
  cmd := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'cashRegisterSessionId',v_session::text,'cashRegisterExpectedVersion',sess.version,'countedClosingBalanceMinor',15500,
    'reason',null,'eventId',event_close::text,'idempotencyKey','k-close','deviceId',device::text,'occurredAt',now_text);
  reg := sess.aggregate || pg_catalog.jsonb_build_object(
    'status','closed','closedByActorId',actor::text,'closedAt',now_text,'closedDeviceId',device::text,
    'expectedClosingBalance',pg_catalog.jsonb_build_object('amountMinor',15500,'currency','MXN'),
    'countedClosingBalance',pg_catalog.jsonb_build_object('amountMinor',15500,'currency','MXN'),
    'difference',pg_catalog.jsonb_build_object('amountMinor',0,'currency','MXN'),
    'closeEventId',event_close::text,'closeIdempotencyKey','k-close');
  execute 'set local role app_api';
  result := app_private.close_cash_register(actor,cmd,reg);
  execute 'reset role';
  if result->>'status' is distinct from 'closed' or (result->>'expectedCashBalanceMinor')::bigint<>15500
    or (result->>'differenceMinor')::bigint<>0 then raise exception 'CASH_COLLECT_CLOSE_EXPECTED_WRONG'; end if;
  if (select expected_closing_balance_minor from app.cash_register_sessions where id=v_session)<>15500
  then raise exception 'CASH_COLLECT_CLOSE_NOT_PERSISTED'; end if;

  -- ---- tip_in with a reason is not a valid movement.
  begin
    insert into app.cash_movements(id,event_id,idempotency_key,restaurant_id,branch_id,cash_register_session_id,
      register_id,shift_id,cashier_id,actor_id,device_id,local_sequence,movement_type,direction,amount_minor,currency,
      source_payment_id,reason,occurred_at)
    values(gen_random_uuid(),gen_random_uuid(),'k-bad-tip',restaurant,branch,v_session,v_register,v_shift,actor,actor,device,99,
      'tip_in','in',10,'MXN',pay_b,'not allowed',now());
    raise exception 'CASH_COLLECT_TIP_WITH_REASON_ACCEPTED';
  exception when check_violation then null; end;
end $cash_collect_change_tests$;
commit;
