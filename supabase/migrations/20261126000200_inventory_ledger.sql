begin;

-- Inventory ledger: append-only movements plus a derived, recomputable balance table. Clients never
-- write inventory directly; app_private.inventory_record_movement does the actor/scope/idempotency
-- revalidation and is the only writer of app.inventory_balances.
create table app.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid not null,
  warehouse_id uuid not null,
  item_id uuid not null references app.inventory_items (id) on delete restrict,
  kind text not null,
  quantity_delta integer not null,
  unit_code text not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  actor_id uuid not null references auth.users (id) on delete restrict,
  device_id uuid,
  reason text,
  idempotency_key text not null,
  compensates_movement_id uuid references app.inventory_movements (id) on delete restrict,
  source_type text,
  source_id uuid,
  unit_cost_minor bigint,
  currency text,
  constraint inventory_movements_warehouse_scope_fk foreign key (restaurant_id, branch_id, warehouse_id)
    references app.inventory_warehouses (restaurant_id, branch_id, id) on delete restrict,
  constraint inventory_movements_idempotency_unique unique (restaurant_id, idempotency_key),
  constraint inventory_movements_kind_valid check (kind in (
    'receipt', 'sale_consumption', 'sale_reversal', 'waste', 'adjustment',
    'transfer_out', 'transfer_in', 'count_adjustment'
  )),
  constraint inventory_movements_quantity_delta_non_zero check (quantity_delta <> 0),
  constraint inventory_movements_reason_required check (
    kind not in ('waste', 'adjustment', 'count_adjustment', 'transfer_out', 'transfer_in')
    or (reason is not null and pg_catalog.char_length(pg_catalog.btrim(reason)) >= 1)
  ),
  constraint inventory_movements_reversal_compensation_required check (
    kind <> 'sale_reversal' or compensates_movement_id is not null
  ),
  constraint inventory_movements_unit_cost_non_negative check (
    unit_cost_minor is null or unit_cost_minor >= 0
  )
);

create unique index inventory_movements_source_unique
  on app.inventory_movements (restaurant_id, source_type, source_id, kind, item_id)
  where source_id is not null;

-- One reversal per compensated movement (backstop for the advisory lock in the writer).
create unique index inventory_movements_reversal_unique
  on app.inventory_movements (compensates_movement_id)
  where kind = 'sale_reversal' and compensates_movement_id is not null;

create index inventory_movements_balance_idx
  on app.inventory_movements (warehouse_id, item_id, occurred_at, id);

create table app.inventory_balances (
  warehouse_id uuid not null references app.inventory_warehouses (id) on delete restrict,
  item_id uuid not null references app.inventory_items (id) on delete restrict,
  quantity integer not null,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (warehouse_id, item_id)
);

create function app_private.reject_inventory_movement_mutation() returns trigger
language plpgsql set search_path = '' as $function$
begin
  raise exception using errcode = '42501', message = 'INVENTORY_MOVEMENT_IMMUTABLE';
end
$function$;

create trigger inventory_movements_immutable
  before update or delete on app.inventory_movements
  for each row execute function app_private.reject_inventory_movement_mutation();

create function app_private.inventory_record_movement(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_item_id uuid,
  p_kind text,
  p_quantity_delta integer,
  p_reason text,
  p_idempotency_key text,
  p_source_type text,
  p_source_id uuid,
  p_compensates_movement_id uuid,
  p_occurred_at timestamptz,
  p_device_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_unit_code text;
  v_movement_id uuid;
  v_existing app.inventory_movements%rowtype;
  v_compensated app.inventory_movements%rowtype;
  v_balance integer;
  v_warehouse_active boolean;
  v_item_deleted_at timestamptz;
begin
  if p_actor_id is null
    or p_restaurant_id is null
    or p_branch_id is null
    or p_warehouse_id is null
    or p_item_id is null
    or p_kind is null
    or p_quantity_delta is null
    or p_idempotency_key is null
    or p_occurred_at is null
  then
    raise exception using errcode = '22000', message = 'INVENTORY_MOVEMENT_ARGUMENT_MISSING';
  end if;

  if p_kind not in (
    'receipt', 'sale_consumption', 'sale_reversal', 'waste', 'adjustment',
    'transfer_out', 'transfer_in', 'count_adjustment'
  ) then
    raise exception using errcode = '22000', message = 'INVENTORY_MOVEMENT_KIND_INVALID';
  end if;

  if p_quantity_delta = 0 then
    raise exception using errcode = '22000', message = 'INVENTORY_MOVEMENT_QUANTITY_ZERO';
  end if;

  if p_idempotency_key <> pg_catalog.btrim(p_idempotency_key)
    or pg_catalog.char_length(p_idempotency_key) not between 1 and 200
    or p_idempotency_key ~ '[[:cntrl:]]'
  then
    raise exception using errcode = '22000', message = 'INVENTORY_MOVEMENT_IDEMPOTENCY_KEY_INVALID';
  end if;

  if p_kind in ('waste', 'adjustment', 'count_adjustment', 'transfer_out', 'transfer_in')
    and (p_reason is null or pg_catalog.char_length(pg_catalog.btrim(p_reason)) = 0)
  then
    raise exception using errcode = '22000', message = 'INVENTORY_MOVEMENT_REASON_REQUIRED';
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

  select w.active into v_warehouse_active
  from app.inventory_warehouses as w
  where w.id = p_warehouse_id
    and w.restaurant_id = p_restaurant_id
    and w.branch_id = p_branch_id;

  if not found then
    raise exception using errcode = '22000', message = 'INVENTORY_WAREHOUSE_SCOPE_INVALID';
  end if;

  if not v_warehouse_active then
    raise exception using errcode = '22000', message = 'INVENTORY_WAREHOUSE_INACTIVE';
  end if;

  select i.unit_code, i.deleted_at into v_unit_code, v_item_deleted_at
  from app.inventory_items as i
  where i.id = p_item_id
    and i.restaurant_id = p_restaurant_id;

  if not found then
    raise exception using errcode = '22000', message = 'INVENTORY_ITEM_SCOPE_INVALID';
  end if;

  if v_item_deleted_at is not null then
    raise exception using errcode = '22000', message = 'INVENTORY_ITEM_INACTIVE';
  end if;

  if p_kind = 'sale_reversal' then
    if p_compensates_movement_id is null then
      raise exception using errcode = '22000', message = 'INVENTORY_REVERSAL_INVALID';
    end if;

    -- Serialize concurrent reversals of the same consumption: the exists() check below is
    -- TOCTOU under READ COMMITTED without this transaction-scoped advisory lock.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_compensates_movement_id::text, 0));

    select m.* into v_compensated
    from app.inventory_movements as m
    where m.id = p_compensates_movement_id
      and m.restaurant_id = p_restaurant_id
      and m.branch_id = p_branch_id
      and m.warehouse_id = p_warehouse_id
      and m.item_id = p_item_id
      and m.kind = 'sale_consumption';

    if not found then
      raise exception using errcode = '22000', message = 'INVENTORY_REVERSAL_INVALID';
    end if;

    if p_quantity_delta <> -v_compensated.quantity_delta then
      raise exception using errcode = '22000', message = 'INVENTORY_REVERSAL_INVALID';
    end if;

    if exists (
      select 1
      from app.inventory_movements as x
      where x.compensates_movement_id = p_compensates_movement_id
        and x.kind = 'sale_reversal'
        and x.idempotency_key <> p_idempotency_key
    ) then
      raise exception using errcode = '22000', message = 'INVENTORY_REVERSAL_INVALID';
    end if;
  end if;

  insert into app.inventory_movements (
    restaurant_id, branch_id, warehouse_id, item_id, kind, quantity_delta, unit_code,
    occurred_at, actor_id, device_id, reason, idempotency_key, compensates_movement_id,
    source_type, source_id
  ) values (
    p_restaurant_id, p_branch_id, p_warehouse_id, p_item_id, p_kind, p_quantity_delta, v_unit_code,
    p_occurred_at, p_actor_id, p_device_id, p_reason, p_idempotency_key, p_compensates_movement_id,
    p_source_type, p_source_id
  )
  on conflict (restaurant_id, idempotency_key) do nothing
  returning id into v_movement_id;

  if v_movement_id is null then
    select m.* into v_existing
    from app.inventory_movements as m
    where m.restaurant_id = p_restaurant_id
      and m.idempotency_key = p_idempotency_key;

    if not found then
      raise exception using errcode = '55000', message = 'INVENTORY_IDEMPOTENCY_RECORD_MISSING';
    end if;

    if v_existing.kind <> p_kind
      or v_existing.restaurant_id <> p_restaurant_id
      or v_existing.branch_id <> p_branch_id
      or v_existing.warehouse_id <> p_warehouse_id
      or v_existing.item_id <> p_item_id
      or v_existing.quantity_delta <> p_quantity_delta
      or v_existing.reason is distinct from p_reason
      or v_existing.source_type is distinct from p_source_type
      or v_existing.source_id is distinct from p_source_id
      or v_existing.compensates_movement_id is distinct from p_compensates_movement_id
    then
      raise exception using errcode = '22000', message = 'INVENTORY_IDEMPOTENCY_CONFLICT';
    end if;

    return pg_catalog.jsonb_build_object(
      'status', 'duplicate',
      'movementId', v_existing.id
    );
  end if;

  insert into app.inventory_balances as b (warehouse_id, item_id, quantity, updated_at)
  values (p_warehouse_id, p_item_id, p_quantity_delta, pg_catalog.clock_timestamp())
  on conflict (warehouse_id, item_id) do update
    set quantity = b.quantity + excluded.quantity,
        updated_at = excluded.updated_at
  returning quantity into v_balance;

  return pg_catalog.jsonb_build_object(
    'status', 'recorded',
    'movementId', v_movement_id,
    'balance', v_balance
  );
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

alter function app_private.inventory_record_movement(
  uuid, uuid, uuid, uuid, uuid, text, integer, text, text, text, uuid, uuid, timestamptz, uuid
) owner to postgres;

revoke all on app.inventory_movements, app.inventory_balances
  from public, anon, authenticated, service_role, app_api;
grant select on app.inventory_movements, app.inventory_balances to authenticated;

revoke all on function app_private.inventory_record_movement(
  uuid, uuid, uuid, uuid, uuid, text, integer, text, text, text, uuid, uuid, timestamptz, uuid
) from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.inventory_record_movement(
  uuid, uuid, uuid, uuid, uuid, text, integer, text, text, text, uuid, uuid, timestamptz, uuid
) to app_api;

alter table app.inventory_movements enable row level security;
alter table app.inventory_movements force row level security;
alter table app.inventory_balances enable row level security;
alter table app.inventory_balances force row level security;

create policy inventory_movements_active_branch_read
  on app.inventory_movements
  for select
  to authenticated
  using (app_rls.has_active_branch_membership(restaurant_id, branch_id));

create policy inventory_balances_active_branch_read
  on app.inventory_balances
  for select
  to authenticated
  using (exists (
    select 1
    from app.inventory_warehouses as w
    where w.id = warehouse_id
      and app_rls.has_active_branch_membership(w.restaurant_id, w.branch_id)
  ));

comment on table app.inventory_movements is
  'Append-only inventory ledger; the only source of truth for stock. UPDATE and DELETE are rejected.';
comment on column app.inventory_movements.quantity_delta is
  'Integer delta in the item base unit; never zero. Negative values consume stock.';
comment on column app.inventory_movements.compensates_movement_id is
  'Original movement reversed by this one; required for sale_reversal.';
comment on column app.inventory_movements.idempotency_key is
  'Per-restaurant idempotency key; a replay with the same payload returns duplicate.';
comment on table app.inventory_balances is
  'Derived, recomputable quantity per warehouse and item; only the private function writes it.';
comment on function app_private.inventory_record_movement(
  uuid, uuid, uuid, uuid, uuid, text, integer, text, text, text, uuid, uuid, timestamptz, uuid
) is
  'Server-only append of one immutable inventory movement with actor/scope/idempotency revalidation and derived balance update.';

commit;
