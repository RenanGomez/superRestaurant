-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
begin;
do $customer_order_history_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  membership uuid := gen_random_uuid();
  customer uuid := gen_random_uuid();
  other_customer uuid := gen_random_uuid();
  order_id uuid;
  capture_id uuid;
  expected_first uuid;
  expected_twentieth uuid;
  now_at timestamptz := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
  result jsonb;
  item jsonb;
  history_index integer;
begin
  if actor is null then raise exception 'CUSTOMER_ORDER_HISTORY_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone)
    values(restaurant,'rollback-only Customer Order history','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (branch,restaurant,'rollback-only history branch'),
    (other_branch,restaurant,'rollback-only excluded branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values(membership,actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by)
    values(membership,'waiter',actor);
  insert into app.customers(id,restaurant_id,display_name,created_by,updated_by) values
    (customer,restaurant,'History Customer',actor,actor),
    (other_customer,restaurant,'Other Customer',actor,actor);

  for history_index in 1..22 loop
    order_id := gen_random_uuid();
    capture_id := gen_random_uuid();
    if history_index=1 then expected_first := order_id; end if;
    if history_index=20 then expected_twentieth := order_id; end if;
    insert into app.orders(
      id,restaurant_id,branch_id,channel,status,aggregate,version,created_by,updated_by
    ) values (
      order_id,restaurant,branch,'delivery','closed',pg_catalog.jsonb_build_object(
        'schemaVersion',1,'orderId',order_id::text,'restaurantId',restaurant::text,
        'branchId',branch::text,'channel','delivery','status','closed','currency','MXN',
        'timeZone','America/Hermosillo','items','[]'::jsonb
      ),1,actor,actor
    );
    insert into app.capture_drafts(
      id,restaurant_id,branch_id,folio,source_channel,fulfillment_channel,status,
      attention_status,recovery_expires_at,confirmed_order_id,version,created_by,updated_by
    ) values (
      capture_id,restaurant,branch,'HIST-'||history_index::text,'phone','delivery','confirmed',
      'unclaimed',now_at+interval '30 days',order_id,1,actor,actor
    );
    insert into app.order_fulfillment_snapshots(
      restaurant_id,branch_id,order_id,capture_draft_id,capture_version,customer_id,
      fulfillment_channel,delivery_instructions,snapshot,confirmed_at,confirmed_by
    ) values (
      restaurant,branch,order_id,capture_id,1,customer,'delivery',null,
      pg_catalog.jsonb_build_object(
        'schemaVersion',1,'orderId',order_id::text,'captureDraftId',capture_id::text,
        'captureVersion',1,'fulfillmentChannel','delivery','deliveryInstructions',null
      ),now_at-(history_index-1)*interval '1 minute',actor
    );
  end loop;

  execute 'set local role app_api';
  result := app_private.list_customer_recent_orders(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'customerId',customer::text,'limit',20
  ));
  if result->>'status'<>'ok' or pg_catalog.jsonb_array_length(result#>'{result,orders}')<>20
    or result#>>'{result,customerId}'<>customer::text
    or result#>>'{result,scope,restaurantId}'<>restaurant::text
    or result#>>'{result,scope,branchId}'<>branch::text
    or result#>>'{result,orders,0,order,orderId}'<>expected_first::text
    or result#>>'{result,orders,19,order,orderId}'<>expected_twentieth::text
  then raise exception 'CUSTOMER_ORDER_HISTORY_ORDER_OR_LIMIT_REJECTED'; end if;

  item := result#>'{result,orders,0}';
  if item->>'fulfillmentChannel'<>'delivery'
    or item->>'confirmedAt' is null
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item))<>3
  then raise exception 'CUSTOMER_ORDER_HISTORY_ITEM_REJECTED'; end if;

  result := app_private.list_customer_recent_orders(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'customerId',other_customer::text,'limit',2
  ));
  if result->>'status'<>'ok' or pg_catalog.jsonb_array_length(result#>'{result,orders}')<>0
  then raise exception 'CUSTOMER_ORDER_HISTORY_EMPTY_REJECTED'; end if;

  result := app_private.list_customer_recent_orders(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',other_branch::text
    ),'customerId',customer::text,'limit',2
  ));
  if result<>pg_catalog.jsonb_build_object('status','denied')
  then raise exception 'CUSTOMER_ORDER_HISTORY_SCOPE_LEAKED'; end if;

  foreach item in array array[
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
        'restaurantId',restaurant::text,'branchId',branch::text
      ),'customerId',customer::text,'limit',21
    ),
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
        'restaurantId',restaurant::text,'branchId',branch::text
      ),'customerId',customer::text,'limit',1,'extra',true
    )
  ] loop
    result := app_private.list_customer_recent_orders(actor,item);
    if result<>pg_catalog.jsonb_build_object('status','rejected')
    then raise exception 'CUSTOMER_ORDER_HISTORY_REQUEST_ACCEPTED'; end if;
  end loop;
  execute 'reset role';

  update app.membership_role_grants set role_code='kitchen' where membership_id=membership;
  execute 'set local role app_api';
  result := app_private.list_customer_recent_orders(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'customerId',customer::text,'limit',1
  ));
  if result<>pg_catalog.jsonb_build_object('status','denied')
  then raise exception 'CUSTOMER_ORDER_HISTORY_ROLE_LEAKED'; end if;
  execute 'reset role';
end
$customer_order_history_tests$;
commit;
