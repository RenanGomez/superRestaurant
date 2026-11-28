-- Test-only fixtures. Executed inside a rollback transaction by CI (`run_invariant`) and the schema verifier.
-- Exercises ordersPaid.averageMinor from 20261128000100_branch_day_summary_average_ticket.sql:
-- 3 paid orders totaling 100001 -> averageMinor = 33334 and count = 3;
-- an empty day -> averageMinor key exists and is JSON null with count = 0;
-- rounding half-up property across multiple non-empty days.
begin;
create function pg_temp.at_order(
  p_restaurant uuid, p_branch uuid, p_order uuid, p_channel text, p_status text
) returns jsonb language sql as $f$
  select pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',p_order::text,'restaurantId',p_restaurant::text,'branchId',p_branch::text,
    'channel',p_channel,'status',p_status,'currency','MXN','timeZone','America/Hermosillo','items','[]'::jsonb
  )
$f$;
create function pg_temp.at_payment(
  p_restaurant uuid, p_branch uuid, p_order uuid, p_session uuid, p_payment uuid,
  p_amount bigint, p_at timestamptz, p_actor uuid
) returns void language plpgsql as $f$
begin
  insert into app.payments(id,restaurant_id,branch_id,order_id,cash_register_session_id,method,amount_minor,currency,state,
    aggregate,captured_at,captured_by,tip_minor)
  values (p_payment,p_restaurant,p_branch,p_order,p_session,'cash',p_amount,'MXN','captured',
    pg_catalog.jsonb_build_object('schemaVersion',1,'paymentId',p_payment::text,'restaurantId',p_restaurant::text,
      'branchId',p_branch::text,'orderId',p_order::text,'method','cash','state','captured',
      'amount',pg_catalog.jsonb_build_object('amountMinor',p_amount,'currency','MXN')),
    p_at,p_actor,0);
end $f$;
create function pg_temp.at_session(
  p_restaurant uuid, p_branch uuid, p_session uuid, p_register uuid, p_shift uuid, p_actor uuid, p_opened timestamptz
) returns void language plpgsql as $f$
begin
  insert into app.cash_register_sessions(id,restaurant_id,branch_id,register_id,shift_id,cashier_id,currency,status,
    opening_float_minor,aggregate,version,opened_at,opened_by)
  values (p_session,p_restaurant,p_branch,p_register,p_shift,p_actor,'MXN','open',5000,
    pg_catalog.jsonb_build_object('schemaVersion',1,'cashRegisterId',p_session::text,'restaurantId',p_restaurant::text,
      'branchId',p_branch::text,'registerId',p_register::text,'shiftId',p_shift::text,'cashierId',p_actor::text,
      'currency','MXN','status','open','movements','[]'::jsonb),
    1,p_opened,p_actor);
end $f$;
create function pg_temp.at_request(p_restaurant uuid, p_branch uuid, p_date text) returns jsonb language sql as $f$
  select pg_catalog.jsonb_build_object('schemaVersion',1,
    'scope',pg_catalog.jsonb_build_object('restaurantId',p_restaurant::text,'branchId',p_branch::text),'date',p_date)
$f$;
do $branch_day_summary_average_ticket_tests$
declare
  creator uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  u_manager uuid := gen_random_uuid();
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  mem uuid := gen_random_uuid();
  shift_id uuid := gen_random_uuid();
  reg_id uuid := gen_random_uuid();
  sess_id uuid := gen_random_uuid();
  o1 uuid := gen_random_uuid();
  o2 uuid := gen_random_uuid();
  o3 uuid := gen_random_uuid();
  o4 uuid := gen_random_uuid();
  o5 uuid := gen_random_uuid();
  o6 uuid := gen_random_uuid();
  o7 uuid := gen_random_uuid();
  o8 uuid := gen_random_uuid();
  result jsonb;
  avg_day text;
  avg_count bigint;
  avg_amount bigint;
  avg_minor bigint;
begin
  if creator is null then raise exception 'AVERAGE_TICKET_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone)
  values (restaurant,'rollback-only average ticket','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name)
  values (branch,restaurant,'rollback-only average ticket branch');
  insert into auth.users(id,email) values (u_manager,'at-manager@invalid.test');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
  values (mem,u_manager,restaurant,branch,creator);
  insert into app.membership_role_grants(membership_id,role_code,granted_by)
  values (mem,'manager',creator);

  insert into app.operational_shifts(id,restaurant_id,branch_id,name,status,opened_at,opened_by)
  values (shift_id,restaurant,branch,'Turno promedio','open','2026-10-07T08:00:00Z',creator);
  perform pg_temp.at_session(restaurant,branch,sess_id,reg_id,shift_id,creator,'2026-10-07T08:00:00Z');

  -- Day 2026-10-07: 3 paid orders totaling 100001 -> averageMinor = 33334.
  -- Day 2026-10-09: 2 paid orders totaling 1001 -> averageMinor = 501 (exact half rounds up).
  -- Day 2026-10-10: 3 paid orders totaling 100000 -> averageMinor = 33333 (below half rounds down).
  insert into app.orders(id,restaurant_id,branch_id,channel,status,aggregate,version,created_by,updated_by,created_at,updated_at)
  select t.o,restaurant,branch,'counter','paid',pg_temp.at_order(restaurant,branch,t.o,'counter','paid'),1,
    creator,creator,t.at_ts,t.at_ts
  from (values
    (o1,'2026-10-07T18:00:00Z'::timestamptz),(o2,'2026-10-07T18:05:00Z'),(o3,'2026-10-07T18:10:00Z'),
    (o4,'2026-10-09T18:00:00Z'),(o5,'2026-10-09T18:05:00Z'),
    (o6,'2026-10-10T18:00:00Z'),(o7,'2026-10-10T18:05:00Z'),(o8,'2026-10-10T18:10:00Z')
  ) as t(o,at_ts);

  perform pg_temp.at_payment(restaurant,branch,o1,sess_id,gen_random_uuid(),33334,'2026-10-07T18:00:00Z',creator);
  perform pg_temp.at_payment(restaurant,branch,o2,sess_id,gen_random_uuid(),33334,'2026-10-07T18:05:00Z',creator);
  perform pg_temp.at_payment(restaurant,branch,o3,sess_id,gen_random_uuid(),33333,'2026-10-07T18:10:00Z',creator);
  perform pg_temp.at_payment(restaurant,branch,o4,sess_id,gen_random_uuid(),500,'2026-10-09T18:00:00Z',creator);
  perform pg_temp.at_payment(restaurant,branch,o5,sess_id,gen_random_uuid(),501,'2026-10-09T18:05:00Z',creator);
  perform pg_temp.at_payment(restaurant,branch,o6,sess_id,gen_random_uuid(),33333,'2026-10-10T18:00:00Z',creator);
  perform pg_temp.at_payment(restaurant,branch,o7,sess_id,gen_random_uuid(),33333,'2026-10-10T18:05:00Z',creator);
  perform pg_temp.at_payment(restaurant,branch,o8,sess_id,gen_random_uuid(),33334,'2026-10-10T18:10:00Z',creator);

  execute 'set local role app_api';

  -- 1) 3 paid orders totaling 100001 -> averageMinor = 33334, count = 3.
  result := app_private.read_branch_day_summary(u_manager,pg_temp.at_request(restaurant,branch,'2026-10-07'));
  if result->'ordersPaid' is distinct from '{"count":3,"amountMinor":100001,"averageMinor":33334}'::jsonb
  then raise exception 'AVERAGE_TICKET_3_ORDERS_WRONG %', result->'ordersPaid'; end if;

  -- 2) Day without paid orders -> key exists and is JSON null, count = 0.
  result := app_private.read_branch_day_summary(u_manager,pg_temp.at_request(restaurant,branch,'2026-10-08'));
  if (result->'ordersPaid'->>'count')::bigint <> 0
    or not (result->'ordersPaid' ? 'averageMinor')
    or pg_catalog.jsonb_typeof(result->'ordersPaid'->'averageMinor') is distinct from 'null'
  then raise exception 'AVERAGE_TICKET_EMPTY_DAY_WRONG %', result->'ordersPaid'; end if;

  -- 3) Rounding property across non-empty days.
  foreach avg_day in array array['2026-10-07','2026-10-09','2026-10-10'] loop
    result := app_private.read_branch_day_summary(u_manager,pg_temp.at_request(restaurant,branch,avg_day));
    avg_count := (result->'ordersPaid'->>'count')::bigint;
    avg_amount := (result->'ordersPaid'->>'amountMinor')::bigint;
    avg_minor := (result->'ordersPaid'->>'averageMinor')::bigint;
    if avg_count <= 0
      or avg_minor <> floor((avg_amount * 2 + avg_count)::numeric / (2 * avg_count))::bigint
      or abs(avg_minor * avg_count - avg_amount) >= avg_count
    then raise exception 'AVERAGE_TICKET_ROUNDING_WRONG % %', avg_day, result->'ordersPaid'; end if;
  end loop;

  execute 'reset role';
end
$branch_day_summary_average_ticket_tests$;
commit;
