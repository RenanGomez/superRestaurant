begin;

create table app.orders (
  id uuid primary key,
  restaurant_id uuid not null,
  branch_id uuid not null,
  table_id uuid,
  channel text not null,
  status text not null,
  aggregate jsonb not null,
  version bigint not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by uuid not null references auth.users (id) on delete restrict,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_by uuid not null references auth.users (id) on delete restrict,
  constraint orders_branch_scope_fk foreign key (restaurant_id, branch_id)
    references app.branches (restaurant_id, id) on delete restrict,
  constraint orders_table_scope_fk foreign key (restaurant_id, branch_id, table_id)
    references app.dining_tables (restaurant_id, branch_id, id) on delete restrict,
  constraint orders_scope_id_unique unique (restaurant_id, branch_id, id),
  constraint orders_channel_valid check (channel in ('table','counter','takeout','delivery')),
  constraint orders_table_channel_valid check ((channel = 'table') = (table_id is not null)),
  constraint orders_status_valid check (status in ('draft','open','partially_paid','paid','closed','cancelled')),
  constraint orders_version_positive check (version > 0),
  constraint orders_aggregate_valid check (
    pg_catalog.jsonb_typeof(aggregate) = 'object'
    and aggregate ->> 'schemaVersion' = '1'
    and aggregate ->> 'orderId' = id::text
    and aggregate ->> 'restaurantId' = restaurant_id::text
    and aggregate ->> 'branchId' = branch_id::text
    and aggregate ->> 'channel' = channel
    and aggregate ->> 'status' = status
    and pg_catalog.jsonb_typeof(aggregate -> 'items') = 'array'
  )
);

create index orders_branch_status_idx on app.orders (restaurant_id, branch_id, status, updated_at, id);
create index orders_table_open_idx on app.orders (restaurant_id, branch_id, table_id, updated_at, id)
  where table_id is not null and status in ('draft','open','partially_paid');

create table app.order_audit_events (
  event_id uuid primary key,
  idempotency_key text not null,
  restaurant_id uuid not null,
  branch_id uuid not null,
  order_id uuid not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  device_id uuid not null,
  operation text not null,
  entity_type text not null,
  entity_id uuid not null,
  expected_order_version bigint not null,
  result_order_version bigint not null,
  event_payload jsonb not null,
  result_order jsonb not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint order_audit_order_scope_fk foreign key (restaurant_id, branch_id, order_id)
    references app.orders (restaurant_id, branch_id, id) on delete restrict,
  constraint order_audit_idempotency_unique unique (actor_id, restaurant_id, branch_id, idempotency_key),
  constraint order_audit_idempotency_valid check (
    idempotency_key = pg_catalog.btrim(idempotency_key)
    and pg_catalog.char_length(idempotency_key) between 1 and 200
    and idempotency_key !~ '[[:cntrl:]]'
  ),
  constraint order_audit_operation_valid check (
    operation in ('order.created','order.item_added','order.state_changed','order_item.state_changed')
  ),
  constraint order_audit_entity_valid check (
    (operation in ('order.created','order.state_changed') and entity_type = 'order' and entity_id = order_id)
    or (operation in ('order.item_added','order_item.state_changed') and entity_type = 'order_item')
  ),
  constraint order_audit_version_valid check (
    expected_order_version >= 0 and result_order_version = expected_order_version + 1
  ),
  constraint order_audit_payload_valid check (
    pg_catalog.jsonb_typeof(event_payload) = 'object'
    and event_payload ->> 'schemaVersion' = '1'
    and event_payload ->> 'eventId' = event_id::text
    and event_payload ->> 'idempotencyKey' = idempotency_key
    and event_payload ->> 'restaurantId' = restaurant_id::text
    and event_payload ->> 'branchId' = branch_id::text
    and event_payload ->> 'orderId' = order_id::text
    and event_payload ->> 'actorId' = actor_id::text
    and event_payload ->> 'deviceId' = device_id::text
    and event_payload ->> 'operation' = operation
    and event_payload ->> 'entityType' = entity_type
    and event_payload ->> 'entityId' = entity_id::text
  ),
  constraint order_audit_result_valid check (
    pg_catalog.jsonb_typeof(result_order) = 'object'
    and result_order ->> 'orderId' = order_id::text
    and result_order ->> 'restaurantId' = restaurant_id::text
    and result_order ->> 'branchId' = branch_id::text
  )
);

create index order_audit_order_idx on app.order_audit_events
  (restaurant_id, branch_id, order_id, result_order_version, received_at, event_id);

create table app_private.kds_branch_cursors (
  restaurant_id uuid not null,
  branch_id uuid not null,
  last_cursor bigint not null default 0,
  primary key (restaurant_id, branch_id),
  constraint kds_branch_cursor_scope_fk foreign key (restaurant_id, branch_id)
    references app.branches (restaurant_id, id) on delete restrict,
  constraint kds_branch_cursor_nonnegative check (last_cursor >= 0)
);

create table app.kds_events (
  event_id uuid primary key,
  restaurant_id uuid not null,
  branch_id uuid not null,
  cursor bigint not null,
  order_id uuid not null,
  order_item_id uuid not null,
  station_id text not null,
  operation text not null,
  status text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null,
  constraint kds_event_audit_fk foreign key (event_id) references app.order_audit_events (event_id) on delete restrict,
  constraint kds_event_order_scope_fk foreign key (restaurant_id, branch_id, order_id)
    references app.orders (restaurant_id, branch_id, id) on delete restrict,
  constraint kds_event_cursor_unique unique (restaurant_id, branch_id, cursor),
  constraint kds_event_station_valid check (
    station_id = pg_catalog.btrim(station_id)
    and pg_catalog.char_length(station_id) between 1 and 64
    and station_id !~ '[[:cntrl:]]'
  ),
  constraint kds_event_operation_valid check (operation in ('order_item.created','order_item.status_changed')),
  constraint kds_event_status_valid check (status in ('pending','sent','preparing','ready','delivered','cancelled')),
  constraint kds_event_cursor_positive check (cursor > 0)
);

create index kds_events_recovery_idx on app.kds_events
  (restaurant_id, branch_id, station_id, cursor);

create function app_private.read_order(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_order_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare result jsonb;
begin
  if not exists (
    select 1 from app.memberships m
    join app.membership_role_grants rg on rg.membership_id = m.id and rg.revoked_at is null
      and rg.role_code in ('owner','admin','manager','supervisor','cashier','waiter','kitchen','viewer','auditor')
    join app.restaurants r on r.id = m.restaurant_id and r.disabled_at is null
    join app.branches b on b.id = m.branch_id and b.restaurant_id = m.restaurant_id and b.disabled_at is null
    where m.user_id = p_actor_id and m.restaurant_id = p_restaurant_id and m.branch_id = p_branch_id and m.revoked_at is null
  ) then return null; end if;

  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('restaurantId', o.restaurant_id::text, 'branchId', o.branch_id::text),
    'order', o.aggregate,
    'version', o.version,
    'updatedAt', pg_catalog.to_char(o.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) into result
  from app.orders o
  where o.restaurant_id = p_restaurant_id and o.branch_id = p_branch_id and o.id = p_order_id;
  return result;
end $function$;

create function app_private.persist_order_mutation(
  p_actor_id uuid,
  p_expected_version bigint,
  p_order jsonb,
  p_audit jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_restaurant_id uuid;
  v_branch_id uuid;
  v_order_id uuid;
  v_event_id uuid;
  v_entity_id uuid;
  v_device_id uuid;
  v_operation text;
  v_entity_type text;
  v_idempotency_key text;
  v_channel text;
  v_status text;
  v_table_id uuid;
  v_occurred_at timestamptz;
  v_existing app.order_audit_events%rowtype;
  v_current app.orders%rowtype;
  v_old_item jsonb;
  v_new_item jsonb;
  v_item_id uuid;
  v_station_id text;
  v_item_status text;
  v_cursor bigint;
  v_received_at timestamptz;
  v_kds_event jsonb;
begin
  if p_actor_id is null or p_expected_version is null or p_expected_version < 0
    or pg_catalog.jsonb_typeof(p_order) <> 'object' or pg_catalog.jsonb_typeof(p_audit) <> 'object'
    or p_order ->> 'schemaVersion' <> '1' or p_audit ->> 'schemaVersion' <> '1'
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  begin
    v_restaurant_id := (p_order ->> 'restaurantId')::uuid;
    v_branch_id := (p_order ->> 'branchId')::uuid;
    v_order_id := (p_order ->> 'orderId')::uuid;
    v_event_id := (p_audit ->> 'eventId')::uuid;
    v_entity_id := (p_audit ->> 'entityId')::uuid;
    v_device_id := (p_audit ->> 'deviceId')::uuid;
    v_occurred_at := (p_audit ->> 'occurredAt')::timestamptz;
    v_table_id := case when p_order ? 'tableId' then (p_order ->> 'tableId')::uuid else null end;
  exception when invalid_text_representation or datetime_field_overflow then
    return pg_catalog.jsonb_build_object('status','conflict');
  end;
  v_operation := p_audit ->> 'operation';
  v_entity_type := p_audit ->> 'entityType';
  v_idempotency_key := p_audit ->> 'idempotencyKey';
  v_channel := p_order ->> 'channel';
  v_status := p_order ->> 'status';

  if p_audit ->> 'actorId' <> p_actor_id::text
    or p_audit ->> 'restaurantId' <> v_restaurant_id::text
    or p_audit ->> 'branchId' <> v_branch_id::text
    or p_audit ->> 'orderId' <> v_order_id::text
    or p_audit ->> 'eventId' <> v_event_id::text
    or p_audit ->> 'entityId' <> v_entity_id::text
    or p_audit ->> 'deviceId' <> v_device_id::text
    or v_idempotency_key is null or v_idempotency_key <> pg_catalog.btrim(v_idempotency_key)
    or pg_catalog.char_length(v_idempotency_key) not between 1 and 200 or v_idempotency_key ~ '[[:cntrl:]]'
    or v_channel not in ('table','counter','takeout','delivery')
    or (v_channel = 'table') <> (v_table_id is not null)
    or pg_catalog.jsonb_typeof(p_order -> 'items') <> 'array'
    or v_operation not in ('order.created','order.item_added','order.state_changed','order_item.state_changed')
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  if not exists (
    select 1 from app.memberships m
    join app.membership_role_grants rg on rg.membership_id = m.id and rg.revoked_at is null and (
      (v_operation = 'order.created' and rg.role_code in ('owner','admin','manager','supervisor','cashier','waiter'))
      or (v_operation in ('order.item_added','order.state_changed') and rg.role_code in ('owner','admin','manager','supervisor','cashier','waiter'))
      or (v_operation = 'order_item.state_changed' and p_audit ->> 'to' in ('sent','delivered') and rg.role_code in ('owner','admin','manager','supervisor','cashier','waiter'))
      or (v_operation = 'order_item.state_changed' and p_audit ->> 'to' in ('preparing','ready') and rg.role_code in ('owner','admin','manager','supervisor','kitchen'))
    )
    join app.restaurants r on r.id = m.restaurant_id and r.disabled_at is null
    join app.branches b on b.id = m.branch_id and b.restaurant_id = m.restaurant_id and b.disabled_at is null
    where m.user_id = p_actor_id and m.restaurant_id = v_restaurant_id and m.branch_id = v_branch_id and m.revoked_at is null
  ) then return pg_catalog.jsonb_build_object('status','forbidden'); end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('order:' || v_order_id::text, 0));
  select * into v_existing from app.order_audit_events
  where actor_id = p_actor_id and restaurant_id = v_restaurant_id and branch_id = v_branch_id and idempotency_key = v_idempotency_key;
  if found then
    if v_existing.event_id <> v_event_id or v_existing.expected_order_version <> p_expected_version
      or v_existing.event_payload <> p_audit or v_existing.result_order <> p_order
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    select pg_catalog.jsonb_build_object(
      'schemaVersion', 1, 'scope', pg_catalog.jsonb_build_object('restaurantId',v_restaurant_id::text,'branchId',v_branch_id::text),
      'status','replayed','order',v_existing.result_order,'version',v_existing.result_order_version,
      'kdsEvent', case when k.event_id is null then null else pg_catalog.jsonb_build_object(
        'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',k.restaurant_id::text,'branchId',k.branch_id::text),
        'cursor','v1:' || k.cursor::text,'eventId',k.event_id::text,'orderId',k.order_id::text,'orderItemId',k.order_item_id::text,
        'stationId',k.station_id,'operation',k.operation,'status',k.status,
        'occurredAt',pg_catalog.to_char(k.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'receivedAt',pg_catalog.to_char(k.received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) end
    ) into strict v_kds_event from app.order_audit_events a left join app.kds_events k on k.event_id = a.event_id
    where a.event_id = v_existing.event_id;
    return v_kds_event;
  end if;
  if exists (select 1 from app.order_audit_events where event_id = v_event_id) then
    return pg_catalog.jsonb_build_object('status','conflict');
  end if;

  if v_operation = 'order.created' then
    if p_expected_version <> 0 or v_status <> 'draft' or p_audit ->> 'entityType' <> 'order'
      or v_entity_id <> v_order_id or p_audit ->> 'to' <> 'draft'
      or pg_catalog.jsonb_array_length(p_order -> 'items') <> 0
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    insert into app.orders(id,restaurant_id,branch_id,table_id,channel,status,aggregate,version,created_by,updated_by)
      values(v_order_id,v_restaurant_id,v_branch_id,v_table_id,v_channel,v_status,p_order,1,p_actor_id,p_actor_id)
      on conflict do nothing returning * into v_current;
    if not found then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  else
    select * into v_current from app.orders
      where restaurant_id = v_restaurant_id and branch_id = v_branch_id and id = v_order_id for update;
    if not found or v_current.version <> p_expected_version then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    if p_order ->> 'channel' <> v_current.aggregate ->> 'channel'
      or (p_order ->> 'tableId') is distinct from (v_current.aggregate ->> 'tableId')
      or p_order ->> 'currency' <> v_current.aggregate ->> 'currency'
      or p_order ->> 'timeZone' <> v_current.aggregate ->> 'timeZone'
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;

    if v_operation = 'order.item_added' then
      v_item_id := v_entity_id;
      select value into v_new_item from pg_catalog.jsonb_array_elements(p_order -> 'items') value
        where value ->> 'orderItemId' = v_item_id::text;
      if p_audit ->> 'entityType' <> 'order_item' or p_audit ->> 'orderItemId' <> v_item_id::text
        or pg_catalog.jsonb_array_length(p_order -> 'items') <> pg_catalog.jsonb_array_length(v_current.aggregate -> 'items') + 1
        or not ((p_order -> 'items') @> (v_current.aggregate -> 'items'))
        or (v_current.aggregate - 'items') <> (p_order - 'items')
        or v_new_item is null or v_new_item ->> 'status' <> 'pending'
      then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    elsif v_operation = 'order_item.state_changed' then
      if p_audit ->> 'to' in ('cancelled') then return pg_catalog.jsonb_build_object('status','conflict'); end if;
      v_item_id := v_entity_id;
      select value into v_old_item from pg_catalog.jsonb_array_elements(v_current.aggregate -> 'items') value
        where value ->> 'orderItemId' = v_item_id::text;
      select value into v_new_item from pg_catalog.jsonb_array_elements(p_order -> 'items') value
        where value ->> 'orderItemId' = v_item_id::text;
      if p_audit ->> 'entityType' <> 'order_item' or p_audit ->> 'orderItemId' <> v_item_id::text
        or v_old_item is null or v_new_item is null
        or p_audit ->> 'from' <> v_old_item ->> 'status' or p_audit ->> 'to' <> v_new_item ->> 'status'
        or (v_old_item - 'status') <> (v_new_item - 'status')
        or (v_current.aggregate - 'items') <> (p_order - 'items')
        or pg_catalog.jsonb_array_length(p_order -> 'items') <> pg_catalog.jsonb_array_length(v_current.aggregate -> 'items')
        or (select pg_catalog.jsonb_agg(value order by value ->> 'orderItemId') from pg_catalog.jsonb_array_elements(v_current.aggregate -> 'items') value where value ->> 'orderItemId' <> v_item_id::text)
          is distinct from (select pg_catalog.jsonb_agg(value order by value ->> 'orderItemId') from pg_catalog.jsonb_array_elements(p_order -> 'items') value where value ->> 'orderItemId' <> v_item_id::text)
      then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    elsif v_operation = 'order.state_changed' then
      if p_audit ->> 'entityType' <> 'order' or v_entity_id <> v_order_id
        or p_audit ->> 'from' <> 'draft' or p_audit ->> 'to' <> 'open'
        or v_current.status <> 'draft' or v_status <> 'open'
        or (v_current.aggregate - 'status') <> (p_order - 'status')
      then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    else
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;

    update app.orders set status=v_status,aggregate=p_order,version=version+1,
      updated_at=pg_catalog.clock_timestamp(),updated_by=p_actor_id
    where restaurant_id=v_restaurant_id and branch_id=v_branch_id and id=v_order_id and version=p_expected_version
    returning * into v_current;
    if not found then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  end if;

  insert into app.order_audit_events(
    event_id,idempotency_key,restaurant_id,branch_id,order_id,actor_id,device_id,operation,entity_type,entity_id,
    expected_order_version,result_order_version,event_payload,result_order,occurred_at
  ) values(
    v_event_id,v_idempotency_key,v_restaurant_id,v_branch_id,v_order_id,p_actor_id,v_device_id,v_operation,v_entity_type,v_entity_id,
    p_expected_version,v_current.version,p_audit,p_order,v_occurred_at
  ) returning received_at into v_received_at;

  if v_operation in ('order.item_added','order_item.state_changed') then
    if v_new_item is null then
      select value into strict v_new_item from pg_catalog.jsonb_array_elements(p_order -> 'items') value
        where value ->> 'orderItemId' = v_entity_id::text;
    end if;
    v_station_id := v_new_item -> 'snapshot' ->> 'stationId';
    v_item_status := v_new_item ->> 'status';
    if v_station_id is null or v_station_id <> pg_catalog.btrim(v_station_id)
      or pg_catalog.char_length(v_station_id) not between 1 and 64 or v_station_id ~ '[[:cntrl:]]'
      or v_item_status not in ('pending','sent','preparing','ready','delivered','cancelled')
    then raise exception 'KDS_EVENT_INVALID'; end if;
    insert into app_private.kds_branch_cursors(restaurant_id,branch_id,last_cursor)
      values(v_restaurant_id,v_branch_id,0) on conflict do nothing;
    update app_private.kds_branch_cursors set last_cursor=last_cursor+1
      where restaurant_id=v_restaurant_id and branch_id=v_branch_id returning last_cursor into strict v_cursor;
    insert into app.kds_events(event_id,restaurant_id,branch_id,cursor,order_id,order_item_id,station_id,operation,status,occurred_at,received_at)
      values(v_event_id,v_restaurant_id,v_branch_id,v_cursor,v_order_id,v_entity_id,v_station_id,
        case when v_operation='order.item_added' then 'order_item.created' else 'order_item.status_changed' end,
        v_item_status,v_occurred_at,v_received_at);
    v_kds_event := pg_catalog.jsonb_build_object(
      'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',v_restaurant_id::text,'branchId',v_branch_id::text),
      'cursor','v1:' || v_cursor::text,'eventId',v_event_id::text,'orderId',v_order_id::text,'orderItemId',v_entity_id::text,
      'stationId',v_station_id,'operation',case when v_operation='order.item_added' then 'order_item.created' else 'order_item.status_changed' end,
      'status',v_item_status,'occurredAt',pg_catalog.to_char(v_occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'receivedAt',pg_catalog.to_char(v_received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  else
    v_kds_event := null;
  end if;

  return pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',v_restaurant_id::text,'branchId',v_branch_id::text),
    'status','saved','order',p_order,'version',v_current.version,'kdsEvent',v_kds_event);
end $function$;

create function app_private.recover_kds_events(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_station_id text,
  p_after_cursor bigint,
  p_limit integer
) returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare result jsonb;
begin
  if p_station_id is null or p_station_id <> pg_catalog.btrim(p_station_id)
    or pg_catalog.char_length(p_station_id) not between 1 and 64 or p_station_id ~ '[[:cntrl:]]'
    or p_after_cursor is null or p_after_cursor < 0 or p_limit is null or p_limit not between 1 and 200
  then return null; end if;
  if not exists (
    select 1 from app.memberships m
    join app.membership_role_grants rg on rg.membership_id=m.id and rg.revoked_at is null
      and rg.role_code in ('owner','admin','manager','supervisor','waiter','kitchen','viewer','auditor')
    join app.restaurants r on r.id=m.restaurant_id and r.disabled_at is null
    join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id and b.disabled_at is null
    where m.user_id=p_actor_id and m.restaurant_id=p_restaurant_id and m.branch_id=p_branch_id and m.revoked_at is null
  ) then return null; end if;

  with highwater as (
    select coalesce((select c.last_cursor from app_private.kds_branch_cursors c
      where c.restaurant_id=p_restaurant_id and c.branch_id=p_branch_id),0) as value
  ), candidates as (
    select e.* from app.kds_events e, highwater h
    where e.restaurant_id=p_restaurant_id and e.branch_id=p_branch_id and e.station_id=p_station_id
      and e.cursor>p_after_cursor and e.cursor<=h.value
    order by e.cursor limit p_limit+1
  ), page as (
    select * from candidates order by cursor limit p_limit
  ), metadata as (
    select greatest(h.value,p_after_cursor) as highwater, exists(select 1 from candidates offset p_limit) as has_more,
      coalesce((select max(cursor) from page),p_after_cursor) as page_cursor from highwater h
  )
  select pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',p_restaurant_id::text,'branchId',p_branch_id::text),
    'stationId',p_station_id,
    'events',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',e.restaurant_id::text,'branchId',e.branch_id::text),
      'cursor','v1:' || e.cursor::text,'eventId',e.event_id::text,'orderId',e.order_id::text,'orderItemId',e.order_item_id::text,
      'stationId',e.station_id,'operation',e.operation,'status',e.status,
      'occurredAt',pg_catalog.to_char(e.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'receivedAt',pg_catalog.to_char(e.received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by e.cursor) from page e),'[]'::jsonb),
    'nextCursor','v1:' || (case when m.has_more then m.page_cursor else m.highwater end)::text,
    'hasMore',m.has_more
  ) into result from metadata m;
  return result;
end $function$;

do $security$
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname='postgres' and rolbypassrls) then
    raise exception 'SECURITY_DEFINER_OWNER_REJECTED';
  end if;
end $security$;

alter function app_private.read_order(uuid,uuid,uuid,uuid) owner to postgres;
alter function app_private.persist_order_mutation(uuid,bigint,jsonb,jsonb) owner to postgres;
alter function app_private.recover_kds_events(uuid,uuid,uuid,text,bigint,integer) owner to postgres;

revoke all on app.orders, app.order_audit_events, app.kds_events from public,anon,authenticated,service_role,app_api;
revoke all on app_private.kds_branch_cursors from public,anon,authenticated,service_role,app_api;
revoke all on function app_private.read_order(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role,app_api;
revoke all on function app_private.persist_order_mutation(uuid,bigint,jsonb,jsonb) from public,anon,authenticated,service_role,app_api;
revoke all on function app_private.recover_kds_events(uuid,uuid,uuid,text,bigint,integer) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.read_order(uuid,uuid,uuid,uuid) to app_api;
grant execute on function app_private.persist_order_mutation(uuid,bigint,jsonb,jsonb) to app_api;
grant execute on function app_private.recover_kds_events(uuid,uuid,uuid,text,bigint,integer) to app_api;

alter table app.orders enable row level security;
alter table app.orders force row level security;
alter table app.order_audit_events enable row level security;
alter table app.order_audit_events force row level security;
alter table app.kds_events enable row level security;
alter table app.kds_events force row level security;
alter table app_private.kds_branch_cursors enable row level security;
alter table app_private.kds_branch_cursors force row level security;

comment on table app.orders is 'Authoritative Restaurant/Branch-scoped Order aggregates; writes only through NestJS and a private atomic function.';
comment on table app.order_audit_events is 'Immutable idempotent Order mutation evidence with authoritative received time and historical result.';
comment on table app.kds_events is 'Durable station-scoped KDS notification log with a monotonic cursor per Branch.';
comment on table app_private.kds_branch_cursors is 'Private Branch-local cursor allocator for durable KDS recovery.';
comment on function app_private.persist_order_mutation(uuid,bigint,jsonb,jsonb) is 'Atomically persists a validated Order mutation, audit event and optional KDS event.';
comment on function app_private.recover_kds_events(uuid,uuid,uuid,text,bigint,integer) is 'Returns an authorized station-scoped durable KDS page and opaque versioned cursor.';

commit;
