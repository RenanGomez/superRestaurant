begin;

-- A branch may mark exactly one active warehouse as its default for sale-driven consumption
-- (20261126000500 added is_default and the partial unique index inventory_warehouses_one_default_idx).
-- Expose that flag through the catalog API functions. The wrappers are replaced because their return
-- type grows a column; they keep the same hardened shape (postgres-owned SECURITY DEFINER with an
-- empty search_path) and the same membership checks. Moving the default is atomic: the previous
-- default of the branch is cleared before the new one is written, so the unique index never sees two.

revoke all on function app_private.list_inventory_warehouses(uuid, uuid, uuid)
  from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.read_inventory_warehouse_for_manage(uuid, uuid)
  from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.create_inventory_warehouse(uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.update_inventory_warehouse(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role, app_api;

drop function app_private.list_inventory_warehouses(uuid, uuid, uuid);
drop function app_private.read_inventory_warehouse_for_manage(uuid, uuid);
drop function app_private.create_inventory_warehouse(uuid, uuid, uuid, text, boolean);
drop function app_private.update_inventory_warehouse(uuid, uuid, text, boolean);

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
  active boolean,
  is_default boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
  select w.id, w.restaurant_id, w.branch_id, w.name, w.active, w.is_default
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
  active boolean,
  is_default boolean
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
    select w.id, w.restaurant_id, w.branch_id, w.name, w.active, w.is_default
    from app.inventory_warehouses as w
    where w.id = p_warehouse_id;
end
$function$;

create function app_private.create_inventory_warehouse(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_name text,
  p_active boolean,
  p_is_default boolean
)
returns table (
  id uuid,
  restaurant_id uuid,
  branch_id uuid,
  name text,
  active boolean,
  is_default boolean
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

  if p_is_default and not p_active then
    raise exception using errcode = '22000', message = 'INVENTORY_WAREHOUSE_DEFAULT_REQUIRES_ACTIVE';
  end if;

  if p_is_default then
    update app.inventory_warehouses as w
    set is_default = false,
        updated_at = pg_catalog.clock_timestamp()
    where w.restaurant_id = p_restaurant_id
      and w.branch_id = p_branch_id
      and w.is_default;
  end if;

  return query
    with inserted as (
      insert into app.inventory_warehouses as w (
        restaurant_id, branch_id, name, active, is_default
      ) values (
        p_restaurant_id, p_branch_id, p_name, p_active, p_is_default
      )
      returning w.id, w.restaurant_id, w.branch_id, w.name, w.active, w.is_default
    )
    select w.id, w.restaurant_id, w.branch_id, w.name, w.active, w.is_default
    from inserted as w;
end
$function$;

create function app_private.update_inventory_warehouse(
  p_actor_id uuid,
  p_warehouse_id uuid,
  p_name text,
  p_active boolean,
  p_is_default boolean
)
returns table (
  id uuid,
  restaurant_id uuid,
  branch_id uuid,
  name text,
  active boolean,
  is_default boolean
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

  if p_is_default and p_active then
    update app.inventory_warehouses as w
    set is_default = false,
        updated_at = pg_catalog.clock_timestamp()
    where w.restaurant_id = v_restaurant_id
      and w.branch_id = v_branch_id
      and w.id <> p_warehouse_id
      and w.is_default;
  end if;

  return query
    with updated as (
      update app.inventory_warehouses as w
      set name = p_name,
          active = p_active,
          is_default = (p_is_default and p_active),
          updated_at = pg_catalog.clock_timestamp()
      where w.id = p_warehouse_id
        and w.restaurant_id = v_restaurant_id
        and w.branch_id = v_branch_id
      returning w.id, w.restaurant_id, w.branch_id, w.name, w.active, w.is_default
    )
    select w.id, w.restaurant_id, w.branch_id, w.name, w.active, w.is_default
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

alter function app_private.list_inventory_warehouses(uuid, uuid, uuid) owner to postgres;
alter function app_private.read_inventory_warehouse_for_manage(uuid, uuid) owner to postgres;
alter function app_private.create_inventory_warehouse(uuid, uuid, uuid, text, boolean, boolean) owner to postgres;
alter function app_private.update_inventory_warehouse(uuid, uuid, text, boolean, boolean) owner to postgres;

revoke all on function app_private.list_inventory_warehouses(uuid, uuid, uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.list_inventory_warehouses(uuid, uuid, uuid) to app_api;

revoke all on function app_private.read_inventory_warehouse_for_manage(uuid, uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.read_inventory_warehouse_for_manage(uuid, uuid) to app_api;

revoke all on function app_private.create_inventory_warehouse(uuid, uuid, uuid, text, boolean, boolean)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.create_inventory_warehouse(uuid, uuid, uuid, text, boolean, boolean) to app_api;

revoke all on function app_private.update_inventory_warehouse(uuid, uuid, text, boolean, boolean)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.update_inventory_warehouse(uuid, uuid, text, boolean, boolean) to app_api;

comment on function app_private.create_inventory_warehouse(uuid, uuid, uuid, text, boolean, boolean) is
  'Creates a branch warehouse; marking it default clears the previous branch default first and requires active.';
comment on function app_private.update_inventory_warehouse(uuid, uuid, text, boolean, boolean) is
  'Updates a branch warehouse; marking it default clears the previous branch default, and deactivating forces is_default false.';

commit;
