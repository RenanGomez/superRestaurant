begin;

-- Inventory catalog writes stay behind app_private SECURITY DEFINER functions. app_api never receives
-- USAGE on schema app nor table privileges, so the fixed app-api-recovery predicate and the runtime
-- catalog invariants keep rejecting a compromised API credential. Reads are wrapped too, so their
-- tenant filter cannot drift from the writer's: p_actor_id is trusted server input, and every function
-- re-checks the actor's membership before returning or mutating a row.

create function app_private.list_inventory_items(p_actor_id uuid, p_restaurant_id uuid)
returns table (
  id uuid,
  restaurant_id uuid,
  sku text,
  name text,
  unit_code text,
  purchase_unit_factor integer,
  min_quantity integer,
  active boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
  select i.id, i.restaurant_id, i.sku, i.name, i.unit_code,
         i.purchase_unit_factor, i.min_quantity, i.active
  from app.inventory_items as i
  where i.restaurant_id = p_restaurant_id
    and i.deleted_at is null
    and exists (
      select 1
      from app.memberships as m
      join app.membership_role_grants as rg
        on rg.membership_id = m.id
       and rg.revoked_at is null
      join app.restaurants as rt
        on rt.id = m.restaurant_id
       and rt.disabled_at is null
      where m.user_id = p_actor_id
        and m.restaurant_id = p_restaurant_id
        and m.revoked_at is null
    )
  order by i.name, i.id
$function$;

create function app_private.read_inventory_item_for_manage(p_actor_id uuid, p_item_id uuid)
returns table (
  id uuid,
  restaurant_id uuid,
  sku text,
  name text,
  unit_code text,
  purchase_unit_factor integer,
  min_quantity integer,
  active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_restaurant_id uuid;
begin
  select i.restaurant_id into v_restaurant_id
  from app.inventory_items as i
  where i.id = p_item_id
    and i.deleted_at is null;

  if not found then
    return;
  end if;

  -- No active membership in the item's restaurant looks exactly like a missing id, so a foreign
  -- actor cannot probe the catalog of another tenant.
  if not exists (
    select 1
    from app.memberships as m
    join app.membership_role_grants as rg
      on rg.membership_id = m.id
     and rg.revoked_at is null
    join app.restaurants as rt
      on rt.id = m.restaurant_id
     and rt.disabled_at is null
    where m.user_id = p_actor_id
      and m.restaurant_id = v_restaurant_id
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
     and rg.role_code in ('owner', 'admin', 'manager')
    join app.restaurants as rt
      on rt.id = m.restaurant_id
     and rt.disabled_at is null
    where m.user_id = p_actor_id
      and m.restaurant_id = v_restaurant_id
      and m.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'INVENTORY_ACTOR_FORBIDDEN';
  end if;

  return query
    select i.id, i.restaurant_id, i.sku, i.name, i.unit_code,
           i.purchase_unit_factor, i.min_quantity, i.active
    from app.inventory_items as i
    where i.id = p_item_id
      and i.deleted_at is null;
end
$function$;

create function app_private.create_inventory_item(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_sku text,
  p_name text,
  p_unit_code text,
  p_purchase_unit_factor integer,
  p_min_quantity integer,
  p_active boolean
)
returns table (
  id uuid,
  restaurant_id uuid,
  sku text,
  name text,
  unit_code text,
  purchase_unit_factor integer,
  min_quantity integer,
  active boolean
)
language plpgsql
volatile
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
     and rg.role_code in ('owner', 'admin', 'manager')
    join app.restaurants as rt
      on rt.id = m.restaurant_id
     and rt.disabled_at is null
    where m.user_id = p_actor_id
      and m.restaurant_id = p_restaurant_id
      and m.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'INVENTORY_ACTOR_FORBIDDEN';
  end if;

  return query
    with inserted as (
      insert into app.inventory_items as i (
        restaurant_id, sku, name, unit_code, purchase_unit_factor, min_quantity, active
      ) values (
        p_restaurant_id, p_sku, p_name, p_unit_code, p_purchase_unit_factor, p_min_quantity, p_active
      )
      returning i.id, i.restaurant_id, i.sku, i.name, i.unit_code,
                i.purchase_unit_factor, i.min_quantity, i.active
    )
    select i.id, i.restaurant_id, i.sku, i.name, i.unit_code,
           i.purchase_unit_factor, i.min_quantity, i.active
    from inserted as i;
end
$function$;

create function app_private.update_inventory_item(
  p_actor_id uuid,
  p_item_id uuid,
  p_sku text,
  p_name text,
  p_unit_code text,
  p_purchase_unit_factor integer,
  p_min_quantity integer,
  p_active boolean
)
returns table (
  id uuid,
  restaurant_id uuid,
  sku text,
  name text,
  unit_code text,
  purchase_unit_factor integer,
  min_quantity integer,
  active boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_restaurant_id uuid;
begin
  select i.restaurant_id into v_restaurant_id
  from app.inventory_items as i
  where i.id = p_item_id
    and i.deleted_at is null;

  if not found then
    return;
  end if;

  if not exists (
    select 1
    from app.memberships as m
    join app.membership_role_grants as rg
      on rg.membership_id = m.id
     and rg.revoked_at is null
    join app.restaurants as rt
      on rt.id = m.restaurant_id
     and rt.disabled_at is null
    where m.user_id = p_actor_id
      and m.restaurant_id = v_restaurant_id
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
     and rg.role_code in ('owner', 'admin', 'manager')
    join app.restaurants as rt
      on rt.id = m.restaurant_id
     and rt.disabled_at is null
    where m.user_id = p_actor_id
      and m.restaurant_id = v_restaurant_id
      and m.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'INVENTORY_ACTOR_FORBIDDEN';
  end if;

  return query
    with updated as (
      update app.inventory_items as i
      set sku = p_sku,
          name = p_name,
          unit_code = p_unit_code,
          purchase_unit_factor = p_purchase_unit_factor,
          min_quantity = p_min_quantity,
          active = p_active,
          updated_at = pg_catalog.clock_timestamp()
      where i.id = p_item_id
        and i.restaurant_id = v_restaurant_id
        and i.deleted_at is null
      returning i.id, i.restaurant_id, i.sku, i.name, i.unit_code,
                i.purchase_unit_factor, i.min_quantity, i.active
    )
    select i.id, i.restaurant_id, i.sku, i.name, i.unit_code,
           i.purchase_unit_factor, i.min_quantity, i.active
    from updated as i;
end
$function$;

create function app_private.list_inventory_warehouses(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid
)
returns table (
  id uuid,
  restaurant_id uuid,
  branch_id uuid,
  name text,
  active boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
  select w.id, w.restaurant_id, w.branch_id, w.name, w.active
  from app.inventory_warehouses as w
  where w.restaurant_id = p_restaurant_id
    and w.branch_id = p_branch_id
    and exists (
      select 1
      from app.memberships as m
      join app.membership_role_grants as rg
        on rg.membership_id = m.id
       and rg.revoked_at is null
      join app.restaurants as rt
        on rt.id = m.restaurant_id
       and rt.disabled_at is null
      join app.branches as br
        on br.id = m.branch_id
       and br.restaurant_id = m.restaurant_id
       and br.disabled_at is null
      where m.user_id = p_actor_id
        and m.restaurant_id = p_restaurant_id
        and m.branch_id = p_branch_id
        and m.revoked_at is null
    )
  order by w.name, w.id
$function$;

create function app_private.read_inventory_warehouse_for_manage(p_actor_id uuid, p_warehouse_id uuid)
returns table (
  id uuid,
  restaurant_id uuid,
  branch_id uuid,
  name text,
  active boolean
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
  select w.restaurant_id, w.branch_id into v_restaurant_id, v_branch_id
  from app.inventory_warehouses as w
  where w.id = p_warehouse_id;

  if not found then
    return;
  end if;

  if not exists (
    select 1
    from app.memberships as m
    join app.membership_role_grants as rg
      on rg.membership_id = m.id
     and rg.revoked_at is null
    join app.restaurants as rt
      on rt.id = m.restaurant_id
     and rt.disabled_at is null
    join app.branches as br
      on br.id = m.branch_id
     and br.restaurant_id = m.restaurant_id
     and br.disabled_at is null
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
     and rg.role_code in ('owner', 'admin', 'manager')
    join app.restaurants as rt
      on rt.id = m.restaurant_id
     and rt.disabled_at is null
    join app.branches as br
      on br.id = m.branch_id
     and br.restaurant_id = m.restaurant_id
     and br.disabled_at is null
    where m.user_id = p_actor_id
      and m.restaurant_id = v_restaurant_id
      and m.branch_id = v_branch_id
      and m.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'INVENTORY_ACTOR_FORBIDDEN';
  end if;

  return query
    select w.id, w.restaurant_id, w.branch_id, w.name, w.active
    from app.inventory_warehouses as w
    where w.id = p_warehouse_id;
end
$function$;

create function app_private.create_inventory_warehouse(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_name text,
  p_active boolean
)
returns table (
  id uuid,
  restaurant_id uuid,
  branch_id uuid,
  name text,
  active boolean
)
language plpgsql
volatile
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
     and rg.role_code in ('owner', 'admin', 'manager')
    join app.restaurants as rt
      on rt.id = m.restaurant_id
     and rt.disabled_at is null
    join app.branches as br
      on br.id = m.branch_id
     and br.restaurant_id = m.restaurant_id
     and br.disabled_at is null
    where m.user_id = p_actor_id
      and m.restaurant_id = p_restaurant_id
      and m.branch_id = p_branch_id
      and m.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'INVENTORY_ACTOR_FORBIDDEN';
  end if;

  return query
    with inserted as (
      insert into app.inventory_warehouses as w (
        restaurant_id, branch_id, name, active
      ) values (
        p_restaurant_id, p_branch_id, p_name, p_active
      )
      returning w.id, w.restaurant_id, w.branch_id, w.name, w.active
    )
    select w.id, w.restaurant_id, w.branch_id, w.name, w.active
    from inserted as w;
end
$function$;

create function app_private.update_inventory_warehouse(
  p_actor_id uuid,
  p_warehouse_id uuid,
  p_name text,
  p_active boolean
)
returns table (
  id uuid,
  restaurant_id uuid,
  branch_id uuid,
  name text,
  active boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_restaurant_id uuid;
  v_branch_id uuid;
begin
  select w.restaurant_id, w.branch_id into v_restaurant_id, v_branch_id
  from app.inventory_warehouses as w
  where w.id = p_warehouse_id;

  if not found then
    return;
  end if;

  if not exists (
    select 1
    from app.memberships as m
    join app.membership_role_grants as rg
      on rg.membership_id = m.id
     and rg.revoked_at is null
    join app.restaurants as rt
      on rt.id = m.restaurant_id
     and rt.disabled_at is null
    join app.branches as br
      on br.id = m.branch_id
     and br.restaurant_id = m.restaurant_id
     and br.disabled_at is null
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
     and rg.role_code in ('owner', 'admin', 'manager')
    join app.restaurants as rt
      on rt.id = m.restaurant_id
     and rt.disabled_at is null
    join app.branches as br
      on br.id = m.branch_id
     and br.restaurant_id = m.restaurant_id
     and br.disabled_at is null
    where m.user_id = p_actor_id
      and m.restaurant_id = v_restaurant_id
      and m.branch_id = v_branch_id
      and m.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'INVENTORY_ACTOR_FORBIDDEN';
  end if;

  return query
    with updated as (
      update app.inventory_warehouses as w
      set name = p_name,
          active = p_active,
          updated_at = pg_catalog.clock_timestamp()
      where w.id = p_warehouse_id
        and w.restaurant_id = v_restaurant_id
        and w.branch_id = v_branch_id
      returning w.id, w.restaurant_id, w.branch_id, w.name, w.active
    )
    select w.id, w.restaurant_id, w.branch_id, w.name, w.active
    from updated as w;
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

alter function app_private.list_inventory_items(uuid, uuid) owner to postgres;
alter function app_private.read_inventory_item_for_manage(uuid, uuid) owner to postgres;
alter function app_private.create_inventory_item(uuid, uuid, text, text, text, integer, integer, boolean) owner to postgres;
alter function app_private.update_inventory_item(uuid, uuid, text, text, text, integer, integer, boolean) owner to postgres;
alter function app_private.list_inventory_warehouses(uuid, uuid, uuid) owner to postgres;
alter function app_private.read_inventory_warehouse_for_manage(uuid, uuid) owner to postgres;
alter function app_private.create_inventory_warehouse(uuid, uuid, uuid, text, boolean) owner to postgres;
alter function app_private.update_inventory_warehouse(uuid, uuid, text, boolean) owner to postgres;

revoke all on function app_private.list_inventory_items(uuid, uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.list_inventory_items(uuid, uuid) to app_api;

revoke all on function app_private.read_inventory_item_for_manage(uuid, uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.read_inventory_item_for_manage(uuid, uuid) to app_api;

revoke all on function app_private.create_inventory_item(uuid, uuid, text, text, text, integer, integer, boolean)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.create_inventory_item(uuid, uuid, text, text, text, integer, integer, boolean) to app_api;

revoke all on function app_private.update_inventory_item(uuid, uuid, text, text, text, integer, integer, boolean)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.update_inventory_item(uuid, uuid, text, text, text, integer, integer, boolean) to app_api;

revoke all on function app_private.list_inventory_warehouses(uuid, uuid, uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.list_inventory_warehouses(uuid, uuid, uuid) to app_api;

revoke all on function app_private.read_inventory_warehouse_for_manage(uuid, uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.read_inventory_warehouse_for_manage(uuid, uuid) to app_api;

revoke all on function app_private.create_inventory_warehouse(uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.create_inventory_warehouse(uuid, uuid, uuid, text, boolean) to app_api;

revoke all on function app_private.update_inventory_warehouse(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.update_inventory_warehouse(uuid, uuid, text, boolean) to app_api;

-- The raw ledger writer keeps its existing EXECUTE grant to app_api (20261126000200_inventory_ledger):
-- the future movements API needs it, and today no client can reach it. Narrowing it to per-operation
-- wrappers is tracked in docs/agentic/debt.md.

commit;
