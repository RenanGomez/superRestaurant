begin;

-- order-deliveries (D6): dispatch and cash settlement of `delivery`-channel Orders.
--
-- Rules (mirrored by packages/shared-types; SQL is the authority that protects the invariants):
--   * Order and OrderItem state machines are untouched. A delivery has its own small state machine
--     (assigned -> en_route -> delivered -> settled, or en_route -> failed -> assigned again) kept in
--     `app.order_deliveries`; `pending` is only the virtual state of an Order with no row yet.
--   * At most two attempts per Order (`attempt_count` increments when a trip leaves the branch).
--     Failing the second attempt leaves the delivery `failed` for good; there is no partial delivery.
--   * Settlement is the only place money moves: `settle_delivery` runs the EXISTING
--     `collect_simple_payment` authority in the same transaction for the Order's full remaining
--     balance, then marks the delivery `settled`. Any failure aborts both; a retry replays by key.
--     SQL derives no money: the API builds the Payment/Order/Register aggregates with packages/domain.
--   * Only cash can be settled here (the courier answers for the cash). A card/transfer intent is
--     collected through the normal `POST /payments/collect` and never through a delivery settlement.
--   * Every transition is journaled append-only with the command's idempotency key: same key and same
--     payload replays the stored result, same key with another payload is a conflict.

-- 1. Courier role.
insert into app.roles (code) values ('courier');

-- 2. Delivery state and its journal.
create table app.order_deliveries (
  restaurant_id uuid not null,
  branch_id uuid not null,
  order_id uuid not null,
  courier_user_id uuid not null references auth.users (id) on delete restrict,
  state text not null,
  version bigint not null default 1,
  attempt_count integer not null default 0,
  assigned_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  failed_reason text,
  cash_to_collect_minor bigint,
  settled_payment_id uuid references app.payments (id) on delete restrict,
  settled_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by uuid not null references auth.users (id) on delete restrict,
  updated_by uuid not null references auth.users (id) on delete restrict,
  constraint order_deliveries_pk primary key (restaurant_id, branch_id, order_id),
  constraint order_deliveries_order_fk foreign key (restaurant_id, branch_id, order_id)
    references app.orders (restaurant_id, branch_id, id) on delete restrict,
  constraint order_deliveries_state_valid check (state in ('assigned','en_route','delivered','failed','settled')),
  constraint order_deliveries_version_valid check (version between 1 and 9007199254740991),
  constraint order_deliveries_attempts_valid check (attempt_count between 0 and 2),
  constraint order_deliveries_assigned_valid check (assigned_at is not null),
  constraint order_deliveries_dispatched_valid check (
    (state in ('assigned') and (dispatched_at is null or attempt_count >= 1))
    or (state in ('en_route','delivered','failed','settled') and dispatched_at is not null and attempt_count >= 1)
  ),
  constraint order_deliveries_delivered_valid check (
    (state in ('delivered','settled')) = (delivered_at is not null)
  ),
  constraint order_deliveries_failed_valid check (
    (state = 'failed') = (failed_reason is not null)
    and (failed_reason is null or (failed_reason = pg_catalog.btrim(failed_reason)
      and pg_catalog.char_length(failed_reason) between 1 and 300 and failed_reason !~ '[[:cntrl:]]'))
  ),
  constraint order_deliveries_settled_valid check (
    (state = 'settled') = (settled_payment_id is not null)
    and (settled_payment_id is null) = (settled_at is null)
    and (cash_to_collect_minor is null or (state = 'settled' and cash_to_collect_minor between 1 and 9007199254740991))
  )
);

create index order_deliveries_branch_courier_idx
  on app.order_deliveries (restaurant_id, branch_id, courier_user_id, state);

alter table app.order_deliveries enable row level security;
alter table app.order_deliveries force row level security;
revoke all on app.order_deliveries from public, anon, authenticated, service_role, app_api;

create table app.order_delivery_events (
  event_id uuid primary key,
  restaurant_id uuid not null,
  branch_id uuid not null,
  order_id uuid not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  device_id uuid not null,
  operation text not null,
  idempotency_key text not null,
  expected_version bigint not null,
  result_version bigint not null,
  from_state text not null,
  to_state text not null,
  command_payload jsonb not null,
  result_payload jsonb not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint order_delivery_events_delivery_fk foreign key (restaurant_id, branch_id, order_id)
    references app.order_deliveries (restaurant_id, branch_id, order_id) on delete restrict,
  constraint order_delivery_events_idempotency_unique unique (actor_id, restaurant_id, branch_id, idempotency_key),
  constraint order_delivery_events_operation_valid check (
    operation in ('delivery.assigned','delivery.dispatched','delivery.completed','delivery.failed','delivery.settled')
  ),
  constraint order_delivery_events_idempotency_valid check (
    idempotency_key = pg_catalog.btrim(idempotency_key)
    and pg_catalog.char_length(idempotency_key) between 1 and 200
    and idempotency_key !~ '[[:cntrl:]]'
  ),
  constraint order_delivery_events_state_valid check (
    from_state in ('pending','assigned','en_route','delivered','failed','settled')
    and to_state in ('assigned','en_route','delivered','failed','settled')
  ),
  constraint order_delivery_events_payload_valid check (
    pg_catalog.jsonb_typeof(command_payload) = 'object' and pg_catalog.jsonb_typeof(result_payload) = 'object'
  )
);

create index order_delivery_events_order_idx
  on app.order_delivery_events (restaurant_id, branch_id, order_id, received_at);

alter table app.order_delivery_events enable row level security;
alter table app.order_delivery_events force row level security;
revoke all on app.order_delivery_events from public, anon, authenticated, service_role, app_api;

create function app_private.reject_order_delivery_event_change() returns trigger
language plpgsql set search_path = '' as $function$
begin
  raise exception using errcode = '55000', message = 'ORDER_DELIVERY_EVENT_IMMUTABLE';
end
$function$;

create trigger order_delivery_events_immutable
  before update or delete on app.order_delivery_events
  for each row execute function app_private.reject_order_delivery_event_change();

-- 3. Projections (no money here).
create function app_private.delivery_view(p_row app.order_deliveries) returns jsonb
language sql stable set search_path = '' as $function$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('restaurantId', p_row.restaurant_id::text, 'branchId', p_row.branch_id::text),
    'orderId', p_row.order_id::text,
    'state', p_row.state,
    'version', p_row.version,
    'courierUserId', p_row.courier_user_id::text,
    'attemptCount', p_row.attempt_count,
    'assignedAt', pg_catalog.to_char(p_row.assigned_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'dispatchedAt', pg_catalog.to_char(p_row.dispatched_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deliveredAt', pg_catalog.to_char(p_row.delivered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'failedReason', p_row.failed_reason,
    'settledPaymentId', p_row.settled_payment_id::text,
    'settledAt', pg_catalog.to_char(p_row.settled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
$function$;

create function app_private.pending_delivery_view(p_restaurant_id uuid, p_branch_id uuid, p_order_id uuid) returns jsonb
language sql stable set search_path = '' as $function$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('restaurantId', p_restaurant_id::text, 'branchId', p_branch_id::text),
    'orderId', p_order_id::text, 'state', 'pending', 'version', 0, 'courierUserId', null, 'attemptCount', 0,
    'assignedAt', null, 'dispatchedAt', null, 'deliveredAt', null, 'failedReason', null,
    'settledPaymentId', null, 'settledAt', null
  )
$function$;

-- Identity-provider display name only (full_name / name); never the email. NULL when absent.
create function app_private.member_display_name(p_user_id uuid) returns text
language sql stable security definer set search_path = '' as $function$
  select nullif(pg_catalog.btrim(pg_catalog.left(pg_catalog.regexp_replace(
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', ''),
    '[[:cntrl:]​-‏ - ⁠-⁯﻿]', '', 'g'), 120)), '')
  from auth.users u where u.id = p_user_id
$function$;

-- 4. Transitions: assign, dispatch, complete, fail.
create function app_private.apply_delivery_transition(p_actor_id uuid, p_operation text, p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_restaurant uuid; v_branch uuid; v_order uuid; v_expected bigint; v_event uuid; v_device uuid;
  v_occurred timestamptz; v_key text; v_courier uuid; v_reason text;
  v_keys text[] := array['schemaVersion','scope','orderId','expectedVersion','eventId','idempotencyKey','deviceId','occurredAt'];
  v_roles text[]; v_manager boolean; v_is_courier boolean;
  v_existing app.order_delivery_events%rowtype;
  v_order_row app.orders%rowtype;
  v_row app.order_deliveries%rowtype;
  v_from text; v_to text; v_event_name text; v_view jsonb;
begin
  if p_operation = 'assign' then v_keys := v_keys || array['courierUserId'];
  elsif p_operation = 'fail' then v_keys := v_keys || array['reason'];
  elsif p_operation not in ('dispatch','complete') then
    return pg_catalog.jsonb_build_object('status','conflict');
  end if;
  if p_actor_id is null or pg_catalog.jsonb_typeof(p_command) <> 'object'
    or not app_private.jsonb_has_exact_keys(p_command, v_keys)
    or p_command -> 'schemaVersion' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_command -> 'scope') <> 'object'
    or not app_private.jsonb_has_exact_keys(p_command -> 'scope', array['restaurantId','branchId'])
    or pg_catalog.jsonb_typeof(p_command -> 'expectedVersion') <> 'number'
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  begin
    v_restaurant := (p_command #>> '{scope,restaurantId}')::uuid;
    v_branch := (p_command #>> '{scope,branchId}')::uuid;
    v_order := (p_command ->> 'orderId')::uuid;
    v_expected := (p_command ->> 'expectedVersion')::bigint;
    v_event := (p_command ->> 'eventId')::uuid;
    v_device := (p_command ->> 'deviceId')::uuid;
    v_occurred := (p_command ->> 'occurredAt')::timestamptz;
    if p_operation = 'assign' then v_courier := (p_command ->> 'courierUserId')::uuid; end if;
  exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    return pg_catalog.jsonb_build_object('status','conflict');
  end;
  v_key := p_command ->> 'idempotencyKey';
  v_reason := case when p_operation = 'fail' then p_command ->> 'reason' else null end;
  if v_key is null or v_key <> pg_catalog.btrim(v_key) or pg_catalog.char_length(v_key) not between 1 and 200
    or v_key ~ '[[:cntrl:]]' or v_expected < 0
    or (p_operation <> 'assign' and v_expected < 1)
    or (p_operation = 'fail' and (v_reason is null or v_reason <> pg_catalog.btrim(v_reason)
      or pg_catalog.char_length(v_reason) not between 1 and 300 or v_reason ~ '[[:cntrl:]]'))
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  select m.roles into v_roles from app_private.find_active_branch_membership(p_actor_id, v_restaurant, v_branch) m;
  if v_roles is null then return pg_catalog.jsonb_build_object('status','forbidden'); end if;
  v_manager := v_roles && array['owner','admin','manager','supervisor','cashier'];
  v_is_courier := 'courier' = any(v_roles);
  if not (v_manager or (p_operation <> 'assign' and v_is_courier)) then
    return pg_catalog.jsonb_build_object('status','forbidden');
  end if;

  v_event_name := case p_operation when 'assign' then 'delivery.assigned' when 'dispatch' then 'delivery.dispatched'
    when 'complete' then 'delivery.completed' else 'delivery.failed' end;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('order:' || v_order::text, 0));

  select * into v_existing from app.order_delivery_events
  where actor_id = p_actor_id and restaurant_id = v_restaurant and branch_id = v_branch and idempotency_key = v_key;
  if found then
    if v_existing.operation <> v_event_name or v_existing.command_payload <> p_command
      or v_existing.event_id <> v_event
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    return pg_catalog.jsonb_build_object('status','replayed','replayed',true,'delivery',v_existing.result_payload -> 'delivery');
  end if;
  if exists (select 1 from app.order_delivery_events where event_id = v_event) then
    return pg_catalog.jsonb_build_object('status','conflict');
  end if;

  select * into v_order_row from app.orders
  where restaurant_id = v_restaurant and branch_id = v_branch and id = v_order for update;
  if not found or v_order_row.channel <> 'delivery' or v_order_row.status not in ('open','partially_paid') then
    return pg_catalog.jsonb_build_object('status','conflict');
  end if;

  select * into v_row from app.order_deliveries
  where restaurant_id = v_restaurant and branch_id = v_branch and order_id = v_order for update;
  if found then
    if v_row.version <> v_expected then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    v_from := v_row.state;
    -- A courier without a management role may only move deliveries assigned to them.
    if not v_manager and v_row.courier_user_id <> p_actor_id then
      return pg_catalog.jsonb_build_object('status','forbidden');
    end if;
  else
    if v_expected <> 0 or p_operation <> 'assign' then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    v_from := 'pending';
  end if;

  if p_operation = 'assign' then
    if v_from not in ('pending','assigned','failed')
      or (v_from = 'failed' and v_row.attempt_count >= 2)
      or (v_from = 'assigned' and v_row.courier_user_id = v_courier)
      or not exists (
        select 1 from app_private.find_active_branch_membership(v_courier, v_restaurant, v_branch) c
        where 'courier' = any(c.roles))
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    v_to := 'assigned';
    if v_from = 'pending' then
      insert into app.order_deliveries (restaurant_id, branch_id, order_id, courier_user_id, state, version,
        attempt_count, assigned_at, created_by, updated_by)
      values (v_restaurant, v_branch, v_order, v_courier, 'assigned', 1, 0, pg_catalog.clock_timestamp(),
        p_actor_id, p_actor_id)
      returning * into v_row;
    else
      update app.order_deliveries set courier_user_id = v_courier, state = 'assigned', failed_reason = null,
        assigned_at = pg_catalog.clock_timestamp(), version = version + 1,
        updated_at = pg_catalog.clock_timestamp(), updated_by = p_actor_id
      where restaurant_id = v_restaurant and branch_id = v_branch and order_id = v_order
      returning * into v_row;
    end if;
  elsif p_operation = 'dispatch' then
    if v_from <> 'assigned' or v_row.attempt_count >= 2 then
      return pg_catalog.jsonb_build_object('status','conflict'); end if;
    v_to := 'en_route';
    update app.order_deliveries set state = 'en_route', attempt_count = attempt_count + 1,
      dispatched_at = pg_catalog.clock_timestamp(), version = version + 1,
      updated_at = pg_catalog.clock_timestamp(), updated_by = p_actor_id
    where restaurant_id = v_restaurant and branch_id = v_branch and order_id = v_order
    returning * into v_row;
  elsif p_operation = 'complete' then
    if v_from <> 'en_route' then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    v_to := 'delivered';
    update app.order_deliveries set state = 'delivered', delivered_at = pg_catalog.clock_timestamp(),
      version = version + 1, updated_at = pg_catalog.clock_timestamp(), updated_by = p_actor_id
    where restaurant_id = v_restaurant and branch_id = v_branch and order_id = v_order
    returning * into v_row;
  else
    if v_from <> 'en_route' then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    v_to := 'failed';
    update app.order_deliveries set state = 'failed', failed_reason = v_reason,
      version = version + 1, updated_at = pg_catalog.clock_timestamp(), updated_by = p_actor_id
    where restaurant_id = v_restaurant and branch_id = v_branch and order_id = v_order
    returning * into v_row;
  end if;

  v_view := app_private.delivery_view(v_row);
  insert into app.order_delivery_events (event_id, restaurant_id, branch_id, order_id, actor_id, device_id, operation,
    idempotency_key, expected_version, result_version, from_state, to_state, command_payload, result_payload, occurred_at)
  values (v_event, v_restaurant, v_branch, v_order, p_actor_id, v_device, v_event_name, v_key, v_expected,
    v_row.version, v_from, v_to, p_command, pg_catalog.jsonb_build_object('delivery', v_view), v_occurred);

  return pg_catalog.jsonb_build_object('status','saved','replayed',false,'delivery',v_view);
end
$function$;

create function app_private.assign_delivery(p_actor_id uuid, p_command jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $function$
  select app_private.apply_delivery_transition(p_actor_id, 'assign', p_command)
$function$;
create function app_private.dispatch_delivery(p_actor_id uuid, p_command jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $function$
  select app_private.apply_delivery_transition(p_actor_id, 'dispatch', p_command)
$function$;
create function app_private.complete_delivery(p_actor_id uuid, p_command jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $function$
  select app_private.apply_delivery_transition(p_actor_id, 'complete', p_command)
$function$;
create function app_private.fail_delivery(p_actor_id uuid, p_command jsonb) returns jsonb
language sql volatile security definer set search_path = '' as $function$
  select app_private.apply_delivery_transition(p_actor_id, 'fail', p_command)
$function$;

-- 5. Settlement: the existing cash-collect authority plus the delivery's own transition, atomically.
-- p_command is the SettleDeliveryCommandV1; p_collect is the CollectPaymentCommandV1 the API derived
-- from it (full remaining balance, the frozen intent's method, tender/tip); p_payment/p_order/p_register
-- are the domain aggregates `collect_simple_payment` already validates. SQL derives no money.
create function app_private.replay_delivery_settlement(p_actor_id uuid, p_command jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $function$
declare
  v_restaurant uuid; v_branch uuid; v_key text; v_existing app.order_delivery_events%rowtype;
begin
  if p_actor_id is null or pg_catalog.jsonb_typeof(p_command) <> 'object'
    or pg_catalog.jsonb_typeof(p_command -> 'scope') <> 'object' then return null; end if;
  begin
    v_restaurant := (p_command #>> '{scope,restaurantId}')::uuid;
    v_branch := (p_command #>> '{scope,branchId}')::uuid;
  exception when invalid_text_representation then return null; end;
  v_key := p_command ->> 'idempotencyKey';
  if not exists (select 1 from app_private.find_active_branch_membership(p_actor_id, v_restaurant, v_branch))
  then return pg_catalog.jsonb_build_object('status','forbidden'); end if;
  select * into v_existing from app.order_delivery_events
  where actor_id = p_actor_id and restaurant_id = v_restaurant and branch_id = v_branch and idempotency_key = v_key;
  if not found then return null; end if;
  if v_existing.operation <> 'delivery.settled' or v_existing.command_payload <> p_command
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  return pg_catalog.jsonb_build_object('status','replayed','replayed',true,
    'delivery', v_existing.result_payload -> 'delivery',
    'payment', pg_catalog.jsonb_set(v_existing.result_payload -> 'payment', '{replayed}', 'true'::jsonb, true));
end
$function$;

create function app_private.settle_delivery(
  p_actor_id uuid,
  p_command jsonb,
  p_collect jsonb,
  p_payment jsonb,
  p_order jsonb,
  p_register jsonb,
  p_order_total_minor bigint,
  p_prior_captured_amount_minor bigint
) returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_restaurant uuid; v_branch uuid; v_order uuid; v_expected bigint; v_event uuid; v_device uuid;
  v_occurred timestamptz; v_key text; v_session uuid; v_payment_id uuid; v_amount bigint;
  v_roles text[]; v_existing app.order_delivery_events%rowtype;
  v_order_row app.orders%rowtype; v_row app.order_deliveries%rowtype;
  v_intent_method text; v_collected jsonb; v_view jsonb; v_status text := 'conflict';
begin
  if p_actor_id is null or pg_catalog.jsonb_typeof(p_command) <> 'object' or pg_catalog.jsonb_typeof(p_collect) <> 'object'
    or not app_private.jsonb_has_exact_keys(p_command, array[
      'schemaVersion','scope','orderId','expectedVersion','eventId','idempotencyKey','deviceId','occurredAt',
      'orderExpectedVersion','cashRegisterSessionId','cashRegisterExpectedVersion','paymentId','localSequence',
      'tenderedAmountMinor','tipMinor'])
    or p_command -> 'schemaVersion' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_command -> 'scope') <> 'object'
    or not app_private.jsonb_has_exact_keys(p_command -> 'scope', array['restaurantId','branchId'])
    or pg_catalog.jsonb_typeof(p_command -> 'expectedVersion') <> 'number'
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  begin
    v_restaurant := (p_command #>> '{scope,restaurantId}')::uuid;
    v_branch := (p_command #>> '{scope,branchId}')::uuid;
    v_order := (p_command ->> 'orderId')::uuid;
    v_expected := (p_command ->> 'expectedVersion')::bigint;
    v_event := (p_command ->> 'eventId')::uuid;
    v_device := (p_command ->> 'deviceId')::uuid;
    v_occurred := (p_command ->> 'occurredAt')::timestamptz;
    v_session := (p_command ->> 'cashRegisterSessionId')::uuid;
    v_payment_id := (p_command ->> 'paymentId')::uuid;
    v_amount := (p_collect ->> 'amountMinor')::bigint;
  exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    return pg_catalog.jsonb_build_object('status','conflict');
  end;
  v_key := p_command ->> 'idempotencyKey';
  -- The collect command must be exactly the settlement restated: same scope, order, register, payment,
  -- identity, versions and sequence; a cash method; the full remaining balance (no partial delivery).
  if v_key is null or v_key <> pg_catalog.btrim(v_key) or pg_catalog.char_length(v_key) not between 1 and 200
    or v_key ~ '[[:cntrl:]]' or v_expected < 1 or v_amount is null
    or p_collect #>> '{scope,restaurantId}' is distinct from v_restaurant::text or p_collect #>> '{scope,branchId}' is distinct from v_branch::text
    or p_collect ->> 'orderId' is distinct from v_order::text or p_collect ->> 'cashRegisterSessionId' is distinct from v_session::text
    or p_collect ->> 'paymentId' is distinct from v_payment_id::text or p_collect ->> 'eventId' is distinct from v_event::text
    or p_collect ->> 'idempotencyKey' is distinct from v_key or p_collect ->> 'deviceId' is distinct from v_device::text
    or p_collect ->> 'occurredAt' is distinct from p_command ->> 'occurredAt'
    or p_collect -> 'localSequence' is distinct from p_command -> 'localSequence'
    or p_collect -> 'orderExpectedVersion' is distinct from p_command -> 'orderExpectedVersion'
    or p_collect -> 'cashRegisterExpectedVersion' is distinct from p_command -> 'cashRegisterExpectedVersion'
    or p_collect ->> 'method' is distinct from 'cash'
    or (p_command -> 'tenderedAmountMinor' is distinct from 'null'::jsonb
      and p_collect -> 'tenderedAmountMinor' is distinct from p_command -> 'tenderedAmountMinor')
    or (p_command -> 'tipMinor' is distinct from 'null'::jsonb
      and p_collect -> 'tipMinor' is distinct from p_command -> 'tipMinor')
    or p_order_total_minor not between 1 and 9007199254740991
    or p_prior_captured_amount_minor not between 0 and 9007199254740991
    or v_amount is distinct from p_order_total_minor - p_prior_captured_amount_minor
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  select m.roles into v_roles from app_private.find_active_branch_membership(p_actor_id, v_restaurant, v_branch) m;
  if v_roles is null or not (v_roles && array['owner','admin','manager','supervisor','cashier'])
  then return pg_catalog.jsonb_build_object('status','forbidden'); end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('order:' || v_order::text, 0));

  select * into v_existing from app.order_delivery_events
  where actor_id = p_actor_id and restaurant_id = v_restaurant and branch_id = v_branch and idempotency_key = v_key;
  if found then
    if v_existing.operation <> 'delivery.settled' or v_existing.command_payload <> p_command
      or v_existing.result_payload -> 'collect' is distinct from p_collect
      or v_existing.event_id <> v_event
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    return pg_catalog.jsonb_build_object('status','replayed','replayed',true,
      'delivery', v_existing.result_payload -> 'delivery',
      'payment', pg_catalog.jsonb_set(v_existing.result_payload -> 'payment', '{replayed}', 'true'::jsonb, true));
  end if;
  if exists (select 1 from app.order_delivery_events where event_id = v_event) then
    return pg_catalog.jsonb_build_object('status','conflict');
  end if;

  select * into v_order_row from app.orders
  where restaurant_id = v_restaurant and branch_id = v_branch and id = v_order for update;
  if not found or v_order_row.channel <> 'delivery' or v_order_row.status not in ('open','partially_paid')
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  select * into v_row from app.order_deliveries
  where restaurant_id = v_restaurant and branch_id = v_branch and order_id = v_order for update;
  if not found or v_row.version <> v_expected or v_row.state <> 'delivered'
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  -- The frozen intent decides the settlement kind: only cash (or no stated intent) settles here.
  select frozen.snapshot -> 'paymentIntent' ->> 'method' into v_intent_method
  from app.order_fulfillment_snapshots frozen
  where frozen.restaurant_id = v_restaurant and frozen.branch_id = v_branch and frozen.order_id = v_order;
  if v_intent_method is not null and v_intent_method <> 'cash'
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  begin
    v_collected := app_private.collect_simple_payment_core(
      p_actor_id, p_collect, p_payment, p_order, p_register, p_order_total_minor, p_prior_captured_amount_minor);
    if v_collected ->> 'status' in ('conflict','forbidden') then
      v_status := v_collected ->> 'status';
      raise exception using errcode = 'P5100', message = 'DELIVERY_SETTLEMENT_ATOMIC_ABORT';
    end if;
    -- A replayed collect belongs to another command; settlement always creates its own Payment and
    -- must leave the Order fully paid.
    if v_collected ->> 'paymentId' is distinct from v_payment_id::text
      or (v_collected ->> 'replayed')::boolean is distinct from false
      or v_collected ->> 'orderStatus' is distinct from 'paid'
      or (v_collected ->> 'remainingBalanceMinor')::bigint is distinct from 0
    then
      v_status := 'conflict';
      raise exception using errcode = 'P5100', message = 'DELIVERY_SETTLEMENT_ATOMIC_ABORT';
    end if;

    update app.order_deliveries set state = 'settled', settled_payment_id = v_payment_id,
      settled_at = pg_catalog.clock_timestamp(), cash_to_collect_minor = v_amount, version = version + 1,
      updated_at = pg_catalog.clock_timestamp(), updated_by = p_actor_id
    where restaurant_id = v_restaurant and branch_id = v_branch and order_id = v_order
    returning * into v_row;
    v_view := app_private.delivery_view(v_row);
    insert into app.order_delivery_events (event_id, restaurant_id, branch_id, order_id, actor_id, device_id, operation,
      idempotency_key, expected_version, result_version, from_state, to_state, command_payload, result_payload, occurred_at)
    values (v_event, v_restaurant, v_branch, v_order, p_actor_id, v_device, 'delivery.settled', v_key, v_expected,
      v_row.version, 'delivered', 'settled', p_command,
      pg_catalog.jsonb_build_object('delivery', v_view, 'payment', v_collected, 'collect', p_collect), v_occurred);
  exception when sqlstate 'P5100' then
    return pg_catalog.jsonb_build_object('status', v_status);
  end;

  return pg_catalog.jsonb_build_object('status','saved','replayed',false,'delivery',v_view,'payment',v_collected);
end
$function$;

-- 5b. /payments/collect must not strand a delivery. The existing authority becomes
-- collect_simple_payment_core (only settle_delivery and the guard call it); the public name is a guard:
--   * active delivery (assigned/en_route/delivered) + cash  => conflict DELIVERY_SETTLE_REQUIRED (settle it);
--   * active delivery + card_manual that fully pays a DELIVERED trip => collected and the delivery is marked
--     settled with a journal row in the same transaction;
--   * a card payment while the trip is still assigned/en_route is admitted and leaves the delivery row
--     untouched (known gap: a fully paid Order leaves the list, so that row is closed by a manager);
--   * everything else, including malformed input and non-members, goes straight to the core.
alter function app_private.collect_simple_payment(uuid,jsonb,jsonb,jsonb,jsonb,bigint,bigint)
  rename to collect_simple_payment_core;
revoke all on function app_private.collect_simple_payment_core(uuid,jsonb,jsonb,jsonb,jsonb,bigint,bigint)
  from public, anon, authenticated, service_role, app_api;

create function app_private.collect_simple_payment(
  p_actor_id uuid, p_command jsonb, p_payment jsonb, p_order jsonb, p_register jsonb,
  p_order_total_minor bigint, p_prior_captured_amount_minor bigint
) returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_restaurant uuid; v_branch uuid; v_order uuid; v_method text; v_device uuid; v_occurred timestamptz; v_key text;
  v_row app.order_deliveries%rowtype; v_result jsonb; v_view jsonb;
begin
  begin
    v_restaurant := (p_command #>> '{scope,restaurantId}')::uuid;
    v_branch := (p_command #>> '{scope,branchId}')::uuid;
    v_order := (p_command ->> 'orderId')::uuid;
    v_method := p_command ->> 'method';
    v_device := (p_command ->> 'deviceId')::uuid;
    v_occurred := (p_command ->> 'occurredAt')::timestamptz;
    v_key := p_command ->> 'idempotencyKey';
  exception when others then
    return app_private.collect_simple_payment_core(p_actor_id, p_command, p_payment, p_order, p_register,
      p_order_total_minor, p_prior_captured_amount_minor);
  end;
  if p_actor_id is null or v_restaurant is null or v_branch is null or v_order is null or v_key is null
    or not exists (select 1 from app_private.find_active_branch_membership(p_actor_id, v_restaurant, v_branch))
  then
    return app_private.collect_simple_payment_core(p_actor_id, p_command, p_payment, p_order, p_register,
      p_order_total_minor, p_prior_captured_amount_minor);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('order:' || v_order::text, 0));
  select * into v_row from app.order_deliveries
  where restaurant_id = v_restaurant and branch_id = v_branch and order_id = v_order for update;
  if not found or v_row.state not in ('assigned','en_route','delivered') then
    return app_private.collect_simple_payment_core(p_actor_id, p_command, p_payment, p_order, p_register,
      p_order_total_minor, p_prior_captured_amount_minor);
  end if;
  if v_method = 'cash' then
    return pg_catalog.jsonb_build_object('status','conflict','code','DELIVERY_SETTLE_REQUIRED');
  end if;
  v_result := app_private.collect_simple_payment_core(p_actor_id, p_command, p_payment, p_order, p_register,
    p_order_total_minor, p_prior_captured_amount_minor);
  if v_result ->> 'paymentId' is not null and (v_result ->> 'replayed')::boolean is false
    and v_result ->> 'orderStatus' = 'paid' and v_row.state = 'delivered'
  then
    update app.order_deliveries set state = 'settled', settled_payment_id = (v_result ->> 'paymentId')::uuid,
      settled_at = pg_catalog.clock_timestamp(), version = version + 1,
      updated_at = pg_catalog.clock_timestamp(), updated_by = p_actor_id
    where restaurant_id = v_restaurant and branch_id = v_branch and order_id = v_order
    returning * into v_row;
    v_view := app_private.delivery_view(v_row);
    insert into app.order_delivery_events (event_id, restaurant_id, branch_id, order_id, actor_id, device_id, operation,
      idempotency_key, expected_version, result_version, from_state, to_state, command_payload, result_payload, occurred_at)
    values (pg_catalog.gen_random_uuid(), v_restaurant, v_branch, v_order, p_actor_id, v_device, 'delivery.settled',
      pg_catalog.left(v_key, 190) || ':delivery', v_row.version - 1, v_row.version, 'delivered', 'settled', p_command,
      pg_catalog.jsonb_build_object('delivery', v_view, 'payment', v_result), v_occurred);
  end if;
  return v_result;
end
$function$;

-- 6. Readers (raw facts; the API projects PII and totals with domain code).
-- Visibility: managers (owner/admin/manager/supervisor/cashier) see every active delivery Order of the
-- branch; a courier-only actor sees ONLY the deliveries assigned to them (rows are filtered here, never
-- in the UI). The raw snapshot is returned for those rows so the API can give the assigned courier the
-- minimal customer projection (name, phone, full address, delivery instructions) needed to deliver;
-- every other role still needs customers.read. A courier never sees another courier's rows.
create function app_private.list_branch_deliveries(p_actor_id uuid, p_restaurant_id uuid, p_branch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_roles text[]; v_manager boolean; v_items jsonb;
begin
  if p_actor_id is null or p_restaurant_id is null or p_branch_id is null
  then return pg_catalog.jsonb_build_object('status','forbidden'); end if;
  select m.roles into v_roles from app_private.find_active_branch_membership(p_actor_id, p_restaurant_id, p_branch_id) m;
  v_manager := v_roles && array['owner','admin','manager','supervisor','cashier'];
  if v_roles is null or not (v_manager or 'courier' = any(v_roles))
  then return pg_catalog.jsonb_build_object('status','forbidden'); end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'delivery', case when d.order_id is null
        then app_private.pending_delivery_view(o.restaurant_id, o.branch_id, o.id) else app_private.delivery_view(d) end,
      'courierName', case when d.order_id is null then null else app_private.member_display_name(d.courier_user_id) end,
      'orderStatus', o.status,
      'order', o.aggregate,
      'snapshot', frozen.snapshot,
      'capturedMinor', (select coalesce(pg_catalog.sum(pay.amount_minor), 0) from app.payments pay
        where pay.restaurant_id = o.restaurant_id and pay.branch_id = o.branch_id and pay.order_id = o.id and pay.state = 'captured')
    ) order by o.created_at, o.id), '[]'::jsonb) into v_items
  from (
    select o.* from app.orders o
    left join app.order_deliveries d2 on d2.restaurant_id = o.restaurant_id and d2.branch_id = o.branch_id and d2.order_id = o.id
    where o.restaurant_id = p_restaurant_id and o.branch_id = p_branch_id and o.channel = 'delivery'
      and o.status in ('open','partially_paid')
      and (v_manager or d2.courier_user_id = p_actor_id)
    order by o.created_at, o.id
    limit 200
  ) o
  left join app.order_deliveries d on d.restaurant_id = o.restaurant_id and d.branch_id = o.branch_id and d.order_id = o.id
  left join app.order_fulfillment_snapshots frozen
    on frozen.restaurant_id = o.restaurant_id and frozen.branch_id = o.branch_id and frozen.order_id = o.id;

  return pg_catalog.jsonb_build_object('schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('restaurantId', p_restaurant_id::text, 'branchId', p_branch_id::text),
    'deliveries', v_items);
end
$function$;

-- One Order's frozen fulfillment snapshot plus its delivery (virtual `pending` for a delivery Order
-- with no row, NULL for any other channel). Any active membership may call it; the API gates by RBAC.
create function app_private.read_order_delivery_context(
  p_actor_id uuid, p_restaurant_id uuid, p_branch_id uuid, p_order_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_channel text; v_row app.order_deliveries%rowtype; v_snapshot jsonb; v_delivery jsonb;
begin
  if p_actor_id is null or p_restaurant_id is null or p_branch_id is null or p_order_id is null
    or not exists (select 1 from app_private.find_active_branch_membership(p_actor_id, p_restaurant_id, p_branch_id))
  then return pg_catalog.jsonb_build_object('status','forbidden'); end if;
  select o.channel into v_channel from app.orders o
  where o.restaurant_id = p_restaurant_id and o.branch_id = p_branch_id and o.id = p_order_id;
  if not found then return null; end if;
  select frozen.snapshot into v_snapshot from app.order_fulfillment_snapshots frozen
  where frozen.restaurant_id = p_restaurant_id and frozen.branch_id = p_branch_id and frozen.order_id = p_order_id;
  select * into v_row from app.order_deliveries d
  where d.restaurant_id = p_restaurant_id and d.branch_id = p_branch_id and d.order_id = p_order_id;
  v_delivery := case
    when found then app_private.delivery_view(v_row)
    when v_channel = 'delivery' then app_private.pending_delivery_view(p_restaurant_id, p_branch_id, p_order_id)
    else null end;
  return pg_catalog.jsonb_build_object('schemaVersion', 1, 'snapshot', v_snapshot, 'delivery', v_delivery);
end
$function$;

create function app_private.list_branch_members(
  p_actor_id uuid, p_restaurant_id uuid, p_branch_id uuid, p_roles text[]
) returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_members jsonb;
begin
  if p_actor_id is null or p_restaurant_id is null or p_branch_id is null
    or (p_roles is not null and (pg_catalog.cardinality(p_roles) not between 1 and 20
      or exists (select 1 from pg_catalog.unnest(p_roles) r where r is null or r !~ '^[a-z][a-z_]{1,31}$')))
    or not exists (select 1 from app_private.find_active_branch_membership(p_actor_id, p_restaurant_id, p_branch_id))
  then return pg_catalog.jsonb_build_object('status','forbidden'); end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'userId', x.user_id::text,
      'displayName', app_private.member_display_name(x.user_id),
      'roles', x.roles
    ) order by x.user_id), '[]'::jsonb) into v_members
  from (
    select m.user_id, pg_catalog.to_jsonb(pg_catalog.array_agg(distinct rg.role_code order by rg.role_code)) as roles
    from app.memberships m
    join app.membership_role_grants rg on rg.membership_id = m.id and rg.revoked_at is null
    join app.restaurants r on r.id = m.restaurant_id and r.disabled_at is null
    join app.branches b on b.id = m.branch_id and b.restaurant_id = m.restaurant_id and b.disabled_at is null
    where m.restaurant_id = p_restaurant_id and m.branch_id = p_branch_id and m.revoked_at is null
    group by m.user_id
    having p_roles is null or pg_catalog.bool_or(rg.role_code = any(p_roles))
    order by m.user_id
    limit 500
  ) x;

  return pg_catalog.jsonb_build_object('schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('restaurantId', p_restaurant_id::text, 'branchId', p_branch_id::text),
    'members', v_members);
end
$function$;

-- 7. Ownership and grants: only app_api executes the entry points; helpers stay private.
do $owner$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'postgres' and rolbypassrls) then
    raise exception using errcode = '55000', message = 'SECURITY_DEFINER_OWNER_REJECTED';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'app_api' and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolinherit and not rolreplication and not rolbypassrls
  ) then raise exception using errcode = '55000', message = 'APP_API_ROLE_REJECTED'; end if;
end
$owner$;

alter function app_private.reject_order_delivery_event_change() owner to postgres;
alter function app_private.collect_simple_payment(uuid,jsonb,jsonb,jsonb,jsonb,bigint,bigint) owner to postgres;
alter function app_private.delivery_view(app.order_deliveries) owner to postgres;
alter function app_private.pending_delivery_view(uuid,uuid,uuid) owner to postgres;
alter function app_private.member_display_name(uuid) owner to postgres;
alter function app_private.apply_delivery_transition(uuid,text,jsonb) owner to postgres;
alter function app_private.assign_delivery(uuid,jsonb) owner to postgres;
alter function app_private.dispatch_delivery(uuid,jsonb) owner to postgres;
alter function app_private.complete_delivery(uuid,jsonb) owner to postgres;
alter function app_private.fail_delivery(uuid,jsonb) owner to postgres;
alter function app_private.replay_delivery_settlement(uuid,jsonb) owner to postgres;
alter function app_private.settle_delivery(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,bigint,bigint) owner to postgres;
alter function app_private.list_branch_deliveries(uuid,uuid,uuid) owner to postgres;
alter function app_private.read_order_delivery_context(uuid,uuid,uuid,uuid) owner to postgres;
alter function app_private.list_branch_members(uuid,uuid,uuid,text[]) owner to postgres;

revoke all on function app_private.reject_order_delivery_event_change() from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.delivery_view(app.order_deliveries) from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.pending_delivery_view(uuid,uuid,uuid) from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.member_display_name(uuid) from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.apply_delivery_transition(uuid,text,jsonb) from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.assign_delivery(uuid,jsonb) from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.dispatch_delivery(uuid,jsonb) from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.complete_delivery(uuid,jsonb) from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.fail_delivery(uuid,jsonb) from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.replay_delivery_settlement(uuid,jsonb) from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.settle_delivery(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,bigint,bigint)
  from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.list_branch_deliveries(uuid,uuid,uuid) from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.read_order_delivery_context(uuid,uuid,uuid,uuid) from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.list_branch_members(uuid,uuid,uuid,text[]) from public, anon, authenticated, service_role, app_api;

revoke all on function app_private.collect_simple_payment(uuid,jsonb,jsonb,jsonb,jsonb,bigint,bigint)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.collect_simple_payment(uuid,jsonb,jsonb,jsonb,jsonb,bigint,bigint) to app_api;
grant execute on function app_private.assign_delivery(uuid,jsonb) to app_api;
grant execute on function app_private.dispatch_delivery(uuid,jsonb) to app_api;
grant execute on function app_private.complete_delivery(uuid,jsonb) to app_api;
grant execute on function app_private.fail_delivery(uuid,jsonb) to app_api;
grant execute on function app_private.replay_delivery_settlement(uuid,jsonb) to app_api;
grant execute on function app_private.settle_delivery(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,bigint,bigint) to app_api;
grant execute on function app_private.list_branch_deliveries(uuid,uuid,uuid) to app_api;
grant execute on function app_private.read_order_delivery_context(uuid,uuid,uuid,uuid) to app_api;
grant execute on function app_private.list_branch_members(uuid,uuid,uuid,text[]) to app_api;

comment on table app.order_deliveries is
  'Server-only dispatch state of a delivery-channel Order (assigned/en_route/delivered/failed/settled); never changes the Order state machine and holds no money other than the settled cash amount.';
comment on table app.order_delivery_events is
  'Append-only journal of delivery transitions with idempotency key, command and result; replay returns the stored result.';
comment on function app_private.settle_delivery(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,bigint,bigint) is
  'Server-only: settles a delivered Order in cash by running collect_simple_payment for the full remaining balance and marking the delivery settled in one transaction; replays by idempotency key.';

commit;
