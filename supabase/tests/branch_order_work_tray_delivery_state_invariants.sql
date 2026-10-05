-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises app_private.list_branch_order_work_items after 20261007000100: every item exposes
-- `deliveryState`, and `unassignedDeliveriesOnly` returns delivery-channel Orders (prepaid `paid`
-- included) with no delivery row or a `failed` one -- never assigned/en_route/delivered/settled ones,
-- never other channels, drafts or another Branch -- with exact keyset pagination over the filtered set.
begin;
do $branch_order_work_tray_delivery_state_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  membership uuid := gen_random_uuid();
  o_open uuid := gen_random_uuid();
  o_partial uuid := gen_random_uuid();
  o_prepaid uuid := gen_random_uuid();
  o_settled_prepaid uuid := gen_random_uuid();
  o_assigned uuid := gen_random_uuid();
  o_en_route uuid := gen_random_uuid();
  o_delivered uuid := gen_random_uuid();
  o_failed uuid := gen_random_uuid();
  o_counter uuid := gen_random_uuid();
  o_draft uuid := gen_random_uuid();
  o_cancelled uuid := gen_random_uuid();
  o_other_branch uuid := gen_random_uuid();
  o_old_paid uuid := gen_random_uuid();
  now_at timestamptz := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
  scope jsonb;
  result jsonb;
  ids text[];
  page_one jsonb;
  seen text[] := array[]::text[];
  rec record;
begin
  if actor is null then raise exception 'WORK_TRAY_DELIVERY_STATE_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone)
    values(restaurant,'rollback-only work tray delivery state','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (branch,restaurant,'rollback-only delivery state branch'),
    (other_branch,restaurant,'rollback-only delivery state other branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values(membership,actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by)
    values(membership,'cashier',actor);

  -- Orders newest first by updated_at: open, partial, prepaid, settled_prepaid, assigned, en_route,
  -- delivered, failed, counter, draft, cancelled (minutes ago 1..11); other_branch order is the newest.
  for rec in
    select * from (values
      (o_open,         branch,       'delivery','open',           1),
      (o_partial,      branch,       'delivery','partially_paid', 2),
      (o_prepaid,      branch,       'delivery','paid',           3),
      (o_settled_prepaid, branch,    'delivery','paid',           4),
      (o_assigned,     branch,       'delivery','open',           5),
      (o_en_route,     branch,       'delivery','open',           6),
      (o_delivered,    branch,       'delivery','open',           7),
      (o_failed,       branch,       'delivery','open',           8),
      (o_counter,      branch,       'counter', 'open',           9),
      (o_draft,        branch,       'delivery','draft',         10),
      (o_cancelled,    branch,       'delivery','cancelled',     11),
      (o_old_paid,     branch,       'delivery','paid',          12),
      (o_other_branch, other_branch, 'delivery','open',           0)
    ) as t(id,branch_id,channel,status,minutes_ago)
  loop
    insert into app.orders(
      id,restaurant_id,branch_id,channel,status,aggregate,version,created_by,updated_by,created_at,updated_at
    ) values (
      rec.id,restaurant,rec.branch_id,rec.channel,rec.status,pg_catalog.jsonb_build_object(
        'schemaVersion',1,'orderId',rec.id::text,'restaurantId',restaurant::text,
        'branchId',rec.branch_id::text,'channel',rec.channel,'status',rec.status,'currency','MXN',
        'timeZone','America/Hermosillo','items','[]'::jsonb
      ),1,actor,actor,now_at-(rec.minutes_ago+20)*interval '1 minute',now_at-rec.minutes_ago*interval '1 minute'
    );
  end loop;

  -- A prepaid Order with no delivery created 3 days ago is outside the 2-day window.
  update app.orders set created_at=now_at-interval '3 days' where id=o_old_paid;

  insert into app.order_deliveries(restaurant_id,branch_id,order_id,courier_user_id,state,attempt_count,
      assigned_at,dispatched_at,delivered_at,failed_reason,settled_at,created_by,updated_by) values
    (restaurant,branch,o_settled_prepaid,actor,'settled',1,now_at,now_at,now_at,null,now_at,actor,actor),
    (restaurant,branch,o_assigned,actor,'assigned',0,now_at,null,null,null,null,actor,actor),
    (restaurant,branch,o_en_route,actor,'en_route',1,now_at,now_at,null,null,null,actor,actor),
    (restaurant,branch,o_delivered,actor,'delivered',1,now_at,now_at,now_at,null,null,actor,actor),
    (restaurant,branch,o_failed,actor,'failed',1,now_at,now_at,null,'cliente no respondio',null,actor,actor);

  scope := pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text);
  execute 'set local role app_api';

  -- Default request (flag absent, original five keys): unchanged filter, deliveryState projected.
  result := app_private.list_branch_order_work_items(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',scope,'limit',100,'after',null,'channel',null));
  select array_agg(e->>'orderId' order by ord) into ids
    from pg_catalog.jsonb_array_elements(result->'orders') with ordinality as x(e,ord);
  if pg_catalog.jsonb_array_length(result->'orders')<>8
    or o_prepaid::text = any(ids) or o_cancelled::text = any(ids) or o_other_branch::text = any(ids)
    or not (o_draft::text = any(ids)) or not (o_counter::text = any(ids))
  then raise exception 'WORK_TRAY_DELIVERY_STATE_DEFAULT_FILTER_CHANGED'; end if;
  if (select e->>'deliveryState' from pg_catalog.jsonb_array_elements(result->'orders') e
        where e->>'orderId'=o_open::text) is not null
    or (select pg_catalog.jsonb_typeof(e->'deliveryState') from pg_catalog.jsonb_array_elements(result->'orders') e
        where e->>'orderId'=o_open::text) <> 'null'
    or (select e->>'deliveryState' from pg_catalog.jsonb_array_elements(result->'orders') e
        where e->>'orderId'=o_assigned::text) <> 'assigned'
    or (select e->>'deliveryState' from pg_catalog.jsonb_array_elements(result->'orders') e
        where e->>'orderId'=o_en_route::text) <> 'en_route'
    or (select e->>'deliveryState' from pg_catalog.jsonb_array_elements(result->'orders') e
        where e->>'orderId'=o_delivered::text) <> 'delivered'
    or (select e->>'deliveryState' from pg_catalog.jsonb_array_elements(result->'orders') e
        where e->>'orderId'=o_failed::text) <> 'failed'
  then raise exception 'WORK_TRAY_DELIVERY_STATE_PROJECTION_REJECTED'; end if;

  -- Explicit false behaves like the default.
  result := app_private.list_branch_order_work_items(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',scope,'limit',100,'after',null,'channel',null,'unassignedDeliveriesOnly',false));
  if pg_catalog.jsonb_array_length(result->'orders')<>8
  then raise exception 'WORK_TRAY_DELIVERY_STATE_FALSE_FLAG_CHANGED_FILTER'; end if;

  -- Unassigned only: open, partial, prepaid (paid) and failed; ordered by updated_at desc.
  result := app_private.list_branch_order_work_items(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',scope,'limit',100,'after',null,'channel',null,'unassignedDeliveriesOnly',true));
  select array_agg(e->>'orderId' order by ord) into ids
    from pg_catalog.jsonb_array_elements(result->'orders') with ordinality as x(e,ord);
  if o_old_paid::text = any(ids) then raise exception 'WORK_TRAY_DELIVERY_STATE_OLD_PREPAID_NOT_WINDOWED'; end if;
  if ids is distinct from array[o_open::text,o_partial::text,o_prepaid::text,o_failed::text]
    or result->'next' is distinct from 'null'::jsonb
  then raise exception 'WORK_TRAY_DELIVERY_STATE_UNASSIGNED_SET_REJECTED'; end if;
  if (select e->>'status' from pg_catalog.jsonb_array_elements(result->'orders') e
        where e->>'orderId'=o_prepaid::text) <> 'paid'
    or (select e->>'deliveryState' from pg_catalog.jsonb_array_elements(result->'orders') e
        where e->>'orderId'=o_failed::text) <> 'failed'
  then raise exception 'WORK_TRAY_DELIVERY_STATE_UNASSIGNED_ITEM_REJECTED'; end if;

  -- The flag forces the delivery channel even when another channel is requested.
  result := app_private.list_branch_order_work_items(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',scope,'limit',100,'after',null,'channel','counter','unassignedDeliveriesOnly',true));
  if pg_catalog.jsonb_array_length(result->'orders')<>4
    or exists (select 1 from pg_catalog.jsonb_array_elements(result->'orders') e where e->>'channel'<>'delivery')
  then raise exception 'WORK_TRAY_DELIVERY_STATE_CHANNEL_NOT_FORCED'; end if;

  -- Keyset pagination is exact over the filtered set (the filter runs before the limit).
  page_one := app_private.list_branch_order_work_items(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',scope,'limit',3,'after',null,'channel',null,'unassignedDeliveriesOnly',true));
  if pg_catalog.jsonb_array_length(page_one->'orders')<>3 or page_one->'next' is null
    or page_one->'next' = 'null'::jsonb
  then raise exception 'WORK_TRAY_DELIVERY_STATE_PAGE_ONE_REJECTED'; end if;
  result := app_private.list_branch_order_work_items(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',scope,'limit',3,'after',page_one->'next','channel',null,
    'unassignedDeliveriesOnly',true));
  if pg_catalog.jsonb_array_length(result->'orders')<>1
    or result#>>'{orders,0,orderId}'<>o_failed::text
    or result->'next' is distinct from 'null'::jsonb
  then raise exception 'WORK_TRAY_DELIVERY_STATE_PAGE_TWO_REJECTED'; end if;

  -- Hostile request shapes are rejected, not coerced.
  result := app_private.list_branch_order_work_items(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',scope,'limit',10,'after',null,'channel',null,'unassignedDeliveriesOnly','true'));
  if result<>pg_catalog.jsonb_build_object('status','rejected')
  then raise exception 'WORK_TRAY_DELIVERY_STATE_STRING_FLAG_ACCEPTED'; end if;
  result := app_private.list_branch_order_work_items(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',scope,'limit',10,'after',null,'channel',null,'unassignedDeliveriesOnly',null));
  if result<>pg_catalog.jsonb_build_object('status','rejected')
  then raise exception 'WORK_TRAY_DELIVERY_STATE_NULL_FLAG_ACCEPTED'; end if;
  result := app_private.list_branch_order_work_items(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',scope,'limit',10,'after',null,'channel',null,'unassignedDeliveriesOnly',true,
    'extra',true));
  if result<>pg_catalog.jsonb_build_object('status','rejected')
  then raise exception 'WORK_TRAY_DELIVERY_STATE_EXTRA_KEY_ACCEPTED'; end if;

  -- Isolation: the other Branch is denied (no membership) and its Order never shows in this Branch.
  result := app_private.list_branch_order_work_items(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',other_branch::text),
    'limit',10,'after',null,'channel',null,'unassignedDeliveriesOnly',true));
  if result<>pg_catalog.jsonb_build_object('status','denied')
  then raise exception 'WORK_TRAY_DELIVERY_STATE_SCOPE_LEAKED'; end if;
  execute 'reset role';

  -- A revoked membership is still denied with the flag.
  update app.memberships set revoked_at=now_at,revoked_by=actor,revocation_reason='rollback-only test revocation'
    where id=membership;
  execute 'set local role app_api';
  result := app_private.list_branch_order_work_items(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',scope,'limit',10,'after',null,'channel',null,'unassignedDeliveriesOnly',true));
  if result<>pg_catalog.jsonb_build_object('status','denied')
  then raise exception 'WORK_TRAY_DELIVERY_STATE_REVOKED_ROLE_LEAKED'; end if;
  execute 'reset role';
end
$branch_order_work_tray_delivery_state_tests$;
commit;
