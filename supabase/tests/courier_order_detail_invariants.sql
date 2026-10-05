-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises app_private.read_courier_delivery_order: a courier reads ONLY the Order of a delivery assigned to
-- them (same shape and version as read_order); another courier, a manager, a courier of another branch, an
-- unassigned Order, a non-delivery Order and a missing Order all get the same NULL.
begin;
do $courier_order_detail_tests$
declare
  creator uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  courier_a uuid := gen_random_uuid();
  courier_b uuid := gen_random_uuid();
  manager uuid := gen_random_uuid();
  foreign_courier uuid := gen_random_uuid();
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_restaurant uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  m_a uuid := gen_random_uuid();
  m_b uuid := gen_random_uuid();
  m_manager uuid := gen_random_uuid();
  m_foreign uuid := gen_random_uuid();
  o_a uuid := gen_random_uuid();
  o_b uuid := gen_random_uuid();
  o_unassigned uuid := gen_random_uuid();
  o_counter uuid := gen_random_uuid();
  result jsonb;
begin
  if creator is null then raise exception 'COURIER_DETAIL_TEST_ACTOR_REQUIRED'; end if;
  insert into app.restaurants(id,name,time_zone) values
    (restaurant,'rollback-only courier detail','America/Hermosillo'),
    (other_restaurant,'rollback-only courier detail foreign','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (branch,restaurant,'rollback-only courier detail branch'),
    (other_branch,other_restaurant,'rollback-only courier detail foreign branch');
  insert into auth.users(id,email) values
    (courier_a,'local-detail-a@invalid.test'),(courier_b,'local-detail-b@invalid.test'),
    (manager,'local-detail-manager@invalid.test'),(foreign_courier,'local-detail-foreign@invalid.test');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values
    (m_a,courier_a,restaurant,branch,creator),(m_b,courier_b,restaurant,branch,creator),
    (m_manager,manager,restaurant,branch,creator),(m_foreign,foreign_courier,other_restaurant,other_branch,creator);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values
    (m_a,'courier',creator),(m_b,'courier',creator),(m_manager,'manager',creator),(m_foreign,'courier',creator);

  insert into app.orders(id,restaurant_id,branch_id,channel,status,aggregate,version,created_by,updated_by)
  select o,restaurant,branch,ch,'open',pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',o::text,'restaurantId',restaurant::text,'branchId',branch::text,'channel',ch,
    'status','open','currency','MXN','timeZone','America/Hermosillo','items','[]'::jsonb
  ),7,creator,creator
  from (values (o_a,'delivery'),(o_b,'delivery'),(o_unassigned,'delivery'),(o_counter,'counter')) as t(o,ch);
  insert into app.order_deliveries(restaurant_id,branch_id,order_id,courier_user_id,state,assigned_at,created_by,updated_by)
  values (restaurant,branch,o_a,courier_a,'assigned',now(),creator,creator),
         (restaurant,branch,o_b,courier_b,'assigned',now(),creator,creator);

  execute 'set local role app_api';
  -- Own Order: the read_order shape, aggregate and version included.
  result := app_private.read_courier_delivery_order(courier_a,restaurant,branch,o_a);
  if result is null or result->>'schemaVersion'<>'1' or (result->>'version')::bigint<>7
    or result->'order'->>'orderId'<>o_a::text or result->'scope'->>'branchId'<>branch::text
    or result->>'updatedAt' is null
  then raise exception 'COURIER_DETAIL_OWN_ORDER_WRONG'; end if;
  -- Another courier of the same branch, even with a delivery of their own, never reads it.
  if app_private.read_courier_delivery_order(courier_b,restaurant,branch,o_a) is not null then raise exception 'COURIER_DETAIL_OTHER_COURIER_READ'; end if;
  if app_private.read_courier_delivery_order(courier_a,restaurant,branch,o_b) is not null then raise exception 'COURIER_DETAIL_OTHER_COURIER_READ_2'; end if;
  -- Not a courier (manager): this reader refuses; managers use read_order through orders.read.
  if app_private.read_courier_delivery_order(manager,restaurant,branch,o_a) is not null then raise exception 'COURIER_DETAIL_MANAGER_READ'; end if;
  -- Unassigned delivery Order, non-delivery Order, missing Order: all the same NULL.
  if app_private.read_courier_delivery_order(courier_a,restaurant,branch,o_unassigned) is not null then raise exception 'COURIER_DETAIL_UNASSIGNED_READ'; end if;
  if app_private.read_courier_delivery_order(courier_a,restaurant,branch,o_counter) is not null then raise exception 'COURIER_DETAIL_COUNTER_READ'; end if;
  if app_private.read_courier_delivery_order(courier_a,restaurant,branch,gen_random_uuid()) is not null then raise exception 'COURIER_DETAIL_MISSING_NOT_NULL'; end if;
  -- Scope isolation: a courier of another restaurant/branch, and the right courier with a wrong scope.
  if app_private.read_courier_delivery_order(foreign_courier,restaurant,branch,o_a) is not null then raise exception 'COURIER_DETAIL_FOREIGN_READ'; end if;
  if app_private.read_courier_delivery_order(courier_a,other_restaurant,other_branch,o_a) is not null then raise exception 'COURIER_DETAIL_WRONG_SCOPE_READ'; end if;
  if app_private.read_courier_delivery_order(courier_a,restaurant,other_branch,o_a) is not null then raise exception 'COURIER_DETAIL_WRONG_BRANCH_READ'; end if;
  if app_private.read_courier_delivery_order(null,restaurant,branch,o_a) is not null then raise exception 'COURIER_DETAIL_NULL_ACTOR_READ'; end if;
  execute 'reset role';

  -- A reassignment hands the Order over at once: the previous courier loses it, the new one gains it.
  update app.order_deliveries set courier_user_id = courier_b where restaurant_id = restaurant and branch_id = branch and order_id = o_a;
  execute 'set local role app_api';
  if app_private.read_courier_delivery_order(courier_a,restaurant,branch,o_a) is not null then raise exception 'COURIER_DETAIL_REASSIGNED_STILL_READ'; end if;
  if app_private.read_courier_delivery_order(courier_b,restaurant,branch,o_a) is null then raise exception 'COURIER_DETAIL_REASSIGNED_NOT_READ'; end if;
  execute 'reset role';
end
$courier_order_detail_tests$;
commit;
