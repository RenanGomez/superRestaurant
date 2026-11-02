-- Rollback-only invariant test for order_payments_captured_by
-- Exercises app_private.read_order_receipt_data with capturedBy, reading with and without payments,
-- and branch/tenant isolation.
begin;
do $order_payments_captured_by_tests$
declare
  creator uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  manager uuid := gen_random_uuid();
  courier_a uuid := gen_random_uuid();
  courier_b uuid := gen_random_uuid();
  foreign_manager uuid := gen_random_uuid();
  sibling_manager uuid := gen_random_uuid();
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  sibling_branch uuid := gen_random_uuid();
  other_restaurant uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  m_manager uuid := gen_random_uuid();
  m_a uuid := gen_random_uuid();
  m_b uuid := gen_random_uuid();
  m_foreign uuid := gen_random_uuid();
  m_sibling uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_register uuid := gen_random_uuid();
  v_shift uuid := gen_random_uuid();
  o_none uuid := gen_random_uuid();
  o_two uuid := gen_random_uuid();
  o_delivery uuid := gen_random_uuid();
  o_sibling uuid := gen_random_uuid();
  p_cash uuid := gen_random_uuid();
  p_transfer uuid := gen_random_uuid();
  p_card uuid := gen_random_uuid();
  t0 timestamptz := timestamptz '2026-10-06 12:00:00.123+00';
  result jsonb;
begin
  if creator is null then raise exception 'RECEIPT_TEST_ACTOR_REQUIRED'; end if;
  insert into app.restaurants(id,name,time_zone) values
    (restaurant,'rollback-only receipt captured-by','America/Hermosillo'),
    (other_restaurant,'rollback-only receipt captured-by foreign','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (branch,restaurant,'rollback-only receipt captured-by branch'),
    (sibling_branch,restaurant,'rollback-only receipt captured-by sibling branch'),
    (other_branch,other_restaurant,'rollback-only receipt captured-by foreign branch');
  insert into auth.users(id,email) values
    (manager,'local-receipt-cb-manager@invalid.test'),(courier_a,'local-receipt-cb-a@invalid.test'),
    (courier_b,'local-receipt-cb-b@invalid.test'),(foreign_manager,'local-receipt-cb-foreign@invalid.test'),
    (sibling_manager,'local-receipt-cb-sibling@invalid.test');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values
    (m_manager,manager,restaurant,branch,creator),(m_a,courier_a,restaurant,branch,creator),
    (m_b,courier_b,restaurant,branch,creator),(m_foreign,foreign_manager,other_restaurant,other_branch,creator),
    (m_sibling,sibling_manager,restaurant,sibling_branch,creator);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values
    (m_manager,'manager',creator),(m_a,'courier',creator),(m_b,'courier',creator),(m_foreign,'manager',creator),
    (m_sibling,'manager',creator);

  insert into app.orders(id,restaurant_id,branch_id,channel,status,aggregate,version,created_at,created_by,updated_by)
  select o,restaurant,branch,ch,'open',pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',o::text,'restaurantId',restaurant::text,'branchId',branch::text,'channel',ch,
    'status','open','currency','MXN','timeZone','America/Hermosillo','items','[]'::jsonb
  ),3,t0,creator,creator
  from (values (o_none,'counter'),(o_two,'counter'),(o_delivery,'delivery')) as t(o,ch);
  insert into app.orders(id,restaurant_id,branch_id,channel,status,aggregate,version,created_at,created_by,updated_by)
  values (o_sibling,restaurant,sibling_branch,'counter','open',pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',o_sibling::text,'restaurantId',restaurant::text,'branchId',sibling_branch::text,
    'channel','counter','status','open','currency','MXN','timeZone','America/Hermosillo','items','[]'::jsonb
  ),3,t0,creator,creator);
  insert into app.order_deliveries(restaurant_id,branch_id,order_id,courier_user_id,state,assigned_at,created_by,updated_by)
  values (restaurant,branch,o_delivery,courier_a,'assigned',now(),creator,creator);

  insert into app.cash_register_sessions(
    id,restaurant_id,branch_id,register_id,shift_id,cashier_id,currency,status,opening_float_minor,aggregate,version,opened_at,opened_by
  ) values (
    v_session,restaurant,branch,v_register,v_shift,creator,'MXN','open',0,pg_catalog.jsonb_build_object(
      'schemaVersion',1,'cashRegisterId',v_session::text,'restaurantId',restaurant::text,'branchId',branch::text,
      'registerId',v_register::text,'shiftId',v_shift::text,'cashierId',creator::text,'currency','MXN','status','open',
      'openingFloat',pg_catalog.jsonb_build_object('amountMinor',0,'currency','MXN'),
      'openedByActorId',creator::text,'openedAt','2026-10-06T12:00:00.000Z','openedDeviceId',gen_random_uuid()::text,
      'movements','[]'::jsonb),
    1,pg_catalog.clock_timestamp(),creator);

  insert into app.payments(id,restaurant_id,branch_id,order_id,cash_register_session_id,method,amount_minor,currency,state,
    manual_provider,manual_terminal_id,manual_reference,aggregate,captured_at,captured_by,tip_minor,tendered_amount_minor,change_minor)
  values
    (p_transfer,restaurant,branch,o_two,v_session,'transfer',1500,'MXN','captured',null,null,'SPEI-123','{}'::jsonb,t0 + interval '2 minutes',creator,0,null,null),
    (p_cash,restaurant,branch,o_two,v_session,'cash',3000,'MXN','captured',null,null,null,'{}'::jsonb,t0 + interval '1 minute',creator,200,5000,1800),
    (p_card,restaurant,branch,o_delivery,v_session,'card_manual',900,'MXN','captured','terminal-x','T-1',null,'{}'::jsonb,t0 + interval '3 minutes',creator,0,null,null);
  update app.payments set aggregate = pg_catalog.jsonb_build_object(
    'schemaVersion',1,'paymentId',id::text,'restaurantId',restaurant_id::text,'branchId',branch_id::text,'orderId',order_id::text,
    'method',method,'state',state,'amount',pg_catalog.jsonb_build_object('amountMinor',amount_minor,'currency',currency))
  where order_id in (o_two,o_delivery);

  execute 'set local role app_api';
  -- 1. No payments: empty list
  result := app_private.read_order_receipt_data(manager,restaurant,branch,o_none);
  if result is null or result->>'schemaVersion'<>'1' or result->>'createdAt'<>'2026-10-06T12:00:00.123Z'
    or result->>'shortFolio'<>upper(left(o_none::text,8)) or result->'payments'<>'[]'::jsonb
  then raise exception 'RECEIPT_NO_PAYMENTS_WRONG %',result; end if;

  -- 2. Two payments with capturedBy matching creator
  result := app_private.read_order_receipt_data(manager,restaurant,branch,o_two);
  if pg_catalog.jsonb_array_length(result->'payments')<>2
    or result#>>'{payments,0,paymentId}'<>p_cash::text
    or result#>>'{payments,0,capturedBy}'<>creator::text
    or result#>>'{payments,0,method}'<>'cash'
    or (result#>>'{payments,0,amountMinor}')::bigint<>3000
    or result#>>'{payments,1,paymentId}'<>p_transfer::text
    or result#>>'{payments,1,capturedBy}'<>creator::text
    or result#>>'{payments,1,method}'<>'transfer'
    or (result#>>'{payments,1,amountMinor}')::bigint<>1500
  then raise exception 'RECEIPT_PAYMENTS_CAPTURED_BY_WRONG %',result; end if;

  -- 3. Assigned courier reads delivery order with capturedBy
  result := app_private.read_order_receipt_data(courier_a,restaurant,branch,o_delivery);
  if result is null or pg_catalog.jsonb_array_length(result->'payments')<>1
    or result#>>'{payments,0,capturedBy}'<>creator::text
  then raise exception 'RECEIPT_COURIER_CAPTURED_BY_WRONG %',result; end if;

  -- 4. Isolation checks
  if app_private.read_order_receipt_data(courier_b,restaurant,branch,o_delivery) is not null then raise exception 'RECEIPT_OTHER_COURIER_READ'; end if;
  if app_private.read_order_receipt_data(foreign_manager,restaurant,branch,o_two) is not null then raise exception 'RECEIPT_FOREIGN_READ'; end if;
  if app_private.read_order_receipt_data(manager,other_restaurant,other_branch,o_two) is not null then raise exception 'RECEIPT_WRONG_SCOPE_READ'; end if;
  if app_private.read_order_receipt_data(manager,restaurant,other_branch,o_two) is not null then raise exception 'RECEIPT_WRONG_BRANCH_READ'; end if;
  if app_private.read_order_receipt_data(manager,restaurant,branch,o_sibling) is not null then raise exception 'RECEIPT_SIBLING_BRANCH_FORWARD_READ'; end if;
  if app_private.read_order_receipt_data(sibling_manager,restaurant,sibling_branch,o_two) is not null then raise exception 'RECEIPT_SIBLING_BRANCH_REVERSE_READ'; end if;
  if app_private.read_order_receipt_data(sibling_manager,restaurant,sibling_branch,o_sibling) is null then raise exception 'RECEIPT_SIBLING_BRANCH_OWN_READ_MISSING'; end if;
  if app_private.read_order_receipt_data(manager,restaurant,branch,gen_random_uuid()) is not null then raise exception 'RECEIPT_MISSING_NOT_NULL'; end if;
  if app_private.read_order_receipt_data(null,restaurant,branch,o_two) is not null then raise exception 'RECEIPT_NULL_ACTOR_READ'; end if;
  execute 'reset role';
end
$order_payments_captured_by_tests$;
rollback;
