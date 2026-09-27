-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises confirm_capture_draft_v3's revalidation of the frozen order-item note introduced by
-- 20260930000100_order_item_note.sql: a materialized item must carry the exact 'note' key and its
-- value must match the confirmed selection-plan line's note (string or null), never silently pass
-- with a missing key or a mismatched value.
begin;
do $order_item_note_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  membership uuid := gen_random_uuid();
  catalog uuid := gen_random_uuid();
  category uuid := gen_random_uuid();
  product uuid := gen_random_uuid();
  target_capture uuid := gen_random_uuid();
  line_a uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  shift uuid := gen_random_uuid();
  confirmed_order uuid := gen_random_uuid();
  confirmation_event uuid := gen_random_uuid();
  item_event uuid := gen_random_uuid();
  item_id uuid := gen_random_uuid();
  now_at timestamptz := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
  created jsonb;
  lease text;
  command jsonb;
  plan jsonb;
  result jsonb;
  confirmation_command jsonb;
  order_record jsonb;
  order_audits jsonb;
begin
  if actor is null then raise exception 'ORDER_ITEM_NOTE_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone)
    values(restaurant,'rollback-only order item note','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(branch,restaurant,'rollback-only note branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values(membership,actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by)
    values(membership,'cashier',actor);

  insert into app.menu_catalogs(id,restaurant_id,version,currency,published_by)
    values(catalog,restaurant,1,'MXN',actor);
  insert into app.menu_categories(restaurant_id,catalog_id,id,name,active,display_order)
    values(restaurant,catalog,category,'Tacos',true,1);
  insert into app.menu_products(
    restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor
  ) values (
    restaurant,catalog,product,category,'Taco con nota','TACO-NOTE',true,1,'kitchen','piece',4900
  );
  insert into app.menu_catalog_heads(restaurant_id,catalog_id,version,updated_at,updated_by)
    values(restaurant,catalog,1,now_at,actor);

  execute 'set local role app_api';
  created := app_private.create_capture_draft(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',target_capture::text,'expectedVersion',0,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceChannel','phone','fulfillmentChannel','counter'
  ));
  execute 'reset role';
  if created->>'status'<>'applied' then raise exception 'ORDER_ITEM_NOTE_CREATE_REJECTED'; end if;
  lease := created#>>'{record,detail,attentionLeaseId}';

  command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',target_capture::text,'expectedVersion',1,
    'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  plan := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'catalogVersion',catalog::text,'lines',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'lineId',line_a::text,'productId',product::text,'variantId',null,'quantity',1,'note','Sin cebolla',
        'modifierGroups',pg_catalog.jsonb_build_array()
      )
    )
  );

  execute 'set local role app_api';
  result := app_private.replace_capture_selection_plan(actor,command,plan);
  execute 'reset role';
  if result->>'status'<>'applied' or result#>>'{record,detail,version}'<>'2'
  then raise exception 'ORDER_ITEM_NOTE_PLAN_APPLY_REJECTED'; end if;

  update app.capture_drafts set fulfillment_channel='counter'
  where restaurant_id=restaurant and branch_id=branch and id=target_capture;
  insert into app.operational_shifts(id,restaurant_id,branch_id,name,status,opened_at,opened_by)
    values(shift,restaurant,branch,'rollback note confirmation','open',now_at-interval '1 minute',actor);
  confirmation_command := pg_catalog.jsonb_build_object(
    'schemaVersion',2,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',target_capture::text,'expectedVersion',2,
    'eventId',confirmation_event::text,'idempotencyKey',gen_random_uuid()::text,
    'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'attentionLeaseId',lease,
    'orderId',confirmed_order::text,'shiftId',shift::text,'tableId',null,
    'currency','MXN','timeZone','America/Hermosillo'
  );
  order_audits := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'eventId',confirmation_event::text,
      'idempotencyKey',confirmation_command->>'idempotencyKey','restaurantId',restaurant::text,
      'branchId',branch::text,'orderId',confirmed_order::text,'actorId',actor::text,
      'deviceId',device::text,'occurredAt',confirmation_command->>'occurredAt',
      'operation','order.created','entityType','order','entityId',confirmed_order::text,'to','draft'
    ),
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'eventId',item_event::text,'idempotencyKey',gen_random_uuid()::text,
      'restaurantId',restaurant::text,'branchId',branch::text,'orderId',confirmed_order::text,
      'actorId',actor::text,'deviceId',device::text,'occurredAt',confirmation_command->>'occurredAt',
      'operation','order.item_added','entityType','order_item',
      'entityId',item_id::text,'orderItemId',item_id::text
    )
  );

  execute 'set local role app_api';
  if app_private.confirm_capture_draft_v3(actor,confirmation_command,null,null)->>'status'<>'pending'
    then raise exception 'ORDER_ITEM_NOTE_CONFIRMATION_PROBE_REJECTED'; end if;

  -- A materialized item whose note diverges from the confirmed selection-plan line's note
  -- must never be silently accepted; note that the confirmed plan line's note is 'Sin cebolla'.
  order_record := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',confirmed_order::text,'restaurantId',restaurant::text,
    'branchId',branch::text,'channel','counter','currency','MXN','timeZone','America/Hermosillo',
    'status','draft','items',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'orderItemId',item_id::text,'snapshot',pg_catalog.jsonb_build_object(
        'catalogVersion',catalog::text,'productId',product::text,'name','Taco con nota','sku','TACO-NOTE',
        'stationId','kitchen','unit','piece',
        'unitPrice',pg_catalog.jsonb_build_object('amountMinor',4900,'currency','MXN'),
        'modifiers',pg_catalog.jsonb_build_array()
      ),'quantity',1,'restaurantId',restaurant::text,'branchId',branch::text,'status','pending',
      'note',null
    ))
  );
  if app_private.confirm_capture_draft_v3(actor,confirmation_command,order_record,order_audits)->>'status'<>'conflict'
  then raise exception 'ORDER_ITEM_NOTE_MISMATCH_ACCEPTED'; end if;

  -- A materialized item missing the 'note' key entirely (the pre-20260930 shape) must also be
  -- rejected, never silently backfilled to null.
  order_record := pg_catalog.jsonb_set(
    order_record,'{items,0}',(order_record#>'{items,0}')-'note'
  );
  if app_private.confirm_capture_draft_v3(actor,confirmation_command,order_record,order_audits)->>'status'<>'conflict'
  then raise exception 'ORDER_ITEM_NOTE_MISSING_KEY_ACCEPTED'; end if;

  -- The correctly materialized item -- note matches the confirmed plan line's note -- applies.
  order_record := pg_catalog.jsonb_set(order_record,'{items,0,note}','"Sin cebolla"'::jsonb,true);
  result := app_private.confirm_capture_draft_v3(actor,confirmation_command,order_record,order_audits);
  if result->>'status'<>'applied' or result#>>'{record,detail,status}'<>'confirmed'
    or app_private.confirm_capture_draft_v3(actor,confirmation_command,null,null)->>'status'<>'replayed'
  then raise exception 'ORDER_ITEM_NOTE_APPLY_OR_REPLAY_REJECTED'; end if;
  execute 'reset role';

  if not exists (
    select 1 from app.orders placed
    where placed.restaurant_id=restaurant and placed.branch_id=branch and placed.id=confirmed_order
      and placed.aggregate#>>'{items,0,note}'='Sin cebolla'
  ) then raise exception 'ORDER_ITEM_NOTE_NOT_PERSISTED'; end if;
end
$order_item_note_tests$;
commit;
