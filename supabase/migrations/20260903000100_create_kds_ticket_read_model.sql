begin;

-- Active KDS ticket read model. Order aggregates remain authoritative; this
-- function only projects immutable snapshots and the current optimistic
-- version required by kitchen transitions.

create function app_private.list_kds_tickets(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_station_id text
) returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare result jsonb;
begin
  if p_station_id is null or p_station_id <> pg_catalog.btrim(p_station_id)
    or pg_catalog.char_length(p_station_id) not between 1 and 64
    or p_station_id ~ '[[:cntrl:]]'
  then return null; end if;

  if not exists (
    select 1 from app.memberships m
    join app.membership_role_grants rg on rg.membership_id = m.id
      and rg.revoked_at is null
      and rg.role_code in ('owner','admin','manager','supervisor','waiter','kitchen','viewer','auditor')
    join app.restaurants r on r.id = m.restaurant_id and r.disabled_at is null
    join app.branches b on b.id = m.branch_id
      and b.restaurant_id = m.restaurant_id and b.disabled_at is null
    where m.user_id = p_actor_id
      and m.restaurant_id = p_restaurant_id
      and m.branch_id = p_branch_id
      and m.revoked_at is null
  ) then return null; end if;

  with active as (
    select
      o.id as order_id,
      o.version as order_version,
      o.channel,
      o.table_id,
      item.value as item,
      first_event.queued_at
    from app.orders o
    cross join lateral pg_catalog.jsonb_array_elements(o.aggregate -> 'items') item(value)
    cross join lateral (
      select pg_catalog.min(e.received_at) as queued_at
      from app.kds_events e
      where e.restaurant_id = o.restaurant_id
        and e.branch_id = o.branch_id
        and e.order_id = o.id
        and e.order_item_id = (item.value ->> 'orderItemId')::uuid
        and e.station_id = p_station_id
    ) first_event
    where o.restaurant_id = p_restaurant_id
      and o.branch_id = p_branch_id
      and o.status = 'open'
      and item.value -> 'snapshot' ->> 'stationId' = p_station_id
      and item.value ->> 'status' in ('sent','preparing','ready')
      and first_event.queued_at is not null
    order by first_event.queued_at, o.id, item.value ->> 'orderItemId'
    limit 501
  ), page as (
    select * from active
    order by queued_at, order_id, item ->> 'orderItemId'
    limit 500
  )
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object(
      'restaurantId', p_restaurant_id::text,
      'branchId', p_branch_id::text
    ),
    'stationId', p_station_id,
    'tickets', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'scope', pg_catalog.jsonb_build_object(
          'restaurantId', p_restaurant_id::text,
          'branchId', p_branch_id::text
        ),
        'stationId', p_station_id,
        'orderId', p.order_id::text,
        'orderItemId', p.item ->> 'orderItemId',
        'orderVersion', p.order_version,
        'channel', p.channel,
        'tableId', case when p.table_id is null then null else pg_catalog.to_jsonb(p.table_id::text) end,
        'quantity', (p.item ->> 'quantity')::integer,
        'productName', p.item -> 'snapshot' ->> 'name',
        'modifiers', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'name', modifier.value ->> 'name',
            'quantity', (modifier.value ->> 'quantity')::integer
          ) order by modifier.ordinality)
          from pg_catalog.jsonb_array_elements(p.item -> 'snapshot' -> 'modifiers')
            with ordinality modifier(value, ordinality)
        ), '[]'::jsonb),
        'status', p.item ->> 'status',
        'queuedAt', pg_catalog.to_char(
          p.queued_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      ) order by p.queued_at, p.order_id, p.item ->> 'orderItemId')
      from page p
    ), '[]'::jsonb),
    'truncated', (select pg_catalog.count(*) > 500 from active)
  ) into result;

  return result;
end $function$;

alter function app_private.list_kds_tickets(uuid,uuid,uuid,text) owner to postgres;
revoke all on function app_private.list_kds_tickets(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.list_kds_tickets(uuid,uuid,uuid,text) to app_api;

comment on function app_private.list_kds_tickets(uuid,uuid,uuid,text) is
  'Returns authorized active KDS tickets with immutable item snapshots and current Order version.';

commit;
