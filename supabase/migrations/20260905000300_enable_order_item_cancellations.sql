begin;

create function app_private.actor_can_cancel_order_item(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_item_status text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from app.memberships as membership
    join app.membership_role_grants as role_grant
      on role_grant.membership_id = membership.id and role_grant.revoked_at is null
    join app.restaurants as restaurant
      on restaurant.id = membership.restaurant_id and restaurant.disabled_at is null
    join app.branches as branch
      on branch.id = membership.branch_id and branch.restaurant_id = membership.restaurant_id and branch.disabled_at is null
    where membership.user_id = p_actor_id
      and membership.restaurant_id = p_restaurant_id
      and membership.branch_id = p_branch_id
      and membership.revoked_at is null
      and (
        (p_item_status = 'pending' and role_grant.role_code in ('owner','admin','manager','supervisor','cashier','waiter'))
        or (p_item_status in ('sent','preparing','ready') and role_grant.role_code in ('owner','admin','manager','supervisor'))
      )
  )
$function$;

create function app_private.persist_order_item_cancellation(
  p_actor_id uuid,
  p_expected_version bigint,
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
  v_item_id uuid;
  v_event_id uuid;
  v_device_id uuid;
  v_occurred_at timestamptz;
  v_idempotency_key text;
  v_existing app.order_audit_events%rowtype;
  v_current app.orders%rowtype;
  v_old_item jsonb;
  v_new_item jsonb;
  v_old_status text;
  v_station_id text;
  v_cursor bigint;
  v_received_at timestamptz;
  v_kds_event jsonb;
begin
  if p_actor_id is null or p_expected_version is null or p_expected_version < 1
    or pg_catalog.jsonb_typeof(p_order) <> 'object'
    or pg_catalog.jsonb_typeof(p_audit) <> 'object'
    or p_order ->> 'schemaVersion' <> '1'
    or p_audit ->> 'schemaVersion' <> '1'
  then return pg_catalog.jsonb_build_object('status', 'conflict'); end if;

  begin
    v_restaurant_id := (p_order ->> 'restaurantId')::uuid;
    v_branch_id := (p_order ->> 'branchId')::uuid;
    v_order_id := (p_order ->> 'orderId')::uuid;
    v_item_id := (p_audit ->> 'entityId')::uuid;
    v_event_id := (p_audit ->> 'eventId')::uuid;
    v_device_id := (p_audit ->> 'deviceId')::uuid;
    v_occurred_at := (p_audit ->> 'occurredAt')::timestamptz;
  exception when invalid_text_representation or datetime_field_overflow then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end;
  v_idempotency_key := p_audit ->> 'idempotencyKey';

  if p_audit ->> 'actorId' <> p_actor_id::text
    or p_audit ->> 'restaurantId' <> v_restaurant_id::text
    or p_audit ->> 'branchId' <> v_branch_id::text
    or p_audit ->> 'orderId' <> v_order_id::text
    or p_audit ->> 'entityType' <> 'order_item'
    or p_audit ->> 'operation' <> 'order_item.state_changed'
    or p_audit ->> 'orderItemId' <> v_item_id::text
    or p_audit ->> 'to' <> 'cancelled'
    or p_audit ->> 'eventId' <> v_event_id::text
    or p_audit ->> 'deviceId' <> v_device_id::text
    or v_idempotency_key is null or v_idempotency_key <> pg_catalog.btrim(v_idempotency_key)
    or pg_catalog.char_length(v_idempotency_key) not between 1 and 200
    or v_idempotency_key ~ '[[:cntrl:]]'
    or p_audit ->> 'reason' is null
    or p_audit ->> 'reason' <> pg_catalog.btrim(p_audit ->> 'reason')
    or pg_catalog.char_length(p_audit ->> 'reason') not between 1 and 500
    or p_audit ->> 'reason' ~ '[[:cntrl:]]'
    or pg_catalog.jsonb_typeof(p_order -> 'items') <> 'array'
  then return pg_catalog.jsonb_build_object('status', 'conflict'); end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('order:' || v_order_id::text, 0));
  select * into v_existing
  from app.order_audit_events
  where actor_id = p_actor_id
    and restaurant_id = v_restaurant_id
    and branch_id = v_branch_id
    and idempotency_key = v_idempotency_key;
  if found then
    if v_existing.event_id <> v_event_id
      or v_existing.expected_order_version <> p_expected_version
      or v_existing.event_payload <> p_audit
      or v_existing.result_order <> p_order
    then return pg_catalog.jsonb_build_object('status', 'conflict'); end if;
    if not app_private.actor_can_cancel_order_item(
      p_actor_id, v_restaurant_id, v_branch_id, p_audit ->> 'from'
    ) then return pg_catalog.jsonb_build_object('status', 'forbidden'); end if;
    select pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'scope', pg_catalog.jsonb_build_object('restaurantId', v_restaurant_id::text, 'branchId', v_branch_id::text),
      'status', 'replayed',
      'order', v_existing.result_order,
      'version', v_existing.result_order_version,
      'kdsEvent', case when event.event_id is null then null else pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'scope', pg_catalog.jsonb_build_object('restaurantId', event.restaurant_id::text, 'branchId', event.branch_id::text),
        'cursor', 'v1:' || event.cursor::text,
        'eventId', event.event_id::text,
        'orderId', event.order_id::text,
        'orderItemId', event.order_item_id::text,
        'stationId', event.station_id,
        'operation', event.operation,
        'status', event.status,
        'occurredAt', pg_catalog.to_char(event.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'receivedAt', pg_catalog.to_char(event.received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) end
    ) into strict v_kds_event
    from app.order_audit_events as audit
    left join app.kds_events as event on event.event_id = audit.event_id
    where audit.event_id = v_existing.event_id;
    return v_kds_event;
  end if;
  if exists (select 1 from app.order_audit_events where event_id = v_event_id) then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end if;

  select * into v_current
  from app.orders
  where restaurant_id = v_restaurant_id and branch_id = v_branch_id and id = v_order_id
  for update;
  if not found or v_current.version <> p_expected_version
    or v_current.status not in ('draft', 'open')
    or p_order ->> 'status' <> v_current.status
    or p_order ->> 'channel' <> v_current.aggregate ->> 'channel'
    or (p_order ->> 'tableId') is distinct from (v_current.aggregate ->> 'tableId')
    or p_order ->> 'currency' <> v_current.aggregate ->> 'currency'
    or p_order ->> 'timeZone' <> v_current.aggregate ->> 'timeZone'
    or (p_order - 'items') <> (v_current.aggregate - 'items')
    or pg_catalog.jsonb_array_length(p_order -> 'items') <> pg_catalog.jsonb_array_length(v_current.aggregate -> 'items')
  then return pg_catalog.jsonb_build_object('status', 'conflict'); end if;

  select value into v_old_item
  from pg_catalog.jsonb_array_elements(v_current.aggregate -> 'items') as item(value)
  where value ->> 'orderItemId' = v_item_id::text;
  select value into v_new_item
  from pg_catalog.jsonb_array_elements(p_order -> 'items') as item(value)
  where value ->> 'orderItemId' = v_item_id::text;
  v_old_status := v_old_item ->> 'status';
  if v_old_item is null or v_new_item is null
    or v_old_status not in ('pending', 'sent', 'preparing', 'ready')
    or p_audit ->> 'from' <> v_old_status
    or v_new_item ->> 'status' <> 'cancelled'
    or pg_catalog.jsonb_typeof(v_new_item -> 'cancellationAudit') <> 'object'
    or (v_old_item - 'status') <> (v_new_item - 'status' - 'cancellationAudit')
    or (select pg_catalog.jsonb_agg(value order by value ->> 'orderItemId')
        from pg_catalog.jsonb_array_elements(v_current.aggregate -> 'items') as item(value)
        where value ->> 'orderItemId' <> v_item_id::text)
      is distinct from
      (select pg_catalog.jsonb_agg(value order by value ->> 'orderItemId')
        from pg_catalog.jsonb_array_elements(p_order -> 'items') as item(value)
        where value ->> 'orderItemId' <> v_item_id::text)
    or v_new_item -> 'cancellationAudit' ->> 'eventId' <> v_event_id::text
    or v_new_item -> 'cancellationAudit' ->> 'idempotencyKey' <> v_idempotency_key
    or v_new_item -> 'cancellationAudit' ->> 'from' <> v_old_status
    or v_new_item -> 'cancellationAudit' ->> 'actorId' <> p_actor_id::text
    or v_new_item -> 'cancellationAudit' ->> 'branchId' <> v_branch_id::text
    or v_new_item -> 'cancellationAudit' ->> 'deviceId' <> v_device_id::text
    or v_new_item -> 'cancellationAudit' ->> 'occurredAt' <> p_audit ->> 'occurredAt'
    or v_new_item -> 'cancellationAudit' ->> 'reason' <> p_audit ->> 'reason'
  then return pg_catalog.jsonb_build_object('status', 'conflict'); end if;

  if not app_private.actor_can_cancel_order_item(p_actor_id, v_restaurant_id, v_branch_id, v_old_status) then
    return pg_catalog.jsonb_build_object('status', 'forbidden');
  end if;
  if v_old_status = 'pending' then
    if p_audit ? 'authorization' or v_new_item -> 'cancellationAudit' ? 'authorization'
    then return pg_catalog.jsonb_build_object('status', 'conflict'); end if;
  elsif pg_catalog.jsonb_typeof(p_audit -> 'authorization') <> 'object'
    or p_audit -> 'authorization' ->> 'approved' <> 'true'
    or p_audit -> 'authorization' ->> 'actorId' <> p_actor_id::text
    or v_new_item -> 'cancellationAudit' -> 'authorization' <> p_audit -> 'authorization'
  then return pg_catalog.jsonb_build_object('status', 'conflict'); end if;

  update app.orders
  set aggregate = p_order, version = version + 1,
    updated_at = pg_catalog.clock_timestamp(), updated_by = p_actor_id
  where restaurant_id = v_restaurant_id and branch_id = v_branch_id
    and id = v_order_id and version = p_expected_version
  returning * into strict v_current;

  insert into app.order_audit_events(
    event_id, idempotency_key, restaurant_id, branch_id, order_id, actor_id, device_id,
    operation, entity_type, entity_id, expected_order_version, result_order_version,
    event_payload, result_order, occurred_at
  ) values (
    v_event_id, v_idempotency_key, v_restaurant_id, v_branch_id, v_order_id, p_actor_id, v_device_id,
    'order_item.state_changed', 'order_item', v_item_id, p_expected_version, v_current.version,
    p_audit, p_order, v_occurred_at
  ) returning received_at into v_received_at;

  v_station_id := v_new_item -> 'snapshot' ->> 'stationId';
  if v_station_id is null or v_station_id <> pg_catalog.btrim(v_station_id)
    or pg_catalog.char_length(v_station_id) not between 1 and 64 or v_station_id ~ '[[:cntrl:]]'
  then raise exception 'KDS_EVENT_INVALID'; end if;
  insert into app_private.kds_branch_cursors(restaurant_id, branch_id, last_cursor)
    values(v_restaurant_id, v_branch_id, 0) on conflict do nothing;
  update app_private.kds_branch_cursors set last_cursor = last_cursor + 1
    where restaurant_id = v_restaurant_id and branch_id = v_branch_id
    returning last_cursor into strict v_cursor;
  insert into app.kds_events(
    event_id, restaurant_id, branch_id, cursor, order_id, order_item_id, station_id,
    operation, status, occurred_at, received_at
  ) values (
    v_event_id, v_restaurant_id, v_branch_id, v_cursor, v_order_id, v_item_id, v_station_id,
    'order_item.status_changed', 'cancelled', v_occurred_at, v_received_at
  );
  v_kds_event := pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('restaurantId', v_restaurant_id::text, 'branchId', v_branch_id::text),
    'cursor', 'v1:' || v_cursor::text,
    'eventId', v_event_id::text,
    'orderId', v_order_id::text,
    'orderItemId', v_item_id::text,
    'stationId', v_station_id,
    'operation', 'order_item.status_changed',
    'status', 'cancelled',
    'occurredAt', pg_catalog.to_char(v_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'receivedAt', pg_catalog.to_char(v_received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  return pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('restaurantId', v_restaurant_id::text, 'branchId', v_branch_id::text),
    'status', 'saved', 'order', p_order, 'version', v_current.version, 'kdsEvent', v_kds_event
  );
end
$function$;

do $security$
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
$security$;

alter function app_private.actor_can_cancel_order_item(uuid,uuid,uuid,text) owner to postgres;
alter function app_private.persist_order_item_cancellation(uuid,bigint,jsonb,jsonb) owner to postgres;
revoke all on function app_private.actor_can_cancel_order_item(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.persist_order_item_cancellation(uuid,bigint,jsonb,jsonb)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.persist_order_item_cancellation(uuid,bigint,jsonb,jsonb) to app_api;

comment on function app_private.persist_order_item_cancellation(uuid,bigint,jsonb,jsonb) is
  'Atomically cancels one eligible OrderItem with server-verified scoped authorization, immutable audit and durable KDS notification.';
comment on function app_private.actor_can_cancel_order_item(uuid,uuid,uuid,text) is
  'Private exact RBAC predicate used only by the cancellation persistence authority.';

commit;
