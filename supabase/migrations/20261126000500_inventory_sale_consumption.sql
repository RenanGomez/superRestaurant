begin;

-- A branch may declare one default warehouse for sale-driven consumption; the caller never picks it.
alter table app.inventory_warehouses add column is_default boolean not null default false;

create unique index inventory_warehouses_one_default_idx
  on app.inventory_warehouses (restaurant_id, branch_id)
  where is_default and active;

-- Sale-driven inventory consumption. Confirmations consume stock from the recipe of each order item,
-- cancellations emit the compensating reversal, and both are idempotent by construction: the immutable
-- ledger key is (restaurant, idempotency_key) and this table's key is (restaurant, order, item, cause).
-- The API must call the *_with_inventory wrappers (see the COMMENT ON FUNCTION below) so the movement
-- is written in the same transaction as the sale; the plain confirm/cancel functions stay untouched.
create table app.inventory_consumptions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid not null,
  order_id uuid not null,
  order_item_id uuid not null,
  cause text not null,
  warehouse_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by uuid not null references auth.users (id) on delete restrict,
  source_version integer not null,
  constraint inventory_consumptions_cause_valid check (cause in ('sale', 'cancel')),
  constraint inventory_consumptions_source_version_positive check (source_version > 0),
  constraint inventory_consumptions_order_fk foreign key (restaurant_id, branch_id, order_id)
    references app.orders (restaurant_id, branch_id, id) on delete restrict,
  constraint inventory_consumptions_warehouse_scope_fk foreign key (restaurant_id, branch_id, warehouse_id)
    references app.inventory_warehouses (restaurant_id, branch_id, id) on delete restrict,
  constraint inventory_consumptions_unique unique (restaurant_id, order_id, order_item_id, cause)
);

create index inventory_consumptions_branch_created_idx
  on app.inventory_consumptions (restaurant_id, branch_id, created_at desc, id);

-- Explodes the persisted aggregate->'items' against the active recipe of each product.
-- * quantity is the integer order-item quantity; each recipe line is per unit.
-- * geometry = 'halves' with `pizzaHalves.halves[]` consumes each half's own product recipe at
--   ceil(line_quantity / 2) per unit; legacy halves without pizzaHalves fall back to the base recipe.
-- * A product without an active recipe produces no movement and is not an error, and no `sale` row.
-- * The warehouse is the branch's active default one; a branch without a default skips consumption:
--   sales never fail because inventory was not set up yet.
-- Movements are grouped per (order item, inventory item) so the ledger source index never collides.
create function app_private.inventory_consume_order(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_order_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_order app.orders%rowtype;
  v_item jsonb;
  v_line record;
  v_order_item_id uuid;
  v_product_id uuid;
  v_quantity integer;
  v_geometry text;
  v_warehouse_id uuid;
  v_item_movements integer;
  v_movements integer := 0;
  v_base_key text;
begin
  if p_actor_id is null or p_restaurant_id is null or p_branch_id is null or p_order_id is null then
    raise exception using errcode = '22000', message = 'INVENTORY_CONSUMPTION_ARGUMENT_MISSING';
  end if;

  if not exists (
    select 1
    from app.memberships as m
    join app.membership_role_grants as rg
      on rg.membership_id = m.id
     and rg.revoked_at is null
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
    raise exception using errcode = '42501', message = 'INVENTORY_ACTOR_FORBIDDEN';
  end if;

  select * into v_order
  from app.orders as o
  where o.restaurant_id = p_restaurant_id
    and o.branch_id = p_branch_id
    and o.id = p_order_id;

  if not found then
    raise exception using errcode = '22000', message = 'INVENTORY_ORDER_SCOPE_INVALID';
  end if;

  -- One prefix for both consumption and reversal: a confirmation and its cancellation serialize.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'inventory-consumption:' || p_order_id::text, 0
  ));

  select w.id into v_warehouse_id
  from app.inventory_warehouses as w
  where w.restaurant_id = p_restaurant_id
    and w.branch_id = p_branch_id
    and w.is_default
    and w.active;

  if v_warehouse_id is null then
    return pg_catalog.jsonb_build_object(
      'status', 'skipped', 'reason', 'no_default_warehouse', 'orderId', p_order_id, 'movements', 0
    );
  end if;

  for v_item in
    select e.value from pg_catalog.jsonb_array_elements(v_order.aggregate -> 'items') as e(value)
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object' then
      continue;
    end if;

    if pg_catalog.jsonb_typeof(v_item -> 'orderItemId') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_item -> 'quantity') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_item -> 'snapshot') is distinct from 'object'
      or pg_catalog.jsonb_typeof(v_item -> 'snapshot' -> 'productId') is distinct from 'string'
    then
      raise exception using errcode = '22000', message = 'INVENTORY_ORDER_ITEM_INVALID';
    end if;

    v_order_item_id := (v_item ->> 'orderItemId')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;
    v_product_id := (v_item -> 'snapshot' ->> 'productId')::uuid;
    v_geometry := v_item -> 'snapshot' ->> 'geometry';
    v_item_movements := 0;

    if v_quantity <= 0 then
      raise exception using errcode = '22000', message = 'INVENTORY_ORDER_ITEM_QUANTITY_INVALID';
    end if;

    v_base_key := 'sale:' || p_order_id::text || ':' || v_order_item_id::text || ':';

    if v_geometry = 'halves'
      and pg_catalog.jsonb_typeof(v_item #> '{snapshot,pizzaHalves,halves}') = 'array'
    then
      -- Aggregate across both halves so two halves sharing an ingredient stay one ledger movement:
      -- the ledger source index is unique per (restaurant, order item, inventory item, kind).
      for v_line in
        select s.item_id, pg_catalog.sum(s.quantity_delta)::integer as quantity_delta
        from (
          select rl.item_id, ((rl.quantity + 1) / 2) * v_quantity as quantity_delta
          from pg_catalog.jsonb_array_elements(v_item #> '{snapshot,pizzaHalves,halves}') as h(value)
          join app.inventory_recipes as r
            on r.restaurant_id = p_restaurant_id
           and r.product_id = (h.value ->> 'productId')::uuid
           and r.modifier_id is null
           and r.active
          join app.inventory_recipe_lines as rl on rl.recipe_id = r.id
          where pg_catalog.jsonb_typeof(h.value -> 'productId') = 'string'
        ) as s
        group by s.item_id
      loop
        perform app_private.inventory_record_movement(
          p_actor_id, p_restaurant_id, p_branch_id, v_warehouse_id, v_line.item_id,
          'sale_consumption', -v_line.quantity_delta, 'sale', v_base_key || v_line.item_id::text,
          'order_item', v_order_item_id, null, pg_catalog.clock_timestamp(), null
        );
        v_item_movements := v_item_movements + 1;
        v_movements := v_movements + 1;
      end loop;
    else
      for v_line in
        select rl.item_id, rl.quantity * v_quantity as quantity_delta
        from app.inventory_recipes as r
        join app.inventory_recipe_lines as rl on rl.recipe_id = r.id
        where r.restaurant_id = p_restaurant_id
          and r.product_id = v_product_id
          and r.modifier_id is null
          and r.active
      loop
        perform app_private.inventory_record_movement(
          p_actor_id, p_restaurant_id, p_branch_id, v_warehouse_id, v_line.item_id,
          'sale_consumption', -v_line.quantity_delta, 'sale', v_base_key || v_line.item_id::text,
          'order_item', v_order_item_id, null, pg_catalog.clock_timestamp(), null
        );
        v_item_movements := v_item_movements + 1;
        v_movements := v_movements + 1;
      end loop;
    end if;

    -- Audit symmetry: a line without recipe (or without any movement) leaves no `sale` row.
    if v_item_movements > 0 then
      insert into app.inventory_consumptions (
        restaurant_id, branch_id, order_id, order_item_id, cause, warehouse_id, created_by, source_version
      ) values (
        p_restaurant_id, p_branch_id, p_order_id, v_order_item_id, 'sale', v_warehouse_id,
        p_actor_id, v_order.version
      )
      on conflict (restaurant_id, order_id, order_item_id, cause) do nothing;
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'status', 'recorded', 'orderId', p_order_id, 'movements', v_movements
  );
end
$function$;

-- Emits one sale_reversal per prior sale_consumption of the cancelled line. The warehouse is taken
-- from the previous consumption, never from the caller. A line without consumption (no recipe, or a
-- sale confirmed before inventory existed) is skipped instead of inventing a movement or a `cancel` row.
create function app_private.inventory_reverse_order_item(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_order_id uuid,
  p_order_item_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_order app.orders%rowtype;
  v_warehouse_id uuid;
  v_movement app.inventory_movements%rowtype;
  v_movements integer := 0;
begin
  if p_actor_id is null or p_restaurant_id is null or p_branch_id is null
    or p_order_id is null or p_order_item_id is null
  then
    raise exception using errcode = '22000', message = 'INVENTORY_CONSUMPTION_ARGUMENT_MISSING';
  end if;

  if not exists (
    select 1
    from app.memberships as m
    join app.membership_role_grants as rg
      on rg.membership_id = m.id
     and rg.revoked_at is null
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
    raise exception using errcode = '42501', message = 'INVENTORY_ACTOR_FORBIDDEN';
  end if;

  select * into v_order
  from app.orders as o
  where o.restaurant_id = p_restaurant_id
    and o.branch_id = p_branch_id
    and o.id = p_order_id;

  if not found then
    raise exception using errcode = '22000', message = 'INVENTORY_ORDER_SCOPE_INVALID';
  end if;

  if not exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_order.aggregate -> 'items') as i(value)
    where i.value ->> 'orderItemId' = p_order_item_id::text
  ) then
    raise exception using errcode = '22000', message = 'INVENTORY_ORDER_ITEM_SCOPE_INVALID';
  end if;

  -- Same prefix as consumption: the confirmation and its cancellation share one lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'inventory-consumption:' || p_order_id::text, 0
  ));

  select m.warehouse_id into v_warehouse_id
  from app.inventory_movements as m
  where m.restaurant_id = p_restaurant_id
    and m.source_type = 'order_item'
    and m.source_id = p_order_item_id
    and m.kind = 'sale_consumption'
    and m.idempotency_key like 'sale:' || p_order_id::text || ':' || p_order_item_id::text || ':%'
  order by m.id
  limit 1;

  if v_warehouse_id is null then
    return pg_catalog.jsonb_build_object(
      'status', 'skipped', 'reason', 'no_consumption', 'orderItemId', p_order_item_id, 'movements', 0
    );
  end if;

  for v_movement in
    select m.*
    from app.inventory_movements as m
    where m.restaurant_id = p_restaurant_id
      and m.source_type = 'order_item'
      and m.source_id = p_order_item_id
      and m.kind = 'sale_consumption'
      and m.idempotency_key like 'sale:' || p_order_id::text || ':' || p_order_item_id::text || ':%'
    order by m.id
  loop
    perform app_private.inventory_record_movement(
      p_actor_id, p_restaurant_id, p_branch_id, v_movement.warehouse_id, v_movement.item_id,
      'sale_reversal', -v_movement.quantity_delta, 'order_item_cancelled',
      'cancel:' || p_order_id::text || ':' || p_order_item_id::text || ':' || v_movement.item_id::text,
      'order_item', p_order_item_id, v_movement.id, pg_catalog.clock_timestamp(), null
    );
    v_movements := v_movements + 1;
  end loop;

  -- Audit symmetry: a `cancel` row exists only when at least one sale_reversal was written.
  if v_movements > 0 then
    insert into app.inventory_consumptions (
      restaurant_id, branch_id, order_id, order_item_id, cause, warehouse_id, created_by, source_version
    ) values (
      p_restaurant_id, p_branch_id, p_order_id, p_order_item_id, 'cancel', v_warehouse_id,
      p_actor_id, v_order.version
    )
    on conflict (restaurant_id, order_id, order_item_id, cause) do nothing;
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'recorded', 'orderItemId', p_order_item_id, 'movements', v_movements
  );
end
$function$;

-- The set of audit event IDs that a cancellation persisted: the order step (the command event) plus
-- every kitchen line step's own event. The reversal must cover lines cancelled in earlier steps too.
create function app_private.inventory_cancellation_event_ids(p_command jsonb, p_steps jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select coalesce(pg_catalog.jsonb_agg(distinct e.event_id), '[]'::jsonb)
  from (
    select p_command ->> 'eventId' as event_id
    where pg_catalog.jsonb_typeof(p_command -> 'eventId') = 'string'
    union all
    select s.value -> 'audit' ->> 'eventId'
    from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(p_steps) = 'array' then p_steps else '[]'::jsonb end
    ) as s(value)
    where pg_catalog.jsonb_typeof(s.value -> 'audit' -> 'eventId') = 'string'
  ) as e
  where e.event_id is not null
$function$;

-- Wrapper: the existing confirmation is not edited; consumption runs after an `applied` result only,
-- so a replay never double-consumes and a rejected/conflicting confirmation never touches stock. The
-- scope and order come from the authoritative result, never from the caller's p_order.
create function app_private.confirm_capture_draft_v3_with_inventory(
  p_actor_id uuid,
  p_command jsonb,
  p_order jsonb,
  p_order_audits jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_restaurant_id uuid;
  v_branch_id uuid;
  v_order_id uuid;
begin
  v_result := app_private.confirm_capture_draft_v3(p_actor_id, p_command, p_order, p_order_audits);

  if v_result ->> 'status' is distinct from 'applied' then
    return v_result;
  end if;

  begin
    v_restaurant_id := (v_result #>> '{record,detail,scope,restaurantId}')::uuid;
    v_branch_id := (v_result #>> '{record,detail,scope,branchId}')::uuid;
    v_order_id := (v_result #>> '{record,detail,confirmedOrderId}')::uuid;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '55000', message = 'INVENTORY_ORDER_REFERENCE_INVALID';
  end;

  if v_restaurant_id is null or v_branch_id is null or v_order_id is null then
    raise exception using errcode = '55000', message = 'INVENTORY_ORDER_REFERENCE_INVALID';
  end if;

  return v_result || pg_catalog.jsonb_build_object(
    'inventory', app_private.inventory_consume_order(
      p_actor_id, v_restaurant_id, v_branch_id, v_order_id
    )
  );
end
$function$;

-- Wrapper: reverses exactly the lines cancelled by this command and its kitchen steps. A replay returns
-- before reversing, and the per-movement ON CONFLICT keeps a retried call after a partial failure from
-- double-compensating.
create function app_private.cancel_order_with_inventory(
  p_actor_id uuid,
  p_command jsonb,
  p_steps jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_restaurant_id uuid;
  v_branch_id uuid;
  v_order_id uuid;
  v_event_ids jsonb;
  v_item jsonb;
  v_inventory jsonb := '[]'::jsonb;
begin
  v_result := app_private.cancel_order(p_actor_id, p_command, p_steps);

  if v_result ->> 'status' is distinct from 'saved' then
    return v_result;
  end if;

  begin
    v_restaurant_id := (p_command #>> '{scope,restaurantId}')::uuid;
    v_branch_id := (p_command #>> '{scope,branchId}')::uuid;
    v_order_id := (p_command ->> 'orderId')::uuid;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '55000', message = 'INVENTORY_ORDER_REFERENCE_INVALID';
  end;

  if v_restaurant_id is null or v_branch_id is null or v_order_id is null then
    raise exception using errcode = '55000', message = 'INVENTORY_ORDER_REFERENCE_INVALID';
  end if;

  v_event_ids := app_private.inventory_cancellation_event_ids(p_command, p_steps);

  for v_item in
    select e.value from pg_catalog.jsonb_array_elements(v_result #> '{order,items}') as e(value)
  loop
    if not (v_event_ids ? (v_item #>> '{cancellationAudit,eventId}')) then
      continue;
    end if;

    v_inventory := v_inventory || pg_catalog.jsonb_build_array(
      app_private.inventory_reverse_order_item(
        p_actor_id, v_restaurant_id, v_branch_id, v_order_id, (v_item ->> 'orderItemId')::uuid
      )
    );
  end loop;

  return v_result || pg_catalog.jsonb_build_object('inventory', v_inventory);
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

alter function app_private.inventory_consume_order(uuid, uuid, uuid, uuid) owner to postgres;
alter function app_private.inventory_reverse_order_item(uuid, uuid, uuid, uuid, uuid) owner to postgres;
alter function app_private.inventory_cancellation_event_ids(jsonb, jsonb) owner to postgres;
alter function app_private.confirm_capture_draft_v3_with_inventory(uuid, jsonb, jsonb, jsonb) owner to postgres;
alter function app_private.cancel_order_with_inventory(uuid, jsonb, jsonb) owner to postgres;

revoke all on app.inventory_consumptions from public, anon, authenticated, service_role, app_api;
grant select on app.inventory_consumptions to authenticated;

revoke all on function app_private.inventory_consume_order(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.inventory_consume_order(uuid, uuid, uuid, uuid) to app_api;

revoke all on function app_private.inventory_reverse_order_item(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.inventory_reverse_order_item(uuid, uuid, uuid, uuid, uuid) to app_api;

revoke all on function app_private.inventory_cancellation_event_ids(jsonb, jsonb)
  from public, anon, authenticated, service_role, app_api;

revoke all on function app_private.confirm_capture_draft_v3_with_inventory(uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.confirm_capture_draft_v3_with_inventory(uuid, jsonb, jsonb, jsonb) to app_api;

revoke all on function app_private.cancel_order_with_inventory(uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.cancel_order_with_inventory(uuid, jsonb, jsonb) to app_api;

alter table app.inventory_consumptions enable row level security;
alter table app.inventory_consumptions force row level security;

create policy inventory_consumptions_active_branch_read
  on app.inventory_consumptions
  for select
  to authenticated
  using (app_rls.has_active_branch_membership(restaurant_id, branch_id));

comment on column app.inventory_warehouses.is_default is
  'The single active default warehouse of a branch; sale-driven consumption writes here.';
comment on table app.inventory_consumptions is
  'One row per order item and cause (sale, cancel); the audit trail that ties order lines to ledger movements.';
comment on column app.inventory_consumptions.source_version is
  'app.orders.version observed when consumption or reversal ran, for traceability of the sale state.';
comment on column app.inventory_consumptions.warehouse_id is
  'Branch warehouse the movements were written to; a sale in a branch without a default warehouse is skipped.';
comment on function app_private.inventory_consume_order(uuid, uuid, uuid, uuid) is
  'Server-only idempotent explosion of a persisted order aggregate into sale_consumption movements on the branch default warehouse; no recipe means no movement.';
comment on function app_private.inventory_reverse_order_item(uuid, uuid, uuid, uuid, uuid) is
  'Server-only idempotent sale_reversal of every sale_consumption of one cancelled order item; the warehouse comes from the original movement.';
comment on function app_private.inventory_cancellation_event_ids(jsonb, jsonb) is
  'Server-only set of event IDs a cancellation persisted: the command event plus each kitchen line step.';
comment on function app_private.confirm_capture_draft_v3_with_inventory(uuid, jsonb, jsonb, jsonb) is
  'API entry point for confirming a capture with inventory: wraps confirm_capture_draft_v3 and consumes only when the result is applied (never on replayed). Call this instead of confirm_capture_draft_v3 whenever stock must follow the sale.';
comment on function app_private.cancel_order_with_inventory(uuid, jsonb, jsonb) is
  'API entry point for cancelling with inventory: wraps cancel_order and reverses every line cancelled by the command or its kitchen steps. Call this instead of cancel_order whenever stock must follow the cancellation.';

commit;
