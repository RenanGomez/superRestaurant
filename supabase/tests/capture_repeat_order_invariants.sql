-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
begin;
do $capture_repeat_order_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  membership uuid := gen_random_uuid();
  customer uuid := gen_random_uuid();
  contact uuid := gen_random_uuid();
  catalog uuid := gen_random_uuid();
  category uuid := gen_random_uuid();
  product uuid := gen_random_uuid();
  modifier_group uuid := gen_random_uuid();
  modifier_option uuid := gen_random_uuid();
  source_order uuid := gen_random_uuid();
  source_item uuid := gen_random_uuid();
  history_capture uuid := gen_random_uuid();
  target_capture uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  shift uuid := gen_random_uuid();
  confirmed_order uuid := gen_random_uuid();
  confirmation_event uuid := gen_random_uuid();
  item_event uuid := gen_random_uuid();
  now_at timestamptz := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
  created jsonb;
  party jsonb;
  command jsonb;
  plan jsonb;
  result jsonb;
  confirmation_command jsonb;
  order_record jsonb;
  order_audits jsonb;
begin
  if actor is null then raise exception 'CAPTURE_REPEAT_ORDER_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone)
    values(restaurant,'rollback-only Capture repeat Order','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (branch,restaurant,'rollback-only repeat branch'),
    (other_branch,restaurant,'rollback-only excluded repeat branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values(membership,actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by)
    values(membership,'cashier',actor);
  insert into app.customers(id,restaurant_id,display_name,created_by,updated_by)
    values(customer,restaurant,'Rollback repeat customer',actor,actor);
  insert into app.customer_phones(restaurant_id,customer_id,contact_id,label,display_value,normalized_value)
    values(restaurant,customer,contact,'Main','662 200 3000','6622003000');

  insert into app.menu_catalogs(id,restaurant_id,version,currency,published_by)
    values(catalog,restaurant,1,'MXN',actor);
  insert into app.menu_categories(restaurant_id,catalog_id,id,name,active,display_order)
    values(restaurant,catalog,category,'Tacos',true,1);
  insert into app.menu_products(
    restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor
  ) values (
    restaurant,catalog,product,category,'Taco vigente','TACO-REPEAT',true,1,'kitchen','piece',4900
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
            'name','Taco histórico de 35.00','unitPrice',pg_catalog.jsonb_build_object(
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
    history_capture,restaurant,branch,'REPEAT-HISTORY','phone','delivery','confirmed',
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
  if created->>'status'<>'applied' then raise exception 'CAPTURE_REPEAT_ORDER_CREATE_REJECTED'; end if;
  party := app_private.set_capture_customer(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',target_capture::text,'expectedVersion',1,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'attentionLeaseId',created#>>'{record,detail,attentionLeaseId}',
    'customerId',customer::text,'contactId',contact::text,'expectedCustomerVersion',1
  ));
  if party->>'status'<>'applied' then raise exception 'CAPTURE_REPEAT_ORDER_CUSTOMER_REJECTED'; end if;

  command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'customerId',customer::text,'sourceOrderId',source_order::text,
    'captureDraftId',target_capture::text,'expectedVersion',2,
    'attentionLeaseId',created#>>'{record,detail,attentionLeaseId}',
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  plan := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'customerId',customer::text,'sourceOrderId',source_order::text,
    'catalogVersion',catalog::text,'lines',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'sourceOrderItemId',source_item::text,'productId',product::text,'quantity',2,
        'modifierGroups',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'groupId',modifier_group::text,'selections',pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('optionId',modifier_option::text,'quantity',1)
          )
        ))
      )
    )
  );

  if app_private.repeat_customer_order_into_capture(
    actor,command,plan || '{"unitPriceMinor":3500}'::jsonb
  )->>'status'<>'rejected' then
    raise exception 'CAPTURE_REPEAT_ORDER_CLIENT_PRICE_ACCEPTED';
  end if;
  result := app_private.repeat_customer_order_into_capture(actor,command,plan);
  if result->>'status'<>'applied' or result#>>'{record,detail,version}'<>'3'
    or app_private.repeat_customer_order_into_capture(actor,command,plan)->>'status'<>'replayed'
  then raise exception 'CAPTURE_REPEAT_ORDER_APPLY_OR_REPLAY_REJECTED'; end if;
  if app_private.repeat_customer_order_into_capture(
    actor,command,pg_catalog.jsonb_set(plan,'{lines,0,quantity}','1'::jsonb)
  )->>'status'<>'conflict' then
    raise exception 'CAPTURE_REPEAT_ORDER_DIVERGENT_REPLAY_ACCEPTED';
  end if;
  execute 'reset role';

  if not exists (
    select 1 from app.capture_repeat_order_plans stored
    where stored.restaurant_id=restaurant and stored.branch_id=branch
      and stored.capture_draft_id=target_capture and stored.customer_id=customer
      and stored.source_order_id=source_order and stored.catalog_id=catalog
      and stored.applied_capture_version=3
      and stored.selection_plan#>>'{lines,0,productId}'=product::text
      and stored.selection_plan#>>'{lines,0,quantity}'='2'
      and stored.selection_plan::text !~ 'unitPrice|Taco|Salsa|name'
  ) or (
    select pg_catalog.count(*) from app.capture_command_events event
    where event.restaurant_id=restaurant and event.branch_id=branch
      and event.capture_draft_id=target_capture and event.operation='capture.order_repeated'
  )<>1 then
    raise exception 'CAPTURE_REPEAT_ORDER_DURABLE_PLAN_REJECTED';
  end if;

  if pg_catalog.to_regprocedure('app_private.read_capture_workspace_v3(uuid,jsonb)') is not null then
    execute 'set local role app_api';
    result := app_private.read_capture_workspace_v3(actor,pg_catalog.jsonb_build_object(
      'schemaVersion',3,'scope',pg_catalog.jsonb_build_object(
        'restaurantId',restaurant::text,'branchId',branch::text
      ),'captureDraftId',target_capture::text
    ));
    execute 'reset role';
    if result->>'schemaVersion'<>'3'
      or result#>>'{repeatOrderPlan,schemaVersion}'<>'1'
      or result#>>'{repeatOrderPlan,customerId}'<>customer::text
      or result#>>'{repeatOrderPlan,sourceOrderId}'<>source_order::text
      or result#>>'{repeatOrderPlan,catalogVersion}'<>catalog::text
      or result#>>'{repeatOrderPlan,appliedCaptureVersion}'<>'3'
      or result#>>'{repeatOrderPlan,lineCount}'<>'1'
    then raise exception 'CAPTURE_REPEAT_ORDER_WORKSPACE_SUMMARY_REJECTED'; end if;
  end if;

  execute 'set local role app_api';
  if app_private.repeat_customer_order_into_capture(
    actor,command || pg_catalog.jsonb_build_object(
      'expectedVersion',2,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text
    ),plan
  )->>'status'<>'conflict' then
    raise exception 'CAPTURE_REPEAT_ORDER_STALE_CAS_ACCEPTED';
  end if;
  execute 'reset role';
  update app.menu_modifier_options set active=false
  where restaurant_id=restaurant and catalog_id=catalog and group_id=modifier_group and id=modifier_option;
  execute 'set local role app_api';
  if app_private.repeat_customer_order_into_capture(
    actor,command || pg_catalog.jsonb_build_object(
      'expectedVersion',3,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text
    ),plan
  )->>'status'<>'conflict' then
    raise exception 'CAPTURE_REPEAT_ORDER_INACTIVE_OPTION_ACCEPTED';
  end if;
  execute 'reset role';
  update app.menu_modifier_options set active=true
  where restaurant_id=restaurant and catalog_id=catalog and group_id=modifier_group and id=modifier_option;
  execute 'set local role app_api';
  if app_private.repeat_customer_order_into_capture(
    actor,command || pg_catalog.jsonb_build_object(
      'scope',pg_catalog.jsonb_build_object(
        'restaurantId',restaurant::text,'branchId',other_branch::text
      ),'expectedVersion',3,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text
    ),plan
  )->>'status'<>'denied' then
    raise exception 'CAPTURE_REPEAT_ORDER_SCOPE_LEAKED';
  end if;

  if pg_catalog.to_regprocedure('app_private.confirm_capture_draft_v3(uuid,jsonb,jsonb,jsonb)') is not null then
    execute 'reset role';
    update app.capture_drafts set fulfillment_channel='counter'
    where restaurant_id=restaurant and branch_id=branch and id=target_capture;
    insert into app.operational_shifts(id,restaurant_id,branch_id,name,status,opened_at,opened_by)
      values(shift,restaurant,branch,'rollback repeat confirmation','open',now_at-interval '1 minute',actor);
    confirmation_command := pg_catalog.jsonb_build_object(
      'schemaVersion',2,'scope',pg_catalog.jsonb_build_object(
        'restaurantId',restaurant::text,'branchId',branch::text
      ),'captureDraftId',target_capture::text,'expectedVersion',3,
      'eventId',confirmation_event::text,'idempotencyKey',gen_random_uuid()::text,
      'deviceId',device::text,
      'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'attentionLeaseId',created#>>'{record,detail,attentionLeaseId}',
      'orderId',confirmed_order::text,'shiftId',shift::text,'tableId',null,
      'currency','MXN','timeZone','America/Hermosillo'
    );
    order_record := pg_catalog.jsonb_build_object(
      'schemaVersion',1,'orderId',confirmed_order::text,'restaurantId',restaurant::text,
      'branchId',branch::text,'channel','counter','currency','MXN','timeZone','America/Hermosillo',
      'status','draft','items',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'orderItemId',gen_random_uuid()::text,'snapshot',pg_catalog.jsonb_build_object(
          'catalogVersion',catalog::text,'productId',product::text,'name','Taco vigente','sku','TACO-REPEAT',
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
    if app_private.read_capture_repeat_order_plan(actor,pg_catalog.jsonb_build_object(
      'schemaVersion',3,'scope',confirmation_command->'scope','captureDraftId',target_capture::text
    ))#>>'{plan,lines,0,productId}'<>product::text
    then raise exception 'CAPTURE_REPEAT_CONFIRMATION_PLAN_READER_REJECTED'; end if;
    if app_private.confirm_capture_draft_v3(actor,confirmation_command,null,null)->>'status'<>'pending'
      then raise exception 'CAPTURE_REPEAT_CONFIRMATION_PROBE_REJECTED'; end if;
    if app_private.confirm_capture_draft_v3(
      actor,
      confirmation_command,
      order_record,
      pg_catalog.jsonb_set(order_audits,'{1,eventId}',pg_catalog.to_jsonb(confirmation_event::text))
    )->>'status'<>'conflict' then
      raise exception 'CAPTURE_REPEAT_CONFIRMATION_PARTIAL_FAILURE_REJECTED';
    end if;
    if exists (
      select 1 from app.orders placed
      where placed.restaurant_id=restaurant and placed.branch_id=branch and placed.id=confirmed_order
    ) or not exists (
      select 1 from app.capture_drafts draft
      where draft.restaurant_id=restaurant and draft.branch_id=branch and draft.id=target_capture
        and draft.status='draft' and draft.version=3 and draft.confirmed_order_id is null
    ) or not exists (
      select 1 from app.capture_repeat_order_plans stored
      where stored.restaurant_id=restaurant and stored.branch_id=branch and stored.capture_draft_id=target_capture
    ) then raise exception 'CAPTURE_REPEAT_CONFIRMATION_PARTIAL_WRITE_LEAKED'; end if;
    result := app_private.confirm_capture_draft_v3(actor,confirmation_command,order_record,order_audits);
    if result->>'status'<>'applied' or result#>>'{record,detail,status}'<>'confirmed'
      or app_private.confirm_capture_draft_v3(actor,confirmation_command,null,null)->>'status'<>'replayed'
    then raise exception 'CAPTURE_REPEAT_CONFIRMATION_APPLY_OR_REPLAY_REJECTED'; end if;
    execute 'reset role';
    if exists (
      select 1 from app.capture_repeat_order_plans stored
      where stored.restaurant_id=restaurant and stored.branch_id=branch and stored.capture_draft_id=target_capture
    ) or not exists (
      select 1 from app.orders placed
      where placed.restaurant_id=restaurant and placed.branch_id=branch and placed.id=confirmed_order
        and placed.version=2 and placed.aggregate->'items'->0->'snapshot'->>'name'='Taco vigente'
        and placed.aggregate#>>'{items,0,snapshot,unitPrice,amountMinor}'='4900'
        and placed.aggregate#>>'{items,0,snapshot,modifiers,0,unitPrice,amountMinor}'='700'
    ) or not exists (
      select 1 from app.kds_events event
      where event.restaurant_id=restaurant and event.branch_id=branch and event.order_id=confirmed_order
        and event.operation='order_item.created' and event.status='pending'
    ) then raise exception 'CAPTURE_REPEAT_CONFIRMATION_ATOMIC_GRAPH_REJECTED'; end if;
  else
    result := app_private.set_capture_customer(actor,pg_catalog.jsonb_build_object(
      'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
        'restaurantId',restaurant::text,'branchId',branch::text
      ),'captureDraftId',target_capture::text,'expectedVersion',3,'eventId',gen_random_uuid()::text,
      'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
      'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'attentionLeaseId',created#>>'{record,detail,attentionLeaseId}',
      'customerId',null,'contactId',null,'expectedCustomerVersion',null
    ));
    execute 'reset role';
    if result->>'status'<>'applied' or exists (
      select 1 from app.capture_repeat_order_plans stored
      where stored.restaurant_id=restaurant and stored.branch_id=branch
        and stored.capture_draft_id=target_capture
    ) then raise exception 'CAPTURE_REPEAT_ORDER_STALE_CONTEXT_NOT_CLEARED'; end if;
  end if;
end
$capture_repeat_order_tests$;
commit;
