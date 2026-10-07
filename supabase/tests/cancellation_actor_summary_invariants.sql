-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises the two functions replaced by 20261007000700: app_private.list_cancelled_work_items (cancelledByName present
-- for a named actor, null for an unnamed one, never the e-mail) and app_private.read_branch_day_summary (cancelled Orders
-- counted by order_cancellations.received_at (server time; the device occurred_at is informative) in the restaurant-zone day, not by orders.updated_at; the exact [start, end)
-- boundaries; pending obligations summed as captured + tip; Branch isolation; mixed currency is a conflict; role gating
-- unchanged; the readers write nothing).
begin;
create function pg_temp.cs_order(p_restaurant uuid, p_branch uuid, p_order uuid) returns jsonb language sql as $f$
  select pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',p_order::text,'restaurantId',p_restaurant::text,'branchId',p_branch::text,
    'channel','counter','status','cancelled','currency','MXN','timeZone','America/Hermosillo','items','[]'::jsonb)
$f$;
create function pg_temp.cs_cancel(
  p_restaurant uuid, p_branch uuid, p_order uuid, p_actor uuid, p_occurred timestamptz, p_from text,
  p_obligation text, p_captured bigint, p_tip bigint, p_currency text, p_order_updated timestamptz, p_device_at timestamptz default null
) returns void language plpgsql as $f$
begin
  insert into app.orders(id,restaurant_id,branch_id,channel,status,aggregate,version,created_by,updated_by,created_at,updated_at)
  values (p_order,p_restaurant,p_branch,'counter','cancelled',pg_temp.cs_order(p_restaurant,p_branch,p_order),2,
    p_actor,p_actor,'2026-10-03T10:00:00Z',p_order_updated);
  insert into app.order_cancellations(restaurant_id,branch_id,order_id,event_id,from_status,result_version,reason,
    actor_id,device_id,occurred_at,received_at,refund_obligation_status,captured_minor,captured_tip_minor,currency)
  values (p_restaurant,p_branch,p_order,gen_random_uuid(),p_from,2,'prueba',p_actor,
    '00000000-0000-4000-8000-0000000000c5',coalesce(p_device_at,p_occurred),p_occurred,p_obligation,p_captured,p_tip,p_currency);
end $f$;
create function pg_temp.cs_summary(p_actor uuid, p_restaurant uuid, p_branch uuid, p_date text) returns jsonb language sql as $f$
  select app_private.read_branch_day_summary(p_actor, pg_catalog.jsonb_build_object('schemaVersion',1,
    'scope',pg_catalog.jsonb_build_object('restaurantId',p_restaurant::text,'branchId',p_branch::text),'date',p_date))
$f$;
create function pg_temp.cs_list(p_actor uuid, p_restaurant uuid, p_branch uuid) returns jsonb language sql as $f$
  select app_private.list_cancelled_work_items(p_actor, pg_catalog.jsonb_build_object('schemaVersion',1,
    'scope',pg_catalog.jsonb_build_object('restaurantId',p_restaurant::text,'branchId',p_branch::text),
    'limit',50,'after','null'::jsonb))
$f$;
do $cancellation_actor_summary_tests$
declare
  creator uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  u_named uuid := gen_random_uuid();
  u_unnamed uuid := gen_random_uuid();
  u_viewer uuid := gen_random_uuid();
  u_cashier uuid := gen_random_uuid();
  u_other_branch uuid := gen_random_uuid();
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  branch_b uuid := gen_random_uuid();
  c_today_pending uuid := gen_random_uuid();
  c_today_none uuid := gen_random_uuid();
  c_yesterday uuid := gen_random_uuid();
  c_lower_bound uuid := gen_random_uuid();
  c_upper_bound uuid := gen_random_uuid();
  c_sibling uuid := gen_random_uuid();
  c_usd uuid := gen_random_uuid();
  c_skew uuid := gen_random_uuid();
  mem uuid;
  rec record;
  result jsonb;
  items jsonb;
  item jsonb;
  before_counts text;
  after_counts text;
begin
  if creator is null then raise exception 'CANCELLATION_SUMMARY_TEST_ACTOR_REQUIRED'; end if;
  insert into app.restaurants(id,name,time_zone) values (restaurant,'rollback-only cancellation summary','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (branch,restaurant,'rollback-only cancellation summary branch'),
    (branch_b,restaurant,'rollback-only cancellation summary sibling');
  insert into auth.users(id,email,raw_user_meta_data) values
    (u_named,'cs-named@invalid.test',pg_catalog.jsonb_build_object('full_name','  Ana Gerente  ')),
    (u_unnamed,'cs-unnamed@invalid.test',null),
    (u_viewer,'cs-viewer@invalid.test',null),(u_cashier,'cs-cashier@invalid.test',null),
    (u_other_branch,'cs-other@invalid.test',null);
  for rec in
    select * from (values
      (u_named,'manager',branch),(u_unnamed,'supervisor',branch),(u_viewer,'viewer',branch),
      (u_cashier,'cashier',branch),(u_other_branch,'manager',branch_b)
    ) as t(u,r,b)
  loop
    mem := gen_random_uuid();
    insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values (mem,rec.u,restaurant,rec.b,creator);
    insert into app.membership_role_grants(membership_id,role_code,granted_by) values (mem,rec.r,creator);
  end loop;

  -- The day is 2026-10-05 in America/Hermosillo (UTC-7): [2026-10-05T07:00Z, 2026-10-06T07:00Z).
  -- All rows below set received_at = the given instant. Pending 5000 + tip 500, today, by the named actor.
  perform pg_temp.cs_cancel(restaurant,branch,c_today_pending,u_named,'2026-10-05T18:00:00Z','paid','pending',5000,500,'MXN','2026-10-05T18:00:00Z');
  -- No obligation, today, by the unnamed actor.
  perform pg_temp.cs_cancel(restaurant,branch,c_today_none,u_unnamed,'2026-10-05T19:00:00Z','open','none',0,0,'MXN','2026-10-05T19:00:00Z');
  -- Cancelled YESTERDAY (pending 9000) although the Order row was touched today: must not count today.
  perform pg_temp.cs_cancel(restaurant,branch,c_yesterday,u_named,'2026-10-04T18:00:00Z','paid','pending',9000,0,'MXN','2026-10-05T20:00:00Z');
  -- Exact lower bound counts today (none); exact upper bound belongs to the next day (pending 100).
  perform pg_temp.cs_cancel(restaurant,branch,c_lower_bound,u_named,'2026-10-05T07:00:00Z','draft','none',0,0,'MXN','2026-10-05T07:00:00Z');
  perform pg_temp.cs_cancel(restaurant,branch,c_upper_bound,u_named,'2026-10-06T07:00:00Z','paid','pending',100,0,'MXN','2026-10-06T07:00:00Z');
  -- Sibling Branch of the same Restaurant, today, pending 7777: excluded from this Branch.
  perform pg_temp.cs_cancel(restaurant,branch_b,c_sibling,u_other_branch,'2026-10-05T18:00:00Z','paid','pending',7777,0,'MXN','2026-10-05T18:00:00Z');
  -- Device clock a day behind: occurred_at is yesterday but the server received it today, so it counts TODAY (pending 250).
  perform pg_temp.cs_cancel(restaurant,branch,c_skew,u_named,'2026-10-05T20:00:00Z','paid','pending',250,0,'MXN','2026-10-05T20:00:00Z','2026-10-04T23:00:00Z');
  -- A pending obligation in another currency on 2026-10-07: never summed, the day is a conflict.
  perform pg_temp.cs_cancel(restaurant,branch,c_usd,u_named,'2026-10-07T18:00:00Z','paid','pending',1000,0,'USD','2026-10-07T18:00:00Z');

  select pg_catalog.count(*)::text || ':' || (select pg_catalog.count(*) from app.order_cancellations)::text
    into before_counts from app.orders;

  -- (b) Day summary.
  result := pg_temp.cs_summary(u_viewer,restaurant,branch,'2026-10-05');
  if result->'cancellations' is distinct from '{"orders":4,"captures":0,"refundPendingMinor":5750}'::jsonb
  then raise exception 'CANCELLATION_SUMMARY_TODAY_WRONG %', result->'cancellations'; end if;
  result := pg_temp.cs_summary(u_named,restaurant,branch,'2026-10-04');
  if result->'cancellations' is distinct from '{"orders":1,"captures":0,"refundPendingMinor":9000}'::jsonb
  then raise exception 'CANCELLATION_SUMMARY_YESTERDAY_WRONG %', result->'cancellations'; end if;
  result := pg_temp.cs_summary(u_named,restaurant,branch,'2026-10-06');
  if result->'cancellations' is distinct from '{"orders":1,"captures":0,"refundPendingMinor":100}'::jsonb
  then raise exception 'CANCELLATION_SUMMARY_UPPER_BOUND_WRONG %', result->'cancellations'; end if;
  result := pg_temp.cs_summary(u_named,restaurant,branch,'2026-10-08');
  if result->'cancellations' is distinct from '{"orders":0,"captures":0,"refundPendingMinor":0}'::jsonb
  then raise exception 'CANCELLATION_SUMMARY_EMPTY_WRONG %', result->'cancellations'; end if;
  result := pg_temp.cs_summary(u_named,restaurant,branch,'2026-10-07');
  if result is distinct from '{"status":"conflict"}'::jsonb
  then raise exception 'CANCELLATION_SUMMARY_CURRENCY_CONFLICT_MISSING %', result; end if;
  -- The sibling Branch only sees its own cancellation.
  result := pg_temp.cs_summary(u_other_branch,restaurant,branch_b,'2026-10-05');
  if result->'cancellations' is distinct from '{"orders":1,"captures":0,"refundPendingMinor":7777}'::jsonb
  then raise exception 'CANCELLATION_SUMMARY_SIBLING_WRONG %', result->'cancellations'; end if;
  -- Gating is unchanged: cashier and a foreign-branch manager are denied.
  if pg_temp.cs_summary(u_cashier,restaurant,branch,'2026-10-05') is distinct from '{"status":"denied"}'::jsonb
    or pg_temp.cs_summary(u_other_branch,restaurant,branch,'2026-10-05') is distinct from '{"status":"denied"}'::jsonb
  then raise exception 'CANCELLATION_SUMMARY_GATING_WRONG'; end if;

  -- (a) Cancelled list: name present for the named actor (trimmed), null for the unnamed one, e-mail never exposed.
  result := pg_temp.cs_list(u_viewer,restaurant,branch);
  items := result->'items';
  if pg_catalog.jsonb_array_length(items) <> 7 then raise exception 'CANCELLATION_LIST_COUNT_WRONG %', items; end if;
  for item in select * from pg_catalog.jsonb_array_elements(items) loop
    if not item ? 'cancelledByName' then raise exception 'CANCELLATION_LIST_NAME_KEY_MISSING'; end if;
    if item->>'actorId' = u_named::text and item->>'cancelledByName' is distinct from 'Ana Gerente'
    then raise exception 'CANCELLATION_LIST_NAME_WRONG %', item->'cancelledByName'; end if;
    if item->>'actorId' = u_unnamed::text and item->'cancelledByName' is distinct from 'null'::jsonb
    then raise exception 'CANCELLATION_LIST_UNNAMED_NOT_NULL %', item->'cancelledByName'; end if;
  end loop;
  if result::text like '%invalid.test%' then raise exception 'CANCELLATION_LIST_EMAIL_EXPOSED'; end if;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(items) i where i->>'cancelledByName' = 'Ana Gerente') <> 6
    or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(items) i where i->'cancelledByName' = 'null'::jsonb) <> 1
  then raise exception 'CANCELLATION_LIST_NAME_DISTRIBUTION_WRONG'; end if;
  -- Scope isolation of the list: the sibling Branch cancellation is not in this Branch's page, and a foreign manager is denied.
  if exists (select 1 from pg_catalog.jsonb_array_elements(items) i where i->>'id' = c_sibling::text)
    or pg_temp.cs_list(u_other_branch,restaurant,branch) is distinct from '{"status":"denied"}'::jsonb
  then raise exception 'CANCELLATION_LIST_SCOPE_LEAK'; end if;

  select pg_catalog.count(*)::text || ':' || (select pg_catalog.count(*) from app.order_cancellations)::text
    into after_counts from app.orders;
  if before_counts is distinct from after_counts then raise exception 'CANCELLATION_SUMMARY_READERS_WROTE'; end if;
end
$cancellation_actor_summary_tests$;
commit;
