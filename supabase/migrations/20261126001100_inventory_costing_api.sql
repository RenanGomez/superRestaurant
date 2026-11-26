begin;

-- Read-only costing and alert helpers for the API. Every calculation starts from the immutable
-- ledger or the derived balance, never from a client-supplied total: app_api has no direct access
-- to schema app (20261126000600), so these SECURITY DEFINER functions are the only entry points.

create function app_private.list_inventory_alerts(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid
)
returns table (
  item_id uuid,
  item_name text,
  unit_code text,
  warehouse_id uuid,
  warehouse_name text,
  quantity integer,
  min_quantity integer,
  deficit integer
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_actor_id is null or p_restaurant_id is null or p_branch_id is null then
    raise exception using errcode = '22000', message = 'INVENTORY_ALERT_ARGUMENT_MISSING';
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

  -- A missing balance row means zero stock, so an item with a minimum alerts in every active
  -- warehouse of the branch until it is stocked. Inactive items and warehouses are not actionable.
  return query
    select i.id,
           i.name,
           i.unit_code,
           w.id,
           w.name,
           coalesce(b.quantity, 0)::integer,
           i.min_quantity,
           (i.min_quantity - coalesce(b.quantity, 0))::integer
    from app.inventory_items as i
    cross join app.inventory_warehouses as w
    left join app.inventory_balances as b
      on b.warehouse_id = w.id
     and b.item_id = i.id
    where i.restaurant_id = p_restaurant_id
      and i.deleted_at is null
      and i.active
      and i.min_quantity > 0
      and w.restaurant_id = p_restaurant_id
      and w.branch_id = p_branch_id
      and w.active
      and coalesce(b.quantity, 0) < i.min_quantity
    order by (i.min_quantity - coalesce(b.quantity, 0)) desc,
             i.name,
             w.name,
             i.id,
             w.id;
end
$function$;

create function app_private.inventory_average_cost(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_item_id uuid
)
returns table (
  quantity integer,
  value_minor bigint,
  unit_cost_minor bigint,
  currency text,
  rounding_remainder integer
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_quantity bigint;
  v_value bigint;
  v_unit_cost bigint;
  v_remainder bigint;
  v_currency_count integer;
  v_currency text;
begin
  if p_actor_id is null
    or p_restaurant_id is null
    or p_branch_id is null
    or p_warehouse_id is null
    or p_item_id is null
  then
    raise exception using errcode = '22000', message = 'INVENTORY_COST_ARGUMENT_MISSING';
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

  if not exists (
    select 1
    from app.inventory_warehouses as w
    where w.id = p_warehouse_id
      and w.restaurant_id = p_restaurant_id
      and w.branch_id = p_branch_id
  ) then
    raise exception using errcode = '22000', message = 'INVENTORY_WAREHOUSE_SCOPE_INVALID';
  end if;

  if not exists (
    select 1
    from app.inventory_items as i
    where i.id = p_item_id
      and i.restaurant_id = p_restaurant_id
      and i.deleted_at is null
  ) then
    raise exception using errcode = '22000', message = 'INVENTORY_ITEM_SCOPE_INVALID';
  end if;

  select coalesce(pg_catalog.sum(m.quantity_delta), 0)::bigint,
         coalesce(pg_catalog.sum(m.quantity_delta::bigint * m.unit_cost_minor), 0)::bigint,
         pg_catalog.count(distinct m.currency)::integer,
         pg_catalog.max(m.currency)
  into v_quantity, v_value, v_currency_count, v_currency
  from app.inventory_movements as m
  where m.restaurant_id = p_restaurant_id
    and m.branch_id = p_branch_id
    and m.warehouse_id = p_warehouse_id
    and m.item_id = p_item_id
    and m.kind = 'receipt'
    and m.quantity_delta > 0
    and m.unit_cost_minor is not null;

  if v_quantity = 0 then
    return query select 0, 0::bigint, 0::bigint, null::text, 0;
    return;
  end if;

  if v_currency_count > 1 then
    raise exception using errcode = '22000', message = 'INVENTORY_COST_CURRENCY_MISMATCH';
  end if;

  if v_quantity > 2147483647 then
    raise exception using errcode = '22003', message = 'INVENTORY_COST_QUANTITY_OVERFLOW';
  end if;

  -- Integer weighted average with round-half-up: (value + quantity / 2) / quantity. The raw
  -- division remainder stays as a non-negative audit value, never a float.
  v_unit_cost := (v_value + (v_quantity / 2)) / v_quantity;
  v_remainder := v_value % v_quantity;

  return query select
    v_quantity::integer,
    v_value,
    v_unit_cost,
    v_currency,
    v_remainder::integer;
end
$function$;

create function app_private.list_inventory_product_costs(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_product_id uuid
)
returns table (
  item_id uuid,
  item_name text,
  unit_code text,
  quantity integer,
  purchase_unit_factor integer,
  unit_cost_minor bigint,
  line_cost_minor bigint,
  currency text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_actor_id is null or p_restaurant_id is null or p_product_id is null then
    raise exception using errcode = '22000', message = 'INVENTORY_COST_ARGUMENT_MISSING';
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
    where m.user_id = p_actor_id
      and m.restaurant_id = p_restaurant_id
      and m.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'INVENTORY_ACTOR_FORBIDDEN';
  end if;

  -- Restaurant-level read: the default warehouse is the first active one in a branch the actor
  -- belongs to; without a default, each item falls back to the first active warehouse of those
  -- branches that already has a balance for it. Costs come from receipts of that warehouse.
  return query
    with active_recipe as (
      select rec.id
      from app.inventory_recipes as rec
      where rec.restaurant_id = p_restaurant_id
        and rec.product_id = p_product_id
        and rec.modifier_id is null
        and rec.active
    ),
    chosen_default as (
      select w.id, w.branch_id
      from app.inventory_warehouses as w
      where w.restaurant_id = p_restaurant_id
        and w.active
        and w.is_default
        and exists (
          select 1
          from app.memberships as m
          join app.membership_role_grants as rg
            on rg.membership_id = m.id
           and rg.revoked_at is null
          join app.branches as b
            on b.id = m.branch_id
           and b.restaurant_id = m.restaurant_id
           and b.disabled_at is null
          where m.user_id = p_actor_id
            and m.restaurant_id = p_restaurant_id
            and m.branch_id = w.branch_id
            and m.revoked_at is null
        )
      order by w.branch_id, w.id
      limit 1
    )
    select line.item_id,
           item.name,
           item.unit_code,
           line.quantity,
           item.purchase_unit_factor,
           coalesce(cost.unit_cost_minor, 0)::bigint,
           (line.quantity::bigint * coalesce(cost.unit_cost_minor, 0))::bigint,
           cost.currency
    from active_recipe as rec
    join app.inventory_recipe_lines as line
      on line.recipe_id = rec.id
    join app.inventory_items as item
      on item.id = line.item_id
     and item.restaurant_id = p_restaurant_id
     and item.deleted_at is null
    left join lateral (
      select costed.unit_cost_minor, costed.currency
      from (
        select w.id, w.branch_id
        from app.inventory_warehouses as w
        where w.restaurant_id = p_restaurant_id
          and w.active
          and exists (
            select 1
            from app.memberships as m
            join app.membership_role_grants as rg
              on rg.membership_id = m.id
             and rg.revoked_at is null
            join app.branches as b
              on b.id = m.branch_id
             and b.restaurant_id = m.restaurant_id
             and b.disabled_at is null
            where m.user_id = p_actor_id
              and m.restaurant_id = p_restaurant_id
              and m.branch_id = w.branch_id
              and m.revoked_at is null
          )
          and (
            w.id = (select id from chosen_default)
            or (
              not exists (select 1 from chosen_default)
              and exists (
                select 1
                from app.inventory_balances as bal
                where bal.warehouse_id = w.id
                  and bal.item_id = line.item_id
              )
            )
          )
        order by
          case when w.id = (select id from chosen_default) then 0 else 1 end,
          case when exists (
            select 1
            from app.inventory_balances as bal
            where bal.warehouse_id = w.id
              and bal.item_id = line.item_id
          ) then 0 else 1 end,
          w.id
        limit 1
      ) as pick
      cross join lateral app_private.inventory_average_cost(
        p_actor_id,
        p_restaurant_id,
        pick.branch_id,
        pick.id,
        line.item_id
      ) as costed
    ) as cost on true
    order by item.name, line.item_id;
end
$function$;

create function app_private.read_inventory_product_margin(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_product_id uuid
)
returns table (
  product_id uuid,
  price_minor bigint,
  cost_minor bigint,
  margin_minor bigint,
  currency text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_price_minor bigint;
  v_price_currency text;
  v_cost_minor bigint;
  v_cost_currency_count integer;
  v_cost_currency text;
begin
  if p_actor_id is null or p_restaurant_id is null or p_branch_id is null or p_product_id is null then
    raise exception using errcode = '22000', message = 'INVENTORY_COST_ARGUMENT_MISSING';
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

  select product.unit_price_minor, catalog.currency
  into v_price_minor, v_price_currency
  from app.menu_catalog_heads as head
  join app.menu_catalogs as catalog
    on catalog.restaurant_id = head.restaurant_id
   and catalog.id = head.catalog_id
   and catalog.version = head.version
  join app.menu_products as product
    on product.restaurant_id = head.restaurant_id
   and product.catalog_id = head.catalog_id
   and product.id = p_product_id
  where head.restaurant_id = p_restaurant_id;

  if not found then
    return;
  end if;

  -- The recipe must exist: without an active base recipe a margin would be an invented number.
  if not exists (
    select 1
    from app.inventory_recipes as rec
    where rec.restaurant_id = p_restaurant_id
      and rec.product_id = p_product_id
      and rec.modifier_id is null
      and rec.active
  ) then
    return;
  end if;

  with chosen_default as (
    select w.id, w.branch_id
    from app.inventory_warehouses as w
    where w.restaurant_id = p_restaurant_id
      and w.branch_id = p_branch_id
      and w.active
      and w.is_default
    order by w.id
    limit 1
  )
  select coalesce(pg_catalog.sum(line.quantity::bigint * coalesce(costed.unit_cost_minor, 0)), 0)::bigint,
         (pg_catalog.count(distinct costed.currency) filter (where costed.currency is not null))::integer,
         pg_catalog.max(costed.currency)
  into v_cost_minor, v_cost_currency_count, v_cost_currency
  from app.inventory_recipes as rec
  join app.inventory_recipe_lines as line
    on line.recipe_id = rec.id
  left join lateral (
    select cost.unit_cost_minor, cost.currency
    from (
      select w.id, w.branch_id
      from app.inventory_warehouses as w
      where w.restaurant_id = p_restaurant_id
        and w.branch_id = p_branch_id
        and w.active
        and (
          w.id = (select id from chosen_default)
          or (
            not exists (select 1 from chosen_default)
            and exists (
              select 1
              from app.inventory_balances as bal
              where bal.warehouse_id = w.id
                and bal.item_id = line.item_id
            )
          )
        )
      order by
        case when w.id = (select id from chosen_default) then 0 else 1 end,
        case when exists (
          select 1
          from app.inventory_balances as bal
          where bal.warehouse_id = w.id
            and bal.item_id = line.item_id
        ) then 0 else 1 end,
        w.id
      limit 1
    ) as pick
    cross join lateral app_private.inventory_average_cost(
      p_actor_id,
      p_restaurant_id,
      pick.branch_id,
      pick.id,
      line.item_id
    ) as cost
  ) as costed on true
  where rec.restaurant_id = p_restaurant_id
    and rec.product_id = p_product_id
    and rec.modifier_id is null
    and rec.active;

  if v_cost_currency_count > 1
    or (v_cost_currency is not null and v_cost_currency <> v_price_currency)
  then
    raise exception using errcode = '22000', message = 'INVENTORY_COST_CURRENCY_MISMATCH';
  end if;

  return query select
    p_product_id,
    v_price_minor,
    v_cost_minor,
    (v_price_minor - v_cost_minor)::bigint,
    v_price_currency;
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

alter function app_private.list_inventory_alerts(uuid, uuid, uuid) owner to postgres;
alter function app_private.inventory_average_cost(uuid, uuid, uuid, uuid, uuid) owner to postgres;
alter function app_private.list_inventory_product_costs(uuid, uuid, uuid) owner to postgres;
alter function app_private.read_inventory_product_margin(uuid, uuid, uuid, uuid) owner to postgres;

revoke all on function app_private.list_inventory_alerts(uuid, uuid, uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.list_inventory_alerts(uuid, uuid, uuid) to app_api;

revoke all on function app_private.inventory_average_cost(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.inventory_average_cost(uuid, uuid, uuid, uuid, uuid) to app_api;

revoke all on function app_private.list_inventory_product_costs(uuid, uuid, uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.list_inventory_product_costs(uuid, uuid, uuid) to app_api;

revoke all on function app_private.read_inventory_product_margin(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.read_inventory_product_margin(uuid, uuid, uuid, uuid) to app_api;

comment on function app_private.list_inventory_alerts(uuid, uuid, uuid) is
  'Branch-scoped, membership-checked stock alerts from the derived balance; missing balance means zero stock, and inactive items or warehouses are omitted.';
comment on function app_private.inventory_average_cost(uuid, uuid, uuid, uuid, uuid) is
  'Membership-checked weighted average of positive receipts with a non-null unit cost; integer round-half-up, non-negative division remainder, and zero when no receipt exists.';
comment on function app_private.list_inventory_product_costs(uuid, uuid, uuid) is
  'Restaurant-level active recipe explosion. Cost warehouse: first active default warehouse of a branch the actor belongs to; without one, per item, the first active warehouse of those branches with a balance. Inactive or missing cost yields zero.';
comment on function app_private.read_inventory_product_margin(uuid, uuid, uuid, uuid) is
  'Estimated margin from the current published catalog price minus the current active recipe cost; it is not a historical sale margin. The cost warehouse is the branch active default, otherwise the first active warehouse of the branch with a balance for the item, and a missing product or active recipe returns no row.';

commit;
