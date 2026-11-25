begin;

do $test$
declare
  actor uuid := gen_random_uuid();
  foreign_actor uuid := gen_random_uuid();
  unaffiliated uuid := gen_random_uuid();
  r uuid := gen_random_uuid();
  r2 uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  b2 uuid := gen_random_uuid();
  m uuid := gen_random_uuid();
  m2 uuid := gen_random_uuid();
  catalog uuid := gen_random_uuid();
  catalog2 uuid := gen_random_uuid();
  category uuid := gen_random_uuid();
  category2 uuid := gen_random_uuid();
  product uuid := gen_random_uuid();
  product2 uuid := gen_random_uuid();
  flour uuid := gen_random_uuid();
  sugar uuid := gen_random_uuid();
  recipe_v1 uuid;
  recipe_v2 uuid;
  result jsonb;
  visible bigint;
  state text;
  err_message text;
  function_name text;
begin
  insert into auth.users(id, email) values
    (actor, 'inventory-recipe-api@invalid.test'),
    (foreign_actor, 'inventory-recipe-api-foreign@invalid.test'),
    (unaffiliated, 'inventory-recipe-api-unaffiliated@invalid.test');
  insert into app.restaurants(id, name, time_zone) values
    (r, 'inventory recipe api', 'America/Hermosillo'),
    (r2, 'foreign inventory recipe api', 'America/Hermosillo');
  insert into app.branches(id, restaurant_id, name) values
    (b, r, 'inventory recipe api'),
    (b2, r2, 'foreign inventory recipe api');
  insert into app.memberships(id, user_id, restaurant_id, branch_id, granted_by) values
    (m, actor, r, b, actor),
    (m2, foreign_actor, r2, b2, foreign_actor);
  insert into app.membership_role_grants(membership_id, role_code, granted_by) values
    (m, 'cashier', actor),
    (m2, 'manager', foreign_actor);

  insert into app.menu_catalogs(id, restaurant_id, version, currency, published_by) values
    (catalog, r, 1, 'MXN', actor),
    (catalog2, r2, 1, 'MXN', foreign_actor);
  insert into app.menu_categories(restaurant_id, catalog_id, id, name, active, display_order) values
    (r, catalog, category, 'Recipe API', true, 1),
    (r2, catalog2, category2, 'Foreign recipe API', true, 1);
  insert into app.menu_products(
    restaurant_id, catalog_id, id, category_id, name, sku, active, display_order, station_id, unit, unit_price_minor
  ) values
    (r, catalog, product, category, 'Recipe API product', 'RECIPE-API-1', true, 1, 'kitchen', 'piece', 10000),
    (r2, catalog2, product2, category2, 'Foreign recipe API product', 'RECIPE-API-2', true, 1, 'kitchen', 'piece', 10000);
  insert into app.inventory_items(id, restaurant_id, name, unit_code) values
    (flour, r, 'Recipe API flour', 'g'),
    (sugar, r, 'Recipe API sugar', 'ml');

  -- Two publishes through the existing private writer; the read API must expose both versions.
  result := app_private.publish_inventory_recipe(actor, r, pg_catalog.jsonb_build_object(
    'productId', product,
    'notes', 'first version',
    'lines', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('itemId', flour, 'quantity', 500, 'unitCode', 'g')
    )
  ));
  recipe_v1 := (result ->> 'recipeId')::uuid;
  result := app_private.publish_inventory_recipe(actor, r, pg_catalog.jsonb_build_object(
    'productId', product,
    'lines', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('itemId', flour, 'quantity', 600, 'unitCode', 'g'),
      pg_catalog.jsonb_build_object('itemId', sugar, 'quantity', 200, 'unitCode', 'ml')
    )
  ));
  recipe_v2 := (result ->> 'recipeId')::uuid;

  -- Grants: only app_api executes the read helpers, and no direct table path is exposed.
  foreach function_name in array array[
    'app_private.list_inventory_recipes(uuid,uuid,uuid,boolean)',
    'app_private.read_inventory_recipe(uuid,uuid,uuid)'
  ] loop
    if not pg_catalog.has_function_privilege('app_api', function_name, 'EXECUTE') then
      raise exception 'app_api cannot execute %', function_name;
    end if;
    foreach state in array array['authenticated', 'anon', 'service_role', 'public'] loop
      if pg_catalog.has_function_privilege(state, function_name, 'EXECUTE') then
        raise exception '% can execute %', state, function_name;
      end if;
    end loop;
  end loop;

  execute 'set local role app_api';

  -- Default listing only shows the active version; include_inactive returns the full history newest first.
  select count(*) into visible
  from app_private.list_inventory_recipes(actor, r, product, false) as rec;
  if visible <> 1 then raise exception 'active recipe list = %, expected 1', visible; end if;
  if not exists (
    select 1
    from app_private.list_inventory_recipes(actor, r, product, false) as rec
    where rec.recipe_id = recipe_v2
      and rec.version = 2
      and rec.active
      and rec.modifier_id is null
  ) then
    raise exception 'active recipe list does not expose v2';
  end if;

  select count(*) into visible
  from app_private.list_inventory_recipes(actor, r, product, true) as rec;
  if visible <> 2 then raise exception 'full recipe list = %, expected 2', visible; end if;
  if (
    select pg_catalog.array_agg(rec.version order by rec.version desc)
    from app_private.list_inventory_recipes(actor, r, product, true) as rec
  ) <> array[2, 1] then
    raise exception 'recipe list is not version-descending';
  end if;
  if (
    select rec.active
    from app_private.list_inventory_recipes(actor, r, product, true) as rec
    where rec.recipe_id = recipe_v1
  ) is distinct from false then
    raise exception 'v1 is still active';
  end if;

  -- Reading by id returns one row per line of the snapshot.
  select count(*) into visible
  from app_private.read_inventory_recipe(actor, r, recipe_v2) as rec;
  if visible <> 2 then raise exception 'recipe read lines = %, expected 2', visible; end if;
  if not exists (
    select 1
    from app_private.read_inventory_recipe(actor, r, recipe_v2) as rec
    where rec.item_id = flour and rec.quantity = 600 and rec.unit_code = 'g' and rec.version = 2
  ) then
    raise exception 'recipe read lost the flour line';
  end if;
  if not exists (
    select 1
    from app_private.read_inventory_recipe(actor, r, recipe_v2) as rec
    where rec.item_id = sugar and rec.quantity = 200 and rec.unit_code = 'ml'
  ) then
    raise exception 'recipe read lost the sugar line';
  end if;

  -- A recipe that does not exist yields zero rows instead of an error.
  select count(*) into visible
  from app_private.read_inventory_recipe(actor, r, gen_random_uuid()) as rec;
  if visible <> 0 then raise exception 'missing recipe returned % rows', visible; end if;
  select count(*) into visible
  from app_private.list_inventory_recipes(actor, r, product2, true) as rec;
  if visible <> 0 then raise exception 'unknown product returned % rows', visible; end if;

  -- Tenant isolation: a member of another restaurant cannot list or read these recipes.
  begin
    perform app_private.list_inventory_recipes(actor, r2, product2, true);
    raise exception 'actor listed another restaurant''s recipes';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;
  begin
    perform app_private.read_inventory_recipe(actor, r2, recipe_v1);
    raise exception 'actor read another restaurant''s recipe';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;

  -- An actor without any membership is forbidden even for its own id.
  begin
    perform app_private.list_inventory_recipes(unaffiliated, r, product, true);
    raise exception 'unaffiliated actor listed recipes';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;
  begin
    perform app_private.read_inventory_recipe(unaffiliated, r, recipe_v1);
    raise exception 'unaffiliated actor read a recipe';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;

  execute 'reset role';
end $test$;
rollback;
