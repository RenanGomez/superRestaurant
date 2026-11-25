begin;

-- Versioned recipes per product and modifier option. Each recipe is a frozen snapshot of its lines;
-- new versions are published by the private function, which deactivates the previous active version in
-- the same transaction. Clients never write recipes directly.
create table app.inventory_recipes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references app.restaurants (id) on delete restrict,
  product_id uuid not null,
  modifier_id uuid,
  version integer not null,
  active boolean not null default true,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by uuid references auth.users (id) on delete restrict,
  notes text,
  constraint inventory_recipes_version_positive check (version > 0),
  constraint inventory_recipes_notes_valid check (
    notes is null or pg_catalog.char_length(pg_catalog.btrim(notes)) between 1 and 500
  )
);

-- One row per version of a product base recipe (modifier_id null) or modifier recipe.
create unique index inventory_recipes_scope_version_unique
  on app.inventory_recipes (
    restaurant_id,
    product_id,
    (coalesce(modifier_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    version
  );

-- At most one active version per product and modifier scope.
create unique index inventory_recipes_active_scope_unique
  on app.inventory_recipes (
    restaurant_id,
    product_id,
    (coalesce(modifier_id, '00000000-0000-0000-0000-000000000000'::uuid))
  )
  where active;

create table app.inventory_recipe_lines (
  recipe_id uuid not null references app.inventory_recipes (id) on delete cascade,
  item_id uuid not null references app.inventory_items (id) on delete restrict,
  quantity integer not null,
  unit_code text not null,
  constraint inventory_recipe_lines_quantity_positive check (quantity > 0),
  constraint inventory_recipe_lines_unit_code_valid check (unit_code in ('g', 'ml', 'piece')),
  constraint inventory_recipe_lines_unique unique (recipe_id, item_id, unit_code)
);

create function app_private.reject_inventory_recipe_line_mutation() returns trigger
language plpgsql set search_path = '' as $function$
begin
  raise exception using errcode = '42501', message = 'INVENTORY_RECIPE_LINE_IMMUTABLE';
end
$function$;

create trigger inventory_recipe_lines_immutable
  before update on app.inventory_recipe_lines
  for each row execute function app_private.reject_inventory_recipe_line_mutation();

create function app_private.publish_inventory_recipe(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_product_id uuid;
  v_modifier_id uuid;
  v_item_id uuid;
  v_item_unit text;
  v_item_deleted_at timestamptz;
  v_line jsonb;
  v_lines jsonb;
  v_line_unit text;
  v_version integer;
  v_recipe_id uuid;
  v_notes text;
begin
  if p_actor_id is null or p_restaurant_id is null then
    raise exception using errcode = '22000', message = 'INVENTORY_RECIPE_ARGUMENT_MISSING';
  end if;

  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22000', message = 'INVENTORY_RECIPE_PAYLOAD_INVALID';
  end if;

  if pg_catalog.jsonb_typeof(p_payload->'productId') is distinct from 'string'
    or not coalesce(
      (p_payload->>'productId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      false
    )
  then
    raise exception using errcode = '22000', message = 'INVENTORY_RECIPE_PRODUCT_INVALID';
  end if;
  v_product_id := (p_payload->>'productId')::uuid;

  if (p_payload ? 'modifierId') and pg_catalog.jsonb_typeof(p_payload->'modifierId') <> 'null' then
    if pg_catalog.jsonb_typeof(p_payload->'modifierId') <> 'string'
      or not coalesce(
        (p_payload->>'modifierId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
        false
      )
    then
      raise exception using errcode = '22000', message = 'INVENTORY_RECIPE_MODIFIER_INVALID';
    end if;
    v_modifier_id := (p_payload->>'modifierId')::uuid;
  end if;

  if (p_payload ? 'notes') and pg_catalog.jsonb_typeof(p_payload->'notes') <> 'null' then
    if pg_catalog.jsonb_typeof(p_payload->'notes') <> 'string' then
      raise exception using errcode = '22000', message = 'INVENTORY_RECIPE_NOTES_INVALID';
    end if;
    v_notes := pg_catalog.btrim(p_payload->>'notes');
    if pg_catalog.char_length(v_notes) not between 1 and 500 then
      raise exception using errcode = '22000', message = 'INVENTORY_RECIPE_NOTES_INVALID';
    end if;
  end if;

  v_lines := p_payload->'lines';
  if v_lines is null
    or pg_catalog.jsonb_typeof(v_lines) <> 'array'
    or pg_catalog.jsonb_array_length(v_lines) not between 1 and 200
  then
    raise exception using errcode = '22000', message = 'INVENTORY_RECIPE_LINES_INVALID';
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
      and m.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'INVENTORY_ACTOR_FORBIDDEN';
  end if;

  if not exists (
    select 1
    from app.menu_products as p
    where p.id = v_product_id
      and p.restaurant_id = p_restaurant_id
  ) then
    raise exception using errcode = '22000', message = 'INVENTORY_RECIPE_PRODUCT_SCOPE_INVALID';
  end if;

  if v_modifier_id is not null and not exists (
    select 1
    from app.menu_modifier_options as o
    where o.id = v_modifier_id
      and o.restaurant_id = p_restaurant_id
  ) then
    raise exception using errcode = '22000', message = 'INVENTORY_RECIPE_MODIFIER_SCOPE_INVALID';
  end if;

  for v_line in select e.value from pg_catalog.jsonb_array_elements(v_lines) as e(value) loop
    if pg_catalog.jsonb_typeof(v_line) <> 'object' then
      raise exception using errcode = '22000', message = 'INVENTORY_RECIPE_LINE_INVALID';
    end if;

    if pg_catalog.jsonb_typeof(v_line->'itemId') is distinct from 'string'
      or not coalesce(
        (v_line->>'itemId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
        false
      )
    then
      raise exception using errcode = '22000', message = 'INVENTORY_RECIPE_LINE_ITEM_INVALID';
    end if;
    v_item_id := (v_line->>'itemId')::uuid;

    if pg_catalog.jsonb_typeof(v_line->'quantity') is distinct from 'number'
      or not coalesce((v_line->>'quantity') ~ '^[1-9][0-9]{0,8}$', false)
    then
      raise exception using errcode = '22000', message = 'INVENTORY_RECIPE_LINE_QUANTITY_INVALID';
    end if;

    if pg_catalog.jsonb_typeof(v_line->'unitCode') is distinct from 'string'
      or (v_line->>'unitCode') not in ('g', 'ml', 'piece')
    then
      raise exception using errcode = '22000', message = 'INVENTORY_RECIPE_LINE_UNIT_INVALID';
    end if;
    v_line_unit := v_line->>'unitCode';

    select i.unit_code, i.deleted_at into v_item_unit, v_item_deleted_at
    from app.inventory_items as i
    where i.id = v_item_id
      and i.restaurant_id = p_restaurant_id;

    if not found then
      raise exception using errcode = '22000', message = 'INVENTORY_RECIPE_ITEM_SCOPE_INVALID';
    end if;

    if v_item_deleted_at is not null then
      raise exception using errcode = '22000', message = 'INVENTORY_RECIPE_ITEM_INACTIVE';
    end if;

    if v_item_unit <> v_line_unit then
      raise exception using errcode = '22000', message = 'INVENTORY_RECIPE_UNIT_INCOMPATIBLE';
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_lines) as e(value)
    group by e.value->>'itemId', e.value->>'unitCode'
    having count(*) > 1
  ) then
    raise exception using errcode = '22000', message = 'INVENTORY_RECIPE_LINE_DUPLICATE';
  end if;

  -- Serialize concurrent publishes of the same product/modifier scope before reading the last version.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_restaurant_id::text || ':' || v_product_id::text || ':' || coalesce(v_modifier_id::text, ''),
    0
  ));

  select coalesce(max(version), 0) + 1 into v_version
  from app.inventory_recipes
  where restaurant_id = p_restaurant_id
    and product_id = v_product_id
    and modifier_id is not distinct from v_modifier_id;

  update app.inventory_recipes
  set active = false
  where restaurant_id = p_restaurant_id
    and product_id = v_product_id
    and modifier_id is not distinct from v_modifier_id
    and active;

  insert into app.inventory_recipes (
    restaurant_id, product_id, modifier_id, version, active, created_by, notes
  ) values (
    p_restaurant_id, v_product_id, v_modifier_id, v_version, true, p_actor_id, v_notes
  )
  returning id into v_recipe_id;

  insert into app.inventory_recipe_lines (recipe_id, item_id, quantity, unit_code)
  select v_recipe_id, (e.value->>'itemId')::uuid, (e.value->>'quantity')::integer, e.value->>'unitCode'
  from pg_catalog.jsonb_array_elements(v_lines) as e(value);

  return pg_catalog.jsonb_build_object('recipeId', v_recipe_id, 'version', v_version);
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

alter function app_private.publish_inventory_recipe(uuid, uuid, jsonb) owner to postgres;

revoke all on app.inventory_recipes, app.inventory_recipe_lines
  from public, anon, authenticated, service_role, app_api;
grant select on app.inventory_recipes, app.inventory_recipe_lines to authenticated;

revoke all on function app_private.publish_inventory_recipe(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.publish_inventory_recipe(uuid, uuid, jsonb) to app_api;

alter table app.inventory_recipes enable row level security;
alter table app.inventory_recipes force row level security;
alter table app.inventory_recipe_lines enable row level security;
alter table app.inventory_recipe_lines force row level security;

create policy inventory_recipes_active_member_read
  on app.inventory_recipes
  for select
  to authenticated
  using (app_rls.has_active_restaurant_membership(restaurant_id));

create policy inventory_recipe_lines_active_member_read
  on app.inventory_recipe_lines
  for select
  to authenticated
  using (exists (
    select 1
    from app.inventory_recipes as r
    where r.id = recipe_id
      and app_rls.has_active_restaurant_membership(r.restaurant_id)
  ));

comment on table app.inventory_recipes is
  'Versioned recipe header per product and optional modifier; exactly one active version per scope.';
comment on column app.inventory_recipes.modifier_id is
  'Modifier option the recipe applies to; null means the base recipe of the product.';
comment on column app.inventory_recipes.version is
  'Monotonic version within (restaurant, product, modifier); a new publish deactivates the previous one.';
comment on column app.inventory_recipes.notes is
  'Optional operator note for this recipe version.';
comment on table app.inventory_recipe_lines is
  'Immutable snapshot of the items and integer quantities consumed by one recipe version.';
comment on column app.inventory_recipe_lines.quantity is
  'Integer quantity in the item base unit; never zero or negative.';
comment on function app_private.publish_inventory_recipe(uuid, uuid, jsonb) is
  'Server-only publish of a versioned recipe with actor scope, same-restaurant items, unit compatibility and previous-version deactivation.';

commit;
