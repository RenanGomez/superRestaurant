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
