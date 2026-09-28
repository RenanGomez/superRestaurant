-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- NOT YET EXECUTED against a live cluster: no local PostgreSQL 17 binaries were present in this
-- worktree (.cache/postgres-local/pgsql/bin/postgres.exe missing) and no network access was used
-- to fetch them. Written to mirror the exact fixture/assertion style of
-- supabase/tests/order_item_note_invariants.sql and supabase/tests/capture_selection_plan tests;
-- must be run and any failure fixed before this migration is considered verified.
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
  device uuid := gen_random_uuid();
  now_at timestamptz := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
  created jsonb;
  lease text;
  quote_command jsonb;
  quote jsonb;
  intent_command jsonb;
  result jsonb;
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

  -- Rejected: capture is still fulfillment_channel='counter', not delivery.
  execute 'set local role app_api';
  result := app_private.set_capture_delivery_quote(actor,quote_command,quote);
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'CAPTURE_DELIVERY_QUOTE_ACCEPTED_OUTSIDE_DELIVERY'; end if;

  update app.capture_drafts set fulfillment_channel='delivery'
  where restaurant_id=restaurant and branch_id=branch and id=target_capture;

  -- Lease belonging to a different membership must be refused.
  execute 'set local role app_api';
  result := app_private.set_capture_delivery_quote(
    actor,quote_command||pg_catalog.jsonb_build_object('attentionLeaseId',gen_random_uuid()::text),quote
  );
  execute 'reset role';
  if result->>'status'<>'conflict' then raise exception 'CAPTURE_DELIVERY_QUOTE_FOREIGN_LEASE_ACCEPTED'; end if;

  execute 'set local role app_api';
  result := app_private.set_capture_delivery_quote(actor,quote_command,quote);
  execute 'reset role';
  if result->>'status'<>'applied' or result#>>'{record,detail,version}'<>'2'
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

  -- Switching away from delivery clears the frozen quote (channel trigger).
  update app.capture_drafts set fulfillment_channel='counter',version=3
  where restaurant_id=restaurant and branch_id=branch and id=target_capture;
  if exists (
    select 1 from app.capture_delivery_quotes stored
    where stored.restaurant_id=restaurant and stored.branch_id=branch and stored.capture_draft_id=target_capture
  ) then raise exception 'CAPTURE_DELIVERY_QUOTE_NOT_CLEARED_ON_CHANNEL_CHANGE'; end if;
  update app.capture_drafts set fulfillment_channel='delivery'
  where restaurant_id=restaurant and branch_id=branch and id=target_capture;

  -- Payment intent: cross-tenant/foreign-scope isolation via a second, unrelated capture in the
  -- same restaurant/branch never observes or interferes with target_capture's row.
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
    ),'captureDraftId',target_capture::text,'expectedVersion',3,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'method','cash','tenderedAmountMinor',20000,'tipMinor',1500,
    'basisFingerprint',pg_catalog.encode(pg_catalog.sha256('fixture-basis'::bytea),'hex')
  );

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

  -- A non-cash method rejects a stated tendered amount.
  execute 'set local role app_api';
  result := app_private.set_capture_payment_intent(actor,intent_command||pg_catalog.jsonb_build_object(
    'idempotencyKey',gen_random_uuid()::text,'method','transfer'
  ));
  execute 'reset role';
  if result->>'status'<>'rejected' then raise exception 'CAPTURE_PAYMENT_INTENT_NONCASH_TENDER_ACCEPTED'; end if;

  -- Replay: identical idempotency key returns the same applied record.
  execute 'set local role app_api';
  result := app_private.set_capture_payment_intent(actor,intent_command);
  execute 'reset role';
  if result->>'status'<>'replayed' then raise exception 'CAPTURE_PAYMENT_INTENT_REPLAY_REJECTED'; end if;

  -- Leaving draft (no_sale) clears both the delivery quote and the payment intent.
  update app.capture_drafts set status='no_sale',version=5,attention_status='unclaimed',
    owner_membership_id=null,attention_lease_id=null,attention_lease_expires_at=null
  where restaurant_id=restaurant and branch_id=branch and id=target_capture;
  if exists (
    select 1 from app.capture_payment_intents stored
    where stored.restaurant_id=restaurant and stored.branch_id=branch and stored.capture_draft_id=target_capture
  ) then raise exception 'CAPTURE_PAYMENT_INTENT_NOT_CLEARED_ON_NO_SALE'; end if;
  if exists (
    select 1 from app.capture_delivery_quotes stored
    where stored.restaurant_id=restaurant and stored.branch_id=branch and stored.capture_draft_id=target_capture
  ) then raise exception 'CAPTURE_DELIVERY_QUOTE_NOT_CLEARED_ON_NO_SALE'; end if;
end
$capture_payment_intent_tests$;
commit;
