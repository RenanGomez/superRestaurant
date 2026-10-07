-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises app_private.read_branch_day_summary: a day of the Restaurant's zone (America/Hermosillo, UTC-7) with two
-- shifts, three methods, three channels, a settled delivery, a cancelled Order and a no_sale Capture; a day with no
-- activity (zeros, never null); the exact [start, end) boundaries; role gating; Branch/Restaurant isolation;
-- hostile request shapes; and that the reader writes nothing.
begin;
create function pg_temp.ds_order(
  p_restaurant uuid, p_branch uuid, p_order uuid, p_channel text, p_status text, p_extra jsonb
) returns jsonb language sql as $f$
  select pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',p_order::text,'restaurantId',p_restaurant::text,'branchId',p_branch::text,
    'channel',p_channel,'status',p_status,'currency','MXN','timeZone','America/Hermosillo','items','[]'::jsonb
  ) || p_extra
$f$;
create function pg_temp.ds_payment(
  p_restaurant uuid, p_branch uuid, p_order uuid, p_session uuid, p_payment uuid, p_method text,
  p_amount bigint, p_tip bigint, p_at timestamptz, p_actor uuid
) returns void language plpgsql as $f$
begin
  insert into app.payments(id,restaurant_id,branch_id,order_id,cash_register_session_id,method,amount_minor,currency,state,
    manual_provider,manual_terminal_id,aggregate,captured_at,captured_by,tip_minor)
  values (p_payment,p_restaurant,p_branch,p_order,p_session,p_method,p_amount,'MXN','captured',
    case when p_method='card_manual' then 'terminal-x' end, case when p_method='card_manual' then 'T-1' end,
    pg_catalog.jsonb_build_object('schemaVersion',1,'paymentId',p_payment::text,'restaurantId',p_restaurant::text,
      'branchId',p_branch::text,'orderId',p_order::text,'method',p_method,'state','captured',
      'amount',pg_catalog.jsonb_build_object('amountMinor',p_amount,'currency','MXN')),
    p_at,p_actor,p_tip);
end $f$;
create function pg_temp.ds_movement(
  p_restaurant uuid, p_branch uuid, p_session uuid, p_register uuid, p_shift uuid, p_actor uuid, p_seq bigint,
  p_type text, p_direction text, p_amount bigint, p_payment uuid, p_reason text, p_at timestamptz
) returns void language plpgsql as $f$
begin
  insert into app.cash_movements(id,event_id,idempotency_key,restaurant_id,branch_id,cash_register_session_id,register_id,
    shift_id,cashier_id,actor_id,device_id,local_sequence,movement_type,direction,amount_minor,currency,source_payment_id,
    reason,occurred_at)
  values (gen_random_uuid(),gen_random_uuid(),'ds-' || p_seq::text,p_restaurant,p_branch,p_session,p_register,p_shift,
    p_actor,p_actor,'00000000-0000-4000-8000-0000000000d5'::uuid,p_seq,p_type,p_direction,p_amount,'MXN',p_payment,
    p_reason,p_at);
end $f$;
create function pg_temp.ds_session(
  p_restaurant uuid, p_branch uuid, p_session uuid, p_register uuid, p_shift uuid, p_actor uuid, p_float bigint,
  p_opened timestamptz, p_closed timestamptz, p_expected bigint, p_counted bigint
) returns void language plpgsql as $f$
begin
  insert into app.cash_register_sessions(id,restaurant_id,branch_id,register_id,shift_id,cashier_id,currency,status,
    opening_float_minor,expected_closing_balance_minor,counted_closing_balance_minor,difference_minor,aggregate,version,
    opened_at,opened_by,closed_at,closed_by)
  values (p_session,p_restaurant,p_branch,p_register,p_shift,p_actor,'MXN',
    case when p_closed is null then 'open' else 'closed' end,p_float,p_expected,p_counted,
    case when p_closed is null then null else p_counted - p_expected end,
    pg_catalog.jsonb_build_object('schemaVersion',1,'cashRegisterId',p_session::text,'restaurantId',p_restaurant::text,
      'branchId',p_branch::text,'registerId',p_register::text,'shiftId',p_shift::text,'cashierId',p_actor::text,
      'currency','MXN','status',case when p_closed is null then 'open' else 'closed' end,'movements','[]'::jsonb),
    1,p_opened,p_actor,p_closed,case when p_closed is null then null else p_actor end);
end $f$;
create function pg_temp.ds_request(p_restaurant uuid, p_branch uuid, p_date text) returns jsonb language sql as $f$
  select pg_catalog.jsonb_build_object('schemaVersion',1,
    'scope',pg_catalog.jsonb_build_object('restaurantId',p_restaurant::text,'branchId',p_branch::text),'date',p_date)
$f$;
do $branch_day_summary_tests$
declare
  creator uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  u_manager uuid := gen_random_uuid();
  u_viewer uuid := gen_random_uuid();
  u_cashier uuid := gen_random_uuid();
  u_waiter uuid := gen_random_uuid();
  u_courier uuid := gen_random_uuid();
  u_other_branch uuid := gen_random_uuid();
  u_foreign uuid := gen_random_uuid();
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  branch_b uuid := gen_random_uuid();
  other_restaurant uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  shift_a uuid := gen_random_uuid();
  shift_b uuid := gen_random_uuid();
  shift_old uuid := gen_random_uuid();
  reg_a uuid := gen_random_uuid();
  reg_b uuid := gen_random_uuid();
  reg_old uuid := gen_random_uuid();
  s_a uuid := gen_random_uuid();
  s_b uuid := gen_random_uuid();
  s_old uuid := gen_random_uuid();
  o1 uuid := gen_random_uuid();
  o2 uuid := gen_random_uuid();
  o3 uuid := gen_random_uuid();
  o4 uuid := gen_random_uuid();
  o5 uuid := gen_random_uuid();
  o6 uuid := gen_random_uuid();
  o7 uuid := gen_random_uuid();
  o8 uuid := gen_random_uuid();
  o9 uuid := gen_random_uuid();
  o10 uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid();
  p10 uuid := gen_random_uuid();
  mem uuid;
  result jsonb;
  before_counts text;
  after_counts text;
  shift_row jsonb;
  reg_row jsonb;
  plan_line record;
  plan_uses_index boolean := false;
begin
  if creator is null then raise exception 'DAY_SUMMARY_TEST_ACTOR_REQUIRED'; end if;
  insert into app.restaurants(id,name,time_zone) values
    (restaurant,'rollback-only day summary','America/Hermosillo'),
    (other_restaurant,'rollback-only day summary foreign','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (branch,restaurant,'rollback-only day summary branch'),
    (branch_b,restaurant,'rollback-only day summary sibling branch'),
    (other_branch,other_restaurant,'rollback-only day summary foreign branch');
  insert into auth.users(id,email) values
    (u_manager,'ds-manager@invalid.test'),(u_viewer,'ds-viewer@invalid.test'),(u_cashier,'ds-cashier@invalid.test'),
    (u_waiter,'ds-waiter@invalid.test'),(u_courier,'ds-courier@invalid.test'),
    (u_other_branch,'ds-other-branch@invalid.test'),(u_foreign,'ds-foreign@invalid.test');
  for mem, result in
    select gen_random_uuid(), pg_catalog.jsonb_build_object('u',u,'r',r,'b',b,'rest',rest)
    from (values
      (u_manager,'manager',branch,restaurant),(u_viewer,'viewer',branch,restaurant),(u_cashier,'cashier',branch,restaurant),
      (u_waiter,'waiter',branch,restaurant),(u_courier,'courier',branch,restaurant),
      (u_other_branch,'manager',branch_b,restaurant),(u_foreign,'manager',other_branch,other_restaurant)
    ) as t(u,r,b,rest)
  loop
    insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values (mem,(result->>'u')::uuid,(result->>'rest')::uuid,(result->>'b')::uuid,creator);
    insert into app.membership_role_grants(membership_id,role_code,granted_by) values (mem,result->>'r',creator);
  end loop;

  -- Shifts: A closed on the day, B open on the day, OLD closed the day before (must not show).
  insert into app.operational_shifts(id,restaurant_id,branch_id,name,status,opened_at,opened_by,closed_at,closed_by) values
    (shift_old,restaurant,branch,'Turno anterior','closed','2026-10-04T08:00:00Z',creator,'2026-10-04T23:00:00Z',creator),
    (shift_a,restaurant,branch,'Turno matutino','closed','2026-10-05T08:00:00Z',creator,'2026-10-05T14:00:00Z',creator),
    (shift_b,restaurant,branch,'Turno vespertino','open','2026-10-05T15:00:00Z',creator,null,null);
  perform pg_temp.ds_session(restaurant,branch,s_old,reg_old,shift_old,creator,1000,'2026-10-04T08:00:00Z','2026-10-04T23:00:00Z',1000,1000);
  perform pg_temp.ds_session(restaurant,branch,s_a,reg_a,shift_a,creator,10000,'2026-10-05T08:00:00Z','2026-10-05T14:00:00Z',23500,23300);
  perform pg_temp.ds_session(restaurant,branch,s_b,reg_b,shift_b,creator,5000,'2026-10-05T15:00:00Z',null,null,null);

  -- Orders: o1 counter, o2 delivery with a 3000 charge, o3 takeout partially paid, o5 counter on the lower boundary,
  -- o10 delivery paid in cash at settlement; o4/o6/o9 are paid one day / exactly the upper bound / one second before.
  insert into app.orders(id,restaurant_id,branch_id,channel,status,aggregate,version,created_by,updated_by,created_at,updated_at)
  select t.o,restaurant,branch,t.ch,t.st,pg_temp.ds_order(restaurant,branch,t.o,t.ch,t.st,t.extra),1,creator,creator,
    '2026-10-04T10:00:00Z',t.upd
  from (values
    (o1,'counter','paid','{}'::jsonb,'2026-10-05T18:00:00Z'::timestamptz),
    (o2,'delivery','paid',pg_catalog.jsonb_build_object('deliveryCharge',pg_catalog.jsonb_build_object(
      'amount',pg_catalog.jsonb_build_object('amountMinor',3000,'currency','MXN'),'quoteId',gen_random_uuid()::text)),
      '2026-10-05T20:00:00Z'),
    (o3,'takeout','partially_paid','{}'::jsonb,'2026-10-05T12:00:00Z'),
    (o4,'counter','paid','{}'::jsonb,'2026-10-04T17:00:00Z'),
    (o5,'counter','paid','{}'::jsonb,'2026-10-05T07:00:00Z'),
    (o6,'counter','paid','{}'::jsonb,'2026-10-06T07:00:00Z'),
    (o7,'counter','cancelled','{}'::jsonb,'2026-10-05T16:00:00Z'),
    (o8,'counter','cancelled','{}'::jsonb,'2026-10-04T16:00:00Z'),
    (o9,'counter','paid','{}'::jsonb,'2026-10-05T06:59:59Z'),
    (o10,'delivery','paid','{}'::jsonb,'2026-10-05T22:00:00Z')
  ) as t(o,ch,st,extra,upd);

  perform pg_temp.ds_payment(restaurant,branch,o1,s_a,p1,'cash',10000,500,'2026-10-05T18:00:00Z',creator);
  perform pg_temp.ds_payment(restaurant,branch,o2,s_b,gen_random_uuid(),'card_manual',9000,0,'2026-10-05T20:00:00Z',creator);
  perform pg_temp.ds_payment(restaurant,branch,o3,s_a,gen_random_uuid(),'transfer',2000,100,'2026-10-05T12:00:00Z',creator);
  perform pg_temp.ds_payment(restaurant,branch,o4,s_old,gen_random_uuid(),'cash',7000,0,'2026-10-04T17:00:00Z',creator);
  perform pg_temp.ds_payment(restaurant,branch,o5,s_a,gen_random_uuid(),'cash',100,0,'2026-10-05T07:00:00Z',creator);
  perform pg_temp.ds_payment(restaurant,branch,o6,s_b,gen_random_uuid(),'cash',100,0,'2026-10-06T07:00:00Z',creator);
  perform pg_temp.ds_payment(restaurant,branch,o9,s_old,gen_random_uuid(),'cash',300,0,'2026-10-05T06:59:59Z',creator);
  perform pg_temp.ds_payment(restaurant,branch,o10,s_b,p10,'cash',3500,0,'2026-10-05T22:00:00Z',creator);

  insert into app.order_deliveries(restaurant_id,branch_id,order_id,courier_user_id,state,assigned_at,dispatched_at,
    attempt_count,delivered_at,settled_payment_id,settled_at,cash_to_collect_minor,created_by,updated_by)
  values (restaurant,branch,o10,u_courier,'settled','2026-10-05T21:00:00Z','2026-10-05T21:10:00Z',1,'2026-10-05T21:50:00Z',
    p10,'2026-10-05T22:00:00Z',3500,creator,creator);

  insert into app.capture_drafts(id,restaurant_id,branch_id,folio,source_channel,status,attention_status,recovery_expires_at,
    created_by,updated_by,created_at,updated_at) values
    (gen_random_uuid(),restaurant,branch,'DS-NOSALE-1','phone','no_sale','unclaimed','2026-10-12T00:00:00Z',creator,creator,
      '2026-10-05T10:00:00Z','2026-10-05T10:05:00Z'),
    (gen_random_uuid(),restaurant,branch,'DS-NOSALE-OLD','phone','no_sale','unclaimed','2026-10-12T00:00:00Z',creator,creator,
      '2026-10-04T10:00:00Z','2026-10-04T10:05:00Z'),
    (gen_random_uuid(),restaurant,branch,'DS-DRAFT','phone','draft','unclaimed','2026-10-12T00:00:00Z',creator,creator,
      '2026-10-05T10:00:00Z','2026-10-05T10:05:00Z');

  perform pg_temp.ds_movement(restaurant,branch,s_a,reg_a,shift_a,creator,1,'cash_sale','in',10000,p1,null,'2026-10-05T18:00:00Z');
  perform pg_temp.ds_movement(restaurant,branch,s_a,reg_a,shift_a,creator,2,'tip_in','in',500,p1,null,'2026-10-05T18:00:00Z');
  perform pg_temp.ds_movement(restaurant,branch,s_a,reg_a,shift_a,creator,3,'cash_in','in',5000,null,'fondo extra','2026-10-05T10:00:00Z');
  perform pg_temp.ds_movement(restaurant,branch,s_a,reg_a,shift_a,creator,4,'cash_out','out',2000,null,'proveedor','2026-10-05T11:00:00Z');
  perform pg_temp.ds_movement(restaurant,branch,s_b,reg_b,shift_b,creator,5,'cash_in','in',1500,null,'cambio','2026-10-05T16:00:00Z');

  before_counts := (select pg_catalog.concat_ws('/',
    (select count(*) from app.payments),(select count(*) from app.orders),(select count(*) from app.cash_movements),
    (select count(*) from app.cash_register_sessions),(select count(*) from app.operational_shifts),
    (select count(*) from app.capture_drafts),(select count(*) from app.order_deliveries)));

  -- The day range is served by payments_branch_captured_idx (seqscan forced off: the fixture table is tiny).
  set local enable_seqscan = off;
  for plan_line in execute 'explain select 1 from app.payments where restaurant_id=''' || restaurant::text
    || ''' and branch_id=''' || branch::text || ''' and state=''captured'' and captured_at >= ''2026-10-05T07:00:00Z'''
    || ' and captured_at < ''2026-10-06T07:00:00Z'''
  loop
    if plan_line."QUERY PLAN" like '%payments_branch_captured_idx%' then plan_uses_index := true; end if;
  end loop;
  set local enable_seqscan = on;
  if not plan_uses_index then raise exception 'DAY_SUMMARY_RANGE_INDEX_UNUSED'; end if;

  execute 'set local role app_api';

  -- ---- The busy day, as a manager.
  result := app_private.read_branch_day_summary(u_manager,pg_temp.ds_request(restaurant,branch,'2026-10-05'));
  if result->>'schemaVersion' <> '1' or result->>'date' <> '2026-10-05' or result->>'timeZone' <> 'America/Hermosillo'
    or result->>'currency' <> 'MXN' or result#>>'{scope,restaurantId}' <> restaurant::text
    or result#>>'{scope,branchId}' <> branch::text
  then raise exception 'DAY_SUMMARY_ENVELOPE_WRONG %', result; end if;
  if result->'totals' is distinct from '{"paymentCount":5,"salesMinor":24600,"tipsMinor":600,"cashTipsMinor":500}'::jsonb
  then raise exception 'DAY_SUMMARY_TOTALS_WRONG %', result->'totals'; end if;
  if result->'salesByChannel' is distinct from '[
    {"channel":"table","paymentCount":0,"amountMinor":0,"tipMinor":0},
    {"channel":"counter","paymentCount":2,"amountMinor":10100,"tipMinor":500},
    {"channel":"takeout","paymentCount":1,"amountMinor":2000,"tipMinor":100},
    {"channel":"delivery","paymentCount":2,"amountMinor":12500,"tipMinor":0}]'::jsonb
  then raise exception 'DAY_SUMMARY_BY_CHANNEL_WRONG %', result->'salesByChannel'; end if;
  if result->'salesByMethod' is distinct from '[
    {"method":"cash","paymentCount":3,"amountMinor":13600,"tipMinor":500},
    {"method":"card_manual","paymentCount":1,"amountMinor":9000,"tipMinor":0},
    {"method":"transfer","paymentCount":1,"amountMinor":2000,"tipMinor":100}]'::jsonb
  then raise exception 'DAY_SUMMARY_BY_METHOD_WRONG %', result->'salesByMethod'; end if;
  -- o1, o2, o5, o10 reached `paid` in the day; o3 is only partially paid; o4/o6/o9 paid outside the day.
  if result->'ordersPaid' is distinct from '{"count":4,"amountMinor":22600}'::jsonb
  then raise exception 'DAY_SUMMARY_ORDERS_PAID_WRONG %', result->'ordersPaid'; end if;
  if result->'deliveryFees' is distinct from '{"orderCount":1,"amountMinor":3000}'::jsonb
  then raise exception 'DAY_SUMMARY_FEES_WRONG %', result->'deliveryFees'; end if;
  if result->'deliveriesSettled' is distinct from '{"count":1,"cashCollectedMinor":3500}'::jsonb
  then raise exception 'DAY_SUMMARY_SETTLED_WRONG %', result->'deliveriesSettled'; end if;
  if result->'cancellations' is distinct from '{"orders":1,"captures":1}'::jsonb
  then raise exception 'DAY_SUMMARY_CANCELLATIONS_WRONG %', result->'cancellations'; end if;
  -- Sales by channel and by method both add up to the total.
  if (select sum((e->>'amountMinor')::bigint) from jsonb_array_elements(result->'salesByChannel') e) <> 24600
    or (select sum((e->>'amountMinor')::bigint) from jsonb_array_elements(result->'salesByMethod') e) <> 24600
  then raise exception 'DAY_SUMMARY_SUMS_INCOHERENT'; end if;

  -- Shifts: A and B only, oldest first; the closed one carries float/expected/counted/difference and movements by type.
  if jsonb_array_length(result->'shifts') <> 2 or result#>>'{shifts,0,shiftId}' <> shift_a::text
    or result#>>'{shifts,1,shiftId}' <> shift_b::text
  then raise exception 'DAY_SUMMARY_SHIFTS_WRONG %', result->'shifts'; end if;
  shift_row := result->'shifts'->0;
  reg_row := shift_row->'registers'->0;
  if shift_row->>'status' <> 'closed' or shift_row->>'name' <> 'Turno matutino'
    or shift_row->>'openedAt' <> '2026-10-05T08:00:00.000Z' or shift_row->>'closedAt' <> '2026-10-05T14:00:00.000Z'
    or jsonb_array_length(shift_row->'registers') <> 1
    or reg_row->>'cashRegisterSessionId' <> s_a::text or reg_row->>'status' <> 'closed'
    or (reg_row->>'openingFloatMinor')::bigint <> 10000 or (reg_row->>'expectedCashBalanceMinor')::bigint <> 23500
    or (reg_row->>'countedClosingBalanceMinor')::bigint <> 23300 or (reg_row->>'differenceMinor')::bigint <> -200
    or reg_row->'movements' is distinct from '[
      {"type":"cash_in","direction":"in","count":1,"amountMinor":5000},
      {"type":"cash_out","direction":"out","count":1,"amountMinor":2000},
      {"type":"cash_sale","direction":"in","count":1,"amountMinor":10000},
      {"type":"tip_in","direction":"in","count":1,"amountMinor":500}]'::jsonb
  then raise exception 'DAY_SUMMARY_CLOSED_SHIFT_WRONG %', shift_row; end if;
  reg_row := result->'shifts'->1->'registers'->0;
  if result#>>'{shifts,1,status}' <> 'open' or result#>>'{shifts,1,closedAt}' is not null
    or reg_row->>'status' <> 'open' or (reg_row->>'openingFloatMinor')::bigint <> 5000
    or (reg_row->>'expectedCashBalanceMinor')::bigint <> 6500
    or reg_row->'countedClosingBalanceMinor' <> 'null'::jsonb or reg_row->'differenceMinor' <> 'null'::jsonb
    or reg_row->'movements' is distinct from '[{"type":"cash_in","direction":"in","count":1,"amountMinor":1500}]'::jsonb
  then raise exception 'DAY_SUMMARY_OPEN_SHIFT_WRONG %', reg_row; end if;

  -- ---- Other roles: viewer reads; cashier/waiter/courier are denied; a manager of a sibling Branch is denied.
  if app_private.read_branch_day_summary(u_viewer,pg_temp.ds_request(restaurant,branch,'2026-10-05'))->>'schemaVersion' <> '1'
  then raise exception 'DAY_SUMMARY_VIEWER_DENIED'; end if;
  if app_private.read_branch_day_summary(u_cashier,pg_temp.ds_request(restaurant,branch,'2026-10-05'))->>'status' <> 'denied'
    or app_private.read_branch_day_summary(u_waiter,pg_temp.ds_request(restaurant,branch,'2026-10-05'))->>'status' <> 'denied'
    or app_private.read_branch_day_summary(u_courier,pg_temp.ds_request(restaurant,branch,'2026-10-05'))->>'status' <> 'denied'
  then raise exception 'DAY_SUMMARY_ROLE_NOT_DENIED'; end if;
  if app_private.read_branch_day_summary(u_other_branch,pg_temp.ds_request(restaurant,branch,'2026-10-05'))->>'status' <> 'denied'
    or app_private.read_branch_day_summary(u_foreign,pg_temp.ds_request(restaurant,branch,'2026-10-05'))->>'status' <> 'denied'
    or app_private.read_branch_day_summary(u_foreign,pg_temp.ds_request(other_restaurant,branch,'2026-10-05'))->>'status' <> 'denied'
    or app_private.read_branch_day_summary(u_manager,pg_temp.ds_request(restaurant,branch_b,'2026-10-05'))->>'status' <> 'denied'
    or app_private.read_branch_day_summary(gen_random_uuid(),pg_temp.ds_request(restaurant,branch,'2026-10-05'))->>'status' <> 'denied'
  then raise exception 'DAY_SUMMARY_SCOPE_NOT_DENIED'; end if;

  -- ---- Isolation: the sibling Branch's own manager and the foreign manager see zeros, never this Branch's money.
  result := app_private.read_branch_day_summary(u_other_branch,pg_temp.ds_request(restaurant,branch_b,'2026-10-05'));
  if result->'totals'->>'salesMinor' <> '0' or jsonb_array_length(result->'shifts') <> 0
    or result->'cancellations' is distinct from '{"orders":0,"captures":0}'::jsonb
  then raise exception 'DAY_SUMMARY_SIBLING_LEAK %', result; end if;
  result := app_private.read_branch_day_summary(u_foreign,pg_temp.ds_request(other_restaurant,other_branch,'2026-10-05'));
  if result->'totals'->>'salesMinor' <> '0' or jsonb_array_length(result->'shifts') <> 0
  then raise exception 'DAY_SUMMARY_FOREIGN_LEAK %', result; end if;

  -- ---- An empty day: zeros everywhere, every channel and method listed, no shifts, never null.
  result := app_private.read_branch_day_summary(u_manager,pg_temp.ds_request(restaurant,branch,'2026-10-01'));
  if result->'totals' is distinct from '{"paymentCount":0,"salesMinor":0,"tipsMinor":0,"cashTipsMinor":0}'::jsonb
    or jsonb_array_length(result->'salesByChannel') <> 4 or jsonb_array_length(result->'salesByMethod') <> 3
    or (select sum((e->>'amountMinor')::bigint) from jsonb_array_elements(result->'salesByChannel') e) <> 0
    or result->'ordersPaid' is distinct from '{"count":0,"amountMinor":0}'::jsonb
    or result->'deliveryFees' is distinct from '{"orderCount":0,"amountMinor":0}'::jsonb
    or result->'deliveriesSettled' is distinct from '{"count":0,"cashCollectedMinor":0}'::jsonb
    or result->'cancellations' is distinct from '{"orders":0,"captures":0}'::jsonb
    or result->'shifts' is distinct from '[]'::jsonb or result->>'currency' <> 'MXN'
  then raise exception 'DAY_SUMMARY_EMPTY_DAY_WRONG %', result; end if;

  -- ---- The previous day: only what ended inside it (o4 paid, one second before the boundary excluded from Oct 5).
  result := app_private.read_branch_day_summary(u_manager,pg_temp.ds_request(restaurant,branch,'2026-10-04'));
  if result->'totals'->>'salesMinor' <> '7300' or result->'totals'->>'paymentCount' <> '2'
    or result->'cancellations' is distinct from '{"orders":1,"captures":1}'::jsonb
    or result->'ordersPaid' is distinct from '{"count":2,"amountMinor":7300}'::jsonb
    or jsonb_array_length(result->'shifts') <> 1
  then raise exception 'DAY_SUMMARY_PREVIOUS_DAY_WRONG %', result; end if;

  -- ---- Hostile shapes are rejected, never errors.
  if app_private.read_branch_day_summary(u_manager,pg_temp.ds_request(restaurant,branch,'2026-02-30'))->>'status' <> 'rejected'
    or app_private.read_branch_day_summary(u_manager,pg_temp.ds_request(restaurant,branch,'2026-5-1'))->>'status' <> 'rejected'
    or app_private.read_branch_day_summary(u_manager,pg_temp.ds_request(restaurant,branch,'1999-12-31'))->>'status' <> 'rejected'
    or app_private.read_branch_day_summary(u_manager,pg_temp.ds_request(restaurant,branch,'2026-10-05') || '{"extra":1}')->>'status' <> 'rejected'
    or app_private.read_branch_day_summary(u_manager,jsonb_set(pg_temp.ds_request(restaurant,branch,'2026-10-05'),'{schemaVersion}','2'))->>'status' <> 'rejected'
    or app_private.read_branch_day_summary(u_manager,jsonb_set(pg_temp.ds_request(restaurant,branch,'2026-10-05'),'{date}','20261005'))->>'status' <> 'rejected'
    or app_private.read_branch_day_summary(u_manager,jsonb_set(pg_temp.ds_request(restaurant,branch,'2026-10-05'),'{scope,branchId}','"x"'))->>'status' <> 'rejected'
    or app_private.read_branch_day_summary(u_manager,'[]'::jsonb)->>'status' <> 'rejected'
    or app_private.read_branch_day_summary(null,pg_temp.ds_request(restaurant,branch,'2026-10-05'))->>'status' <> 'rejected'
  then raise exception 'DAY_SUMMARY_HOSTILE_NOT_REJECTED'; end if;
  execute 'reset role';

  -- ---- The reader wrote nothing.
  after_counts := (select pg_catalog.concat_ws('/',
    (select count(*) from app.payments),(select count(*) from app.orders),(select count(*) from app.cash_movements),
    (select count(*) from app.cash_register_sessions),(select count(*) from app.operational_shifts),
    (select count(*) from app.capture_drafts),(select count(*) from app.order_deliveries)));
  if before_counts is distinct from after_counts then raise exception 'DAY_SUMMARY_WROTE'; end if;
end
$branch_day_summary_tests$;
commit;
