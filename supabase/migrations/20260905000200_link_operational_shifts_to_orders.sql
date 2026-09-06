begin;

create table app.order_operational_shifts (
  restaurant_id uuid not null,
  branch_id uuid not null,
  order_id uuid not null,
  shift_id uuid not null,
  linked_at timestamptz not null default pg_catalog.clock_timestamp(),
  linked_by uuid not null references auth.users (id) on delete restrict,
  constraint order_operational_shifts_pk primary key (restaurant_id, branch_id, order_id),
  constraint order_operational_shifts_order_fk foreign key (restaurant_id, branch_id, order_id)
    references app.orders (restaurant_id, branch_id, id) on delete restrict,
  constraint order_operational_shifts_shift_fk foreign key (restaurant_id, branch_id, shift_id)
    references app.operational_shifts (restaurant_id, branch_id, id) on delete restrict
);

create index order_operational_shifts_shift_idx
  on app.order_operational_shifts (restaurant_id, branch_id, shift_id, order_id);

create function app_private.create_operational_order(
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
    and shift.opened_at <= v_occurred_at
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

create function app_private.list_active_table_orders(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_table_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  has_membership boolean;
  result jsonb;
begin
  if p_actor_id is null or p_restaurant_id is null or p_branch_id is null or p_table_id is null then
    return null;
  end if;

  select exists (
    select 1
    from app_private.find_active_branch_membership(p_actor_id, p_restaurant_id, p_branch_id)
  ) into has_membership;
  if not has_membership then return null; end if;

  if not exists (
    select 1
    from app.dining_tables as dining_table
    where dining_table.restaurant_id = p_restaurant_id
      and dining_table.branch_id = p_branch_id
      and dining_table.id = p_table_id
  ) then
    return null;
  end if;

  if (
    select pg_catalog.count(*)
    from (
      select 1
      from app.orders as orders
      where orders.restaurant_id = p_restaurant_id
        and orders.branch_id = p_branch_id
        and orders.table_id = p_table_id
        and orders.status in ('draft', 'open', 'partially_paid')
      limit 101
    ) as bounded_orders
  ) > 100 then
    return '{"status":"limit_exceeded"}'::jsonb;
  end if;

  if exists (
    select 1
    from app.orders as orders
    where orders.restaurant_id = p_restaurant_id
      and orders.branch_id = p_branch_id
      and orders.table_id = p_table_id
      and orders.status in ('draft', 'open', 'partially_paid')
      and (
        pg_catalog.jsonb_array_length(orders.aggregate -> 'items') > 100
        or exists (
          select 1
          from pg_catalog.jsonb_array_elements(orders.aggregate -> 'items') as item(value)
          where pg_catalog.jsonb_array_length(item.value -> 'snapshot' -> 'modifiers') > 5000
        )
      )
  ) then
    return '{"status":"limit_exceeded"}'::jsonb;
  end if;

  select pg_catalog.jsonb_build_object(
    'schemaVersion', 2,
    'scope', pg_catalog.jsonb_build_object('restaurantId', p_restaurant_id, 'branchId', p_branch_id),
    'tableId', p_table_id,
    'orders', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'orderId', active_order.id,
      'tableId', active_order.table_id,
      'shiftId', active_order.shift_id,
      'status', active_order.status,
      'version', active_order.version,
      'itemCount', active_order.item_count,
      'currency', active_order.currency,
      'items', active_order.items,
      'updatedAt', pg_catalog.to_char(active_order.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) order by active_order.updated_at desc, active_order.id), '[]'::jsonb)
  ) into result
  from (
    select orders.id, orders.table_id, link.shift_id, orders.status, orders.version,
      pg_catalog.jsonb_array_length(orders.aggregate -> 'items') as item_count,
      orders.aggregate ->> 'currency' as currency,
      coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'orderItemId', item.value ->> 'orderItemId',
          'productId', item.value -> 'snapshot' ->> 'productId',
          'productName', item.value -> 'snapshot' ->> 'name',
          'quantity', item.value -> 'quantity',
          'status', item.value ->> 'status',
          'unit', item.value -> 'snapshot' ->> 'unit',
          'unitPrice', item.value -> 'snapshot' -> 'unitPrice',
          'modifiers', coalesce((
            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
              'groupId', modifier.value -> 'groupId',
              'groupName', modifier.value -> 'groupName',
              'optionId', modifier.value ->> 'modifierId',
              'optionName', modifier.value ->> 'name',
              'quantity', modifier.value -> 'quantity',
              'unitPrice', modifier.value -> 'unitPrice'
            ) order by modifier.ordinality)
            from pg_catalog.jsonb_array_elements(item.value -> 'snapshot' -> 'modifiers')
              with ordinality as modifier(value, ordinality)
          ), '[]'::jsonb)
        ) order by item.ordinality)
        from pg_catalog.jsonb_array_elements(orders.aggregate -> 'items')
          with ordinality as item(value, ordinality)
      ), '[]'::jsonb) as items,
      orders.updated_at
    from app.orders as orders
    left join app.order_operational_shifts as link
      on link.restaurant_id = orders.restaurant_id
      and link.branch_id = orders.branch_id
      and link.order_id = orders.id
    where orders.restaurant_id = p_restaurant_id
      and orders.branch_id = p_branch_id
      and orders.table_id = p_table_id
      and orders.status in ('draft', 'open', 'partially_paid')
    order by orders.updated_at desc, orders.id
    limit 101
  ) as active_order;

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

alter function app_private.create_operational_order(uuid,uuid,jsonb,jsonb) owner to postgres;
alter function app_private.list_active_table_orders(uuid,uuid,uuid,uuid) owner to postgres;

revoke all on app.order_operational_shifts from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.create_operational_order(uuid,uuid,jsonb,jsonb)
  from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.list_active_table_orders(uuid,uuid,uuid,uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.create_operational_order(uuid,uuid,jsonb,jsonb) to app_api;
grant execute on function app_private.list_active_table_orders(uuid,uuid,uuid,uuid) to app_api;

alter table app.order_operational_shifts enable row level security;
alter table app.order_operational_shifts force row level security;

comment on table app.order_operational_shifts is
  'Immutable association between an order and the branch operational shift in which it was created.';
comment on function app_private.create_operational_order(uuid,uuid,jsonb,jsonb) is
  'Atomically validates an open operational shift, creates an order through the existing persistence authority, and links both.';
comment on function app_private.list_active_table_orders(uuid,uuid,uuid,uuid) is
  'Server-only bounded list of active orders for one exact authorized table scope.';

commit;
