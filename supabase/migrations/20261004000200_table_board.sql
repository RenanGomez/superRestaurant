begin;

-- tables-board: operational table board (status, active orders, waiter) plus the two SQL
-- authorities it depends on that did not exist yet -- opening an operational shift, and assigning
-- a waiter to an order with audit. Money/totals are deliberately NOT computed here: the API layer
-- re-reads each order through the existing `read_order` authority and reuses
-- `calculateOrderAggregateTotals` (packages/domain), exactly as `OrderService.detail` already does,
-- so there is only ever one money calculation path.

-- 1. Waiter assignment: additive column plus a widened audit operation vocabulary.
alter table app.orders add column waiter_user_id uuid references auth.users (id) on delete restrict;

alter table app.order_audit_events drop constraint order_audit_operation_valid;
alter table app.order_audit_events add constraint order_audit_operation_valid check (
  operation in (
    'order.created', 'order.item_added', 'order.state_changed', 'order_item.state_changed',
    'order.waiter_assigned'
  )
);

alter table app.order_audit_events drop constraint order_audit_entity_valid;
alter table app.order_audit_events add constraint order_audit_entity_valid check (
  (operation in ('order.created', 'order.state_changed', 'order.waiter_assigned') and entity_type = 'order' and entity_id = order_id)
  or (operation in ('order.item_added', 'order_item.state_changed') and entity_type = 'order_item')
);

create function app_private.assign_order_waiter(
  p_actor_id uuid,
  p_expected_version bigint,
  p_order_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_waiter_user_id uuid,
  p_audit jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_event_id uuid;
  v_device_id uuid;
  v_occurred_at timestamptz;
  v_idempotency_key text;
  v_existing app.order_audit_events%rowtype;
  v_current app.orders%rowtype;
  v_has_waiter_membership boolean;
  v_new_version bigint;
  v_result_order jsonb;
  v_audit_stored jsonb;
begin
  if p_actor_id is null or p_expected_version is null or p_expected_version < 0
    or p_order_id is null or p_restaurant_id is null or p_branch_id is null
    or pg_catalog.jsonb_typeof(p_audit) <> 'object'
    or not app_private.jsonb_has_exact_keys(p_audit, array[
      'schemaVersion','eventId','idempotencyKey','restaurantId','branchId','orderId',
      'actorId','deviceId','occurredAt','operation','entityType','entityId','payload'
    ])
    or p_audit ->> 'operation' <> 'order.waiter_assigned'
    or p_audit ->> 'entityType' <> 'order'
    or p_audit ->> 'entityId' <> p_order_id::text
    or p_audit ->> 'orderId' <> p_order_id::text
    or p_audit ->> 'restaurantId' <> p_restaurant_id::text
    or p_audit ->> 'branchId' <> p_branch_id::text
    or p_audit ->> 'actorId' <> p_actor_id::text
    or pg_catalog.jsonb_typeof(p_audit -> 'payload') <> 'object'
    or not app_private.jsonb_has_exact_keys(p_audit -> 'payload', array['to'])
  then return pg_catalog.jsonb_build_object('status', 'conflict'); end if;

  begin
    v_event_id := (p_audit ->> 'eventId')::uuid;
    v_device_id := (p_audit ->> 'deviceId')::uuid;
    v_occurred_at := (p_audit ->> 'occurredAt')::timestamptz;
  exception when invalid_text_representation or datetime_field_overflow then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end;
  v_idempotency_key := p_audit ->> 'idempotencyKey';
  if v_idempotency_key is null or v_idempotency_key <> pg_catalog.btrim(v_idempotency_key)
    or pg_catalog.char_length(v_idempotency_key) not between 1 and 200 or v_idempotency_key ~ '[[:cntrl:]]'
  then return pg_catalog.jsonb_build_object('status', 'conflict'); end if;

  if not exists (
    select 1 from app_private.find_active_branch_membership(p_actor_id, p_restaurant_id, p_branch_id)
  ) then
    return pg_catalog.jsonb_build_object('status', 'forbidden');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('order:' || p_order_id::text, 0));

  select * into v_existing from app.order_audit_events
  where actor_id = p_actor_id and restaurant_id = p_restaurant_id and branch_id = p_branch_id
    and idempotency_key = v_idempotency_key;
  if found then
    -- The stored payload carries the server-derived `from`; compare everything the client sent.
    if (v_existing.event_payload #- '{payload,from}') <> p_audit then
      return pg_catalog.jsonb_build_object('status', 'conflict');
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'replayed', 'version', v_existing.result_order_version, 'order', v_existing.result_order
    );
  end if;

  -- The waiter's *current* membership is validated only after the command-identity lookup above,
  -- so a byte-identical retry of an already-applied command still replays even if the waiter's
  -- membership was revoked in the meantime; a new command is always checked.
  if p_waiter_user_id is not null then
    select exists (
      select 1 from app_private.find_active_branch_membership(p_waiter_user_id, p_restaurant_id, p_branch_id)
    ) into v_has_waiter_membership;
    if not v_has_waiter_membership then
      return pg_catalog.jsonb_build_object('status', 'conflict');
    end if;
  end if;

  select * into v_current from app.orders
  where restaurant_id = p_restaurant_id and branch_id = p_branch_id and id = p_order_id
  for update;
  if not found or v_current.version <> p_expected_version
    or v_current.status not in ('draft', 'open', 'partially_paid')
  then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end if;

  -- The client sends only `payload.to` (which must equal the target). `from` is never trusted from
  -- the client: it is derived here from the row read under FOR UPDATE and written into the stored
  -- audit evidence.
  if (p_audit -> 'payload' ->> 'to') is distinct from (case when p_waiter_user_id is null then null else p_waiter_user_id::text end)
  then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end if;
  v_audit_stored := pg_catalog.jsonb_set(
    p_audit, '{payload,from}',
    case when v_current.waiter_user_id is null then 'null'::jsonb else pg_catalog.to_jsonb(v_current.waiter_user_id::text) end
  );

  v_new_version := v_current.version + 1;
  update app.orders set
    waiter_user_id = p_waiter_user_id,
    version = v_new_version,
    updated_at = pg_catalog.clock_timestamp(),
    updated_by = p_actor_id
  where restaurant_id = p_restaurant_id and branch_id = p_branch_id and id = p_order_id;

  v_result_order := pg_catalog.jsonb_build_object(
    'orderId', p_order_id::text,
    'restaurantId', p_restaurant_id::text,
    'branchId', p_branch_id::text,
    'waiterUserId', case when p_waiter_user_id is null then null else p_waiter_user_id::text end,
    'version', v_new_version
  );

  insert into app.order_audit_events (
    event_id, idempotency_key, restaurant_id, branch_id, order_id, actor_id, device_id,
    operation, entity_type, entity_id, expected_order_version, result_order_version,
    event_payload, result_order, occurred_at
  ) values (
    v_event_id, v_idempotency_key, p_restaurant_id, p_branch_id, p_order_id, p_actor_id, v_device_id,
    'order.waiter_assigned', 'order', p_order_id, p_expected_version, v_new_version,
    v_audit_stored, v_result_order, v_occurred_at
  );

  return pg_catalog.jsonb_build_object('status', 'saved', 'version', v_new_version, 'order', v_result_order);
end
$function$;

-- 2. Open an operational shift (was missing; `list_active_operational_shifts` had no writer).
-- Openings are journaled with their idempotency key so a retry replays (same payload) or is a
-- conflict (same key, different payload).
create table app.operational_shift_events (
  event_id uuid primary key,
  restaurant_id uuid not null,
  branch_id uuid not null,
  shift_id uuid not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  device_id uuid not null,
  idempotency_key text not null,
  payload jsonb not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint operational_shift_events_shift_fk foreign key (restaurant_id, branch_id, shift_id)
    references app.operational_shifts (restaurant_id, branch_id, id) on delete restrict,
  constraint operational_shift_events_idempotency_unique unique (actor_id, restaurant_id, branch_id, idempotency_key),
  constraint operational_shift_events_idempotency_valid check (
    idempotency_key = pg_catalog.btrim(idempotency_key)
    and pg_catalog.char_length(idempotency_key) between 1 and 200
    and idempotency_key !~ '[[:cntrl:]]'
  ),
  constraint operational_shift_events_payload_valid check (pg_catalog.jsonb_typeof(payload) = 'object')
);
alter table app.operational_shift_events enable row level security;
alter table app.operational_shift_events force row level security;
revoke all on app.operational_shift_events from public, anon, authenticated, service_role, app_api;

create function app_private.open_operational_shift(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_shift_id uuid,
  p_name text,
  p_audit jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_event_id uuid;
  v_device_id uuid;
  v_occurred_at timestamptz;
  v_idempotency_key text;
  v_has_membership boolean;
  v_name text;
  v_existing_event app.operational_shift_events%rowtype;
  v_payload jsonb;
begin
  if p_actor_id is null or p_restaurant_id is null or p_branch_id is null or p_shift_id is null
    or p_name is null
    or pg_catalog.jsonb_typeof(p_audit) <> 'object'
    or not app_private.jsonb_has_exact_keys(p_audit, array[
      'schemaVersion','eventId','idempotencyKey','restaurantId','branchId',
      'actorId','deviceId','occurredAt','operation','entityType','entityId'
    ])
    or p_audit ->> 'operation' <> 'operational_shift.opened'
    or p_audit ->> 'entityType' <> 'operational_shift'
    or p_audit ->> 'entityId' <> p_shift_id::text
    or p_audit ->> 'restaurantId' <> p_restaurant_id::text
    or p_audit ->> 'branchId' <> p_branch_id::text
    or p_audit ->> 'actorId' <> p_actor_id::text
  then return pg_catalog.jsonb_build_object('status', 'conflict'); end if;

  v_name := pg_catalog.btrim(p_name);
  if pg_catalog.char_length(v_name) < 1 or pg_catalog.char_length(v_name) > 80 then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end if;

  begin
    v_event_id := (p_audit ->> 'eventId')::uuid;
    v_device_id := (p_audit ->> 'deviceId')::uuid;
    v_occurred_at := (p_audit ->> 'occurredAt')::timestamptz;
  exception when invalid_text_representation or datetime_field_overflow then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end;
  v_idempotency_key := p_audit ->> 'idempotencyKey';
  if v_idempotency_key is null or v_idempotency_key <> pg_catalog.btrim(v_idempotency_key)
    or pg_catalog.char_length(v_idempotency_key) not between 1 and 200 or v_idempotency_key ~ '[[:cntrl:]]'
  then return pg_catalog.jsonb_build_object('status', 'conflict'); end if;

  select exists (
    select 1 from app_private.find_active_branch_membership(p_actor_id, p_restaurant_id, p_branch_id)
  ) into v_has_membership;
  if not v_has_membership then
    return pg_catalog.jsonb_build_object('status', 'forbidden');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('shift-open:' || p_restaurant_id::text || ':' || p_branch_id::text, 0)
  );

  v_payload := p_audit || pg_catalog.jsonb_build_object('name', v_name);
  select * into v_existing_event from app.operational_shift_events
  where actor_id = p_actor_id and restaurant_id = p_restaurant_id and branch_id = p_branch_id
    and idempotency_key = v_idempotency_key;
  if found then
    if v_existing_event.payload <> v_payload then
      return pg_catalog.jsonb_build_object('status', 'conflict');
    end if;
    return pg_catalog.jsonb_build_object('status', 'replayed', 'shiftId', v_existing_event.shift_id::text);
  end if;

  if exists (
    select 1 from app.operational_shifts
    where restaurant_id = p_restaurant_id and branch_id = p_branch_id and id = p_shift_id
  ) then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end if;

  if exists (
    select 1 from app.operational_shifts
    where restaurant_id = p_restaurant_id and branch_id = p_branch_id and status = 'open'
  ) then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end if;

  insert into app.operational_shifts (id, restaurant_id, branch_id, name, status, opened_at, opened_by)
  values (p_shift_id, p_restaurant_id, p_branch_id, v_name, 'open', pg_catalog.clock_timestamp(), p_actor_id);
  -- opened_at is the server clock: a fast device clock must never make
  -- create_operational_order's `shift.opened_at <= order occurredAt` reject real orders. The
  -- device's occurredAt is kept only in the journal below.

  insert into app.operational_shift_events (
    event_id, restaurant_id, branch_id, shift_id, actor_id, device_id, idempotency_key, payload, occurred_at
  ) values (
    v_event_id, p_restaurant_id, p_branch_id, p_shift_id, p_actor_id, v_device_id, v_idempotency_key, v_payload, v_occurred_at
  );

  return pg_catalog.jsonb_build_object('status', 'saved', 'shiftId', p_shift_id::text);
end
$function$;

-- 2b. Redefine create_operational_order (20260905000200). Shift membership is decided only by the
-- server-side state of the shift inside this transaction (`status = 'open'`, not closed); the
-- device's occurredAt stays audit data and never orders anything, so a device with a slow clock
-- can still create orders in the open shift.
create or replace function app_private.create_operational_order(
  p_actor_id uuid,
  p_shift_id uuid,
  p_order jsonb,
  p_audit jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_restaurant_id uuid;
  v_branch_id uuid;
  v_order_id uuid;
  v_event_id uuid;
  v_occurred_at timestamptz;
  v_result jsonb;
begin
  if p_actor_id is null or p_shift_id is null
    or pg_catalog.jsonb_typeof(p_order) <> 'object'
    or pg_catalog.jsonb_typeof(p_audit) <> 'object'
  then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end if;

  begin
    v_restaurant_id := (p_order ->> 'restaurantId')::uuid;
    v_branch_id := (p_order ->> 'branchId')::uuid;
    v_order_id := (p_order ->> 'orderId')::uuid;
    v_event_id := (p_audit ->> 'eventId')::uuid;
    v_occurred_at := (p_audit ->> 'occurredAt')::timestamptz;
  exception when invalid_text_representation or datetime_field_overflow then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end;

  if p_audit ->> 'operation' <> 'order.created'
    or p_audit ->> 'entityType' <> 'order'
    or p_audit ->> 'entityId' <> v_order_id::text
    or p_audit ->> 'eventId' <> v_event_id::text
    or p_audit ->> 'restaurantId' <> v_restaurant_id::text
    or p_audit ->> 'branchId' <> v_branch_id::text
  then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end if;

  perform 1
  from app.operational_shifts as shift
  where shift.restaurant_id = v_restaurant_id
    and shift.branch_id = v_branch_id
    and shift.id = p_shift_id
    and shift.status = 'open'
    and shift.closed_at is null
  for share;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end if;

  v_result := app_private.persist_order_mutation(p_actor_id, 0, p_order, p_audit);
  if v_result ->> 'status' = 'saved' then
    insert into app.order_operational_shifts (
      restaurant_id, branch_id, order_id, shift_id, linked_by
    ) values (
      v_restaurant_id, v_branch_id, v_order_id, p_shift_id, p_actor_id
    );
    return v_result;
  end if;

  if v_result ->> 'status' = 'replayed' and exists (
    select 1
    from app.order_operational_shifts as link
    where link.restaurant_id = v_restaurant_id
      and link.branch_id = v_branch_id
      and link.order_id = v_order_id
      and link.shift_id = p_shift_id
  ) then
    return v_result;
  end if;

  return pg_catalog.jsonb_build_object('status', 'conflict');
end
$function$;

-- 3. Table board read model: per-table occupancy plus the lightweight active-order identities
-- (table_id, order_id, status, version, waiterUserId, openedAt). The API attaches currency/total
-- by re-reading each order through the existing authoritative path.
create function app_private.list_table_board(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  has_membership boolean;
  result jsonb;
begin
  if p_actor_id is null or p_restaurant_id is null or p_branch_id is null then return null; end if;

  select exists (
    select 1 from app_private.find_active_branch_membership(p_actor_id, p_restaurant_id, p_branch_id)
  ) into has_membership;
  if not has_membership then return null; end if;

  -- Never truncate silently: above the cap the caller gets an explicit limit_exceeded.
  if (
    select pg_catalog.count(*) from (
      select 1 from app.orders as orders
      where orders.restaurant_id = p_restaurant_id and orders.branch_id = p_branch_id
        and orders.table_id is not null and orders.status in ('draft', 'open', 'partially_paid')
      limit 501
    ) as capped
  ) > 500 then
    return '{"status":"limit_exceeded"}'::jsonb;
  end if;

  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('restaurantId', p_restaurant_id, 'branchId', p_branch_id),
    'orders', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'tableId', bounded_order.table_id,
      'orderId', bounded_order.id,
      'status', bounded_order.status,
      'version', bounded_order.version,
      'waiterUserId', bounded_order.waiter_user_id,
      'openedAt', pg_catalog.to_char(bounded_order.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) order by bounded_order.table_id, bounded_order.created_at, bounded_order.id), '[]'::jsonb)
  ) into result
  from (
    select orders.table_id, orders.id, orders.status, orders.version, orders.waiter_user_id, orders.created_at
    from app.orders as orders
    where orders.restaurant_id = p_restaurant_id
      and orders.branch_id = p_branch_id
      and orders.table_id is not null
      and orders.status in ('draft', 'open', 'partially_paid')
    order by orders.table_id, orders.created_at, orders.id
    limit 500
  ) as bounded_order;

  return result;
end
$function$;

do $owner$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'postgres' and rolbypassrls
  ) then
    raise exception using errcode = '55000', message = 'SECURITY_DEFINER_OWNER_REJECTED';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'app_api' and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolinherit and not rolreplication and not rolbypassrls
  ) then
    raise exception using errcode = '55000', message = 'APP_API_ROLE_REJECTED';
  end if;
end
$owner$;

alter function app_private.assign_order_waiter(uuid,bigint,uuid,uuid,uuid,uuid,jsonb) owner to postgres;
alter function app_private.open_operational_shift(uuid,uuid,uuid,uuid,text,jsonb) owner to postgres;
alter function app_private.list_table_board(uuid,uuid,uuid) owner to postgres;

revoke all on function app_private.assign_order_waiter(uuid,bigint,uuid,uuid,uuid,uuid,jsonb)
  from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.open_operational_shift(uuid,uuid,uuid,uuid,text,jsonb)
  from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.list_table_board(uuid,uuid,uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.assign_order_waiter(uuid,bigint,uuid,uuid,uuid,uuid,jsonb) to app_api;
grant execute on function app_private.open_operational_shift(uuid,uuid,uuid,uuid,text,jsonb) to app_api;
grant execute on function app_private.list_table_board(uuid,uuid,uuid) to app_api;

comment on function app_private.assign_order_waiter(uuid,bigint,uuid,uuid,uuid,uuid,jsonb) is
  'Server-only: assigns or clears an order''s waiter, validating the waiter''s own active branch membership, advancing version optimistically, and auditing the change via app.order_audit_events (order.waiter_assigned).';
comment on function app_private.open_operational_shift(uuid,uuid,uuid,uuid,text,jsonb) is
  'Server-only: opens the single allowed open operational shift for a branch; journals the opening in app.operational_shift_events, replays on the same (actor, restaurant, branch, idempotencyKey) with an identical payload, conflicts on a different payload or when another shift is open.';
comment on function app_private.list_table_board(uuid,uuid,uuid) is
  'Server-only bounded list of active (draft/open/partially_paid) table orders for one authorized branch scope, keyed by table; money is intentionally not computed here.';

commit;
