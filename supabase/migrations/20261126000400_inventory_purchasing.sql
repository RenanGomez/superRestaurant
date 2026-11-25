begin;

-- Inventory purchasing: suppliers, purchase orders and reception. Clients only read the tables under
-- RLS; app_private.inventory_create_purchase_order and app_private.inventory_receive_purchase_order
-- are the only writers. Reception appends one `receipt` ledger movement per line through the existing
-- app_private.inventory_record_movement, which keeps the ledger and derived balances authoritative.
create table app.inventory_suppliers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references app.restaurants (id) on delete restrict,
  name text not null,
  contact text,
  active boolean not null default true,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint inventory_suppliers_scope_id_unique unique (restaurant_id, id),
  constraint inventory_suppliers_name_valid check (pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 160),
  constraint inventory_suppliers_contact_valid check (
    contact is null or pg_catalog.char_length(pg_catalog.btrim(contact)) between 1 and 200
  )
);

create unique index inventory_suppliers_active_name_unique
  on app.inventory_suppliers (restaurant_id, pg_catalog.lower(name))
  where active;

create index inventory_suppliers_restaurant_active_idx
  on app.inventory_suppliers (restaurant_id, active, id);

create table app.inventory_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references app.restaurants (id) on delete restrict,
  branch_id uuid not null,
  supplier_id uuid not null,
  status text not null default 'draft',
  currency text not null,
  ordered_at timestamptz not null default pg_catalog.clock_timestamp(),
  received_at timestamptz,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint inventory_purchase_orders_branch_scope_fk foreign key (restaurant_id, branch_id)
    references app.branches (restaurant_id, id) on delete restrict,
  constraint inventory_purchase_orders_supplier_scope_fk foreign key (restaurant_id, supplier_id)
    references app.inventory_suppliers (restaurant_id, id) on delete restrict,
  constraint inventory_purchase_orders_scope_id_unique unique (restaurant_id, id),
  constraint inventory_purchase_orders_status_valid check (status in ('draft', 'sent', 'received', 'cancelled')),
  constraint inventory_purchase_orders_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint inventory_purchase_orders_received_consistency check (
    (status = 'received' and received_at is not null)
    or (status <> 'received' and received_at is null)
  )
);

create index inventory_purchase_orders_branch_status_idx
  on app.inventory_purchase_orders (branch_id, status);

-- Composite FK needs a restaurant-scoped unique key on items. The table is additive here so the
-- ledger and line writes can never cross a restaurant boundary at the schema level.
alter table app.inventory_items
  add constraint inventory_items_purchasing_scope_unique unique (restaurant_id, id);

create table app.inventory_purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  order_id uuid not null,
  item_id uuid not null,
  quantity integer not null,
  unit_code text not null,
  unit_cost_minor bigint not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint inventory_purchase_order_lines_order_scope_fk foreign key (restaurant_id, order_id)
    references app.inventory_purchase_orders (restaurant_id, id) on delete restrict,
  constraint inventory_purchase_order_lines_item_scope_fk foreign key (restaurant_id, item_id)
    references app.inventory_items (restaurant_id, id) on delete restrict,
  constraint inventory_purchase_order_lines_unique unique (order_id, item_id, unit_code),
  constraint inventory_purchase_order_lines_quantity_positive check (quantity > 0),
  constraint inventory_purchase_order_lines_unit_cost_non_negative check (unit_cost_minor >= 0),
  constraint inventory_purchase_order_lines_unit_code_valid check (unit_code in ('g', 'ml', 'piece'))
);

-- A purchase-order receipt has no cost parameter in inventory_record_movement. Enrich only the
-- movements sourced from a purchase line, before the immutable ledger row is stored.
create function app_private.inventory_apply_purchase_line_cost() returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_unit_cost_minor bigint;
  v_currency text;
begin
  if new.unit_cost_minor is null
    and new.source_type = 'purchase_order_line'
    and new.source_id is not null
  then
    select l.unit_cost_minor, o.currency into v_unit_cost_minor, v_currency
    from app.inventory_purchase_order_lines as l
    join app.inventory_purchase_orders as o
      on o.id = l.order_id
     and o.restaurant_id = l.restaurant_id
    where l.id = new.source_id
      and l.restaurant_id = new.restaurant_id
      and l.item_id = new.item_id;

    if found then
      new.unit_cost_minor := v_unit_cost_minor;
      new.currency := v_currency;
    end if;
  end if;

  return new;
end
$function$;

create trigger inventory_movements_purchase_line_cost
  before insert on app.inventory_movements
  for each row execute function app_private.inventory_apply_purchase_line_cost();

-- Payload: {"supplierId": uuid, "currency": "MXN", "orderedAt"?: timestamp,
-- "lines": [{"itemId": uuid, "quantity": int, "unitCode": "g|ml|piece", "unitCostMinor": int}]}.
create function app_private.inventory_create_purchase_order(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_order_id uuid;
  v_supplier_id uuid;
  v_currency text;
  v_ordered_at timestamptz;
  v_line jsonb;
  v_item_id uuid;
  v_item_unit text;
  v_item_deleted_at timestamptz;
  v_item_active boolean;
  v_quantity_text text;
  v_quantity integer;
  v_unit_cost_text text;
  v_unit_cost_minor bigint;
  v_unit_code text;
  v_index integer := 0;
  v_line_count integer;
begin
  if p_actor_id is null
    or p_restaurant_id is null
    or p_branch_id is null
    or p_payload is null
  then
    raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_ARGUMENT_INVALID';
  end if;

  if not exists (
    select 1
    from app.memberships as m
    join app.membership_role_grants as rg
      on rg.membership_id = m.id
     and rg.revoked_at is null
     and rg.role_code in ('owner', 'admin', 'manager')
    join app.restaurants as r
      on r.id = m.restaurant_id
     and r.disabled_at is null
    join app.branches as b
      on b.id = m.branch_id
     and b.restaurant_id = m.restaurant_id
     and b.disabled_at is null
    where m.user_id = p_actor_id
      and m.restaurant_id = p_restaurant_id
      and m.branch_id = p_branch_id
      and m.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'INVENTORY_PURCHASE_ACTOR_FORBIDDEN';
  end if;

  if pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_PAYLOAD_INVALID';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_payload) as actual(key)
    where actual.key not in ('supplierId', 'currency', 'orderedAt', 'lines')
  ) then
    raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_PAYLOAD_INVALID';
  end if;

  if not (p_payload ? 'supplierId' and p_payload ? 'currency' and p_payload ? 'lines') then
    raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_PAYLOAD_INVALID';
  end if;

  v_currency := p_payload ->> 'currency';
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_PAYLOAD_INVALID';
  end if;

  begin
    v_ordered_at := coalesce((p_payload ->> 'orderedAt')::timestamptz, pg_catalog.clock_timestamp());
  exception when others then
    raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_PAYLOAD_INVALID';
  end;

  if pg_catalog.jsonb_typeof(p_payload -> 'lines') <> 'array' then
    raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_PAYLOAD_INVALID';
  end if;

  if pg_catalog.jsonb_array_length(p_payload -> 'lines') not between 1 and 200 then
    raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_PAYLOAD_INVALID';
  end if;
  v_line_count := pg_catalog.jsonb_array_length(p_payload -> 'lines');

  if not (
    (p_payload ->> 'supplierId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ) then
    raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_SUPPLIER_SCOPE_INVALID';
  end if;
  v_supplier_id := (p_payload ->> 'supplierId')::uuid;

  if not exists (
    select 1
    from app.inventory_suppliers as s
    where s.id = v_supplier_id
      and s.restaurant_id = p_restaurant_id
      and s.active
  ) then
    raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_SUPPLIER_SCOPE_INVALID';
  end if;

  insert into app.inventory_purchase_orders (
    restaurant_id, branch_id, supplier_id, status, currency, ordered_at, created_by
  ) values (
    p_restaurant_id, p_branch_id, v_supplier_id, 'draft', v_currency, v_ordered_at, p_actor_id
  )
  returning id into v_order_id;

  for v_line in
    select e.value from pg_catalog.jsonb_array_elements(p_payload -> 'lines') as e
  loop
    v_index := v_index + 1;

    if pg_catalog.jsonb_typeof(v_line) <> 'object' then
      raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_LINE_INVALID';
    end if;

    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_line) as actual(key)
      where actual.key not in ('itemId', 'quantity', 'unitCode', 'unitCostMinor')
    )
      or not (v_line ? 'itemId' and v_line ? 'quantity' and v_line ? 'unitCode' and v_line ? 'unitCostMinor')
    then
      raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_LINE_INVALID';
    end if;

    if not (
      (v_line ->> 'itemId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    ) then
      raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_LINE_INVALID';
    end if;
    v_item_id := (v_line ->> 'itemId')::uuid;

    v_quantity_text := v_line ->> 'quantity';
    if v_quantity_text is null or v_quantity_text !~ '^[0-9]{1,9}$' then
      raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_LINE_INVALID';
    end if;
    v_quantity := v_quantity_text::integer;
    if v_quantity <= 0 then
      raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_LINE_INVALID';
    end if;

    v_unit_cost_text := v_line ->> 'unitCostMinor';
    if v_unit_cost_text is null or v_unit_cost_text !~ '^[0-9]{1,18}$' then
      raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_LINE_INVALID';
    end if;
    v_unit_cost_minor := v_unit_cost_text::bigint;

    v_unit_code := v_line ->> 'unitCode';
    if v_unit_code is null or v_unit_code not in ('g', 'ml', 'piece') then
      raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_LINE_INVALID';
    end if;

    select i.unit_code, i.deleted_at, i.active
      into v_item_unit, v_item_deleted_at, v_item_active
    from app.inventory_items as i
    where i.id = v_item_id
      and i.restaurant_id = p_restaurant_id;

    if not found then
      raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_ITEM_SCOPE_INVALID';
    end if;

    if v_item_deleted_at is not null or not v_item_active then
      raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_ITEM_INACTIVE';
    end if;

    if v_item_unit <> v_unit_code then
      raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_LINE_INVALID';
    end if;

    insert into app.inventory_purchase_order_lines (
      restaurant_id, order_id, item_id, quantity, unit_code, unit_cost_minor
    ) values (
      p_restaurant_id, v_order_id, v_item_id, v_quantity, v_unit_code, v_unit_cost_minor
    );
  end loop;

  if v_index <> v_line_count then
    raise exception using errcode = '55000', message = 'INVENTORY_PURCHASE_LINE_COUNT_MISMATCH';
  end if;

  return pg_catalog.jsonb_build_object('orderId', v_order_id, 'status', 'draft');
end
$function$;

-- Payload: {"warehouseId": uuid, "occurredAt"?: timestamp, "receivedAt"?: timestamp, "deviceId"?: uuid}.
create function app_private.inventory_receive_purchase_order(
  p_actor_id uuid,
  p_order_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_order app.inventory_purchase_orders%rowtype;
  v_line app.inventory_purchase_order_lines%rowtype;
  v_warehouse_id uuid;
  v_occurred_at timestamptz;
  v_device_id uuid;
  v_received_at timestamptz;
  v_movement jsonb;
  v_movements jsonb;
begin
  if p_actor_id is null or p_order_id is null or p_payload is null then
    raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_ARGUMENT_INVALID';
  end if;

  if pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_PAYLOAD_INVALID';
  end if;

  select * into v_order
  from app.inventory_purchase_orders as o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_ORDER_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from app.memberships as m
    join app.membership_role_grants as rg
      on rg.membership_id = m.id
     and rg.revoked_at is null
     and rg.role_code in ('owner', 'admin', 'manager')
    join app.restaurants as r
      on r.id = m.restaurant_id
     and r.disabled_at is null
    join app.branches as b
      on b.id = m.branch_id
     and b.restaurant_id = m.restaurant_id
     and b.disabled_at is null
    where m.user_id = p_actor_id
      and m.restaurant_id = v_order.restaurant_id
      and m.branch_id = v_order.branch_id
      and m.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'INVENTORY_PURCHASE_ACTOR_FORBIDDEN';
  end if;

  if v_order.status = 'cancelled' then
    raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_ORDER_CANCELLED';
  end if;

  -- Replay: an already received order never moves stock again and returns its known movements.
  if v_order.status = 'received' then
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('lineId', l.id, 'movementId', m.id)
        order by l.id, m.id
      ),
      '[]'::jsonb
    )
    into v_movements
    from app.inventory_purchase_order_lines as l
    join app.inventory_movements as m
      on m.restaurant_id = l.restaurant_id
     and m.source_type = 'purchase_order_line'
     and m.source_id = l.id
     and m.kind = 'receipt'
     and m.item_id = l.item_id
    where l.order_id = v_order.id;

    return pg_catalog.jsonb_build_object('status', 'received', 'movements', v_movements);
  end if;

  if v_order.status not in ('draft', 'sent') then
    raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_ORDER_STATUS_INVALID';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_payload) as actual(key)
    where actual.key not in ('warehouseId', 'occurredAt', 'deviceId', 'receivedAt')
  )
    or not (p_payload ? 'warehouseId')
  then
    raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_PAYLOAD_INVALID';
  end if;

  if not (
    (p_payload ->> 'warehouseId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ) then
    raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_PAYLOAD_INVALID';
  end if;
  v_warehouse_id := (p_payload ->> 'warehouseId')::uuid;

  begin
    v_occurred_at := coalesce((p_payload ->> 'occurredAt')::timestamptz, pg_catalog.clock_timestamp());
    v_received_at := coalesce((p_payload ->> 'receivedAt')::timestamptz, v_occurred_at);
    v_device_id := nullif(p_payload ->> 'deviceId', '')::uuid;
  exception when others then
    raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_PAYLOAD_INVALID';
  end;

  for v_line in
    select * from app.inventory_purchase_order_lines as l
    where l.order_id = v_order.id
    order by l.id
  loop
    v_movement := app_private.inventory_record_movement(
      p_actor_id,
      v_order.restaurant_id,
      v_order.branch_id,
      v_warehouse_id,
      v_line.item_id,
      'receipt',
      v_line.quantity,
      null,
      'receipt:' || v_order.id::text || ':' || v_line.id::text,
      'purchase_order_line',
      v_line.id,
      null,
      v_occurred_at,
      v_device_id
    );

    if (v_movement ->> 'status') not in ('recorded', 'duplicate') then
      raise exception using errcode = '55000', message = 'INVENTORY_PURCHASE_RECEIPT_FAILED';
    end if;
  end loop;

  update app.inventory_purchase_orders
  set status = 'received',
      received_at = v_received_at,
      updated_at = pg_catalog.clock_timestamp()
  where id = v_order.id;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('lineId', l.id, 'movementId', m.id)
      order by l.id, m.id
    ),
    '[]'::jsonb
  )
  into v_movements
  from app.inventory_purchase_order_lines as l
  join app.inventory_movements as m
    on m.restaurant_id = l.restaurant_id
   and m.source_type = 'purchase_order_line'
   and m.source_id = l.id
   and m.kind = 'receipt'
   and m.item_id = l.item_id
  where l.order_id = v_order.id;

  return pg_catalog.jsonb_build_object('status', 'received', 'movements', v_movements);
end
$function$;

do $owner$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'postgres' and rolbypassrls)
    or not exists (
      select 1 from pg_catalog.pg_roles
      where rolname = 'app_api'
        and not rolsuper
        and not rolcreatedb
        and not rolcreaterole
        and not rolinherit
        and not rolreplication
        and not rolbypassrls
    )
  then
    raise exception using errcode = '55000', message = 'APP_API_ROLE_REJECTED';
  end if;
end
$owner$;

alter function app_private.inventory_apply_purchase_line_cost() owner to postgres;
alter function app_private.inventory_create_purchase_order(uuid, uuid, uuid, jsonb) owner to postgres;
alter function app_private.inventory_receive_purchase_order(uuid, uuid, jsonb) owner to postgres;

revoke all on app.inventory_suppliers, app.inventory_purchase_orders, app.inventory_purchase_order_lines
  from public, anon, authenticated, service_role, app_api;
grant select on app.inventory_suppliers, app.inventory_purchase_orders, app.inventory_purchase_order_lines
  to authenticated;

revoke all on function app_private.inventory_apply_purchase_line_cost()
  from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.inventory_create_purchase_order(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.inventory_receive_purchase_order(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.inventory_create_purchase_order(uuid, uuid, uuid, jsonb) to app_api;
grant execute on function app_private.inventory_receive_purchase_order(uuid, uuid, jsonb) to app_api;

alter table app.inventory_suppliers enable row level security;
alter table app.inventory_suppliers force row level security;
alter table app.inventory_purchase_orders enable row level security;
alter table app.inventory_purchase_orders force row level security;
alter table app.inventory_purchase_order_lines enable row level security;
alter table app.inventory_purchase_order_lines force row level security;

create policy inventory_suppliers_active_member_read
  on app.inventory_suppliers
  for select
  to authenticated
  using (app_rls.has_active_restaurant_membership(restaurant_id));

create policy inventory_purchase_orders_active_branch_read
  on app.inventory_purchase_orders
  for select
  to authenticated
  using (app_rls.has_active_branch_membership(restaurant_id, branch_id));

create policy inventory_purchase_order_lines_active_branch_read
  on app.inventory_purchase_order_lines
  for select
  to authenticated
  using (exists (
    select 1
    from app.inventory_purchase_orders as o
    where o.id = inventory_purchase_order_lines.order_id
      and o.restaurant_id = inventory_purchase_order_lines.restaurant_id
      and app_rls.has_active_branch_membership(o.restaurant_id, o.branch_id)
  ));

comment on table app.inventory_suppliers is
  'Restaurant-scoped suppliers; a supplier name is unique per restaurant while active.';
comment on table app.inventory_purchase_orders is
  'Branch-scoped purchase orders with an explicit draft/sent/received/cancelled lifecycle.';
comment on table app.inventory_purchase_order_lines is
  'Integer quantities in the item base unit and integer minor-unit costs; unique per order, item and unit.';
comment on function app_private.inventory_create_purchase_order(uuid, uuid, uuid, jsonb) is
  'Server-only creation of a draft purchase order with actor/role, supplier, item, unit and integer validation.';
comment on function app_private.inventory_receive_purchase_order(uuid, uuid, jsonb) is
  'Server-only reception: one idempotent receipt movement per line, then marks the order received.';
comment on function app_private.inventory_apply_purchase_line_cost() is
  'Stamps unit_cost_minor and currency on receipt movements sourced from a purchase order line.';

commit;
