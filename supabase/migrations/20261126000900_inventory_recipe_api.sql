begin;

-- Recipe reads for the API. Publishing already lives in 20261126000300; these helpers only expose
-- versioned headers and their immutable line snapshots to a restaurant member, so the API never
-- touches app.inventory_recipes directly.

create function app_private.list_inventory_recipes(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_product_id uuid,
  p_include_inactive boolean
)
returns table (
  recipe_id uuid,
  restaurant_id uuid,
  product_id uuid,
  modifier_id uuid,
  version integer,
  active boolean,
  notes text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_actor_id is null or p_restaurant_id is null or p_product_id is null then
    raise exception using errcode = '22000', message = 'INVENTORY_RECIPE_ARGUMENT_MISSING';
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

  return query
    select rec.id, rec.restaurant_id, rec.product_id, rec.modifier_id, rec.version,
           rec.active, rec.notes, rec.created_at
    from app.inventory_recipes as rec
    where rec.restaurant_id = p_restaurant_id
      and rec.product_id = p_product_id
      and (p_include_inactive or rec.active)
    order by rec.product_id, rec.version desc;
end
$function$;

create function app_private.read_inventory_recipe(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_recipe_id uuid
)
returns table (
  recipe_id uuid,
  restaurant_id uuid,
  product_id uuid,
  modifier_id uuid,
  version integer,
  active boolean,
  notes text,
  item_id uuid,
  quantity integer,
  unit_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_actor_id is null or p_restaurant_id is null or p_recipe_id is null then
    raise exception using errcode = '22000', message = 'INVENTORY_RECIPE_ARGUMENT_MISSING';
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

  return query
    select rec.id, rec.restaurant_id, rec.product_id, rec.modifier_id, rec.version,
           rec.active, rec.notes, line.item_id, line.quantity, line.unit_code
    from app.inventory_recipes as rec
    join app.inventory_recipe_lines as line
      on line.recipe_id = rec.id
    where rec.restaurant_id = p_restaurant_id
      and rec.id = p_recipe_id
    order by line.item_id, line.unit_code;
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

alter function app_private.list_inventory_recipes(uuid, uuid, uuid, boolean) owner to postgres;
alter function app_private.read_inventory_recipe(uuid, uuid, uuid) owner to postgres;

revoke all on function app_private.list_inventory_recipes(uuid, uuid, uuid, boolean)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.list_inventory_recipes(uuid, uuid, uuid, boolean) to app_api;

revoke all on function app_private.read_inventory_recipe(uuid, uuid, uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.read_inventory_recipe(uuid, uuid, uuid) to app_api;

comment on function app_private.list_inventory_recipes(uuid, uuid, uuid, boolean) is
  'Restaurant-scoped, membership-checked recipe version listing, newest version first; inactive versions are optional.';
comment on function app_private.read_inventory_recipe(uuid, uuid, uuid) is
  'Restaurant-scoped, membership-checked recipe snapshot read, one row per line; empty when the recipe is out of scope or missing.';

commit;
