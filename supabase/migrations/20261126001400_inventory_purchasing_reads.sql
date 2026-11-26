begin;

-- Purchasing reads follow the RBAC `catalog.read` permission instead of the manage-only gate, so the
-- SQL accepts exactly the same actors as apps/api/src/auth/rbac-policy.ts. This list is a copy of the
-- RBAC matrix: roles holding `catalog.read` are owner, admin, manager, supervisor, cashier, waiter,
-- viewer and auditor. If the RBAC matrix changes, this migration's role list must change with it.
-- Writes (create/update supplier, purchase-order create/receive) keep the manage-only gate.

create or replace function app_private.list_inventory_suppliers(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_include_inactive boolean default false
)
returns table (
  id uuid,
  restaurant_id uuid,
  name text,
  contact text,
  active boolean,
  created_at timestamptz
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
    join app.restaurants as r
      on r.id = m.restaurant_id
     and r.disabled_at is null
    where m.user_id = p_actor_id
      and m.restaurant_id = p_restaurant_id
      and m.revoked_at is null
  ) then
    return;
  end if;

  if not exists (
    select 1
    from app.memberships as m
    join app.membership_role_grants as rg
      on rg.membership_id = m.id
     and rg.revoked_at is null
     and rg.role_code in (
       'owner', 'admin', 'manager', 'supervisor', 'cashier', 'waiter', 'viewer', 'auditor'
     )
    join app.restaurants as r
      on r.id = m.restaurant_id
     and r.disabled_at is null
    where m.user_id = p_actor_id
      and m.restaurant_id = p_restaurant_id
      and m.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'INVENTORY_ACTOR_FORBIDDEN';
  end if;

  return query
    select s.id, s.restaurant_id, s.name, s.contact, s.active, s.created_at
    from app.inventory_suppliers as s
    where s.restaurant_id = p_restaurant_id
      and (coalesce(p_include_inactive, false) or s.active)
    order by s.name, s.id;
end
$function$;

create or replace function app_private.list_inventory_purchase_orders(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_status text default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  supplier_id uuid,
  supplier_name text,
  status text,
  currency text,
  ordered_at timestamptz,
  received_at timestamptz,
  received_by uuid,
  total_minor bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_limit integer;
begin
  if p_status is not null
    and p_status not in ('draft', 'sent', 'received', 'cancelled')
  then
    raise exception using errcode = '22000', message = 'INVENTORY_PURCHASE_STATUS_INVALID';
  end if;

  if not exists (
    select 1
    from app.memberships as m
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
    return;
  end if;

  if not exists (
    select 1
    from app.memberships as m
    join app.membership_role_grants as rg
      on rg.membership_id = m.id
     and rg.revoked_at is null
     and rg.role_code in (
       'owner', 'admin', 'manager', 'supervisor', 'cashier', 'waiter', 'viewer', 'auditor'
     )
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
    select o.id,
           o.supplier_id,
           s.name,
           o.status,
           o.currency,
           o.ordered_at,
           o.received_at,
           o.received_by,
           coalesce(t.total_minor, 0)::bigint
    from app.inventory_purchase_orders as o
    join app.inventory_suppliers as s
      on s.id = o.supplier_id
     and s.restaurant_id = o.restaurant_id
    left join (
      select l.order_id,
             pg_catalog.sum(l.quantity::bigint * l.unit_cost_minor)::bigint as total_minor
      from app.inventory_purchase_order_lines as l
      where l.restaurant_id = p_restaurant_id
      group by l.order_id
    ) as t
      on t.order_id = o.id
    where o.restaurant_id = p_restaurant_id
      and o.branch_id = p_branch_id
      and (p_status is null or o.status = p_status)
    order by o.ordered_at desc, o.id
    limit v_limit;
end
$function$;

create or replace function app_private.read_inventory_purchase_order(p_actor_id uuid, p_order_id uuid)
returns table (
  id uuid,
  restaurant_id uuid,
  branch_id uuid,
  supplier_id uuid,
  supplier_name text,
  status text,
  currency text,
  ordered_at timestamptz,
  received_at timestamptz,
  received_by uuid,
  total_minor bigint,
  lines jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_restaurant_id uuid;
  v_branch_id uuid;
begin
  select o.restaurant_id, o.branch_id into v_restaurant_id, v_branch_id
  from app.inventory_purchase_orders as o
  where o.id = p_order_id;

  if not found then
    return;
  end if;

  if not exists (
    select 1
    from app.memberships as m
    join app.restaurants as r
      on r.id = m.restaurant_id
     and r.disabled_at is null
    join app.branches as b
      on b.id = m.branch_id
     and b.restaurant_id = m.restaurant_id
     and b.disabled_at is null
    where m.user_id = p_actor_id
      and m.restaurant_id = v_restaurant_id
      and m.branch_id = v_branch_id
      and m.revoked_at is null
  ) then
    return;
  end if;

  if not exists (
    select 1
    from app.memberships as m
    join app.membership_role_grants as rg
      on rg.membership_id = m.id
     and rg.revoked_at is null
     and rg.role_code in (
       'owner', 'admin', 'manager', 'supervisor', 'cashier', 'waiter', 'viewer', 'auditor'
     )
    join app.restaurants as r
      on r.id = m.restaurant_id
     and r.disabled_at is null
    join app.branches as b
      on b.id = m.branch_id
     and b.restaurant_id = m.restaurant_id
     and b.disabled_at is null
    where m.user_id = p_actor_id
      and m.restaurant_id = v_restaurant_id
      and m.branch_id = v_branch_id
      and m.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'INVENTORY_ACTOR_FORBIDDEN';
  end if;

  return query
    with header as (
      select o.id,
             o.restaurant_id,
             o.branch_id,
             o.supplier_id,
             s.name as supplier_name,
             o.status,
             o.currency,
             o.ordered_at,
             o.received_at,
             o.received_by,
             (
               select coalesce(
                 pg_catalog.sum(l.quantity::bigint * l.unit_cost_minor)::bigint,
                 0
               )
               from app.inventory_purchase_order_lines as l
               where l.order_id = o.id
                 and l.restaurant_id = o.restaurant_id
             ) as total_minor
      from app.inventory_purchase_orders as o
      join app.inventory_suppliers as s
        on s.id = o.supplier_id
       and s.restaurant_id = o.restaurant_id
      where o.id = p_order_id
        and o.restaurant_id = v_restaurant_id
    )
    select h.id,
           h.restaurant_id,
           h.branch_id,
           h.supplier_id,
           h.supplier_name,
           h.status,
           h.currency,
           h.ordered_at,
           h.received_at,
           h.received_by,
           h.total_minor,
           coalesce((
             select pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'item_id', l.item_id,
                 'item_name', i.name,
                 'quantity', l.quantity,
                 'unit_code', l.unit_code,
                 'unit_cost_minor', l.unit_cost_minor
               )
               order by l.id
             )
             from app.inventory_purchase_order_lines as l
             join app.inventory_items as i
               on i.id = l.item_id
              and i.restaurant_id = l.restaurant_id
             where l.order_id = h.id
               and l.restaurant_id = h.restaurant_id
           ), '[]'::jsonb) as lines
    from header as h;
end
$function$;

alter function app_private.list_inventory_suppliers(uuid, uuid, boolean) owner to postgres;
alter function app_private.list_inventory_purchase_orders(uuid, uuid, uuid, text, integer) owner to postgres;
alter function app_private.read_inventory_purchase_order(uuid, uuid) owner to postgres;

revoke all on function app_private.list_inventory_suppliers(uuid, uuid, boolean)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.list_inventory_suppliers(uuid, uuid, boolean) to app_api;

revoke all on function app_private.list_inventory_purchase_orders(uuid, uuid, uuid, text, integer)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.list_inventory_purchase_orders(uuid, uuid, uuid, text, integer) to app_api;

revoke all on function app_private.read_inventory_purchase_order(uuid, uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.read_inventory_purchase_order(uuid, uuid) to app_api;

commit;
