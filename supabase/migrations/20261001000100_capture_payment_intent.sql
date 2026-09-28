begin;

-- S8 sec 9.1, subunit 2: durable, per-capture delivery quote and payment
-- intent. Both are single-row-per-capture facts, mirroring
-- app.capture_repeat_order_plans' shape (PK on scope+capture, CAS via
-- applied_capture_version, upsert on conflict). Neither table is reachable by
-- the client directly; only the app_private SECURITY DEFINER functions below
-- write to them, and only apps/api may call those functions.

create table app.capture_delivery_quotes (
  restaurant_id uuid not null,
  branch_id uuid not null,
  capture_draft_id uuid not null,
  quote jsonb not null,
  applied_capture_version bigint not null,
  idempotency_key text not null,
  command_fingerprint text not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  actor_membership_id uuid not null,
  device_id uuid not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null,
  constraint capture_delivery_quotes_pk primary key (restaurant_id, branch_id, capture_draft_id),
  constraint capture_delivery_quotes_capture_fk foreign key (restaurant_id, branch_id, capture_draft_id)
    references app.capture_drafts (restaurant_id, branch_id, id) on delete restrict,
  constraint capture_delivery_quotes_membership_fk foreign key (restaurant_id, branch_id, actor_membership_id)
    references app.memberships (restaurant_id, branch_id, id) on delete restrict,
  constraint capture_delivery_quotes_version_valid check (applied_capture_version between 1 and 9007199254740991),
  constraint capture_delivery_quotes_idempotency_valid check (
    idempotency_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint capture_delivery_quotes_fingerprint_valid check (command_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint capture_delivery_quotes_timestamp_order check (received_at >= occurred_at),
  -- Exact shape of packages/shared-types/src/delivery-quote.ts DeliveryQuoteV1. The API builds
  -- this jsonb from app_private.list_active_delivery_zones_for_quote + quoteDelivery; the client
  -- never supplies it directly.
  constraint capture_delivery_quotes_shape_valid check (
    app_private.jsonb_has_exact_keys(quote, array[
      'schemaVersion','quoteId','restaurantId','branchId','captureDraftId','addressSnapshotRef','address',
      'currency','timeZone','quotedAt','scheduledFor','version','coverageStatus','zoneId','feeMinor',
      'promiseStart','promiseEnd','expiresAt','override'
    ])
    and quote->>'schemaVersion' = '1'
    and quote->>'restaurantId' = restaurant_id::text
    and quote->>'branchId' = branch_id::text
    and quote->>'captureDraftId' = capture_draft_id::text
    and quote->>'currency' ~ '^[A-Z]{3}$'
    and quote->>'coverageStatus' in ('covered','not_covered')
    and (
      (quote->>'coverageStatus' = 'not_covered' and quote->'zoneId' = 'null'::jsonb and (quote->>'feeMinor')::bigint = 0)
      or (quote->>'coverageStatus' = 'covered' and quote->'zoneId' is distinct from 'null'::jsonb)
    )
    and (quote->>'feeMinor')::bigint between 0 and 9007199254740991
  )
);

alter table app.capture_delivery_quotes enable row level security;
alter table app.capture_delivery_quotes force row level security;
revoke all on app.capture_delivery_quotes from public, anon, authenticated, service_role, app_api;

comment on table app.capture_delivery_quotes is
  'Server-only, one row per held capture: the frozen delivery-fee quote (DeliveryQuoteV1) the API computed for it. Never written by the client. Cleared when the capture leaves delivery or leaves draft.';

create table app.capture_payment_intents (
  restaurant_id uuid not null,
  branch_id uuid not null,
  capture_draft_id uuid not null,
  intent jsonb not null,
  applied_capture_version bigint not null,
  -- sha256(catalogVersion + ordered line facts + delivery fee at set-time), used at read time to
  -- detect that lines/fulfillment/quote advanced after the intent was fixed (status "stale").
  basis_fingerprint text not null,
  idempotency_key text not null,
  command_fingerprint text not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  actor_membership_id uuid not null,
  device_id uuid not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null,
  constraint capture_payment_intents_pk primary key (restaurant_id, branch_id, capture_draft_id),
  constraint capture_payment_intents_capture_fk foreign key (restaurant_id, branch_id, capture_draft_id)
    references app.capture_drafts (restaurant_id, branch_id, id) on delete restrict,
  constraint capture_payment_intents_membership_fk foreign key (restaurant_id, branch_id, actor_membership_id)
    references app.memberships (restaurant_id, branch_id, id) on delete restrict,
  constraint capture_payment_intents_version_valid check (applied_capture_version between 1 and 9007199254740991),
  constraint capture_payment_intents_basis_valid check (basis_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint capture_payment_intents_idempotency_valid check (
    idempotency_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint capture_payment_intents_fingerprint_valid check (command_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint capture_payment_intents_timestamp_order check (received_at >= occurred_at),
  -- Exact shape of packages/shared-types/src/capture-payment-intent.ts CapturePaymentIntentV1.
  constraint capture_payment_intents_shape_valid check (
    app_private.jsonb_has_exact_keys(intent, array['schemaVersion','method','tenderedAmountMinor','tipMinor'])
    and intent->>'schemaVersion' = '1'
    and intent->>'method' in ('cash','card_manual','transfer')
    and (
      intent->'tenderedAmountMinor' = 'null'::jsonb
      or (intent->>'method' = 'cash' and (intent->>'tenderedAmountMinor')::bigint between 0 and 9007199254740991)
    )
    and (intent->>'tipMinor')::bigint between 0 and 9007199254740991
  )
);

alter table app.capture_payment_intents enable row level security;
alter table app.capture_payment_intents force row level security;
revoke all on app.capture_payment_intents from public, anon, authenticated, service_role, app_api;

comment on table app.capture_payment_intents is
  'Server-only, one row per held capture: the customer''s stated payment intent (CapturePaymentIntentV1). No Payment or CashMovement is implied. Cleared when the capture leaves draft.';

alter table app.capture_command_events drop constraint capture_events_operation_valid;
alter table app.capture_command_events add constraint capture_events_operation_valid check (operation in (
  'capture.created','capture.autosaved','capture.held','capture.claimed','capture.resumed','capture.transferred',
  'capture.confirmed','capture.no_sale','capture.recovery_preference_changed','capture.taken_over',
  'capture.customer_changed','capture.fulfillment_changed','capture.delivery_instructions_changed',
  'capture.order_repeated','capture.selection_replaced','capture.delivery_quote_set','capture.delivery_quote_cleared',
  'capture.payment_intent_set'
));

-- Mirrors clear_capture_delivery_instructions_for_channel: a quote frozen for delivery has no
-- business surviving a switch away from delivery, nor surviving a change of the address/fulfillment
-- snapshot it was quoted against (set_capture_fulfillment updates capture_drafts.fulfillment_snapshot_id
-- whenever the address changes). confirm_capture_draft_v3 independently refuses a quote whose
-- addressSnapshotRef no longer matches the capture's current fulfillment snapshot (see below), as
-- defense in depth against a race between this trigger and a concurrent confirm.
create function app_private.clear_capture_delivery_quote_for_channel()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.fulfillment_channel is distinct from 'delivery'
    or new.fulfillment_snapshot_id is distinct from old.fulfillment_snapshot_id
  then
    delete from app.capture_delivery_quotes
    where restaurant_id = new.restaurant_id and branch_id = new.branch_id and capture_draft_id = new.id;
  end if;
  if new.status is distinct from 'draft' then
    delete from app.capture_delivery_quotes
    where restaurant_id = new.restaurant_id and branch_id = new.branch_id and capture_draft_id = new.id;
    delete from app.capture_payment_intents
    where restaurant_id = new.restaurant_id and branch_id = new.branch_id and capture_draft_id = new.id;
  end if;
  return new;
end
$function$;

create trigger capture_drafts_clear_delivery_quote_for_channel
after update of fulfillment_channel, fulfillment_snapshot_id, status on app.capture_drafts
for each row execute function app_private.clear_capture_delivery_quote_for_channel();

alter function app_private.clear_capture_delivery_quote_for_channel() owner to postgres;
revoke all on function app_private.clear_capture_delivery_quote_for_channel()
  from public, anon, authenticated, service_role, app_api;

comment on function app_private.clear_capture_delivery_quote_for_channel() is
  'Clears the frozen delivery quote when the capture switches away from delivery or its address/fulfillment snapshot changes, and clears both the delivery quote and the payment intent when the capture leaves draft (confirmed/no_sale).';

create function app_private.set_capture_delivery_quote(
  p_actor_id uuid,
  p_command jsonb,
  p_quote jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  restaurant uuid; branch uuid; capture uuid; event uuid; device uuid; member uuid; lease uuid;
  expected bigint; occurred timestamptz; scheduled_for timestamptz; observed timestamptz; fingerprint text;
  result_record jsonb; current_capture app.capture_drafts%rowtype; stored app.capture_command_events%rowtype;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_command, array[
      'schemaVersion','scope','captureDraftId','expectedVersion','eventId','idempotencyKey','deviceId','occurredAt',
      'attentionLeaseId','scheduledFor'
    ])
    or not app_private.jsonb_has_exact_keys(p_command->'scope', array['restaurantId','branchId'])
    or p_command->'schemaVersion' is distinct from '1'::jsonb
    or not coalesce(p_command->>'expectedVersion' ~ '^[1-9][0-9]*$', false)
    or not coalesce(p_command->>'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    or not app_private.jsonb_has_exact_keys(p_quote, array[
      'schemaVersion','quoteId','restaurantId','branchId','captureDraftId','addressSnapshotRef','address',
      'currency','timeZone','quotedAt','scheduledFor','version','coverageStatus','zoneId','feeMinor',
      'promiseStart','promiseEnd','expiresAt','override'
    ])
    or p_quote->'schemaVersion' is distinct from '1'::jsonb
    or p_quote->>'coverageStatus' not in ('covered','not_covered')
    or not (
      (p_quote->>'coverageStatus' = 'not_covered' and p_quote->'zoneId' = 'null'::jsonb and p_quote->>'feeMinor' = '0')
      or (p_quote->>'coverageStatus' = 'covered' and p_quote->'zoneId' is distinct from 'null'::jsonb)
    )
    or not coalesce(p_quote->>'feeMinor' ~ '^[0-9]+$', false)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  begin
    restaurant := (p_command#>>'{scope,restaurantId}')::uuid;
    branch := (p_command#>>'{scope,branchId}')::uuid;
    capture := (p_command->>'captureDraftId')::uuid;
    event := (p_command->>'eventId')::uuid;
    device := (p_command->>'deviceId')::uuid;
    lease := (p_command->>'attentionLeaseId')::uuid;
    expected := (p_command->>'expectedVersion')::bigint;
    occurred := (p_command->>'occurredAt')::timestamptz;
    scheduled_for := case when p_command->'scheduledFor' = 'null'::jsonb then null
      else (p_command->>'scheduledFor')::timestamptz end;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or capture is null or event is null or device is null or lease is null
    or expected not between 1 and 9007199254740990 or occurred is null
    or p_command#>>'{scope,restaurantId}' is distinct from restaurant::text
    or p_command#>>'{scope,branchId}' is distinct from branch::text
    or p_command->>'occurredAt' is distinct from pg_catalog.to_char(occurred at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    or (scheduled_for is not null and p_command->>'scheduledFor' is distinct from
      pg_catalog.to_char(scheduled_for at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    or p_quote->>'restaurantId' is distinct from restaurant::text
    or p_quote->>'branchId' is distinct from branch::text
    or p_quote->>'captureDraftId' is distinct from capture::text
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  select m.id into member
  from app.memberships m
  join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
  join app.restaurants r on r.id=m.restaurant_id
  join app.membership_role_grants g on g.membership_id=m.id
  where m.user_id=p_actor_id and m.restaurant_id=restaurant and m.branch_id=branch
    and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null and g.revoked_at is null
    and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
  order by g.role_code limit 1 for share of m,b,r,g;
  if member is null then return pg_catalog.jsonb_build_object('status','denied'); end if;

  -- Deliberately hashed over the client's command only, never over p_quote: the quote is
  -- server-recomputed on every call (fresh quotedAt/quoteId each time), so hashing it would make a
  -- retry with the same idempotencyKey but a different recomputed quote collide on fingerprint and
  -- be rejected as a spurious conflict instead of being recognized as the same logical write. The
  -- command DOES include scheduledFor -- it changes what quoteForCapture computes just as much as
  -- the address does, so the same idempotencyKey with a different scheduledFor must never replay
  -- the first quote. This must stay identical to the hash probe_capture_delivery_quote_set
  -- computes, below.
  fingerprint := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'capture.delivery_quote_set:'||p_command::text||':'||p_actor_id::text, 'UTF8'
  )), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'capture-command:'||p_actor_id::text||':'||restaurant::text||':'||branch::text||':'||(p_command->>'idempotencyKey'), 0
  ));
  select * into stored from app.capture_command_events
  where actor_id=p_actor_id and restaurant_id=restaurant and branch_id=branch
    and idempotency_key=p_command->>'idempotencyKey';
  if found then
    if stored.operation <> 'capture.delivery_quote_set' or stored.command_fingerprint <> fingerprint then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;
    return pg_catalog.jsonb_build_object('status','replayed','record',stored.result_capture);
  end if;

  select * into current_capture from app.capture_drafts
  where restaurant_id=restaurant and branch_id=branch and id=capture for update;
  observed := greatest(pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp()),current_capture.updated_at);
  if not found or current_capture.version<>expected or current_capture.status<>'draft'
    or current_capture.attention_status<>'claimed' or current_capture.owner_membership_id is distinct from member
    or current_capture.attention_lease_id is distinct from lease or current_capture.attention_lease_expires_at<=observed
    or current_capture.fulfillment_channel is distinct from 'delivery'
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  select result_capture into result_record from app.capture_command_events
  where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture and result_version=expected;
  if not found then raise exception using errcode='55000', message='CAPTURE_JOURNAL_CURRENT_VERSION_MISSING'; end if;
  result_record := pg_catalog.jsonb_set(result_record,'{detail}',(result_record->'detail')||pg_catalog.jsonb_build_object(
    'version',expected+1,
    'updatedAt',pg_catalog.to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ));

  insert into app.capture_delivery_quotes(
    restaurant_id,branch_id,capture_draft_id,quote,applied_capture_version,idempotency_key,command_fingerprint,
    actor_id,actor_membership_id,device_id,occurred_at,received_at
  ) values (
    restaurant,branch,capture,p_quote,expected+1,p_command->>'idempotencyKey',fingerprint,
    p_actor_id,member,device,occurred,observed
  ) on conflict (restaurant_id,branch_id,capture_draft_id) do update set
    quote=excluded.quote, applied_capture_version=excluded.applied_capture_version,
    idempotency_key=excluded.idempotency_key, command_fingerprint=excluded.command_fingerprint,
    actor_id=excluded.actor_id, actor_membership_id=excluded.actor_membership_id, device_id=excluded.device_id,
    occurred_at=excluded.occurred_at, received_at=excluded.received_at;

  update app.capture_drafts set version=expected+1,updated_at=observed,updated_by=p_actor_id
  where restaurant_id=restaurant and branch_id=branch and id=capture and version=expected;
  if not found then raise exception using errcode='40001', message='CAPTURE_DELIVERY_QUOTE_LOST_UPDATE'; end if;
  insert into app.capture_command_events(
    event_id,restaurant_id,branch_id,capture_draft_id,actor_id,actor_membership_id,device_id,operation,
    idempotency_key,command_fingerprint,expected_version,result_version,result_capture,occurred_at,received_at
  ) values (
    event,restaurant,branch,capture,p_actor_id,member,device,'capture.delivery_quote_set',
    p_command->>'idempotencyKey',fingerprint,expected,expected+1,result_record,occurred,observed
  );
  return pg_catalog.jsonb_build_object('status','applied','record',result_record);
end
$function$;

alter function app_private.set_capture_delivery_quote(uuid,jsonb,jsonb) owner to postgres;
revoke all on function app_private.set_capture_delivery_quote(uuid,jsonb,jsonb)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.set_capture_delivery_quote(uuid,jsonb,jsonb) to app_api;

comment on function app_private.set_capture_delivery_quote(uuid,jsonb,jsonb) is
  'Freezes the API-computed delivery quote against a held, delivery-channel capture after lease/CAS revalidation. The quote jsonb is never trusted from the client; the API rebuilds it from zones.quoteForCapture on every call.';

-- Read-only idempotency probe, mirroring probe_capture_selection_plan_replace: recognizes a
-- replay purely from actor+scope+idempotencyKey+fingerprint BEFORE the API recomputes the
-- delivery quote (a network round trip and a call to zones.quoteForCapture). Without this, a
-- retry with the same idempotencyKey after a lost response would recompute a new quotedAt/quoteId
-- and collide with set_capture_delivery_quote's stored fingerprint, turning a legitimate replay
-- into a spurious 409 conflict.
create function app_private.probe_capture_delivery_quote_set(
  p_actor_id uuid,
  p_command jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  restaurant uuid; branch uuid; capture uuid; event uuid; device uuid; lease uuid;
  expected bigint; occurred timestamptz; scheduled_for timestamptz; fingerprint text;
  stored app.capture_command_events%rowtype;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_command, array[
      'schemaVersion','scope','captureDraftId','expectedVersion','eventId','idempotencyKey','deviceId','occurredAt',
      'attentionLeaseId','scheduledFor'
    ])
    or not app_private.jsonb_has_exact_keys(p_command->'scope', array['restaurantId','branchId'])
    or p_command->'schemaVersion' is distinct from '1'::jsonb
    or not coalesce(p_command->>'expectedVersion' ~ '^[1-9][0-9]*$', false)
    or not coalesce(p_command->>'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  begin
    restaurant := (p_command#>>'{scope,restaurantId}')::uuid;
    branch := (p_command#>>'{scope,branchId}')::uuid;
    capture := (p_command->>'captureDraftId')::uuid;
    event := (p_command->>'eventId')::uuid;
    device := (p_command->>'deviceId')::uuid;
    lease := (p_command->>'attentionLeaseId')::uuid;
    expected := (p_command->>'expectedVersion')::bigint;
    occurred := (p_command->>'occurredAt')::timestamptz;
    scheduled_for := case when p_command->'scheduledFor' = 'null'::jsonb then null
      else (p_command->>'scheduledFor')::timestamptz end;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or capture is null or event is null or device is null or lease is null
    or expected not between 1 and 9007199254740990 or occurred is null
    or p_command#>>'{scope,restaurantId}' is distinct from restaurant::text
    or p_command#>>'{scope,branchId}' is distinct from branch::text
    or p_command->>'occurredAt' is distinct from pg_catalog.to_char(occurred at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    or (scheduled_for is not null and p_command->>'scheduledFor' is distinct from
      pg_catalog.to_char(scheduled_for at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  if not exists (
    select 1
    from app.memberships m
    join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
    join app.restaurants r on r.id=m.restaurant_id
    join app.membership_role_grants g on g.membership_id=m.id
    where m.user_id=p_actor_id and m.restaurant_id=restaurant and m.branch_id=branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null and g.revoked_at is null
      and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
  ) then return pg_catalog.jsonb_build_object('status','denied'); end if;

  fingerprint := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'capture.delivery_quote_set:'||p_command::text||':'||p_actor_id::text, 'UTF8'
  )), 'hex');
  select * into stored from app.capture_command_events
  where actor_id=p_actor_id and restaurant_id=restaurant and branch_id=branch
    and idempotency_key=p_command->>'idempotencyKey';
  if found then
    if stored.operation <> 'capture.delivery_quote_set' or stored.command_fingerprint <> fingerprint then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;
    return pg_catalog.jsonb_build_object('status','replayed','record',stored.result_capture);
  end if;
  return pg_catalog.jsonb_build_object('status','pending');
end
$function$;

alter function app_private.probe_capture_delivery_quote_set(uuid,jsonb) owner to postgres;
revoke all on function app_private.probe_capture_delivery_quote_set(uuid,jsonb)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.probe_capture_delivery_quote_set(uuid,jsonb) to app_api;

comment on function app_private.probe_capture_delivery_quote_set(uuid,jsonb) is
  'Read-only idempotency probe for set_capture_delivery_quote: recognizes a replay purely from actor+scope+idempotencyKey+fingerprint before the API recomputes the delivery quote, so a retry after a lost response is never turned into a spurious conflict by a freshly recomputed quotedAt/quoteId.';

-- p_command carries only the client-visible envelope (never basisFingerprint): the fingerprint
-- hashed over it must stay identical to the one probe_capture_payment_intent_set computes, below,
-- so a retry with the same idempotencyKey is recognized as the original apply regardless of
-- whether the API's freshly recomputed basisFingerprint (p_basis_fingerprint) still matches.
create function app_private.set_capture_payment_intent(
  p_actor_id uuid,
  p_command jsonb,
  p_basis_fingerprint text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  restaurant uuid; branch uuid; capture uuid; event uuid; device uuid; member uuid; lease uuid;
  expected bigint; occurred timestamptz; observed timestamptz; fingerprint text; result_record jsonb;
  current_capture app.capture_drafts%rowtype; stored app.capture_command_events%rowtype;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_command, array[
      'schemaVersion','scope','captureDraftId','expectedVersion','eventId','idempotencyKey','deviceId','occurredAt',
      'attentionLeaseId','method','tenderedAmountMinor','tipMinor'
    ])
    or not app_private.jsonb_has_exact_keys(p_command->'scope', array['restaurantId','branchId'])
    or p_command->'schemaVersion' is distinct from '1'::jsonb
    or not coalesce(p_command->>'expectedVersion' ~ '^[1-9][0-9]*$', false)
    or not coalesce(p_command->>'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    or p_command->>'method' not in ('cash','card_manual','transfer')
    or not (
      p_command->'tenderedAmountMinor' = 'null'::jsonb
      or (p_command->>'method' = 'cash' and coalesce(p_command->>'tenderedAmountMinor' ~ '^[0-9]+$', false))
    )
    or not coalesce(p_command->>'tipMinor' ~ '^[0-9]+$', false)
    or p_basis_fingerprint is null or p_basis_fingerprint !~ '^[0-9a-f]{64}$'
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  begin
    restaurant := (p_command#>>'{scope,restaurantId}')::uuid;
    branch := (p_command#>>'{scope,branchId}')::uuid;
    capture := (p_command->>'captureDraftId')::uuid;
    event := (p_command->>'eventId')::uuid;
    device := (p_command->>'deviceId')::uuid;
    lease := (p_command->>'attentionLeaseId')::uuid;
    expected := (p_command->>'expectedVersion')::bigint;
    occurred := (p_command->>'occurredAt')::timestamptz;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or capture is null or event is null or device is null or lease is null
    or expected not between 1 and 9007199254740990 or occurred is null
    or p_command#>>'{scope,restaurantId}' is distinct from restaurant::text
    or p_command#>>'{scope,branchId}' is distinct from branch::text
    or p_command->>'occurredAt' is distinct from pg_catalog.to_char(occurred at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  select m.id into member
  from app.memberships m
  join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
  join app.restaurants r on r.id=m.restaurant_id
  join app.membership_role_grants g on g.membership_id=m.id
  where m.user_id=p_actor_id and m.restaurant_id=restaurant and m.branch_id=branch
    and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null and g.revoked_at is null
    and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
  order by g.role_code limit 1 for share of m,b,r,g;
  if member is null then return pg_catalog.jsonb_build_object('status','denied'); end if;

  fingerprint := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'capture.payment_intent_set:'||p_command::text||':'||p_actor_id::text, 'UTF8'
  )), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'capture-command:'||p_actor_id::text||':'||restaurant::text||':'||branch::text||':'||(p_command->>'idempotencyKey'), 0
  ));
  select * into stored from app.capture_command_events
  where actor_id=p_actor_id and restaurant_id=restaurant and branch_id=branch
    and idempotency_key=p_command->>'idempotencyKey';
  if found then
    if stored.operation <> 'capture.payment_intent_set' or stored.command_fingerprint <> fingerprint then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;
    return pg_catalog.jsonb_build_object('status','replayed','record',stored.result_capture);
  end if;

  select * into current_capture from app.capture_drafts
  where restaurant_id=restaurant and branch_id=branch and id=capture for update;
  observed := greatest(pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp()),current_capture.updated_at);
  if not found or current_capture.version<>expected or current_capture.status<>'draft'
    or current_capture.attention_status<>'claimed' or current_capture.owner_membership_id is distinct from member
    or current_capture.attention_lease_id is distinct from lease or current_capture.attention_lease_expires_at<=observed
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  select result_capture into result_record from app.capture_command_events
  where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture and result_version=expected;
  if not found then raise exception using errcode='55000', message='CAPTURE_JOURNAL_CURRENT_VERSION_MISSING'; end if;
  result_record := pg_catalog.jsonb_set(result_record,'{detail}',(result_record->'detail')||pg_catalog.jsonb_build_object(
    'version',expected+1,
    'updatedAt',pg_catalog.to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ));

  insert into app.capture_payment_intents(
    restaurant_id,branch_id,capture_draft_id,intent,applied_capture_version,basis_fingerprint,
    idempotency_key,command_fingerprint,actor_id,actor_membership_id,device_id,occurred_at,received_at
  ) values (
    restaurant,branch,capture,pg_catalog.jsonb_build_object(
      'schemaVersion',1,'method',p_command->'method','tenderedAmountMinor',p_command->'tenderedAmountMinor',
      'tipMinor',p_command->'tipMinor'
    ),expected+1,p_basis_fingerprint,p_command->>'idempotencyKey',fingerprint,p_actor_id,member,device,occurred,observed
  ) on conflict (restaurant_id,branch_id,capture_draft_id) do update set
    intent=excluded.intent, applied_capture_version=excluded.applied_capture_version,
    basis_fingerprint=excluded.basis_fingerprint, idempotency_key=excluded.idempotency_key,
    command_fingerprint=excluded.command_fingerprint, actor_id=excluded.actor_id,
    actor_membership_id=excluded.actor_membership_id, device_id=excluded.device_id,
    occurred_at=excluded.occurred_at, received_at=excluded.received_at;

  update app.capture_drafts set version=expected+1,updated_at=observed,updated_by=p_actor_id
  where restaurant_id=restaurant and branch_id=branch and id=capture and version=expected;
  if not found then raise exception using errcode='40001', message='CAPTURE_PAYMENT_INTENT_LOST_UPDATE'; end if;
  insert into app.capture_command_events(
    event_id,restaurant_id,branch_id,capture_draft_id,actor_id,actor_membership_id,device_id,operation,
    idempotency_key,command_fingerprint,expected_version,result_version,result_capture,occurred_at,received_at
  ) values (
    event,restaurant,branch,capture,p_actor_id,member,device,'capture.payment_intent_set',
    p_command->>'idempotencyKey',fingerprint,expected,expected+1,result_record,occurred,observed
  );
  return pg_catalog.jsonb_build_object('status','applied','record',result_record);
end
$function$;

alter function app_private.set_capture_payment_intent(uuid,jsonb,text) owner to postgres;
revoke all on function app_private.set_capture_payment_intent(uuid,jsonb,text)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.set_capture_payment_intent(uuid,jsonb,text) to app_api;

comment on function app_private.set_capture_payment_intent(uuid,jsonb,text) is
  'Freezes the customer''s stated payment intent after lease/CAS revalidation. p_basis_fingerprint is supplied by the API (sha256 of catalogVersion + ordered line facts + delivery fee at set-time) and is compared at read/confirm time to detect staleness; no Payment or CashMovement is implied. p_command never carries the basis, so a retry with the same idempotencyKey is recognized as a replay even if repricing since the original apply produced a different fingerprint.';

-- Read-only idempotency probe, mirroring probe_capture_delivery_quote_set: recognizes a replay
-- purely from actor+scope+idempotencyKey+fingerprint over the client's own command BEFORE the API
-- re-reads the workspace and reprices the basis. Without this, a retry with the same
-- idempotencyKey after the lines changed (or after a lost response) would recompute a different
-- basisFingerprint and could be rejected as insufficient/conflict instead of being recognized as
-- the original apply.
create function app_private.probe_capture_payment_intent_set(
  p_actor_id uuid,
  p_command jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  restaurant uuid; branch uuid; capture uuid; event uuid; device uuid; lease uuid;
  expected bigint; occurred timestamptz; fingerprint text;
  stored app.capture_command_events%rowtype;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_command, array[
      'schemaVersion','scope','captureDraftId','expectedVersion','eventId','idempotencyKey','deviceId','occurredAt',
      'attentionLeaseId','method','tenderedAmountMinor','tipMinor'
    ])
    or not app_private.jsonb_has_exact_keys(p_command->'scope', array['restaurantId','branchId'])
    or p_command->'schemaVersion' is distinct from '1'::jsonb
    or not coalesce(p_command->>'expectedVersion' ~ '^[1-9][0-9]*$', false)
    or not coalesce(p_command->>'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    or p_command->>'method' not in ('cash','card_manual','transfer')
    or not (
      p_command->'tenderedAmountMinor' = 'null'::jsonb
      or (p_command->>'method' = 'cash' and coalesce(p_command->>'tenderedAmountMinor' ~ '^[0-9]+$', false))
    )
    or not coalesce(p_command->>'tipMinor' ~ '^[0-9]+$', false)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  begin
    restaurant := (p_command#>>'{scope,restaurantId}')::uuid;
    branch := (p_command#>>'{scope,branchId}')::uuid;
    capture := (p_command->>'captureDraftId')::uuid;
    event := (p_command->>'eventId')::uuid;
    device := (p_command->>'deviceId')::uuid;
    lease := (p_command->>'attentionLeaseId')::uuid;
    expected := (p_command->>'expectedVersion')::bigint;
    occurred := (p_command->>'occurredAt')::timestamptz;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or capture is null or event is null or device is null or lease is null
    or expected not between 1 and 9007199254740990 or occurred is null
    or p_command#>>'{scope,restaurantId}' is distinct from restaurant::text
    or p_command#>>'{scope,branchId}' is distinct from branch::text
    or p_command->>'occurredAt' is distinct from pg_catalog.to_char(occurred at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  if not exists (
    select 1
    from app.memberships m
    join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
    join app.restaurants r on r.id=m.restaurant_id
    join app.membership_role_grants g on g.membership_id=m.id
    where m.user_id=p_actor_id and m.restaurant_id=restaurant and m.branch_id=branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null and g.revoked_at is null
      and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
  ) then return pg_catalog.jsonb_build_object('status','denied'); end if;

  fingerprint := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'capture.payment_intent_set:'||p_command::text||':'||p_actor_id::text, 'UTF8'
  )), 'hex');
  select * into stored from app.capture_command_events
  where actor_id=p_actor_id and restaurant_id=restaurant and branch_id=branch
    and idempotency_key=p_command->>'idempotencyKey';
  if found then
    if stored.operation <> 'capture.payment_intent_set' or stored.command_fingerprint <> fingerprint then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;
    return pg_catalog.jsonb_build_object('status','replayed','record',stored.result_capture);
  end if;
  return pg_catalog.jsonb_build_object('status','pending');
end
$function$;

alter function app_private.probe_capture_payment_intent_set(uuid,jsonb) owner to postgres;
revoke all on function app_private.probe_capture_payment_intent_set(uuid,jsonb)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.probe_capture_payment_intent_set(uuid,jsonb) to app_api;

comment on function app_private.probe_capture_payment_intent_set(uuid,jsonb) is
  'Read-only idempotency probe for set_capture_payment_intent: recognizes a replay purely from actor+scope+idempotencyKey+fingerprint over the client''s command before the API re-reads the workspace and reprices the basis, so a retry after the lines changed (or a lost response) is never turned into a spurious insufficient/conflict by a freshly recomputed basisFingerprint.';

create function app_private.read_capture_workspace_v5(p_actor_id uuid, p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v4 jsonb;
  restaurant uuid;
  branch uuid;
  capture uuid;
  delivery_quote jsonb;
  payment_intent jsonb;
  payment_intent_applied_version bigint;
  payment_intent_basis text;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_request,array['schemaVersion','scope','captureDraftId'])
    or not app_private.jsonb_has_exact_keys(p_request->'scope',array['restaurantId','branchId'])
    or p_request->'schemaVersion' is distinct from '5'::jsonb
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  begin
    restaurant := (p_request#>>'{scope,restaurantId}')::uuid;
    branch := (p_request#>>'{scope,branchId}')::uuid;
    capture := (p_request->>'captureDraftId')::uuid;
  exception when invalid_text_representation then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;

  v4 := app_private.read_capture_workspace_v4(p_actor_id,pg_catalog.jsonb_build_object(
    'schemaVersion',4,
    'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',capture::text
  ));
  if app_private.jsonb_has_exact_keys(v4,array['status']) then return v4; end if;

  select stored.quote into delivery_quote from app.capture_delivery_quotes stored
  where stored.restaurant_id=restaurant and stored.branch_id=branch and stored.capture_draft_id=capture;

  select stored.intent, stored.applied_capture_version, stored.basis_fingerprint
  into payment_intent, payment_intent_applied_version, payment_intent_basis
  from app.capture_payment_intents stored
  where stored.restaurant_id=restaurant and stored.branch_id=branch and stored.capture_draft_id=capture;

  return (v4-'schemaVersion')||pg_catalog.jsonb_build_object(
    'schemaVersion',5,
    'deliveryQuote',delivery_quote,
    'paymentIntent',payment_intent,
    'paymentIntentAppliedCaptureVersion',payment_intent_applied_version,
    'paymentIntentBasisFingerprint',payment_intent_basis
  );
end
$function$;

alter function app_private.read_capture_workspace_v5(uuid,jsonb) owner to postgres;
revoke all on function app_private.read_capture_workspace_v5(uuid,jsonb)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.read_capture_workspace_v5(uuid,jsonb) to app_api;

comment on function app_private.read_capture_workspace_v5(uuid,jsonb) is
  'Rehydrates Capture V4 facts plus the frozen delivery quote and payment intent (raw facts only); the API computes CapturePaymentIntentProjectionV1 (totals/change/stale) from these and the live selection projection, mirroring how selectionProjection is API-derived from selectionPlan.';

-- H7: order_fulfillment_snapshots_payload_valid (from 20260922000200, applied) pins
-- snapshot->>'schemaVersion'='1', which the confirm write below can no longer satisfy once it
-- additively merges deliveryQuote/paymentIntent (shared-types' parseOrderFulfillmentSnapshotV2
-- contract for the resulting 12-key shape). Relax the check to accept either schemaVersion, purely
-- additive: every other clause -- object shape, orderId/captureDraftId/captureVersion/
-- fulfillmentChannel/deliveryInstructions consistency -- is unchanged.
alter table app.order_fulfillment_snapshots drop constraint order_fulfillment_snapshots_payload_valid;
alter table app.order_fulfillment_snapshots add constraint order_fulfillment_snapshots_payload_valid check (
  pg_catalog.jsonb_typeof(snapshot)='object'
  and snapshot->>'schemaVersion' in ('1','2')
  and snapshot->>'orderId'=order_id::text
  and snapshot->>'captureDraftId'=capture_draft_id::text
  and snapshot->>'captureVersion'=capture_version::text
  and snapshot->>'fulfillmentChannel'=fulfillment_channel
  and snapshot->'deliveryInstructions' is not distinct from coalesce(
    pg_catalog.to_jsonb(delivery_instructions),'null'::jsonb
  )
);

-- confirm now freezes deliveryQuote/paymentIntent into the Order's fulfillment snapshot, and
-- rejects (without relaxing any existing check) when a stored intent's basis_fingerprint no
-- longer matches the confirming command's current basis -- the caller (API) is responsible for
-- recomputing and passing paymentBasisFingerprint the same way it already recomputes totals.
create or replace function app_private.confirm_capture_draft_v3(
  p_actor_id uuid,
  p_command jsonb,
  p_order jsonb,
  p_order_audits jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  restaurant uuid; branch uuid; capture uuid; requested_order_id uuid; member uuid;
  expected bigint; fingerprint text; catalog uuid; catalog_currency text;
  stored app.capture_command_events%rowtype;
  repeat_plan app.capture_repeat_order_plans%rowtype;
  stored_quote app.capture_delivery_quotes%rowtype;
  stored_intent app.capture_payment_intents%rowtype;
  current_fulfillment_snapshot uuid; current_channel text;
  fulfillment_change_version bigint; plan_change_version bigint;
  frozen_quote jsonb; frozen_intent jsonb;
  old_result jsonb; mutation_result jsonb; result_record jsonb; base_order jsonb;
  line_record record; item jsonb; expected_snapshot jsonb; expected_modifiers jsonb; expected_note jsonb;
  product app.menu_products%rowtype; line_index bigint; item_count integer; write_status text;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_command,array[
      'schemaVersion','scope','captureDraftId','expectedVersion','eventId','idempotencyKey','deviceId','occurredAt',
      'attentionLeaseId','orderId','shiftId','tableId','currency','timeZone'
    ])
    or not app_private.jsonb_has_exact_keys(p_command->'scope',array['restaurantId','branchId'])
    or p_command->'schemaVersion' is distinct from '2'::jsonb
    or not coalesce(p_command->>'expectedVersion' ~ '^[1-9][0-9]*$',false)
    or not coalesce(p_command->>'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
    or not coalesce(p_command->>'currency' ~ '^[A-Z]{3}$',false)
    or pg_catalog.char_length(p_command->>'timeZone') not between 1 and 100
    or (p_order is null) is distinct from (p_order_audits is null)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  begin
    restaurant := (p_command#>>'{scope,restaurantId}')::uuid;
    branch := (p_command#>>'{scope,branchId}')::uuid;
    capture := (p_command->>'captureDraftId')::uuid;
    requested_order_id := (p_command->>'orderId')::uuid;
    expected := (p_command->>'expectedVersion')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or capture is null or requested_order_id is null
    or expected not between 1 and 9007199254740990
    or p_command#>>'{scope,restaurantId}' is distinct from restaurant::text
    or p_command#>>'{scope,branchId}' is distinct from branch::text
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  select membership.id into member
  from app.memberships membership
  join app.branches b on b.id=membership.branch_id and b.restaurant_id=membership.restaurant_id
  join app.restaurants r on r.id=membership.restaurant_id
  join app.membership_role_grants grant_record on grant_record.membership_id=membership.id
  where membership.user_id=p_actor_id and membership.restaurant_id=restaurant and membership.branch_id=branch
    and membership.revoked_at is null and b.disabled_at is null and r.disabled_at is null
    and grant_record.revoked_at is null
    and grant_record.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
  order by grant_record.role_code limit 1 for share of membership,b,r,grant_record;
  if member is null then return pg_catalog.jsonb_build_object('status','denied'); end if;

  fingerprint := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'capture.confirmed.v3:'||p_command::text||':'||p_actor_id::text
  ,'UTF8'
  )),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'capture-command:'||p_actor_id::text||':'||restaurant::text||':'||branch::text||':'||(p_command->>'idempotencyKey'),0
  ));
  select * into stored from app.capture_command_events
  where actor_id=p_actor_id and restaurant_id=restaurant and branch_id=branch
    and idempotency_key=p_command->>'idempotencyKey';
  if found then
    if stored.operation<>'capture.confirmed' or stored.command_fingerprint<>fingerprint
      or stored.capture_draft_id<>capture or stored.expected_version<>expected
      or stored.result_capture#>>'{detail,confirmedOrderId}' is distinct from requested_order_id::text
      or not exists (
        select 1 from app.orders confirmed
        join app.order_operational_shifts shift_link on shift_link.restaurant_id=confirmed.restaurant_id
          and shift_link.branch_id=confirmed.branch_id and shift_link.order_id=confirmed.id
        join app.order_fulfillment_snapshots frozen on frozen.restaurant_id=confirmed.restaurant_id
          and frozen.branch_id=confirmed.branch_id and frozen.order_id=confirmed.id
          and frozen.capture_draft_id=capture
        where confirmed.restaurant_id=restaurant and confirmed.branch_id=branch and confirmed.id=requested_order_id
          and shift_link.shift_id=(p_command->>'shiftId')::uuid
      )
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    return pg_catalog.jsonb_build_object('status','replayed','record',stored.result_capture);
  end if;
  if p_order is null then return pg_catalog.jsonb_build_object('status','pending'); end if;

  -- H23: deliveryCharge is an optional key here, exactly like tableId -- the codec omits it
  -- entirely when null (same optional-key convention as orderDiscount/tip) rather than always
  -- writing an explicit null, because persist_order_mutation's later item-add/state-change
  -- mutations require the persisted aggregate outside items/status to stay byte-for-byte
  -- identical; always re-adding the key here would break that equality against every order
  -- persisted without it (every non-delivery order, and every order confirmed before H13).
  if pg_catalog.jsonb_typeof(p_order)<>'object' or pg_catalog.jsonb_typeof(p_order_audits)<>'array'
    or not (
      app_private.jsonb_has_exact_keys(p_order,array[
        'schemaVersion','orderId','restaurantId','branchId','channel','currency','timeZone','status','items'
      ])
      or app_private.jsonb_has_exact_keys(p_order,array[
        'schemaVersion','orderId','restaurantId','branchId','channel','currency','timeZone','status','items','deliveryCharge'
      ])
      or app_private.jsonb_has_exact_keys(p_order,array[
        'schemaVersion','orderId','restaurantId','branchId','channel','tableId','currency','timeZone','status','items'
      ])
      or app_private.jsonb_has_exact_keys(p_order,array[
        'schemaVersion','orderId','restaurantId','branchId','channel','tableId','currency','timeZone','status','items','deliveryCharge'
      ])
    )
    or p_order->>'schemaVersion'<>'1'
    or p_order->>'restaurantId' is distinct from restaurant::text
    or p_order->>'branchId' is distinct from branch::text
    or p_order->>'orderId' is distinct from requested_order_id::text
    or p_order->>'currency' is distinct from p_command->>'currency'
    or p_order->>'timeZone' is distinct from p_command->>'timeZone'
    or p_order->>'status'<>'draft'
    or pg_catalog.jsonb_typeof(p_order->'items')<>'array'
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  item_count := pg_catalog.jsonb_array_length(p_order->'items');
  if pg_catalog.jsonb_array_length(p_order_audits)<>item_count+1
    or p_order_audits->0->>'operation'<>'order.created'
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  select * into repeat_plan from app.capture_repeat_order_plans plan
  where plan.restaurant_id=restaurant and plan.branch_id=branch and plan.capture_draft_id=capture for update;

  if not found then
    if item_count<>0 then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  else
    if (repeat_plan.plan_kind='repeat' and repeat_plan.applied_capture_version<>expected)
      or (repeat_plan.plan_kind='repeat' and repeat_plan.customer_id::text is distinct from repeat_plan.selection_plan->>'customerId')
      or pg_catalog.jsonb_array_length(repeat_plan.selection_plan->'lines')<>item_count
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;

    select head.catalog_id,catalog_record.currency into catalog,catalog_currency
    from app.menu_catalog_heads head
    join app.menu_catalogs catalog_record on catalog_record.restaurant_id=head.restaurant_id
      and catalog_record.id=head.catalog_id and catalog_record.version=head.version
    where head.restaurant_id=restaurant for share of head,catalog_record;
    if not found or catalog_currency is distinct from p_command->>'currency' then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;

    for line_record in
      select line.value, line.ordinality
      from pg_catalog.jsonb_array_elements(repeat_plan.selection_plan->'lines') with ordinality line(value,ordinality)
      order by line.ordinality
    loop
      begin
        select product_record.* into product
        from app.menu_products product_record
        join app.menu_categories category on category.restaurant_id=product_record.restaurant_id
          and category.catalog_id=product_record.catalog_id and category.id=product_record.category_id
        where product_record.restaurant_id=restaurant and product_record.catalog_id=catalog
          and product_record.id=(line_record.value->>'productId')::uuid
          and product_record.active and category.active;
      exception when invalid_text_representation then
        return pg_catalog.jsonb_build_object('status','conflict');
      end;
      if not found then return pg_catalog.jsonb_build_object('status','conflict'); end if;

      if exists (
        select 1 from app.menu_modifier_groups catalog_group
        left join lateral (
          select requested.value from pg_catalog.jsonb_array_elements(line_record.value->'modifierGroups') requested(value)
          where requested.value->>'groupId'=catalog_group.id::text
        ) requested_group on true
        where catalog_group.restaurant_id=restaurant and catalog_group.catalog_id=catalog
          and catalog_group.product_id=product.id
          and (not catalog_group.active or requested_group.value is null)
      ) or exists (
        select 1 from pg_catalog.jsonb_array_elements(line_record.value->'modifierGroups') requested_group(value)
        left join app.menu_modifier_groups catalog_group on catalog_group.restaurant_id=restaurant
          and catalog_group.catalog_id=catalog and catalog_group.product_id=product.id
          and catalog_group.id=(requested_group.value->>'groupId')::uuid
        where catalog_group.id is null or not catalog_group.active
          or (select coalesce(pg_catalog.sum((selection.value->>'quantity')::integer),0)
              from pg_catalog.jsonb_array_elements(requested_group.value->'selections') selection(value))
            not between catalog_group.minimum_quantity and catalog_group.maximum_quantity
      ) or exists (
        select 1 from pg_catalog.jsonb_array_elements(line_record.value->'modifierGroups') requested_group(value)
        cross join lateral pg_catalog.jsonb_array_elements(requested_group.value->'selections') selection(value)
        left join app.menu_modifier_options option_record on option_record.restaurant_id=restaurant
          and option_record.catalog_id=catalog and option_record.group_id=(requested_group.value->>'groupId')::uuid
          and option_record.id=(selection.value->>'optionId')::uuid
        where option_record.id is null or not option_record.active
          or (option_record.maximum_quantity is not null
            and (selection.value->>'quantity')::integer>option_record.maximum_quantity)
      ) then return pg_catalog.jsonb_build_object('status','conflict'); end if;

      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'modifierId',option_record.id::text,
        'name',option_record.name,
        'groupId',catalog_group.id::text,
        'groupName',catalog_group.name,
        'groupCatalogVersion',catalog::text,
        'unitPrice',pg_catalog.jsonb_build_object('amountMinor',option_record.unit_price_minor,'currency',catalog_currency),
        'quantity',(selection.value->>'quantity')::integer
      ) order by catalog_group.display_order,catalog_group.id,option_record.id),'[]'::jsonb) into expected_modifiers
      from pg_catalog.jsonb_array_elements(line_record.value->'modifierGroups') requested_group(value)
      cross join lateral pg_catalog.jsonb_array_elements(requested_group.value->'selections') selection(value)
      join app.menu_modifier_groups catalog_group on catalog_group.restaurant_id=restaurant
        and catalog_group.catalog_id=catalog and catalog_group.product_id=product.id
        and catalog_group.id=(requested_group.value->>'groupId')::uuid
      join app.menu_modifier_options option_record on option_record.restaurant_id=restaurant
        and option_record.catalog_id=catalog and option_record.group_id=catalog_group.id
        and option_record.id=(selection.value->>'optionId')::uuid;

      expected_snapshot := pg_catalog.jsonb_build_object(
        'catalogVersion',catalog::text,'productId',product.id::text,'name',product.name,
        'stationId',product.station_id,'unit',product.unit,
        'unitPrice',pg_catalog.jsonb_build_object('amountMinor',product.unit_price_minor,'currency',catalog_currency),
        'modifiers',expected_modifiers
      );
      if product.sku is not null then
        expected_snapshot := expected_snapshot||pg_catalog.jsonb_build_object('sku',product.sku);
      end if;
      if product.tax_id is not null then
        expected_snapshot := expected_snapshot||pg_catalog.jsonb_build_object('tax',pg_catalog.jsonb_build_object(
          'taxId',product.tax_id,'name',product.tax_name,'taxRuleVersion',product.tax_rule_version,
          'rate',pg_catalog.jsonb_build_object(
            'numerator',product.tax_rate_numerator::text,'denominator',product.tax_rate_denominator::text
          ),'inclusion',product.tax_inclusion
        ));
      end if;

      if line_record.value ? 'note' then
        expected_note := line_record.value->'note';
      else
        expected_note := 'null'::jsonb;
      end if;

      item := p_order#>array['items',(line_record.ordinality-1)::text];
      if item is null
        or not app_private.jsonb_has_exact_keys(item,array[
          'orderItemId','snapshot','quantity','restaurantId','branchId','status','note'
        ])
        or not coalesce(item->>'orderItemId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
        or item->>'quantity' is distinct from line_record.value->>'quantity'
        or item->>'restaurantId' is distinct from restaurant::text
        or item->>'branchId' is distinct from branch::text
        or item->>'status'<>'pending'
        or item->'snapshot' is distinct from expected_snapshot
        or item->'note' is distinct from expected_note
      then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    end loop;
  end if;

  -- Freeze the delivery quote and payment intent, if any.
  select fulfillment_snapshot_id, fulfillment_channel into current_fulfillment_snapshot, current_channel
  from app.capture_drafts
  where restaurant_id=restaurant and branch_id=branch and id=capture for share;

  select * into stored_quote from app.capture_delivery_quotes
  where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture for share;
  -- Defense in depth: clear_capture_delivery_quote_for_channel already deletes this row the
  -- instant fulfillment_snapshot_id changes, so this should never actually find a mismatch; it
  -- exists purely to fail closed rather than freeze an inconsistent quote/address pairing.
  if found and stored_quote.quote->>'addressSnapshotRef' is distinct from current_fulfillment_snapshot::text then
    return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_quote_stale');
  end if;
  frozen_quote := case when found then stored_quote.quote else null end;

  -- H10: a delivery capture can never confirm without a live, coverage-eligible quote. This is
  -- deliberately stricter than the staleness check above, which only guards against an
  -- address/snapshot mismatch; here we also require the frozen quote to still be in-date and
  -- actually cover the address. H14: expiry is judged against the server's own clock
  -- (clock_timestamp()), not the client-supplied occurredAt -- a client can't extend a quote's
  -- life by lying about when its command "occurred".
  if current_channel = 'delivery' then
    if frozen_quote is null then
      return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_quote_missing');
    end if;
    if frozen_quote->>'coverageStatus' = 'not_covered' then
      return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_quote_not_covered');
    elsif (frozen_quote->>'expiresAt')::timestamptz <= clock_timestamp() then
      return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_quote_expired');
    end if;
    -- H13: the Order's frozen delivery charge must be exactly the server's own frozen quote --
    -- never relaxed to "close enough", and never trusted from the client without this check. The
    -- API is expected to materialize it from this same quote, but a stale API read (the quote
    -- moved between the API's workspace read and this transaction) must surface as a conflict,
    -- not silently persist a mismatched charge.
    if p_order->'deliveryCharge' is null or pg_catalog.jsonb_typeof(p_order->'deliveryCharge')<>'object'
      or not app_private.jsonb_has_exact_keys(p_order->'deliveryCharge',array['amount','quoteId'])
      or pg_catalog.jsonb_typeof(p_order#>'{deliveryCharge,amount}')<>'object'
      or not app_private.jsonb_has_exact_keys(p_order#>'{deliveryCharge,amount}',array['amountMinor','currency'])
      or (p_order#>'{deliveryCharge,amount,amountMinor}')::text::numeric is distinct from (frozen_quote->>'feeMinor')::numeric
      or p_order#>>'{deliveryCharge,amount,currency}' is distinct from p_order->>'currency'
      or p_order#>>'{deliveryCharge,quoteId}' is distinct from frozen_quote->>'quoteId'
    then
      return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_charge_mismatch');
    end if;
  -- H23: the key is optional (see the shape check above), so a non-delivery order may omit it
  -- entirely -- that must be accepted exactly like an explicit null, never rejected.
  elsif (p_order ? 'deliveryCharge') and p_order->'deliveryCharge' is distinct from 'null'::jsonb then
    return pg_catalog.jsonb_build_object('status','rejected');
  end if;

  -- Staleness is decided from the actual facts that could have invalidated the intent since it
  -- was set, not from whether ANY unrelated mutation (e.g. delivery instructions) advanced the
  -- draft's version: the selection/repeat plan's change history (H16: read from the command
  -- journal, not repeat_plan.applied_capture_version -- that row is shared by both plan kinds,
  -- but replace_capture_selection_plan DELETES it outright when the selection is cleared to zero
  -- lines, which would otherwise silently reset "the plan's version" to null/0 and hide a real,
  -- intent-invalidating change; capture.selection_replaced/capture.order_repeated are logged
  -- unconditionally, including on that clearing delete, so this is immune to it), the frozen
  -- quote's applied_capture_version, and the version at which the fulfillment/address snapshot
  -- itself last changed (capture.fulfillment_changed). A payment intent set before any of those
  -- moved on is still valid, even if the draft's overall version advanced for an unrelated
  -- reason in between.
  select max(events.result_version) into fulfillment_change_version
  from app.capture_command_events events
  where events.restaurant_id=restaurant and events.branch_id=branch and events.capture_draft_id=capture
    and events.operation='capture.fulfillment_changed';

  select max(events.result_version) into plan_change_version
  from app.capture_command_events events
  where events.restaurant_id=restaurant and events.branch_id=branch and events.capture_draft_id=capture
    and events.operation in ('capture.selection_replaced','capture.order_repeated');

  select * into stored_intent from app.capture_payment_intents
  where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture for share;
  if not found then
    frozen_intent := null;
  elsif coalesce(plan_change_version,0) > stored_intent.applied_capture_version
    or coalesce(stored_quote.applied_capture_version,0) > stored_intent.applied_capture_version
    or coalesce(fulfillment_change_version,0) > stored_intent.applied_capture_version
  then
    return pg_catalog.jsonb_build_object('status','conflict','reason','payment_intent_stale');
  else
    frozen_intent := stored_intent.intent;
  end if;

  begin
    base_order := pg_catalog.jsonb_set(p_order,'{items}','[]'::jsonb,false);
    old_result := app_private.confirm_capture_draft(p_actor_id,p_command,base_order,p_order_audits->0);
    if old_result->>'status'='denied' then
      write_status := 'denied';
      raise exception using errcode='P5100',message='CAPTURE_CONFIRMATION_ATOMIC_ABORT';
    end if;
    if old_result->>'status'<>'applied' then
      write_status := 'conflict';
      raise exception using errcode='P5100',message='CAPTURE_CONFIRMATION_ATOMIC_ABORT';
    end if;
    result_record := old_result->'record';

    if item_count>0 then
      for line_index in 1..item_count loop
        mutation_result := app_private.persist_order_mutation(
          p_actor_id,
          line_index,
          pg_catalog.jsonb_set(p_order,'{items}',(
            select pg_catalog.jsonb_agg(prefix.value order by prefix.ordinality)
            from pg_catalog.jsonb_array_elements(p_order->'items') with ordinality prefix(value,ordinality)
            where prefix.ordinality<=line_index
          ),false),
          p_order_audits->line_index::integer
        );
        if mutation_result->>'status'='forbidden' then
          write_status := 'denied';
          raise exception using errcode='P5100',message='CAPTURE_CONFIRMATION_ATOMIC_ABORT';
        end if;
        if mutation_result->>'status'<>'saved' then
          write_status := 'conflict';
          raise exception using errcode='P5100',message='CAPTURE_CONFIRMATION_ATOMIC_ABORT';
        end if;
      end loop;
    end if;

    -- Additive: the stored snapshot is written as schemaVersion 1 (parseOrderFulfillmentSnapshotV1's
    -- exact key set). Merging deliveryQuote/paymentIntent without also bumping schemaVersion to 2
    -- would leave an object with 12 keys claiming to be schemaVersion 1, which every V1 parser
    -- (an exact-keys match) then rejects outright. schemaVersion 2 is parseOrderFulfillmentSnapshotV2's
    -- contract (shared-types): identical to V1 plus these two nullable fields, nothing else changes.
    update app.order_fulfillment_snapshots
    set snapshot = snapshot || pg_catalog.jsonb_build_object(
      'schemaVersion', 2, 'deliveryQuote', frozen_quote, 'paymentIntent', frozen_intent
    )
    where restaurant_id=restaurant and branch_id=branch and order_id=requested_order_id
      and capture_draft_id=capture;
    if not found then raise exception using errcode='55000',message='CAPTURE_CONFIRMATION_SNAPSHOT_MISSING'; end if;

    update app.capture_command_events set command_fingerprint=fingerprint
    where actor_id=p_actor_id and restaurant_id=restaurant and branch_id=branch
      and idempotency_key=p_command->>'idempotencyKey' and operation='capture.confirmed'
      and capture_draft_id=capture and expected_version=expected;
    if not found then raise exception using errcode='55000',message='CAPTURE_CONFIRMATION_EVENT_MISSING'; end if;
  exception when sqlstate 'P5100' then
    return pg_catalog.jsonb_build_object('status',write_status);
  end;

  return pg_catalog.jsonb_build_object('status','applied','record',result_record);
end
$function$;

alter function app_private.confirm_capture_draft_v3(uuid,jsonb,jsonb,jsonb) owner to postgres;

commit;
