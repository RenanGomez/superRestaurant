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
    or not app_private.jsonb_has_exact_keys(p_audit -> 'payload', array['from','to'])
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

  if p_waiter_user_id is not null then
    select exists (
      select 1 from app_private.find_active_branch_membership(p_waiter_user_id, p_restaurant_id, p_branch_id)
    ) into v_has_waiter_membership;
    if not v_has_waiter_membership then
      return pg_catalog.jsonb_build_object('status', 'conflict');
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('order:' || p_order_id::text, 0));

  select * into v_existing from app.order_audit_events
  where actor_id = p_actor_id and restaurant_id = p_restaurant_id and branch_id = p_branch_id
    and idempotency_key = v_idempotency_key;
  if found then
    if v_existing.event_payload <> p_audit then
      return pg_catalog.jsonb_build_object('status', 'conflict');
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'replayed', 'version', v_existing.result_order_version, 'order', v_existing.result_order
    );
  end if;

  select * into v_current from app.orders
  where restaurant_id = p_restaurant_id and branch_id = p_branch_id and id = p_order_id
  for update;
  if not found or v_current.version <> p_expected_version then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end if;

  -- `payload.to` must match the actual target (the client always knows this); `payload.from` is
  -- audit-only evidence of what the client believed at read time and is not re-validated against
  -- the current row here -- `p_expected_version` is the only concurrency gate, exactly like every
  -- other order mutation in this schema.
  if (p_audit -> 'payload' ->> 'to') is distinct from (case when p_waiter_user_id is null then null else p_waiter_user_id::text end)
  then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end if;

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
    p_audit, v_result_order, v_occurred_at
  );

  return pg_catalog.jsonb_build_object('status', 'saved', 'version', v_new_version, 'order', v_result_order);
end
$function$;

-- 2. Open an operational shift (was missing; `list_active_operational_shifts` had no writer).
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
  v_existing_same boolean;
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

  if exists (
    select 1 from app.operational_shifts
    where restaurant_id = p_restaurant_id and branch_id = p_branch_id and id = p_shift_id
  ) then
    select exists (
      select 1 from app.operational_shifts
      where restaurant_id = p_restaurant_id and branch_id = p_branch_id and id = p_shift_id
        and name = v_name and opened_by = p_actor_id and status = 'open'
    ) into v_existing_same;
    if v_existing_same then
      return pg_catalog.jsonb_build_object('status', 'replayed', 'shiftId', p_shift_id::text);
    end if;
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end if;

  if exists (
    select 1 from app.operational_shifts
    where restaurant_id = p_restaurant_id and branch_id = p_branch_id and status = 'open'
  ) then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end if;

  insert into app.operational_shifts (id, restaurant_id, branch_id, name, status, opened_at, opened_by)
  values (p_shift_id, p_restaurant_id, p_branch_id, v_name, 'open', v_occurred_at, p_actor_id);

  return pg_catalog.jsonb_build_object('status', 'saved', 'shiftId', p_shift_id::text);
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
  'Server-only: opens the single allowed open operational shift for a branch; idempotent on (actor, restaurant, branch, idempotencyKey) via the audit payload, conflicts if another shift is already open.';
comment on function app_private.list_table_board(uuid,uuid,uuid) is
  'Server-only bounded list of active (draft/open/partially_paid) table orders for one authorized branch scope, keyed by table; money is intentionally not computed here.';

commit;
