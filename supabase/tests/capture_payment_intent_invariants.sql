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
  stale_lines_capture uuid := gen_random_uuid();
  address_change_capture uuid := gen_random_uuid();
  quote_mismatch_capture uuid := gen_random_uuid();
  h10_expired_capture uuid := gen_random_uuid();
  h10_expired_order uuid := gen_random_uuid();
  h10_not_covered_capture uuid := gen_random_uuid();
  h10_not_covered_order uuid := gen_random_uuid();
  catalog uuid := gen_random_uuid();
  category uuid := gen_random_uuid();
  product uuid := gen_random_uuid();
  line_a uuid := gen_random_uuid();
  line_b uuid := gen_random_uuid();
  confirm_customer uuid := gen_random_uuid();
  confirm_contact uuid := gen_random_uuid();
  confirm_address uuid := gen_random_uuid();
  party jsonb;
  fulfillment jsonb;
  device uuid := gen_random_uuid();
  shift uuid := gen_random_uuid();
  confirmed_order uuid := gen_random_uuid();
  stale_order uuid := gen_random_uuid();
  stale_lines_order uuid := gen_random_uuid();
  address_change_order uuid := gen_random_uuid();
  confirmation_event uuid := gen_random_uuid();
  item_event uuid := gen_random_uuid();
  item_id uuid := gen_random_uuid();
  fulfillment_snapshot_before uuid;
  fulfillment_snapshot_after uuid;
  now_at timestamptz := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
  created jsonb;
  lease text;
  quote_command jsonb;
  quote jsonb;
  intent_command jsonb;
  intent_basis text;
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
    'expiresAt',pg_catalog.to_char((now_at+interval '15 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'override',null
  );
  quote_command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',target_capture::text,'expectedVersion',1,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'scheduledFor',null
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

  -- The probe recognizes the same replay purely from the command (never from a freshly
  -- recomputed quote jsonb with a different quotedAt/quoteId), and is 'pending' for a brand-new
  -- idempotencyKey. Both fingerprints are computed over the command only, so a recomputed quote
  -- never turns a legitimate replay into a spurious conflict.
  execute 'set local role app_api';
  result := app_private.probe_capture_delivery_quote_set(actor,quote_command);
  execute 'reset role';
  if result->>'status'<>'replayed' then raise exception 'CAPTURE_DELIVERY_QUOTE_PROBE_REPLAY_REJECTED'; end if;
  execute 'set local role app_api';
  result := app_private.probe_capture_delivery_quote_set(
    actor,quote_command||pg_catalog.jsonb_build_object('idempotencyKey',gen_random_uuid()::text)
  );
  execute 'reset role';
  if result->>'status'<>'pending' then raise exception 'CAPTURE_DELIVERY_QUOTE_PROBE_PENDING_REJECTED'; end if;

  -- H4: scheduledFor is part of the hashed command. The SAME idempotencyKey that was applied
  -- above with scheduledFor=null must never replay for a DIFFERENT scheduledFor -- quoteForCapture
  -- would compute a different promise/coverage for it, so this must be a conflict, not a replay.
  execute 'set local role app_api';
  result := app_private.probe_capture_delivery_quote_set(
    actor,quote_command||pg_catalog.jsonb_build_object(
      'scheduledFor',pg_catalog.to_char((now_at+interval '2 hours') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'CAPTURE_DELIVERY_QUOTE_SCHEDULED_FOR_REPLAY_ACCEPTED'; end if;
  execute 'set local role app_api';
  result := app_private.set_capture_delivery_quote(
    actor,quote_command||pg_catalog.jsonb_build_object(
      'scheduledFor',pg_catalog.to_char((now_at+interval '2 hours') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),quote
  );
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'CAPTURE_DELIVERY_QUOTE_SCHEDULED_FOR_SET_REPLAY_ACCEPTED'; end if;

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
    'method','cash','tenderedAmountMinor',20000,'tipMinor',1500
  );
  intent_basis := pg_catalog.encode(pg_catalog.sha256('fixture-basis'::bytea),'hex');

  -- The probe alone recognizes a replay purely from actor+scope+idempotencyKey+fingerprint over
  -- the client's own command, before the API ever repriced a basis; a foreign command must never
  -- be reported as pending.
  execute 'set local role app_api';
  result := app_private.probe_capture_payment_intent_set(actor,intent_command);
  execute 'reset role';
  if result->>'status'<>'pending' then raise exception 'CAPTURE_PAYMENT_INTENT_PROBE_NOT_PENDING'; end if;

  -- Foreign lease is refused.
  execute 'set local role app_api';
  result := app_private.set_capture_payment_intent(actor,intent_command||pg_catalog.jsonb_build_object(
    'attentionLeaseId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text
  ),intent_basis);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'CAPTURE_PAYMENT_INTENT_FOREIGN_LEASE_ACCEPTED'; end if;

  -- A non-cash method rejects a stated tendered amount.
  execute 'set local role app_api';
  result := app_private.set_capture_payment_intent(actor,intent_command||pg_catalog.jsonb_build_object(
    'idempotencyKey',gen_random_uuid()::text,'method','transfer'
  ),intent_basis);
  execute 'reset role';
  if result->>'status'<>'rejected' then raise exception 'CAPTURE_PAYMENT_INTENT_NONCASH_TENDER_ACCEPTED'; end if;

  -- version 4 -> 5: apply.
  execute 'set local role app_api';
  result := app_private.set_capture_payment_intent(actor,intent_command,intent_basis);
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

  -- H2: replay after repricing. The lines changed since the original apply, so a naive retry
  -- would recompute a DIFFERENT basisFingerprint for the same idempotencyKey; the probe must
  -- still recognize it as the original apply (from the client command alone) and the real write
  -- path must return the SAME stored record, never insufficient/conflict from the new basis.
  execute 'set local role app_api';
  result := app_private.probe_capture_payment_intent_set(actor,intent_command);
  execute 'reset role';
  if result->>'status'<>'replayed' then raise exception 'CAPTURE_PAYMENT_INTENT_PROBE_REPLAY_REJECTED'; end if;
  if (result->'record'->'detail'->>'version')::bigint<>5 then
    raise exception 'CAPTURE_PAYMENT_INTENT_PROBE_REPLAY_VERSION_MISMATCH';
  end if;
  execute 'set local role app_api';
  result := app_private.set_capture_payment_intent(
    actor,intent_command,pg_catalog.encode(pg_catalog.sha256('fixture-basis-repriced'::bytea),'hex')
  );
  execute 'reset role';
  if result->>'status'<>'replayed' then raise exception 'CAPTURE_PAYMENT_INTENT_REPLAY_REJECTED'; end if;
  if not exists (
    select 1 from app.capture_payment_intents stored
    where stored.restaurant_id=restaurant and stored.branch_id=branch and stored.capture_draft_id=target_capture
      and stored.basis_fingerprint=intent_basis
  ) then raise exception 'CAPTURE_PAYMENT_INTENT_REPLAY_OVERWROTE_BASIS'; end if;

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
  select capture_drafts.fulfillment_snapshot_id into fulfillment_snapshot_before from app.capture_drafts
  where restaurant_id=restaurant and branch_id=branch and id=confirm_capture;

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
  quote := quote||pg_catalog.jsonb_build_object(
    'captureDraftId',confirm_capture::text,'addressSnapshotRef',fulfillment_snapshot_before::text
  );
  quote_command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',confirm_capture::text,'expectedVersion',4,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'scheduledFor',null
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
    'method','cash','tenderedAmountMinor',10000,'tipMinor',500
  );
  execute 'set local role app_api';
  result := app_private.set_capture_payment_intent(
    actor,intent_command,pg_catalog.encode(pg_catalog.sha256('fixture-basis-confirm'::bytea),'hex')
  );
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
  -- H7: merging deliveryQuote/paymentIntent must bump schemaVersion to 2 (shared-types'
  -- parseOrderFulfillmentSnapshotV1 is an exact-12-key match and would otherwise reject this
  -- 12-key object claiming schemaVersion 1); it must also carry exactly the 12 V2 keys, no more.
  if (frozen->>'schemaVersion')::int<>2 then
    raise exception 'CAPTURE_PAYMENT_INTENT_CONFIRM_SNAPSHOT_NOT_V2';
  end if;
  if not app_private.jsonb_has_exact_keys(frozen, array[
    'schemaVersion','orderId','captureDraftId','captureVersion','fulfillmentChannel','tableId',
    'partySnapshot','fulfillmentSnapshot','deliveryInstructions','frozenAt','deliveryQuote','paymentIntent'
  ]) then raise exception 'CAPTURE_PAYMENT_INTENT_CONFIRM_SNAPSHOT_KEYS_DRIFTED'; end if;

  ----------------------------------------------------------------------------
  -- Changing the fulfillment/address snapshot after quoting deletes the frozen
  -- quote (clear_capture_delivery_quote_for_channel now also fires on
  -- fulfillment_snapshot_id, not just channel/status), and confirm proceeds
  -- with no quote rather than a stale one.
  ----------------------------------------------------------------------------
  execute 'set local role app_api';
  created := app_private.create_capture_draft(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',address_change_capture::text,'expectedVersion',0,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceChannel','phone','fulfillmentChannel','delivery'
  ));
  execute 'reset role';
  if created->>'status'<>'applied' then raise exception 'CAPTURE_ADDRESS_CHANGE_CREATE_REJECTED'; end if;
  lease := created#>>'{record,detail,attentionLeaseId}';

  execute 'set local role app_api';
  party := app_private.set_capture_customer(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',address_change_capture::text,'expectedVersion',1,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'customerId',confirm_customer::text,'contactId',confirm_contact::text,'expectedCustomerVersion',1
  ));
  execute 'reset role';
  if party->>'status'<>'applied' then raise exception 'CAPTURE_ADDRESS_CHANGE_CUSTOMER_REJECTED'; end if;

  execute 'set local role app_api';
  fulfillment := app_private.set_capture_fulfillment(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',address_change_capture::text,'expectedVersion',2,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'customerSnapshotRef',party#>>'{record,detail,customerSnapshotRef}',
    'addressId',confirm_address::text,'expectedAddressVersion',1
  ));
  execute 'reset role';
  if fulfillment->>'status'<>'applied' then raise exception 'CAPTURE_ADDRESS_CHANGE_FULFILLMENT_REJECTED'; end if;
  select capture_drafts.fulfillment_snapshot_id into fulfillment_snapshot_before from app.capture_drafts
  where restaurant_id=restaurant and branch_id=branch and id=address_change_capture;

  quote := quote||pg_catalog.jsonb_build_object(
    'captureDraftId',address_change_capture::text,'addressSnapshotRef',fulfillment_snapshot_before::text
  );
  quote_command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',address_change_capture::text,'expectedVersion',3,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'scheduledFor',null
  );
  execute 'set local role app_api';
  result := app_private.set_capture_delivery_quote(actor,quote_command,quote);
  execute 'reset role';
  if result->>'status'<>'applied' then raise exception 'CAPTURE_ADDRESS_CHANGE_QUOTE_REJECTED'; end if;
  if not exists (
    select 1 from app.capture_delivery_quotes stored
    where stored.restaurant_id=restaurant and stored.branch_id=branch and stored.capture_draft_id=address_change_capture
  ) then raise exception 'CAPTURE_ADDRESS_CHANGE_QUOTE_NOT_PERSISTED'; end if;

  -- Re-applying the address (a new party/fulfillment snapshot each time by design) must clear the
  -- now-stale quote, even though the fulfillment channel itself never changed.
  execute 'set local role app_api';
  fulfillment := app_private.set_capture_fulfillment(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',address_change_capture::text,'expectedVersion',4,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'customerSnapshotRef',party#>>'{record,detail,customerSnapshotRef}',
    'addressId',confirm_address::text,'expectedAddressVersion',1
  ));
  execute 'reset role';
  if fulfillment->>'status'<>'applied' then raise exception 'CAPTURE_ADDRESS_CHANGE_REFULFILLMENT_REJECTED'; end if;
  select capture_drafts.fulfillment_snapshot_id into fulfillment_snapshot_after from app.capture_drafts
  where restaurant_id=restaurant and branch_id=branch and id=address_change_capture;
  if fulfillment_snapshot_after is not distinct from fulfillment_snapshot_before
  then raise exception 'CAPTURE_ADDRESS_CHANGE_TEST_SNAPSHOT_DID_NOT_CHANGE'; end if;
  if exists (
    select 1 from app.capture_delivery_quotes stored
    where stored.restaurant_id=restaurant and stored.branch_id=branch and stored.capture_draft_id=address_change_capture
  ) then raise exception 'CAPTURE_ADDRESS_CHANGE_QUOTE_NOT_CLEARED'; end if;

  -- Confirm now proceeds with no quote at all (never a stale one).
  confirmation_command := pg_catalog.jsonb_build_object(
    'schemaVersion',2,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',address_change_capture::text,'expectedVersion',5,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'attentionLeaseId',lease,
    'orderId',address_change_order::text,'shiftId',shift::text,'tableId',null,
    'currency','MXN','timeZone','America/Hermosillo'
  );
  order_audits := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'schemaVersion',1,'eventId',confirmation_command->>'eventId',
    'idempotencyKey',confirmation_command->>'idempotencyKey','restaurantId',restaurant::text,
    'branchId',branch::text,'orderId',address_change_order::text,'actorId',actor::text,
    'deviceId',device::text,'occurredAt',confirmation_command->>'occurredAt',
    'operation','order.created','entityType','order','entityId',address_change_order::text,'to','draft'
  ));
  order_record := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',address_change_order::text,'restaurantId',restaurant::text,
    'branchId',branch::text,'channel','delivery','currency','MXN','timeZone','America/Hermosillo',
    'status','draft','items',pg_catalog.jsonb_build_array()
  );
-- H10: a delivery capture with no live quote (the stale one was cleared above by the
  -- re-fulfillment) must be refused at confirm rather than proceeding with no quote at all.
  execute 'set local role app_api';
  result := app_private.confirm_capture_draft_v3(actor,confirmation_command,order_record,order_audits);
  execute 'reset role';
  if result->>'status'<>'conflict' or result->>'reason'<>'delivery_quote_missing'
  then raise exception 'CAPTURE_ADDRESS_CHANGE_CONFIRM_NOT_REFUSED'; end if;

  ----------------------------------------------------------------------------
  -- A synthetically inconsistent stored quote (addressSnapshotRef no longer
  -- matching the capture's current fulfillment snapshot) is refused at
  -- confirm, independent of the trigger that normally prevents this state.
  ----------------------------------------------------------------------------
  execute 'set local role app_api';
  created := app_private.create_capture_draft(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',quote_mismatch_capture::text,'expectedVersion',0,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceChannel','phone','fulfillmentChannel','delivery'
  ));
  execute 'reset role';
  if created->>'status'<>'applied' then raise exception 'CAPTURE_QUOTE_MISMATCH_CREATE_REJECTED'; end if;
  lease := created#>>'{record,detail,attentionLeaseId}';

  execute 'set local role app_api';
  party := app_private.set_capture_customer(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',quote_mismatch_capture::text,'expectedVersion',1,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'customerId',confirm_customer::text,'contactId',confirm_contact::text,'expectedCustomerVersion',1
  ));
  execute 'reset role';
  if party->>'status'<>'applied' then raise exception 'CAPTURE_QUOTE_MISMATCH_CUSTOMER_REJECTED'; end if;

  execute 'set local role app_api';
  fulfillment := app_private.set_capture_fulfillment(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',quote_mismatch_capture::text,'expectedVersion',2,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'customerSnapshotRef',party#>>'{record,detail,customerSnapshotRef}',
    'addressId',confirm_address::text,'expectedAddressVersion',1
  ));
  execute 'reset role';
  if fulfillment->>'status'<>'applied' then raise exception 'CAPTURE_QUOTE_MISMATCH_FULFILLMENT_REJECTED'; end if;

  -- Bypasses set_capture_delivery_quote (and therefore the trigger that keeps this row
  -- consistent) to synthesize the otherwise-unreachable inconsistent state directly, as a
  -- superuser fixture -- never how the API or a client can reach this table.
  insert into app.capture_delivery_quotes(
    restaurant_id,branch_id,capture_draft_id,quote,applied_capture_version,idempotency_key,command_fingerprint,
    actor_id,actor_membership_id,device_id,occurred_at,received_at
  ) values (
    restaurant,branch,quote_mismatch_capture,
    quote||pg_catalog.jsonb_build_object('captureDraftId',quote_mismatch_capture::text,'addressSnapshotRef',gen_random_uuid()::text),
    3,gen_random_uuid()::text,pg_catalog.encode(pg_catalog.sha256('fixture-mismatch'::bytea),'hex'),
    actor,membership,device,now_at,now_at
  );

  confirmation_command := pg_catalog.jsonb_build_object(
    'schemaVersion',2,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',quote_mismatch_capture::text,'expectedVersion',3,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'attentionLeaseId',lease,
    'orderId',gen_random_uuid()::text,'shiftId',shift::text,'tableId',null,
    'currency','MXN','timeZone','America/Hermosillo'
  );
  order_audits := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'schemaVersion',1,'eventId',confirmation_command->>'eventId',
    'idempotencyKey',confirmation_command->>'idempotencyKey','restaurantId',restaurant::text,
    'branchId',branch::text,'orderId',confirmation_command->>'orderId','actorId',actor::text,
    'deviceId',device::text,'occurredAt',confirmation_command->>'occurredAt',
    'operation','order.created','entityType','order','entityId',confirmation_command->>'orderId','to','draft'
  ));
  order_record := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',confirmation_command->>'orderId','restaurantId',restaurant::text,
    'branchId',branch::text,'channel','delivery','currency','MXN','timeZone','America/Hermosillo',
    'status','draft','items',pg_catalog.jsonb_build_array()
  );
  execute 'set local role app_api';
  result := app_private.confirm_capture_draft_v3(actor,confirmation_command,order_record,order_audits);
  execute 'reset role';
  if result->>'status'<>'conflict' or result->>'reason'<>'delivery_quote_stale'
  then raise exception 'CAPTURE_QUOTE_MISMATCH_NOT_REJECTED'; end if;

  ----------------------------------------------------------------------------
  -- A benign edit unrelated to lines/fulfillment/quote (e.g. delivery
  -- instructions or any other autosaved field) after the payment intent was
  -- set does NOT stale it: confirm succeeds even though the draft's overall
  -- version advanced past the intent's applied_capture_version.
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
    'method','cash','tenderedAmountMinor',5000,'tipMinor',0
  );
  execute 'set local role app_api';
  result := app_private.set_capture_payment_intent(
    actor,intent_command,pg_catalog.encode(pg_catalog.sha256('fixture-basis-stale'::bytea),'hex')
  );
  execute 'reset role';
  if result->>'status'<>'applied' then raise exception 'CAPTURE_PAYMENT_INTENT_STALE_SET_REJECTED'; end if;
  -- Payment intent's applied_capture_version is now 2 (set at version 1 -> 2).

  -- version 2 -> 3: a benign, unrelated autosave (fulfillment channel and every snapshot
  -- reference identical to before) advances the draft's version without touching lines,
  -- fulfillment/address or the quote. This must NOT be treated as staling the intent.
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
    then raise exception 'CAPTURE_PAYMENT_INTENT_BENIGN_EDIT_PROBE_REJECTED'; end if;
  result := app_private.confirm_capture_draft_v3(actor,confirmation_command,order_record,order_audits);
  execute 'reset role';
  if result->>'status'<>'applied'
  then raise exception 'CAPTURE_PAYMENT_INTENT_BENIGN_EDIT_WRONGLY_STALED'; end if;
  if not exists (select 1 from app.orders placed where placed.id=stale_order)
  then raise exception 'CAPTURE_PAYMENT_INTENT_BENIGN_EDIT_ORDER_NOT_CREATED'; end if;

  ----------------------------------------------------------------------------
  -- Confirm rejects a stale payment intent when the selection plan changed
  -- (a real line change) after the intent's applied_capture_version.
  ----------------------------------------------------------------------------
  execute 'set local role app_api';
  created := app_private.create_capture_draft(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',stale_lines_capture::text,'expectedVersion',0,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceChannel','phone','fulfillmentChannel','counter'
  ));
  execute 'reset role';
  if created->>'status'<>'applied' then raise exception 'CAPTURE_PAYMENT_INTENT_STALE_LINES_CREATE_REJECTED'; end if;
  lease := created#>>'{record,detail,attentionLeaseId}';

  -- version 1 -> 2: an initial selection plan.
  plan_command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',stale_lines_capture::text,'expectedVersion',1,'attentionLeaseId',lease,
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
  if result->>'status'<>'applied' then raise exception 'CAPTURE_PAYMENT_INTENT_STALE_LINES_PLAN_REJECTED'; end if;

  -- version 2 -> 3: the payment intent, set against this one-line plan.
  intent_command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',stale_lines_capture::text,'expectedVersion',2,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'method','cash','tenderedAmountMinor',5000,'tipMinor',0
  );
  execute 'set local role app_api';
  result := app_private.set_capture_payment_intent(
    actor,intent_command,pg_catalog.encode(pg_catalog.sha256('fixture-basis-stale-lines'::bytea),'hex')
  );
  execute 'reset role';
  if result->>'status'<>'applied' then raise exception 'CAPTURE_PAYMENT_INTENT_STALE_LINES_SET_REJECTED'; end if;
  -- Payment intent's applied_capture_version is now 3.

  -- version 3 -> 4: the lines actually change (a second line added) after the intent was set.
  plan_command := plan_command||pg_catalog.jsonb_build_object(
    'expectedVersion',3,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text
  );
  plan := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'catalogVersion',catalog::text,'lines',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'lineId',line_a::text,'productId',product::text,'variantId',null,'quantity',1,'note',null,
        'modifierGroups',pg_catalog.jsonb_build_array()
      ),
      pg_catalog.jsonb_build_object(
        'lineId',line_b::text,'productId',product::text,'variantId',null,'quantity',1,'note',null,
        'modifierGroups',pg_catalog.jsonb_build_array()
      )
    )
  );
  execute 'set local role app_api';
  result := app_private.replace_capture_selection_plan(actor,plan_command,plan);
  execute 'reset role';
  if result->>'status'<>'applied' then raise exception 'CAPTURE_PAYMENT_INTENT_STALE_LINES_REPLAN_REJECTED'; end if;

  confirmation_command := pg_catalog.jsonb_build_object(
    'schemaVersion',2,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',stale_lines_capture::text,'expectedVersion',4,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'attentionLeaseId',lease,
    'orderId',stale_lines_order::text,'shiftId',shift::text,'tableId',null,
    'currency','MXN','timeZone','America/Hermosillo'
  );

  order_record := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',stale_lines_order::text,'restaurantId',restaurant::text,
    'branchId',branch::text,'channel','counter','currency','MXN','timeZone','America/Hermosillo',
    'status','draft','items',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'orderItemId',item_id::text,'snapshot',pg_catalog.jsonb_build_object(
          'catalogVersion',catalog::text,'productId',product::text,'name','Taco de confirmacion',
          'sku','TACO-CONFIRM','stationId','kitchen','unit','piece',
          'unitPrice',pg_catalog.jsonb_build_object('amountMinor',5000,'currency','MXN'),
          'modifiers',pg_catalog.jsonb_build_array()
        ),'quantity',1,'restaurantId',restaurant::text,'branchId',branch::text,'status','pending',
        'note',null
      ),
      pg_catalog.jsonb_build_object(
        'orderItemId',gen_random_uuid()::text,'snapshot',pg_catalog.jsonb_build_object(
          'catalogVersion',catalog::text,'productId',product::text,'name','Taco de confirmacion',
          'sku','TACO-CONFIRM','stationId','kitchen','unit','piece',
          'unitPrice',pg_catalog.jsonb_build_object('amountMinor',5000,'currency','MXN'),
          'modifiers',pg_catalog.jsonb_build_array()
        ),'quantity',1,'restaurantId',restaurant::text,'branchId',branch::text,'status','pending',
        'note',null
      )
    )
  );
  order_audits := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('operation','order.created'),
    pg_catalog.jsonb_build_object('operation','order.item_added'),
    pg_catalog.jsonb_build_object('operation','order.item_added')
  );

  execute 'set local role app_api';
  if app_private.confirm_capture_draft_v3(actor,confirmation_command,null,null)->>'status'<>'pending'
    then raise exception 'CAPTURE_PAYMENT_INTENT_STALE_LINES_PROBE_REJECTED'; end if;
  -- The order/items shape matches the (now two-line) selection plan exactly, so the item
  -- validation loop passes; SQL must still refuse for staleness, before ever persisting anything.
  result := app_private.confirm_capture_draft_v3(actor,confirmation_command,order_record,order_audits);
  execute 'reset role';
  if result->>'status'<>'conflict' or result->>'reason'<>'payment_intent_stale'
  then raise exception 'CAPTURE_PAYMENT_INTENT_STALE_LINES_NOT_REJECTED'; end if;
  if exists (select 1 from app.orders placed where placed.id=stale_lines_order)
  then raise exception 'CAPTURE_PAYMENT_INTENT_STALE_LINES_ORDER_WAS_CREATED'; end if;
  ----------------------------------------------------------------------------
  -- H10: a delivery confirm with an expired frozen quote is refused, even
  -- though the quote is still address-consistent (not stale) and otherwise
  -- covered.
  ----------------------------------------------------------------------------
  execute 'set local role app_api';
  created := app_private.create_capture_draft(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',h10_expired_capture::text,'expectedVersion',0,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceChannel','phone','fulfillmentChannel','delivery'
  ));
  execute 'reset role';
  if created->>'status'<>'applied' then raise exception 'CAPTURE_H10_EXPIRED_CREATE_REJECTED'; end if;
  lease := created#>>'{record,detail,attentionLeaseId}';

  execute 'set local role app_api';
  party := app_private.set_capture_customer(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',h10_expired_capture::text,'expectedVersion',1,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'customerId',confirm_customer::text,'contactId',confirm_contact::text,'expectedCustomerVersion',1
  ));
  execute 'reset role';
  if party->>'status'<>'applied' then raise exception 'CAPTURE_H10_EXPIRED_CUSTOMER_REJECTED'; end if;

  execute 'set local role app_api';
  fulfillment := app_private.set_capture_fulfillment(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',h10_expired_capture::text,'expectedVersion',2,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'customerSnapshotRef',party#>>'{record,detail,customerSnapshotRef}',
    'addressId',confirm_address::text,'expectedAddressVersion',1
  ));
  execute 'reset role';
  if fulfillment->>'status'<>'applied' then raise exception 'CAPTURE_H10_EXPIRED_FULFILLMENT_REJECTED'; end if;
  select capture_drafts.fulfillment_snapshot_id into fulfillment_snapshot_before from app.capture_drafts
  where restaurant_id=restaurant and branch_id=branch and id=h10_expired_capture;

  -- Bypasses set_capture_delivery_quote to synthesize an already-expired quote directly: the API
  -- never lets a client submit a past expiresAt, so this state can only be reached by time passing
  -- after a legitimately-set quote, which this fixture simulates directly.
  insert into app.capture_delivery_quotes(
    restaurant_id,branch_id,capture_draft_id,quote,applied_capture_version,idempotency_key,command_fingerprint,
    actor_id,actor_membership_id,device_id,occurred_at,received_at
  ) values (
    restaurant,branch,h10_expired_capture,
    quote||pg_catalog.jsonb_build_object(
      'captureDraftId',h10_expired_capture::text,'addressSnapshotRef',fulfillment_snapshot_before::text,
      'expiresAt',pg_catalog.to_char((now_at-interval '5 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    3,gen_random_uuid()::text,pg_catalog.encode(pg_catalog.sha256('fixture-h10-expired'::bytea),'hex'),
    actor,membership,device,now_at,now_at
  );

  confirmation_command := pg_catalog.jsonb_build_object(
    'schemaVersion',2,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',h10_expired_capture::text,'expectedVersion',3,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'attentionLeaseId',lease,
    'orderId',h10_expired_order::text,'shiftId',shift::text,'tableId',null,
    'currency','MXN','timeZone','America/Hermosillo'
  );
  order_audits := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'schemaVersion',1,'eventId',confirmation_command->>'eventId',
    'idempotencyKey',confirmation_command->>'idempotencyKey','restaurantId',restaurant::text,
    'branchId',branch::text,'orderId',h10_expired_order::text,'actorId',actor::text,
    'deviceId',device::text,'occurredAt',confirmation_command->>'occurredAt',
    'operation','order.created','entityType','order','entityId',h10_expired_order::text,'to','draft'
  ));
  order_record := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',h10_expired_order::text,'restaurantId',restaurant::text,
    'branchId',branch::text,'channel','delivery','currency','MXN','timeZone','America/Hermosillo',
    'status','draft','items',pg_catalog.jsonb_build_array()
  );
  execute 'set local role app_api';
  result := app_private.confirm_capture_draft_v3(actor,confirmation_command,order_record,order_audits);
  execute 'reset role';
  if result->>'status'<>'conflict' or result->>'reason'<>'delivery_quote_expired'
  then raise exception 'CAPTURE_H10_EXPIRED_NOT_REJECTED'; end if;

  ----------------------------------------------------------------------------
  -- H10: a delivery confirm with a frozen quote that never covered the
  -- address (coverageStatus 'not_covered') is refused, even when it is
  -- address-consistent and unexpired.
  ----------------------------------------------------------------------------
  execute 'set local role app_api';
  created := app_private.create_capture_draft(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',h10_not_covered_capture::text,'expectedVersion',0,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceChannel','phone','fulfillmentChannel','delivery'
  ));
  execute 'reset role';
  if created->>'status'<>'applied' then raise exception 'CAPTURE_H10_NOT_COVERED_CREATE_REJECTED'; end if;
  lease := created#>>'{record,detail,attentionLeaseId}';

  execute 'set local role app_api';
  party := app_private.set_capture_customer(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',h10_not_covered_capture::text,'expectedVersion',1,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'customerId',confirm_customer::text,'contactId',confirm_contact::text,'expectedCustomerVersion',1
  ));
  execute 'reset role';
  if party->>'status'<>'applied' then raise exception 'CAPTURE_H10_NOT_COVERED_CUSTOMER_REJECTED'; end if;

  execute 'set local role app_api';
  fulfillment := app_private.set_capture_fulfillment(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',h10_not_covered_capture::text,'expectedVersion',2,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'customerSnapshotRef',party#>>'{record,detail,customerSnapshotRef}',
    'addressId',confirm_address::text,'expectedAddressVersion',1
  ));
  execute 'reset role';
  if fulfillment->>'status'<>'applied' then raise exception 'CAPTURE_H10_NOT_COVERED_FULFILLMENT_REJECTED'; end if;
  select capture_drafts.fulfillment_snapshot_id into fulfillment_snapshot_before from app.capture_drafts
  where restaurant_id=restaurant and branch_id=branch and id=h10_not_covered_capture;

  quote_command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',h10_not_covered_capture::text,'expectedVersion',3,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'scheduledFor',null
  );
  execute 'set local role app_api';
  result := app_private.set_capture_delivery_quote(
    actor,quote_command,
    pg_catalog.jsonb_build_object(
      'schemaVersion',1,'quoteId',gen_random_uuid()::text,'restaurantId',restaurant::text,
      'branchId',branch::text,'captureDraftId',h10_not_covered_capture::text,
      'addressSnapshotRef',fulfillment_snapshot_before::text,
      'address',pg_catalog.jsonb_build_object('postalCode','83000','locality','Hermosillo'),
      'currency','MXN','timeZone','America/Hermosillo',
      'quotedAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'scheduledFor',null,'version',1,'coverageStatus','not_covered','zoneId',null,'feeMinor',0,
      'promiseStart',null,'promiseEnd',null,
      'expiresAt',pg_catalog.to_char((now_at+interval '15 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'override',null
    )
  );
  execute 'reset role';
  if result->>'status'<>'applied' then raise exception 'CAPTURE_H10_NOT_COVERED_QUOTE_REJECTED'; end if;

  confirmation_command := pg_catalog.jsonb_build_object(
    'schemaVersion',2,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',h10_not_covered_capture::text,'expectedVersion',4,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'attentionLeaseId',lease,
    'orderId',h10_not_covered_order::text,'shiftId',shift::text,'tableId',null,
    'currency','MXN','timeZone','America/Hermosillo'
  );
  order_audits := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'schemaVersion',1,'eventId',confirmation_command->>'eventId',
    'idempotencyKey',confirmation_command->>'idempotencyKey','restaurantId',restaurant::text,
    'branchId',branch::text,'orderId',h10_not_covered_order::text,'actorId',actor::text,
    'deviceId',device::text,'occurredAt',confirmation_command->>'occurredAt',
    'operation','order.created','entityType','order','entityId',h10_not_covered_order::text,'to','draft'
  ));
  order_record := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',h10_not_covered_order::text,'restaurantId',restaurant::text,
    'branchId',branch::text,'channel','delivery','currency','MXN','timeZone','America/Hermosillo',
    'status','draft','items',pg_catalog.jsonb_build_array()
  );
  execute 'set local role app_api';
  result := app_private.confirm_capture_draft_v3(actor,confirmation_command,order_record,order_audits);
  execute 'reset role';
  if result->>'status'<>'conflict' or result->>'reason'<>'delivery_quote_not_covered'
  then raise exception 'CAPTURE_H10_NOT_COVERED_NOT_REJECTED'; end if;
end
$capture_payment_intent_tests$;
commit;
