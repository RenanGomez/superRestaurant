begin;

-- Manual inventory entry points. The raw ledger writer (20261126000200) stays untouched: transfers
-- wrap it twice inside one transaction, and the read helpers derive the transfer pair from the
-- source columns already stored on every movement.

create function app_private.inventory_transfer(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_from_warehouse_id uuid,
  p_to_warehouse_id uuid,
  p_item_id uuid,
  p_quantity integer,
  p_unit_code text,
  p_reason text,
  p_idempotency_key text,
  p_device_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_pair_id uuid;
  v_existing_out uuid;
  v_existing_in uuid;
  v_item_unit text;
  v_occurred_at timestamptz := pg_catalog.clock_timestamp();
  v_out jsonb;
  v_in jsonb;
  v_status text;
  v_movements jsonb;
begin
  if p_actor_id is null
    or p_restaurant_id is null
    or p_branch_id is null
    or p_from_warehouse_id is null
    or p_to_warehouse_id is null
    or p_item_id is null
    or p_quantity is null
    or p_unit_code is null
    or p_reason is null
    or p_idempotency_key is null
  then
    raise exception using errcode = '22000', message = 'INVENTORY_TRANSFER_ARGUMENT_MISSING';
  end if;

  if p_from_warehouse_id = p_to_warehouse_id then
    raise exception using errcode = '22000', message = 'INVENTORY_TRANSFER_SCOPE_INVALID';
  end if;

  if p_quantity <= 0 then
    raise exception using errcode = '22000', message = 'INVENTORY_TRANSFER_QUANTITY_INVALID';
  end if;

  if pg_catalog.char_length(pg_catalog.btrim(p_reason)) = 0 then
    raise exception using errcode = '22000', message = 'INVENTORY_TRANSFER_REASON_REQUIRED';
  end if;

  if p_idempotency_key <> pg_catalog.btrim(p_idempotency_key)
    or pg_catalog.char_length(p_idempotency_key) not between 1 and 190
    or p_idempotency_key ~ '[[:cntrl:]]'
  then
    raise exception using errcode = '22000', message = 'INVENTORY_TRANSFER_IDEMPOTENCY_KEY_INVALID';
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
    raise exception using errcode = '42501', message = 'INVENTORY_ACTOR_FORBIDDEN';
  end if;

  if not exists (
    select 1
    from app.inventory_warehouses as w
    where w.id = p_from_warehouse_id
      and w.restaurant_id = p_restaurant_id
      and w.branch_id = p_branch_id
  ) or not exists (
    select 1
    from app.inventory_warehouses as w
    where w.id = p_to_warehouse_id
      and w.restaurant_id = p_restaurant_id
      and w.branch_id = p_branch_id
  ) then
    raise exception using errcode = '22000', message = 'INVENTORY_WAREHOUSE_SCOPE_INVALID';
  end if;

  if not exists (
    select 1
    from app.inventory_warehouses as w
    where w.id = p_from_warehouse_id
      and w.active
  ) or not exists (
    select 1
    from app.inventory_warehouses as w
    where w.id = p_to_warehouse_id
      and w.active
  ) then
    raise exception using errcode = '22000', message = 'INVENTORY_WAREHOUSE_INACTIVE';
  end if;

  select i.unit_code into v_item_unit
  from app.inventory_items as i
  where i.id = p_item_id
    and i.restaurant_id = p_restaurant_id
    and i.deleted_at is null;

  if not found then
    raise exception using errcode = '22000', message = 'INVENTORY_ITEM_SCOPE_INVALID';
  end if;

  if v_item_unit <> p_unit_code then
    raise exception using errcode = '22000', message = 'INVENTORY_ITEM_UNIT_MISMATCH';
  end if;

  -- Serialize concurrent callers of the same transfer key so the pair precheck and the two inserts
  -- cannot interleave into a one-sided or conflicting pair.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'inventory-transfer:' || p_restaurant_id::text || ':' || p_idempotency_key, 0
  ));

  select m.source_id into v_existing_out
  from app.inventory_movements as m
  where m.restaurant_id = p_restaurant_id
    and m.idempotency_key = p_idempotency_key || ':out';

  if found then
    select m.source_id into v_existing_in
    from app.inventory_movements as m
    where m.restaurant_id = p_restaurant_id
      and m.idempotency_key = p_idempotency_key || ':in';

    if not found or v_existing_in is distinct from v_existing_out then
      raise exception using errcode = '22000', message = 'INVENTORY_TRANSFER_STATE_INVALID';
    end if;

    v_pair_id := v_existing_out;
  else
    if exists (
      select 1
      from app.inventory_movements as m
      where m.restaurant_id = p_restaurant_id
        and m.idempotency_key = p_idempotency_key || ':in'
    ) then
      raise exception using errcode = '22000', message = 'INVENTORY_TRANSFER_STATE_INVALID';
    end if;

    v_pair_id := pg_catalog.gen_random_uuid();
  end if;

  v_out := app_private.inventory_record_movement(
    p_actor_id, p_restaurant_id, p_branch_id, p_from_warehouse_id, p_item_id,
    'transfer_out', -p_quantity, p_reason, p_idempotency_key || ':out',
    'inventory_transfer', v_pair_id, null, v_occurred_at, p_device_id
  );
  v_in := app_private.inventory_record_movement(
    p_actor_id, p_restaurant_id, p_branch_id, p_to_warehouse_id, p_item_id,
    'transfer_in', p_quantity, p_reason, p_idempotency_key || ':in',
    'inventory_transfer', v_pair_id, null, v_occurred_at, p_device_id
  );

  if (v_out ->> 'status') is distinct from (v_in ->> 'status') then
    raise exception using errcode = '22000', message = 'INVENTORY_TRANSFER_STATE_INVALID';
  end if;

  v_status := v_out ->> 'status';

  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', m.id,
      'restaurantId', m.restaurant_id,
      'branchId', m.branch_id,
      'warehouseId', m.warehouse_id,
      'itemId', m.item_id,
      'kind', m.kind,
      'quantityDelta', m.quantity_delta,
      'unitCode', m.unit_code,
      'occurredAt', pg_catalog.to_char(m.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'actorId', m.actor_id,
      'reason', m.reason,
      'idempotencyKey', m.idempotency_key,
      'compensatesMovementId', m.compensates_movement_id,
      'transferPairId', case when m.source_type = 'inventory_transfer' then m.source_id else null end,
      'unitCostMinor', m.unit_cost_minor,
      'currency', m.currency,
      'recipeVersionId', null,
      'roundingRemainder', 0
    )
    order by m.kind
  )
  into v_movements
  from app.inventory_movements as m
  where m.id in ((v_out ->> 'movementId')::uuid, (v_in ->> 'movementId')::uuid);

  return pg_catalog.jsonb_build_object(
    'status', v_status,
    'transferPairId', v_pair_id,
    'movements', coalesce(v_movements, '[]'::jsonb)
  );
end
$function$;

create function app_private.list_inventory_movements(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid default null,
  p_item_id uuid default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  restaurant_id uuid,
  branch_id uuid,
  warehouse_id uuid,
  item_id uuid,
  kind text,
  quantity_delta integer,
  unit_code text,
  occurred_at timestamptz,
  actor_id uuid,
  reason text,
  idempotency_key text,
  compensates_movement_id uuid,
  transfer_pair_id uuid,
  unit_cost_minor bigint,
  currency text,
  recipe_version_id uuid,
  rounding_remainder integer
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_limit integer;
begin
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

  v_limit := case
    when p_limit is null or p_limit < 1 then 100
    when p_limit > 200 then 200
    else p_limit
  end;

  return query
    select m.id, m.restaurant_id, m.branch_id, m.warehouse_id, m.item_id, m.kind,
           m.quantity_delta, m.unit_code, m.occurred_at, m.actor_id, m.reason,
           m.idempotency_key, m.compensates_movement_id,
           case when m.source_type = 'inventory_transfer' then m.source_id else null end,
           m.unit_cost_minor, m.currency, null::uuid, 0
    from app.inventory_movements as m
    where m.restaurant_id = p_restaurant_id
      and m.branch_id = p_branch_id
      and (p_warehouse_id is null or m.warehouse_id = p_warehouse_id)
      and (p_item_id is null or m.item_id = p_item_id)
    order by m.occurred_at desc, m.id
    limit v_limit;
end
$function$;

create function app_private.list_inventory_balances(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid default null
)
returns table (
  warehouse_id uuid,
  item_id uuid,
  quantity integer,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
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

  return query
    select b.warehouse_id, b.item_id, b.quantity, b.updated_at
    from app.inventory_balances as b
    join app.inventory_warehouses as w
      on w.id = b.warehouse_id
     and w.restaurant_id = p_restaurant_id
     and w.branch_id = p_branch_id
    where p_warehouse_id is null or b.warehouse_id = p_warehouse_id
    order by b.warehouse_id, b.item_id;
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

alter function app_private.inventory_transfer(
  uuid, uuid, uuid, uuid, uuid, uuid, integer, text, text, text, uuid
) owner to postgres;
alter function app_private.list_inventory_movements(
  uuid, uuid, uuid, uuid, uuid, integer
) owner to postgres;
alter function app_private.list_inventory_balances(
  uuid, uuid, uuid, uuid
) owner to postgres;

revoke all on function app_private.inventory_transfer(
  uuid, uuid, uuid, uuid, uuid, uuid, integer, text, text, text, uuid
) from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.inventory_transfer(
  uuid, uuid, uuid, uuid, uuid, uuid, integer, text, text, text, uuid
) to app_api;

revoke all on function app_private.list_inventory_movements(
  uuid, uuid, uuid, uuid, uuid, integer
) from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.list_inventory_movements(
  uuid, uuid, uuid, uuid, uuid, integer
) to app_api;

revoke all on function app_private.list_inventory_balances(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.list_inventory_balances(
  uuid, uuid, uuid, uuid
) to app_api;

comment on function app_private.inventory_transfer(
  uuid, uuid, uuid, uuid, uuid, uuid, integer, text, text, text, uuid
) is
  'Server-only atomic transfer between two active warehouses of the same branch: writes transfer_out and transfer_in with one shared pair id and replays as duplicate.';
comment on function app_private.list_inventory_movements(
  uuid, uuid, uuid, uuid, uuid, integer
) is
  'Branch-scoped, membership-checked movement read; transfer_pair_id is derived from the transfer source columns.';
comment on function app_private.list_inventory_balances(
  uuid, uuid, uuid, uuid
) is
  'Branch-scoped, membership-checked derived balance read.';

commit;
