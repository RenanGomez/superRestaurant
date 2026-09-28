-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Mirrors the fixture/assertion style of supabase/tests/order_item_note_invariants.sql and
-- supabase/tests/capture_selection_plan tests.
begin;
do $capture_payment_intent_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  other_actor uuid := (select id from auth.users where deleted_at is null order by id offset 1 limit 1);
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  membership uuid := gen_random_uuid();
  other_membership uuid := gen_random_uuid();
  target_capture uuid := gen_random_uuid();
  other_capture uuid := gen_random_uuid();
  confirm_capture uuid := gen_random_uuid();
  stale_capture uuid := gen_random_uuid();
  catalog uuid := gen_random_uuid();
  category uuid := gen_random_uuid();
  product uuid := gen_random_uuid();
  line_a uuid := gen_random_uuid();
  confirm_customer uuid := gen_random_uuid();
  confirm_contact uuid := gen_random_uuid();
  confirm_address uuid := gen_random_uuid();
  party jsonb;
  fulfillment jsonb;
  device uuid := gen_random_uuid();
  shift uuid := gen_random_uuid();
  confirmed_order uuid := gen_random_uuid();
  stale_order uuid := gen_random_uuid();
  confirmation_event uuid := gen_random_uuid();
  item_event uuid := gen_random_uuid();
  item_id uuid := gen_random_uuid();
  now_at timestamptz := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
  created jsonb;
  lease text;
  quote_command jsonb;
  quote jsonb;
  intent_command jsonb;
  autosave_command jsonb;
  plan_command jsonb;
  plan jsonb;
  result jsonb;
  confirmation_command jsonb;
  order_record jsonb;
  order_audits jsonb;
  frozen jsonb;
begin
  if actor is null or other_actor is null then raise exception 'CAPTURE_PAYMENT_INTENT_TEST_ACTORS_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone)
    values(restaurant,'rollback-only payment intent','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(branch,restaurant,'rollback-only pi branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values(membership,actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by)
    values(membership,'cashier',actor);
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values(other_membership,other_actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by)
    values(other_membership,'cashier',actor);

  ----------------------------------------------------------------------------
  -- Delivery quote: rejected outside delivery, foreign lease, apply, replay,
  -- cleared on channel change.
  ----------------------------------------------------------------------------
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
  if created->>'status'<>'applied' then raise exception 'CAPTURE_PAYMENT_INTENT_CREATE_REJECTED'; end if;
  lease := created#>>'{record,detail,attentionLeaseId}';

  quote := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'quoteId',gen_random_uuid()::text,'restaurantId',restaurant::text,
    'branchId',branch::text,'captureDraftId',target_capture::text,
    'addressSnapshotRef',gen_random_uuid()::text,
    'address',pg_catalog.jsonb_build_object('postalCode','83000','locality','Hermosillo'),
    'currency','MXN','timeZone','America/Hermosillo',
    'quotedAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'scheduledFor',null,'version',1,'coverageStatus','covered','zoneId',gen_random_uuid()::text,
    'feeMinor',3000,
    'promiseStart',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'promiseEnd',pg_catalog.to_char((now_at+interval '15 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'override',null
  );
  quote_command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',target_capture::text,'expectedVersion',1,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

  -- version 1, channel='counter': rejected (not delivery).
  execute 'set local role app_api';
  result := app_private.set_capture_delivery_quote(actor,quote_command,quote);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'CAPTURE_DELIVERY_QUOTE_ACCEPTED_OUTSIDE_DELIVERY'; end if;

  -- version 1 -> 2: legitimate channel change via autosave (keeps the journal continuous).
  autosave_command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',target_capture::text,'expectedVersion',1,'attentionLeaseId',lease,
    'sourceChannel','phone','fulfillmentChannel','delivery','customerSnapshotRef',null,'fulfillmentSnapshotRef',null,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  execute 'set local role app_api';
  result := app_private.autosave_capture_draft(actor,autosave_command);
  execute 'reset role';
  if result->>'status'<>'applied' then raise exception 'CAPTURE_PAYMENT_INTENT_TEST_AUTOSAVE_TO_DELIVERY_REJECTED'; end if;
  quote_command := quote_command||pg_catalog.jsonb_build_object('expectedVersion',2);

  -- Lease belonging to a different membership must be refused.
  execute 'set local role app_api';
  result := app_private.set_capture_delivery_quote(
    actor,quote_command||pg_catalog.jsonb_build_object(
      'attentionLeaseId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text
    ),quote
  );
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'CAPTURE_DELIVERY_QUOTE_FOREIGN_LEASE_ACCEPTED'; end if;

  -- version 2 -> 3: apply.
  execute 'set local role app_api';
  result := app_private.set_capture_delivery_quote(actor,quote_command,quote);
  execute 'reset role';
  if result->>'status'<>'applied' or result#>>'{record,detail,version}'<>'3'
  then raise exception 'CAPTURE_DELIVERY_QUOTE_APPLY_REJECTED'; end if;
  if not exists (
    select 1 from app.capture_delivery_quotes stored
    where stored.restaurant_id=restaurant and stored.branch_id=branch and stored.capture_draft_id=target_capture
      and stored.quote->>'feeMinor'='3000'
  ) then raise exception 'CAPTURE_DELIVERY_QUOTE_NOT_PERSISTED'; end if;

  -- Idempotent replay: same idempotency key returns the same applied result without reapplying.
  execute 'set local role app_api';
  result := app_private.set_capture_delivery_quote(actor,quote_command,quote);
  execute 'reset role';
  if result->>'status'<>'replayed' then raise exception 'CAPTURE_DELIVERY_QUOTE_REPLAY_REJECTED'; end if;

  -- version 3 -> 4: legitimate channel change away from delivery clears the frozen quote.
  autosave_command := autosave_command||pg_catalog.jsonb_build_object(
    'expectedVersion',3,'fulfillmentChannel','counter',
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text
  );
  execute 'set local role app_api';
  result := app_private.autosave_capture_draft(actor,autosave_command);
  execute 'reset role';
  if result->>'status'<>'applied' then raise exception 'CAPTURE_PAYMENT_INTENT_TEST_AUTOSAVE_TO_COUNTER_REJECTED'; end if;
  if exists (
    select 1 from app.capture_delivery_quotes stored
    where stored.restaurant_id=restaurant and stored.branch_id=branch and stored.capture_draft_id=target_capture
  ) then raise exception 'CAPTURE_DELIVERY_QUOTE_NOT_CLEARED_ON_CHANNEL_CHANGE'; end if;

  ----------------------------------------------------------------------------
  -- Payment intent: isolation, foreign lease, non-cash tender rejection,
  -- apply, replay -- capture is now at version 4.
  ----------------------------------------------------------------------------
  created := app_private.create_capture_draft(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',other_capture::text,'expectedVersion',0,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceChannel','phone','fulfillmentChannel','counter'
  ));

  intent_command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',target_capture::text,'expectedVersion',4,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'method','cash','tenderedAmountMinor',20000,'tipMinor',1500,
    'basisFingerprint',pg_catalog.encode(pg_catalog.sha256('fixture-basis'::bytea),'hex')
  );

  -- Foreign lease is refused.
  execute 'set local role app_api';
  result := app_private.set_capture_payment_intent(actor,intent_command||pg_catalog.jsonb_build_object(
    'attentionLeaseId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text
  ));
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'CAPTURE_PAYMENT_INTENT_FOREIGN_LEASE_ACCEPTED'; end if;

  -- A non-cash method rejects a stated tendered amount.
  execute 'set local role app_api';
  result := app_private.set_capture_payment_intent(actor,intent_command||pg_catalog.jsonb_build_object(
    'idempotencyKey',gen_random_uuid()::text,'method','transfer'
  ));
  execute 'reset role';
  if result->>'status'<>'rejected' then raise exception 'CAPTURE_PAYMENT_INTENT_NONCASH_TENDER_ACCEPTED'; end if;

  -- version 4 -> 5: apply.
  execute 'set local role app_api';
  result := app_private.set_capture_payment_intent(actor,intent_command);
  execute 'reset role';
  if result->>'status'<>'applied' then raise exception 'CAPTURE_PAYMENT_INTENT_APPLY_REJECTED'; end if;
  if not exists (
    select 1 from app.capture_payment_intents stored
    where stored.restaurant_id=restaurant and stored.branch_id=branch and stored.capture_draft_id=target_capture
      and stored.intent->>'tenderedAmountMinor'='20000' and stored.intent->>'tipMinor'='1500'
  ) then raise exception 'CAPTURE_PAYMENT_INTENT_NOT_PERSISTED'; end if;
  if exists (
    select 1 from app.capture_payment_intents stored
    where stored.restaurant_id=restaurant and stored.branch_id=branch and stored.capture_draft_id=other_capture
  ) then raise exception 'CAPTURE_PAYMENT_INTENT_LEAKED_ACROSS_CAPTURES'; end if;

  -- Replay: identical idempotency key returns the same applied record.
  execute 'set local role app_api';
  result := app_private.set_capture_payment_intent(actor,intent_command);
  execute 'reset role';
  if result->>'status'<>'replayed' then raise exception 'CAPTURE_PAYMENT_INTENT_REPLAY_REJECTED'; end if;

  -- Leaving draft (no_sale, last touch on this capture) clears the payment intent too.
  update app.capture_drafts set status='no_sale',attention_status='unclaimed',
    owner_membership_id=null,attention_lease_id=null,attention_lease_expires_at=null
  where restaurant_id=restaurant and branch_id=branch and id=target_capture;
  if exists (
    select 1 from app.capture_payment_intents stored
    where stored.restaurant_id=restaurant and stored.branch_id=branch and stored.capture_draft_id=target_capture
  ) then raise exception 'CAPTURE_PAYMENT_INTENT_NOT_CLEARED_ON_NO_SALE'; end if;

  ----------------------------------------------------------------------------
  -- Confirm freezes deliveryQuote and paymentIntent into the Order snapshot.
  ----------------------------------------------------------------------------
  insert into app.menu_catalogs(id,restaurant_id,version,currency,published_by)
    values(catalog,restaurant,1,'MXN',actor);
  insert into app.menu_categories(restaurant_id,catalog_id,id,name,active,display_order)
    values(restaurant,catalog,category,'Tacos',true,1);
  insert into app.menu_products(
    restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor
  ) values (
    restaurant,catalog,product,category,'Taco de confirmacion','TACO-CONFIRM',true,1,'kitchen','piece',5000
  );
  insert into app.menu_catalog_heads(restaurant_id,catalog_id,version,updated_at,updated_by)
    values(restaurant,catalog,1,now_at,actor);
  insert into app.operational_shifts(id,restaurant_id,branch_id,name,status,opened_at,opened_by)
    values(shift,restaurant,branch,'rollback confirm shift','open',now_at-interval '1 minute',actor);
  insert into app.customers(id,restaurant_id,display_name,created_by,updated_by)
    values(confirm_customer,restaurant,'Rollback confirm customer',actor,actor);
  insert into app.customer_phones(restaurant_id,customer_id,contact_id,label,display_value,normalized_value)
    values(restaurant,confirm_customer,confirm_contact,'Main','662 100 3000','6621003000');
  insert into app.customer_addresses(
    id,restaurant_id,customer_id,label,street_line,locality,country_code,instructions,
    validation_branch_id,validation_event_id,validated_by,validation_device_id,validated_at,
    created_at,created_by,updated_at,updated_by
  ) values (
    confirm_address,restaurant,confirm_customer,'Home','Calle Confirmacion 200','Hermosillo','MX',null,
    branch,gen_random_uuid(),actor,gen_random_uuid(),now_at,now_at,actor,now_at,actor
  );

  -- version 0 -> 1: create (delivery channel, so base confirm_capture_draft will require both a
  -- customer and a fulfillment/address snapshot below).
  execute 'set local role app_api';
  created := app_private.create_capture_draft(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',confirm_capture::text,'expectedVersion',0,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceChannel','phone','fulfillmentChannel','delivery'
  ));
  execute 'reset role';
  if created->>'status'<>'applied' then raise exception 'CAPTURE_PAYMENT_INTENT_CONFIRM_CREATE_REJECTED'; end if;
  lease := created#>>'{record,detail,attentionLeaseId}';

  -- version 1 -> 2: attach the customer.
  execute 'set local role app_api';
  party := app_private.set_capture_customer(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',confirm_capture::text,'expectedVersion',1,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'customerId',confirm_customer::text,'contactId',confirm_contact::text,'expectedCustomerVersion',1
  ));
  execute 'reset role';
  if party->>'status'<>'applied' then raise exception 'CAPTURE_PAYMENT_INTENT_CONFIRM_CUSTOMER_REJECTED'; end if;

  -- version 2 -> 3: attach the address as the fulfillment snapshot.
  execute 'set local role app_api';
  fulfillment := app_private.set_capture_fulfillment(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',confirm_capture::text,'expectedVersion',2,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'customerSnapshotRef',party#>>'{record,detail,customerSnapshotRef}',
    'addressId',confirm_address::text,'expectedAddressVersion',1
  ));
  execute 'reset role';
  if fulfillment->>'status'<>'applied' then raise exception 'CAPTURE_PAYMENT_INTENT_CONFIRM_FULFILLMENT_REJECTED'; end if;

  -- version 3 -> 4: catalog selection plan.
  plan_command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',confirm_capture::text,'expectedVersion',3,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
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
  result := app_private.replace_capture_selection_plan(actor,plan_command,plan);
  execute 'reset role';
  if result->>'status'<>'applied' then raise exception 'CAPTURE_PAYMENT_INTENT_CONFIRM_PLAN_REJECTED'; end if;

  -- version 4 -> 5: the frozen delivery quote.
  quote := quote||pg_catalog.jsonb_build_object('captureDraftId',confirm_capture::text);
  quote_command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',confirm_capture::text,'expectedVersion',4,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  execute 'set local role app_api';
  result := app_private.set_capture_delivery_quote(actor,quote_command,quote);
  execute 'reset role';
  if result->>'status'<>'applied' then raise exception 'CAPTURE_PAYMENT_INTENT_CONFIRM_QUOTE_REJECTED'; end if;

  -- version 5 -> 6: the payment intent.
  intent_command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',confirm_capture::text,'expectedVersion',5,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'method','cash','tenderedAmountMinor',10000,'tipMinor',500,
    'basisFingerprint',pg_catalog.encode(pg_catalog.sha256('fixture-basis-confirm'::bytea),'hex')
  );
  execute 'set local role app_api';
  result := app_private.set_capture_payment_intent(actor,intent_command);
  execute 'reset role';
  if result->>'status'<>'applied' then raise exception 'CAPTURE_PAYMENT_INTENT_CONFIRM_INTENT_REJECTED'; end if;

  confirmation_command := pg_catalog.jsonb_build_object(
    'schemaVersion',2,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',confirm_capture::text,'expectedVersion',6,
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
  order_record := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',confirmed_order::text,'restaurantId',restaurant::text,
    'branchId',branch::text,'channel','delivery','currency','MXN','timeZone','America/Hermosillo',
    'status','draft','items',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'orderItemId',item_id::text,'snapshot',pg_catalog.jsonb_build_object(
        'catalogVersion',catalog::text,'productId',product::text,'name','Taco de confirmacion',
        'sku','TACO-CONFIRM','stationId','kitchen','unit','piece',
        'unitPrice',pg_catalog.jsonb_build_object('amountMinor',5000,'currency','MXN'),
        'modifiers',pg_catalog.jsonb_build_array()
      ),'quantity',1,'restaurantId',restaurant::text,'branchId',branch::text,'status','pending',
      'note',null
    ))
  );

  execute 'set local role app_api';
  if app_private.confirm_capture_draft_v3(actor,confirmation_command,null,null)->>'status'<>'pending'
    then raise exception 'CAPTURE_PAYMENT_INTENT_CONFIRM_PROBE_REJECTED'; end if;
  result := app_private.confirm_capture_draft_v3(actor,confirmation_command,order_record,order_audits);
  execute 'reset role';
  if result->>'status'<>'applied' then raise exception 'CAPTURE_PAYMENT_INTENT_CONFIRM_APPLY_REJECTED'; end if;

  select snapshot.snapshot into frozen from app.order_fulfillment_snapshots snapshot
  where snapshot.restaurant_id=restaurant and snapshot.branch_id=branch and snapshot.order_id=confirmed_order;
  if frozen is null or frozen#>>'{deliveryQuote,feeMinor}'<>'3000'
    or frozen#>>'{paymentIntent,tenderedAmountMinor}'<>'10000'
    or frozen#>>'{paymentIntent,tipMinor}'<>'500'
  then raise exception 'CAPTURE_PAYMENT_INTENT_CONFIRM_DID_NOT_FREEZE_BOTH'; end if;

  ----------------------------------------------------------------------------
  -- Confirm rejects a stale payment intent (applied_capture_version behind
  -- the version being confirmed).
  ----------------------------------------------------------------------------
  execute 'set local role app_api';
  created := app_private.create_capture_draft(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',stale_capture::text,'expectedVersion',0,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceChannel','phone','fulfillmentChannel','counter'
  ));
  execute 'reset role';
  if created->>'status'<>'applied' then raise exception 'CAPTURE_PAYMENT_INTENT_STALE_CREATE_REJECTED'; end if;
  lease := created#>>'{record,detail,attentionLeaseId}';

  intent_command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',stale_capture::text,'expectedVersion',1,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'method','cash','tenderedAmountMinor',5000,'tipMinor',0,
    'basisFingerprint',pg_catalog.encode(pg_catalog.sha256('fixture-basis-stale'::bytea),'hex')
  );
  execute 'set local role app_api';
  result := app_private.set_capture_payment_intent(actor,intent_command);
  execute 'reset role';
  if result->>'status'<>'applied' then raise exception 'CAPTURE_PAYMENT_INTENT_STALE_SET_REJECTED'; end if;
  -- Payment intent's applied_capture_version is now 2 (set at version 1 -> 2).

  -- version 2 -> 3: an unrelated autosave advances the capture past the intent's basis, without
  -- touching the intent itself, exactly the scenario basis-fingerprint/applied_capture_version
  -- staleness exists to catch.
  autosave_command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',stale_capture::text,'expectedVersion',2,'attentionLeaseId',lease,
    'sourceChannel','phone','fulfillmentChannel','counter','customerSnapshotRef',null,'fulfillmentSnapshotRef',null,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  execute 'set local role app_api';
  result := app_private.autosave_capture_draft(actor,autosave_command);
  execute 'reset role';
  if result->>'status'<>'applied' then raise exception 'CAPTURE_PAYMENT_INTENT_STALE_AUTOSAVE_REJECTED'; end if;

  confirmation_command := pg_catalog.jsonb_build_object(
    'schemaVersion',2,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',stale_capture::text,'expectedVersion',3,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'attentionLeaseId',lease,
    'orderId',stale_order::text,'shiftId',shift::text,'tableId',null,
    'currency','MXN','timeZone','America/Hermosillo'
  );
  order_audits := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'schemaVersion',1,'eventId',confirmation_command->>'eventId',
    'idempotencyKey',confirmation_command->>'idempotencyKey','restaurantId',restaurant::text,
    'branchId',branch::text,'orderId',stale_order::text,'actorId',actor::text,
    'deviceId',device::text,'occurredAt',confirmation_command->>'occurredAt',
    'operation','order.created','entityType','order','entityId',stale_order::text,'to','draft'
  ));
  order_record := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',stale_order::text,'restaurantId',restaurant::text,
    'branchId',branch::text,'channel','counter','currency','MXN','timeZone','America/Hermosillo',
    'status','draft','items',pg_catalog.jsonb_build_array()
  );

  execute 'set local role app_api';
  if app_private.confirm_capture_draft_v3(actor,confirmation_command,null,null)->>'status'<>'pending'
    then raise exception 'CAPTURE_PAYMENT_INTENT_STALE_PROBE_REJECTED'; end if;
  result := app_private.confirm_capture_draft_v3(actor,confirmation_command,order_record,order_audits);
  execute 'reset role';
  if result->>'status'<>'conflict' or result->>'reason'<>'payment_intent_stale'
  then raise exception 'CAPTURE_PAYMENT_INTENT_STALE_NOT_REJECTED'; end if;
  if exists (select 1 from app.orders placed where placed.id=stale_order)
  then raise exception 'CAPTURE_PAYMENT_INTENT_STALE_ORDER_WAS_CREATED'; end if;
end
$capture_payment_intent_tests$;
commit;
