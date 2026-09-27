-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
begin;
do $capture_selection_plan_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  membership uuid := gen_random_uuid();
  catalog uuid := gen_random_uuid();
  category uuid := gen_random_uuid();
  product uuid := gen_random_uuid();
  modifier_group uuid := gen_random_uuid();
  modifier_option uuid := gen_random_uuid();
  target_capture uuid := gen_random_uuid();
  line_a uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  shift uuid := gen_random_uuid();
  confirmed_order uuid := gen_random_uuid();
  confirmation_event uuid := gen_random_uuid();
  item_event uuid := gen_random_uuid();
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
  if actor is null then raise exception 'CAPTURE_SELECTION_PLAN_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone)
    values(restaurant,'rollback-only Capture selection plan','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (branch,restaurant,'rollback-only selection branch'),
    (other_branch,restaurant,'rollback-only excluded selection branch');
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
    restaurant,catalog,product,category,'Taco vigente','TACO-SELECTION',true,1,'kitchen','piece',4900
  );
  insert into app.menu_modifier_groups(
    restaurant_id,catalog_id,id,product_id,name,active,display_order,minimum_quantity,maximum_quantity
  ) values (
    restaurant,catalog,modifier_group,product,'Salsas',true,1,1,2
  );
  insert into app.menu_modifier_options(
    restaurant_id,catalog_id,group_id,id,name,unit_price_minor,active,maximum_quantity
  ) values (
    restaurant,catalog,modifier_group,modifier_option,'Roja vigente',700,true,2
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
  if created->>'status'<>'applied' then raise exception 'CAPTURE_SELECTION_PLAN_CREATE_REJECTED'; end if;
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
        'lineId',line_a::text,'productId',product::text,'variantId',null,'quantity',2,'note',null,
        'modifierGroups',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'groupId',modifier_group::text,'selections',pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('optionId',modifier_option::text,'quantity',1)
          )
        ))
      )
    )
  );

  execute 'set local role app_api';
  -- Fail closed on extra keys.
  if app_private.replace_capture_selection_plan(
    actor,command||'{"unexpected":true}'::jsonb,plan
  )->>'status'<>'rejected' then
    raise exception 'CAPTURE_SELECTION_PLAN_EXTRA_KEYS_ACCEPTED';
  end if;
  -- Duplicate lineId rejected.
  if app_private.replace_capture_selection_plan(
    actor,command,plan||pg_catalog.jsonb_build_object('lines',(plan->'lines')||(plan->'lines'))
  )->>'status'<>'rejected' then
    raise exception 'CAPTURE_SELECTION_PLAN_DUPLICATE_LINE_ID_ACCEPTED';
  end if;
  -- Line missing the required variantId key is rejected, matching the exact
  -- shape produced by parseReplaceCaptureSelectionPlanCommandV1.
  if app_private.replace_capture_selection_plan(
    actor,command,pg_catalog.jsonb_set(
      plan,'{lines,0}',(plan#>'{lines,0}')-'variantId'
    )
  )->>'status'<>'rejected' then
    raise exception 'CAPTURE_SELECTION_PLAN_MISSING_VARIANT_ID_KEY_ACCEPTED';
  end if;
  -- A non-uuid variantId is rejected.
  if app_private.replace_capture_selection_plan(
    actor,command,pg_catalog.jsonb_set(plan,'{lines,0,variantId}','"not-a-uuid"'::jsonb)
  )->>'status'<>'rejected' then
    raise exception 'CAPTURE_SELECTION_PLAN_INVALID_VARIANT_ID_ACCEPTED';
  end if;

  result := app_private.replace_capture_selection_plan(actor,command,plan);
  if result->>'status'<>'applied' or result#>>'{record,detail,version}'<>'2'
    or app_private.replace_capture_selection_plan(actor,command,plan)->>'status'<>'replayed'
  then raise exception 'CAPTURE_SELECTION_PLAN_APPLY_OR_REPLAY_REJECTED'; end if;

  -- Same idempotencyKey, different plan payload -> conflict, never silently reprices/duplicates.
  if app_private.replace_capture_selection_plan(
    actor,command,pg_catalog.jsonb_set(plan,'{lines,0,quantity}','1'::jsonb)
  )->>'status'<>'conflict' then
    raise exception 'CAPTURE_SELECTION_PLAN_DIVERGENT_REPLAY_ACCEPTED';
  end if;

  -- Stale CAS.
  if app_private.replace_capture_selection_plan(
    actor,command||pg_catalog.jsonb_build_object(
      'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text
    ),plan
  )->>'status'<>'conflict' then
    raise exception 'CAPTURE_SELECTION_PLAN_STALE_CAS_ACCEPTED';
  end if;

  -- Cross-branch scope leak.
  if app_private.replace_capture_selection_plan(
    actor,command||pg_catalog.jsonb_build_object(
      'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',other_branch::text),
      'expectedVersion',2,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text
    ),plan
  )->>'status'<>'denied' then
    raise exception 'CAPTURE_SELECTION_PLAN_SCOPE_LEAKED';
  end if;
  execute 'reset role';

  if not exists (
    select 1 from app.capture_repeat_order_plans stored
    where stored.restaurant_id=restaurant and stored.branch_id=branch
      and stored.capture_draft_id=target_capture and stored.plan_kind='selection'
      and stored.customer_id is null and stored.source_order_id is null and stored.catalog_id=catalog
      and stored.applied_capture_version=2
      and stored.selection_plan#>>'{lines,0,lineId}'=line_a::text
      and stored.selection_plan#>>'{lines,0,quantity}'='2'
      and stored.selection_plan::text !~ 'unitPrice|Taco|Salsa|"name"'
  ) or (
    select pg_catalog.count(*) from app.capture_command_events event
    where event.restaurant_id=restaurant and event.branch_id=branch
      and event.capture_draft_id=target_capture and event.operation='capture.selection_replaced'
  )<>1 then
    raise exception 'CAPTURE_SELECTION_PLAN_DURABLE_PLAN_REJECTED';
  end if;

  -- V3 stays repeat-plan-only: a selection plan must not surface there.
  execute 'set local role app_api';
  result := app_private.read_capture_workspace_v3(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',3,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',target_capture::text
  ));
  execute 'reset role';
  if result->>'schemaVersion'<>'3' or not app_private.jsonb_has_exact_keys(
    result,array['schemaVersion','detail','customerSnapshot','fulfillmentSnapshot','repeatOrderPlan']
  ) or result->'repeatOrderPlan' is distinct from 'null'::jsonb
  then raise exception 'CAPTURE_SELECTION_PLAN_V3_UNCHANGED_REJECTED'; end if;

  -- V4 widens V3 with a bounded selection-plan summary (no lines/prices).
  execute 'set local role app_api';
  result := app_private.read_capture_workspace_v4(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',4,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',target_capture::text
  ));
  execute 'reset role';
  if result->>'schemaVersion'<>'4'
    or result->'repeatOrderPlan' is distinct from 'null'::jsonb
    or result#>>'{selectionPlan,schemaVersion}'<>'1'
    or result#>>'{selectionPlan,catalogVersion}'<>catalog::text
    or result#>>'{selectionPlan,appliedCaptureVersion}'<>'2'
    or result#>>'{selectionPlan,lineCount}'<>'1'
    or result->'selectionPlan' ? 'plan'
  then raise exception 'CAPTURE_SELECTION_PLAN_WORKSPACE_SUMMARY_REJECTED'; end if;

  -- Confirm materializes the Order from the selection plan with the same
  -- catalog/product/option revalidation as the repeat-plan path.
  update app.capture_drafts set fulfillment_channel='counter'
  where restaurant_id=restaurant and branch_id=branch and id=target_capture;
  insert into app.operational_shifts(id,restaurant_id,branch_id,name,status,opened_at,opened_by)
    values(shift,restaurant,branch,'rollback selection confirmation','open',now_at-interval '1 minute',actor);
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
  order_record := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',confirmed_order::text,'restaurantId',restaurant::text,
    'branchId',branch::text,'channel','counter','currency','MXN','timeZone','America/Hermosillo',
    'status','draft','items',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'orderItemId',gen_random_uuid()::text,'snapshot',pg_catalog.jsonb_build_object(
        'catalogVersion',catalog::text,'productId',product::text,'name','Taco vigente','sku','TACO-SELECTION',
        'stationId','kitchen','unit','piece',
        'unitPrice',pg_catalog.jsonb_build_object('amountMinor',4900,'currency','MXN'),
        'modifiers',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'modifierId',modifier_option::text,'name','Roja vigente','groupId',modifier_group::text,
          'groupName','Salsas','groupCatalogVersion',catalog::text,
          'unitPrice',pg_catalog.jsonb_build_object('amountMinor',700,'currency','MXN'),'quantity',1
        ))
      ),'quantity',2,'restaurantId',restaurant::text,'branchId',branch::text,'status','pending'
    ))
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
      'entityId',order_record#>>'{items,0,orderItemId}','orderItemId',order_record#>>'{items,0,orderItemId}'
    )
  );
  execute 'set local role app_api';
  if app_private.read_capture_selection_plan(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',3,'scope',confirmation_command->'scope','captureDraftId',target_capture::text
  ))#>>'{plan,lines,0,productId}'<>product::text
  then raise exception 'CAPTURE_SELECTION_PLAN_READER_REJECTED'; end if;
  if app_private.confirm_capture_draft_v3(actor,confirmation_command,null,null)->>'status'<>'pending'
    then raise exception 'CAPTURE_SELECTION_CONFIRMATION_PROBE_REJECTED'; end if;
  result := app_private.confirm_capture_draft_v3(actor,confirmation_command,order_record,order_audits);
  if result->>'status'<>'applied' or result#>>'{record,detail,status}'<>'confirmed'
    or app_private.confirm_capture_draft_v3(actor,confirmation_command,null,null)->>'status'<>'replayed'
  then raise exception 'CAPTURE_SELECTION_CONFIRMATION_APPLY_OR_REPLAY_REJECTED'; end if;
  execute 'reset role';

  if exists (
    select 1 from app.capture_repeat_order_plans stored
    where stored.restaurant_id=restaurant and stored.branch_id=branch and stored.capture_draft_id=target_capture
  ) or not exists (
    select 1 from app.orders placed
    where placed.restaurant_id=restaurant and placed.branch_id=branch and placed.id=confirmed_order
      and placed.aggregate->'items'->0->'snapshot'->>'name'='Taco vigente'
      and placed.aggregate#>>'{items,0,snapshot,unitPrice,amountMinor}'='4900'
  ) then raise exception 'CAPTURE_SELECTION_CONFIRMATION_ATOMIC_GRAPH_REJECTED'; end if;
end
$capture_selection_plan_tests$;

-- A catalog selection plan has no Customer dependency, unlike a repeat-order plan: the
-- context-clearing trigger must only delete a 'repeat' row on a customer change, never a
-- 'selection' row. Leaving draft status still clears either kind (covered by the ON DELETE
-- RESTRICT/leave-draft path exercised elsewhere; this block isolates the customer-change edge).
do $capture_selection_plan_trigger_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  catalog uuid := gen_random_uuid();
  category uuid := gen_random_uuid();
  product uuid := gen_random_uuid();
  customer_a uuid := gen_random_uuid();
  customer_b uuid := gen_random_uuid();
  snapshot_a uuid := gen_random_uuid();
  snapshot_b uuid := gen_random_uuid();
  source_order uuid := gen_random_uuid();
  selection_capture uuid := gen_random_uuid();
  repeat_capture uuid := gen_random_uuid();
  now_at timestamptz := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
begin
  if actor is null then raise exception 'CAPTURE_SELECTION_PLAN_TRIGGER_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone)
    values(restaurant,'rollback-only Capture plan-context trigger','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(branch,restaurant,'rollback-only trigger branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values(gen_random_uuid(),actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by)
    select id,'cashier',actor from app.memberships where restaurant_id=restaurant and branch_id=branch;

  insert into app.menu_catalogs(id,restaurant_id,version,currency,published_by)
    values(catalog,restaurant,1,'MXN',actor);
  insert into app.menu_categories(restaurant_id,catalog_id,id,name,active,display_order)
    values(restaurant,catalog,category,'Tacos',true,1);
  insert into app.menu_products(
    restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor
  ) values (
    restaurant,catalog,product,category,'Taco vigente','TACO-TRIGGER',true,1,'kitchen','piece',4900
  );
  insert into app.menu_catalog_heads(restaurant_id,catalog_id,version,updated_at,updated_by)
    values(restaurant,catalog,1,now_at,actor);

  insert into app.customers(id,restaurant_id,display_name,created_by,updated_by) values
    (customer_a,restaurant,'Rollback trigger customer A',actor,actor),
    (customer_b,restaurant,'Rollback trigger customer B',actor,actor);
  insert into app.customer_party_snapshots(
    id,restaurant_id,customer_id,contact_id,display_name,phone_display_value,phone_normalized_value,created_by
  ) values
    (snapshot_a,restaurant,customer_a,gen_random_uuid(),'Rollback trigger customer A','662 200 3001','6622003001',actor),
    (snapshot_b,restaurant,customer_b,gen_random_uuid(),'Rollback trigger customer B','662 200 3002','6622003002',actor);

  insert into app.orders(
    id,restaurant_id,branch_id,channel,status,aggregate,version,created_by,updated_by
  ) values (
    source_order,restaurant,branch,'delivery','closed',pg_catalog.jsonb_build_object(
      'schemaVersion',1,'orderId',source_order::text,'restaurantId',restaurant::text,
      'branchId',branch::text,'channel','delivery','status','closed','currency','MXN',
      'timeZone','America/Hermosillo','items','[]'::jsonb
    ),1,actor,actor
  );

  -- A selection-plan capture with a customer already attached (dine-in/delivery captures can
  -- have both a customer and a catalog selection at once).
  insert into app.capture_drafts(
    id,restaurant_id,branch_id,folio,source_channel,fulfillment_channel,status,attention_status,
    customer_id,customer_snapshot_id,recovery_expires_at,version,created_by,updated_by
  ) values (
    selection_capture,restaurant,branch,'TRIGGER-SELECTION','phone','delivery','draft','unclaimed',
    customer_a,snapshot_a,now_at+interval '30 days',1,actor,actor
  );
  insert into app.capture_repeat_order_plans(
    restaurant_id,branch_id,capture_draft_id,plan_kind,customer_id,source_order_id,catalog_id,
    applied_capture_version,selection_plan,updated_at,updated_by
  ) values (
    restaurant,branch,selection_capture,'selection',null,null,catalog,2,pg_catalog.jsonb_build_object(
      'schemaVersion',1,'catalogVersion',catalog::text,'lines','[]'::jsonb
    ),now_at,actor
  );

  update app.capture_drafts set customer_id=customer_b,customer_snapshot_id=snapshot_b,
    updated_at=pg_catalog.clock_timestamp(),updated_by=actor
  where restaurant_id=restaurant and branch_id=branch and id=selection_capture;
  if not exists (
    select 1 from app.capture_repeat_order_plans stored
    where stored.restaurant_id=restaurant and stored.branch_id=branch and stored.capture_draft_id=selection_capture
      and stored.plan_kind='selection'
  ) then raise exception 'CAPTURE_SELECTION_PLAN_TRIGGER_DELETED_SELECTION_ON_CUSTOMER_CHANGE'; end if;

  -- A repeat-order-plan capture, by contrast, must lose its plan the moment the customer changes.
  insert into app.capture_drafts(
    id,restaurant_id,branch_id,folio,source_channel,fulfillment_channel,status,attention_status,
    customer_id,customer_snapshot_id,recovery_expires_at,version,created_by,updated_by
  ) values (
    repeat_capture,restaurant,branch,'TRIGGER-REPEAT','phone','delivery','draft','unclaimed',
    customer_a,snapshot_a,now_at+interval '30 days',1,actor,actor
  );
  insert into app.capture_repeat_order_plans(
    restaurant_id,branch_id,capture_draft_id,plan_kind,customer_id,source_order_id,catalog_id,
    applied_capture_version,selection_plan,updated_at,updated_by
  ) values (
    restaurant,branch,repeat_capture,'repeat',customer_a,source_order,catalog,2,pg_catalog.jsonb_build_object(
      'schemaVersion',1,'customerId',customer_a::text,'sourceOrderId',source_order::text,
      'catalogVersion',catalog::text,'lines',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'sourceOrderItemId',gen_random_uuid()::text,'productId',product::text,'quantity',1,'modifierGroups','[]'::jsonb
      ))
    ),now_at,actor
  );

  update app.capture_drafts set customer_id=customer_b,customer_snapshot_id=snapshot_b,
    updated_at=pg_catalog.clock_timestamp(),updated_by=actor
  where restaurant_id=restaurant and branch_id=branch and id=repeat_capture;
  if exists (
    select 1 from app.capture_repeat_order_plans stored
    where stored.restaurant_id=restaurant and stored.branch_id=branch and stored.capture_draft_id=repeat_capture
  ) then raise exception 'CAPTURE_SELECTION_PLAN_TRIGGER_KEPT_REPEAT_ON_CUSTOMER_CHANGE'; end if;
end
$capture_selection_plan_trigger_tests$;

-- repeat_customer_order_into_capture's on-conflict update must fix plan_kind='repeat' (and
-- null customer_id/source_order_id back in via replace_capture_selection_plan) so a prior
-- 'selection' row converts cleanly instead of violating capture_repeat_order_plans_payload_valid.
do $capture_selection_plan_kind_conversion_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  membership uuid := gen_random_uuid();
  customer uuid := gen_random_uuid();
  contact uuid := gen_random_uuid();
  customer_snapshot uuid := gen_random_uuid();
  catalog uuid := gen_random_uuid();
  category uuid := gen_random_uuid();
  product uuid := gen_random_uuid();
  source_order uuid := gen_random_uuid();
  source_item uuid := gen_random_uuid();
  history_capture uuid := gen_random_uuid();
  target_capture uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  now_at timestamptz := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
  created jsonb;
  lease text;
  selection_command jsonb;
  selection_plan jsonb;
  repeat_command jsonb;
  repeat_plan jsonb;
  result jsonb;
  stored app.capture_repeat_order_plans%rowtype;
begin
  if actor is null then raise exception 'CAPTURE_SELECTION_PLAN_KIND_CONVERSION_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone)
    values(restaurant,'rollback-only Capture plan-kind conversion','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(branch,restaurant,'rollback-only conversion branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values(membership,actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by)
    values(membership,'cashier',actor);
  insert into app.customers(id,restaurant_id,display_name,created_by,updated_by)
    values(customer,restaurant,'Rollback conversion customer',actor,actor);
  insert into app.customer_phones(restaurant_id,customer_id,contact_id,label,display_value,normalized_value)
    values(restaurant,customer,contact,'Main','662 200 3010','6622003010');
  insert into app.customer_party_snapshots(
    id,restaurant_id,customer_id,contact_id,display_name,phone_display_value,phone_normalized_value,created_by
  ) values (
    customer_snapshot,restaurant,customer,contact,'Rollback conversion customer','662 200 3010','6622003010',actor
  );

  insert into app.menu_catalogs(id,restaurant_id,version,currency,published_by)
    values(catalog,restaurant,1,'MXN',actor);
  insert into app.menu_categories(restaurant_id,catalog_id,id,name,active,display_order)
    values(restaurant,catalog,category,'Tacos',true,1);
  -- No modifier groups on this product: repeat_customer_order_into_capture's per-line group
  -- coverage check has nothing to satisfy, keeping this fixture focused on plan_kind alone.
  insert into app.menu_products(
    restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor
  ) values (
    restaurant,catalog,product,category,'Taco vigente','TACO-CONVERSION',true,1,'kitchen','piece',4900
  );
  insert into app.menu_catalog_heads(restaurant_id,catalog_id,version,updated_at,updated_by)
    values(restaurant,catalog,1,now_at,actor);

  insert into app.orders(
    id,restaurant_id,branch_id,channel,status,aggregate,version,created_by,updated_by
  ) values (
    source_order,restaurant,branch,'delivery','closed',pg_catalog.jsonb_build_object(
      'schemaVersion',1,'orderId',source_order::text,'restaurantId',restaurant::text,
      'branchId',branch::text,'channel','delivery','status','closed','currency','MXN',
      'timeZone','America/Hermosillo','items',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'orderItemId',source_item::text,'quantity',2,'status','pending',
          'snapshot',pg_catalog.jsonb_build_object(
            'catalogVersion','historical-v1','productId',product::text,
            'name','Taco histórico','unitPrice',pg_catalog.jsonb_build_object(
              'amountMinor','3500','currency','MXN'
            ),'modifiers','[]'::jsonb
          )
        )
      )
    ),1,actor,actor
  );
  insert into app.capture_drafts(
    id,restaurant_id,branch_id,folio,source_channel,fulfillment_channel,status,
    attention_status,recovery_expires_at,confirmed_order_id,version,created_by,updated_by
  ) values (
    history_capture,restaurant,branch,'CONVERSION-HISTORY','phone','delivery','confirmed',
    'unclaimed',now_at+interval '30 days',source_order,1,actor,actor
  );
  insert into app.order_fulfillment_snapshots(
    restaurant_id,branch_id,order_id,capture_draft_id,capture_version,customer_id,
    fulfillment_channel,delivery_instructions,snapshot,confirmed_at,confirmed_by
  ) values (
    restaurant,branch,source_order,history_capture,1,customer,'delivery',null,
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'orderId',source_order::text,'captureDraftId',history_capture::text,
      'captureVersion',1,'fulfillmentChannel','delivery','deliveryInstructions',null
    ),now_at,actor
  );

  execute 'set local role app_api';
  created := app_private.create_capture_draft(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',target_capture::text,'expectedVersion',0,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceChannel','phone','fulfillmentChannel','delivery'
  ));
  execute 'reset role';
  if created->>'status'<>'applied' then raise exception 'CAPTURE_SELECTION_PLAN_KIND_CONVERSION_CREATE_REJECTED'; end if;
  lease := created#>>'{record,detail,attentionLeaseId}';

  -- Step 1: a catalog selection plan (version 1 -> 2, plan_kind='selection').
  selection_command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',target_capture::text,'expectedVersion',1,
    'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  selection_plan := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'catalogVersion',catalog::text,'lines',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'lineId',gen_random_uuid()::text,'productId',product::text,'variantId',null,'quantity',1,'note',null,
        'modifierGroups','[]'::jsonb
      )
    )
  );
  execute 'set local role app_api';
  result := app_private.replace_capture_selection_plan(actor,selection_command,selection_plan);
  execute 'reset role';
  if result->>'status'<>'applied' then raise exception 'CAPTURE_SELECTION_PLAN_KIND_CONVERSION_SELECTION_STEP_REJECTED'; end if;

  select * into stored from app.capture_repeat_order_plans
  where restaurant_id=restaurant and branch_id=branch and capture_draft_id=target_capture;
  if stored.plan_kind<>'selection' or stored.customer_id is not null or stored.source_order_id is not null then
    raise exception 'CAPTURE_SELECTION_PLAN_KIND_CONVERSION_SELECTION_SHAPE_REJECTED';
  end if;

  -- The customer must be attached before a repeat plan can reference them (raw update mirrors
  -- app_private.set_capture_customer's effect without needing its full snapshot machinery here).
  update app.capture_drafts set customer_id=customer,customer_snapshot_id=customer_snapshot,
    updated_at=pg_catalog.clock_timestamp(),updated_by=actor
  where restaurant_id=restaurant and branch_id=branch and id=target_capture;

  -- Step 2: repeat that historical order onto the SAME capture (version 2 -> 3). The prior
  -- 'selection' row must convert to 'repeat' instead of violating the payload check.
  repeat_command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'customerId',customer::text,'sourceOrderId',source_order::text,
    'captureDraftId',target_capture::text,'expectedVersion',2,
    'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  repeat_plan := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'customerId',customer::text,'sourceOrderId',source_order::text,
    'catalogVersion',catalog::text,'lines',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'sourceOrderItemId',source_item::text,'productId',product::text,'quantity',2,'modifierGroups','[]'::jsonb
    ))
  );
  execute 'set local role app_api';
  result := app_private.repeat_customer_order_into_capture(actor,repeat_command,repeat_plan);
  execute 'reset role';
  if result->>'status'<>'applied' then raise exception 'CAPTURE_SELECTION_PLAN_KIND_CONVERSION_REPEAT_STEP_REJECTED'; end if;

  select * into stored from app.capture_repeat_order_plans
  where restaurant_id=restaurant and branch_id=branch and capture_draft_id=target_capture;
  if stored.plan_kind<>'repeat' or stored.customer_id<>customer or stored.source_order_id<>source_order then
    raise exception 'CAPTURE_SELECTION_PLAN_KIND_CONVERSION_REPEAT_SHAPE_REJECTED';
  end if;

  -- Step 3: replace it with a selection plan again (version 3 -> 4). The prior 'repeat' row
  -- must convert back to 'selection' with customer_id/source_order_id nulled.
  execute 'set local role app_api';
  result := app_private.replace_capture_selection_plan(actor,selection_command||pg_catalog.jsonb_build_object(
    'expectedVersion',3,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text
  ),selection_plan);
  execute 'reset role';
  if result->>'status'<>'applied' then raise exception 'CAPTURE_SELECTION_PLAN_KIND_CONVERSION_SELECTION_AGAIN_STEP_REJECTED'; end if;

  select * into stored from app.capture_repeat_order_plans
  where restaurant_id=restaurant and branch_id=branch and capture_draft_id=target_capture;
  if stored.plan_kind<>'selection' or stored.customer_id is not null or stored.source_order_id is not null then
    raise exception 'CAPTURE_SELECTION_PLAN_KIND_CONVERSION_SELECTION_AGAIN_SHAPE_REJECTED';
  end if;
end
$capture_selection_plan_kind_conversion_tests$;

-- A catalog selection plan has no Customer dependency: an unrelated mutation (here, toggling
-- the recovery preference) that advances draft.version past applied_capture_version must not
-- turn a perfectly valid selection into 503 on read, nor block confirm from materializing it.
do $capture_selection_plan_stale_version_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
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
  now_at timestamptz := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
  created jsonb;
  lease text;
  command jsonb;
  plan jsonb;
  preference_command jsonb;
  result jsonb;
  confirmation_command jsonb;
  order_record jsonb;
  order_audits jsonb;
begin
  if actor is null then raise exception 'CAPTURE_SELECTION_PLAN_STALE_VERSION_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone)
    values(restaurant,'rollback-only Capture stale selection version','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(branch,restaurant,'rollback-only stale-version branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values(gen_random_uuid(),actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by)
    select id,'cashier',actor from app.memberships where restaurant_id=restaurant and branch_id=branch;

  insert into app.menu_catalogs(id,restaurant_id,version,currency,published_by)
    values(catalog,restaurant,1,'MXN',actor);
  insert into app.menu_categories(restaurant_id,catalog_id,id,name,active,display_order)
    values(restaurant,catalog,category,'Tacos',true,1);
  insert into app.menu_products(
    restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor
  ) values (
    restaurant,catalog,product,category,'Taco vigente','TACO-STALE',true,1,'kitchen','piece',4900
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
  if created->>'status'<>'applied' then raise exception 'CAPTURE_SELECTION_PLAN_STALE_VERSION_CREATE_REJECTED'; end if;
  lease := created#>>'{record,detail,attentionLeaseId}';

  -- Step 1: attach a selection plan (version 1 -> 2, applied_capture_version=2).
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
        'lineId',line_a::text,'productId',product::text,'variantId',null,'quantity',2,'note',null,
        'modifierGroups','[]'::jsonb
      )
    )
  );
  execute 'set local role app_api';
  result := app_private.replace_capture_selection_plan(actor,command,plan);
  execute 'reset role';
  if result->>'status'<>'applied' or result#>>'{record,detail,version}'<>'2' then
    raise exception 'CAPTURE_SELECTION_PLAN_STALE_VERSION_SETUP_REJECTED';
  end if;

  -- Step 2: an unrelated mutation (recovery preference) advances the draft to version 3
  -- WITHOUT touching the selection plan: applied_capture_version stays at 2.
  preference_command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',target_capture::text,'expectedVersion',2,
    'attentionLeaseId',lease,'autoRenewSelected',true,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  execute 'set local role app_api';
  result := app_private.mutate_capture_attention(actor,'capture.recovery_preference_changed',preference_command);
  execute 'reset role';
  if result->>'status'<>'applied' or result#>>'{record,detail,version}'<>'3' then
    raise exception 'CAPTURE_SELECTION_PLAN_STALE_VERSION_DRIFT_REJECTED';
  end if;
  if not exists (
    select 1 from app.capture_repeat_order_plans stored
    where stored.restaurant_id=restaurant and stored.branch_id=branch and stored.capture_draft_id=target_capture
      and stored.plan_kind='selection' and stored.applied_capture_version=2
  ) then raise exception 'CAPTURE_SELECTION_PLAN_STALE_VERSION_PLAN_UNEXPECTEDLY_CHANGED'; end if;

  -- read_capture_selection_plan must still answer 'ok' (not 'missing') for the now-stale plan.
  execute 'set local role app_api';
  result := app_private.read_capture_selection_plan(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',3,'scope',command->'scope','captureDraftId',target_capture::text
  ));
  execute 'reset role';
  if result->>'status'<>'ok' or result#>>'{plan,lines,0,productId}'<>product::text then
    raise exception 'CAPTURE_SELECTION_PLAN_STALE_VERSION_READER_REJECTED';
  end if;

  -- V4 must still expose a non-null selectionPlan summary (informative appliedCaptureVersion=2).
  execute 'set local role app_api';
  result := app_private.read_capture_workspace_v4(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',4,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',target_capture::text
  ));
  execute 'reset role';
  if result#>>'{selectionPlan,appliedCaptureVersion}'<>'2' or result#>>'{selectionPlan,lineCount}'<>'1' then
    raise exception 'CAPTURE_SELECTION_PLAN_STALE_VERSION_WORKSPACE_REJECTED';
  end if;

  -- Confirm must still materialize the Order from the stale-but-valid selection plan.
  insert into app.operational_shifts(id,restaurant_id,branch_id,name,status,opened_at,opened_by)
    values(shift,restaurant,branch,'rollback stale selection confirmation','open',now_at-interval '1 minute',actor);
  confirmation_command := pg_catalog.jsonb_build_object(
    'schemaVersion',2,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',target_capture::text,'expectedVersion',3,
    'eventId',confirmation_event::text,'idempotencyKey',gen_random_uuid()::text,
    'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'attentionLeaseId',lease,
    'orderId',confirmed_order::text,'shiftId',shift::text,'tableId',null,
    'currency','MXN','timeZone','America/Hermosillo'
  );
  order_record := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',confirmed_order::text,'restaurantId',restaurant::text,
    'branchId',branch::text,'channel','counter','currency','MXN','timeZone','America/Hermosillo',
    'status','draft','items',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'orderItemId',gen_random_uuid()::text,'snapshot',pg_catalog.jsonb_build_object(
        'catalogVersion',catalog::text,'productId',product::text,'name','Taco vigente','sku','TACO-STALE',
        'stationId','kitchen','unit','piece',
        'unitPrice',pg_catalog.jsonb_build_object('amountMinor',4900,'currency','MXN'),
        'modifiers','[]'::jsonb
      ),'quantity',2,'restaurantId',restaurant::text,'branchId',branch::text,'status','pending'
    ))
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
      'entityId',order_record#>>'{items,0,orderItemId}','orderItemId',order_record#>>'{items,0,orderItemId}'
    )
  );
  execute 'set local role app_api';
  if app_private.confirm_capture_draft_v3(actor,confirmation_command,null,null)->>'status'<>'pending'
    then raise exception 'CAPTURE_SELECTION_PLAN_STALE_VERSION_CONFIRMATION_PROBE_REJECTED'; end if;
  result := app_private.confirm_capture_draft_v3(actor,confirmation_command,order_record,order_audits);
  execute 'reset role';
  if result->>'status'<>'applied' or result#>>'{record,detail,status}'<>'confirmed' then
    raise exception 'CAPTURE_SELECTION_PLAN_STALE_VERSION_CONFIRMATION_REJECTED';
  end if;
  if not exists (
    select 1 from app.orders placed
    where placed.restaurant_id=restaurant and placed.branch_id=branch and placed.id=confirmed_order
      and placed.aggregate->'items'->0->'snapshot'->>'name'='Taco vigente'
  ) then raise exception 'CAPTURE_SELECTION_PLAN_STALE_VERSION_CONFIRMATION_NOT_MATERIALIZED'; end if;
end
$capture_selection_plan_stale_version_tests$;

-- probe_capture_selection_plan_replace answers purely from actor+scope+idempotencyKey+
-- fingerprint: it must recognize a replay (and a divergent-payload conflict) without ever
-- touching catalog/product state, and without requiring a pending request to have been applied.
do $capture_selection_plan_probe_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  catalog uuid := gen_random_uuid();
  category uuid := gen_random_uuid();
  product uuid := gen_random_uuid();
  target_capture uuid := gen_random_uuid();
  line_a uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  now_at timestamptz := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
  created jsonb;
  lease text;
  command jsonb;
  plan jsonb;
  result jsonb;
begin
  if actor is null then raise exception 'CAPTURE_SELECTION_PLAN_PROBE_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone)
    values(restaurant,'rollback-only Capture selection plan probe','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(branch,restaurant,'rollback-only probe branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values(gen_random_uuid(),actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by)
    select id,'cashier',actor from app.memberships where restaurant_id=restaurant and branch_id=branch;

  insert into app.menu_catalogs(id,restaurant_id,version,currency,published_by)
    values(catalog,restaurant,1,'MXN',actor);
  insert into app.menu_categories(restaurant_id,catalog_id,id,name,active,display_order)
    values(restaurant,catalog,category,'Tacos',true,1);
  insert into app.menu_products(
    restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor
  ) values (
    restaurant,catalog,product,category,'Taco vigente','TACO-PROBE',true,1,'kitchen','piece',4900
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
  if created->>'status'<>'applied' then raise exception 'CAPTURE_SELECTION_PLAN_PROBE_CREATE_REJECTED'; end if;
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
        'lineId',line_a::text,'productId',product::text,'variantId',null,'quantity',1,'note',null,
        'modifierGroups','[]'::jsonb
      )
    )
  );

  -- Before the write ever happens, the probe must answer 'pending' -- not 'applied', not
  -- 'replayed' -- purely because no command event exists yet for this idempotency key.
  execute 'set local role app_api';
  result := app_private.probe_capture_selection_plan_replace(actor,command,plan);
  execute 'reset role';
  if result->>'status'<>'pending' then raise exception 'CAPTURE_SELECTION_PLAN_PROBE_PENDING_REJECTED'; end if;

  execute 'set local role app_api';
  result := app_private.replace_capture_selection_plan(actor,command,plan);
  execute 'reset role';
  if result->>'status'<>'applied' then raise exception 'CAPTURE_SELECTION_PLAN_PROBE_APPLY_REJECTED'; end if;

  -- Even after every product/head behind this exact plan is gone (the catalog row itself
  -- stays, since capture_repeat_order_plans_catalog_fk still references it), the probe must
  -- still recognize the replay: it never reads menu_products/menu_catalog_heads at all.
  delete from app.menu_catalog_heads where restaurant_id=restaurant;
  delete from app.menu_modifier_options where restaurant_id=restaurant;
  delete from app.menu_modifier_groups where restaurant_id=restaurant;
  delete from app.menu_products where restaurant_id=restaurant;
  delete from app.menu_categories where restaurant_id=restaurant;

  execute 'set local role app_api';
  result := app_private.probe_capture_selection_plan_replace(actor,command,plan);
  execute 'reset role';
  if result->>'status'<>'replayed' or result#>>'{record,detail,version}'<>'2' then
    raise exception 'CAPTURE_SELECTION_PLAN_PROBE_REPLAY_REJECTED';
  end if;

  -- Same idempotencyKey, different plan payload -> conflict, never treated as a replay.
  execute 'set local role app_api';
  result := app_private.probe_capture_selection_plan_replace(
    actor,command,pg_catalog.jsonb_set(plan,'{lines,0,quantity}','2'::jsonb)
  );
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'CAPTURE_SELECTION_PLAN_PROBE_DIVERGENT_ACCEPTED'; end if;

  -- A structurally rejected command/plan must fail closed the same way the write does.
  execute 'set local role app_api';
  result := app_private.probe_capture_selection_plan_replace(actor,command||'{"unexpected":true}'::jsonb,plan);
  execute 'reset role';
  if result->>'status'<>'rejected' then raise exception 'CAPTURE_SELECTION_PLAN_PROBE_EXTRA_KEYS_ACCEPTED'; end if;
end
$capture_selection_plan_probe_tests$;

-- A 0-line selection plan means "no plan": the row is deleted (still
-- audited by the command event), never persisted with an empty lines array.
do $capture_selection_plan_empty_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  catalog uuid := gen_random_uuid();
  category uuid := gen_random_uuid();
  product uuid := gen_random_uuid();
  target_capture uuid := gen_random_uuid();
  line_a uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  now_at timestamptz := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
  created jsonb;
  lease text;
  command jsonb;
  plan jsonb;
  empty_command jsonb;
  empty_plan jsonb;
  result jsonb;
begin
  if actor is null then raise exception 'CAPTURE_SELECTION_PLAN_EMPTY_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone)
    values(restaurant,'rollback-only Capture empty selection plan','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(branch,restaurant,'rollback-only empty selection branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values(gen_random_uuid(),actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by)
    select id,'cashier',actor from app.memberships where restaurant_id=restaurant and branch_id=branch;

  insert into app.menu_catalogs(id,restaurant_id,version,currency,published_by)
    values(catalog,restaurant,1,'MXN',actor);
  insert into app.menu_categories(restaurant_id,catalog_id,id,name,active,display_order)
    values(restaurant,catalog,category,'Tacos',true,1);
  insert into app.menu_products(
    restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor
  ) values (
    restaurant,catalog,product,category,'Taco vigente','TACO-SELECTION-EMPTY',true,1,'kitchen','piece',4900
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
  if created->>'status'<>'applied' then raise exception 'CAPTURE_SELECTION_PLAN_EMPTY_CREATE_REJECTED'; end if;
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
        'lineId',line_a::text,'productId',product::text,'variantId',null,'quantity',1,'note',null,
        'modifierGroups',pg_catalog.jsonb_build_array()
      )
    )
  );

  execute 'set local role app_api';
  result := app_private.replace_capture_selection_plan(actor,command,plan);
  execute 'reset role';
  if result->>'status'<>'applied' then raise exception 'CAPTURE_SELECTION_PLAN_EMPTY_SETUP_REJECTED'; end if;
  if not exists (
    select 1 from app.capture_repeat_order_plans stored
    where stored.restaurant_id=restaurant and stored.branch_id=branch and stored.capture_draft_id=target_capture
  ) then raise exception 'CAPTURE_SELECTION_PLAN_EMPTY_SETUP_ROW_MISSING'; end if;

  empty_command := command||pg_catalog.jsonb_build_object(
    'expectedVersion',2,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text
  );
  empty_plan := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'catalogVersion',catalog::text,'lines',pg_catalog.jsonb_build_array()
  );
  execute 'set local role app_api';
  result := app_private.replace_capture_selection_plan(actor,empty_command,empty_plan);
  execute 'reset role';
  if result->>'status'<>'applied' or result#>>'{record,detail,version}'<>'3' then
    raise exception 'CAPTURE_SELECTION_PLAN_EMPTY_REPLACE_REJECTED';
  end if;

  if exists (
    select 1 from app.capture_repeat_order_plans stored
    where stored.restaurant_id=restaurant and stored.branch_id=branch and stored.capture_draft_id=target_capture
  ) then raise exception 'CAPTURE_SELECTION_PLAN_EMPTY_ROW_NOT_DELETED'; end if;
  if (
    select pg_catalog.count(*) from app.capture_command_events event
    where event.restaurant_id=restaurant and event.branch_id=branch
      and event.capture_draft_id=target_capture and event.operation='capture.selection_replaced'
  )<>2 then raise exception 'CAPTURE_SELECTION_PLAN_EMPTY_NOT_AUDITED'; end if;

  execute 'set local role app_api';
  result := app_private.read_capture_workspace_v4(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',4,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',target_capture::text
  ));
  execute 'reset role';
  if result->'selectionPlan' is distinct from 'null'::jsonb
  then raise exception 'CAPTURE_SELECTION_PLAN_EMPTY_WORKSPACE_STILL_HAS_PLAN'; end if;
end
$capture_selection_plan_empty_tests$;
commit;
