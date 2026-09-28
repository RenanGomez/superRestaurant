-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises app_private.list_branch_order_work_items: keyset pagination, scope isolation,
-- role authorization, and that both a snapshot-backed (confirmed delivery) Order and a bare
-- (no fulfillment snapshot, e.g. dine-in) Order are returned with their full aggregate and
-- (nullable) snapshot untouched, so the API can project totals/customer/address from them. Uses
-- a table-less counter Order for the no-snapshot case to avoid a dining-table fixture; the API's
-- own unit tests exercise the dine-in/table mapping against a domain Order aggregate.
begin;
do $branch_order_work_tray_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  membership uuid := gen_random_uuid();
  customer uuid := gen_random_uuid();
  order_with_snapshot uuid := gen_random_uuid();
  order_without_snapshot uuid := gen_random_uuid();
  capture_id uuid := gen_random_uuid();
  now_at timestamptz := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
  result jsonb;
  first_page_next jsonb;
  item jsonb;
begin
  if actor is null then raise exception 'BRANCH_ORDER_WORK_TRAY_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone)
    values(restaurant,'rollback-only branch order work tray','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (branch,restaurant,'rollback-only work tray branch'),
    (other_branch,restaurant,'rollback-only excluded branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values(membership,actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by)
    values(membership,'cashier',actor);
  insert into app.customers(id,restaurant_id,display_name,created_by,updated_by)
    values(customer,restaurant,'Work Tray Customer',actor,actor);

  insert into app.orders(
    id,restaurant_id,branch_id,channel,status,aggregate,version,created_by,updated_by,created_at,updated_at
  ) values (
    order_with_snapshot,restaurant,branch,'delivery','open',pg_catalog.jsonb_build_object(
      'schemaVersion',1,'orderId',order_with_snapshot::text,'restaurantId',restaurant::text,
      'branchId',branch::text,'channel','delivery','status','open','currency','MXN',
      'timeZone','America/Hermosillo','items','[]'::jsonb
    ),1,actor,actor,now_at-interval '5 minutes',now_at
  ), (
    order_without_snapshot,restaurant,branch,'counter','draft',pg_catalog.jsonb_build_object(
      'schemaVersion',1,'orderId',order_without_snapshot::text,'restaurantId',restaurant::text,
      'branchId',branch::text,'channel','counter','status','draft','currency','MXN',
      'timeZone','America/Hermosillo','items','[]'::jsonb
    ),1,actor,actor,now_at-interval '10 minutes',now_at-interval '1 minute'
  );
  insert into app.capture_drafts(
    id,restaurant_id,branch_id,folio,source_channel,fulfillment_channel,status,
    attention_status,recovery_expires_at,confirmed_order_id,version,created_by,updated_by
  ) values (
    capture_id,restaurant,branch,'WT-0001','phone','delivery','confirmed',
    'unclaimed',now_at+interval '30 days',order_with_snapshot,1,actor,actor
  );
  insert into app.order_fulfillment_snapshots(
    restaurant_id,branch_id,order_id,capture_draft_id,capture_version,customer_id,
    fulfillment_channel,delivery_instructions,snapshot,confirmed_at,confirmed_by
  ) values (
    restaurant,branch,order_with_snapshot,capture_id,1,customer,'delivery',null,
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'orderId',order_with_snapshot::text,'captureDraftId',capture_id::text,
      'captureVersion',1,'fulfillmentChannel','delivery','deliveryInstructions',null
    ),now_at,actor
  );

  execute 'set local role app_api';

  result := app_private.list_branch_order_work_items(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'limit',1,'after',null,'channel',null
  ));
  if result->>'schemaVersion'<>'1' or pg_catalog.jsonb_array_length(result->'orders')<>1
    or result#>>'{orders,0,orderId}'<>order_with_snapshot::text
    or result#>>'{orders,0,snapshot,orderId}'<>order_with_snapshot::text
    or result#>>'{orders,0,order,orderId}'<>order_with_snapshot::text
    or result->'next' is null
  then raise exception 'BRANCH_ORDER_WORK_TRAY_FIRST_PAGE_REJECTED'; end if;
  first_page_next := result->'next';

  result := app_private.list_branch_order_work_items(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'limit',10,'after',null,'channel','counter'
  ));
  if pg_catalog.jsonb_array_length(result->'orders')<>1
    or result#>>'{orders,0,orderId}'<>order_without_snapshot::text
  then raise exception 'BRANCH_ORDER_WORK_TRAY_CHANNEL_FILTER_REJECTED'; end if;

  result := app_private.list_branch_order_work_items(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'limit',10,'after',null,'channel','takeout'
  ));
  if pg_catalog.jsonb_array_length(result->'orders')<>0
  then raise exception 'BRANCH_ORDER_WORK_TRAY_CHANNEL_FILTER_LEAKED'; end if;

  result := app_private.list_branch_order_work_items(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'limit',10,'after',null,'channel','not-a-channel'
  ));
  if result<>pg_catalog.jsonb_build_object('status','rejected')
  then raise exception 'BRANCH_ORDER_WORK_TRAY_INVALID_CHANNEL_ACCEPTED'; end if;

  result := app_private.list_branch_order_work_items(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'limit',1,'after',first_page_next,'channel',null
  ));
  if pg_catalog.jsonb_array_length(result->'orders')<>1
    or result#>>'{orders,0,orderId}'<>order_without_snapshot::text
    or result#>'{orders,0,snapshot}' <> 'null'::jsonb
    or result->'next' is distinct from 'null'::jsonb
    or result#>>'{orders,0,createdAt}'<>pg_catalog.to_char(
      (now_at-interval '10 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    or result#>>'{orders,0,createdAt}' = result#>>'{orders,0,updatedAt}'
  then raise exception 'BRANCH_ORDER_WORK_TRAY_SECOND_PAGE_OR_SNAPSHOT_NULL_REJECTED'; end if;

  result := app_private.list_branch_order_work_items(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',other_branch::text
    ),'limit',10,'after',null,'channel',null
  ));
  if result<>pg_catalog.jsonb_build_object('status','denied')
  then raise exception 'BRANCH_ORDER_WORK_TRAY_SCOPE_LEAKED'; end if;

  result := app_private.list_branch_order_work_items(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'limit',0,'after',null,'channel',null
  ));
  if result<>pg_catalog.jsonb_build_object('status','rejected')
  then raise exception 'BRANCH_ORDER_WORK_TRAY_REQUEST_ACCEPTED'; end if;
  execute 'reset role';

  update app.memberships set revoked_at=now_at,revoked_by=actor,revocation_reason='rollback-only test revocation'
    where id=membership;
  execute 'set local role app_api';
  result := app_private.list_branch_order_work_items(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'limit',10,'after',null,'channel',null
  ));
  if result<>pg_catalog.jsonb_build_object('status','denied')
  then raise exception 'BRANCH_ORDER_WORK_TRAY_REVOKED_MEMBERSHIP_LEAKED'; end if;
  execute 'reset role';
end
$branch_order_work_tray_tests$;
commit;
