begin;

-- The disposable local cluster stubs auth.uid() to NULL. Point it at a transaction-local GUC so RLS
-- can be exercised as an authenticated member; the whole test is rolled back.
create or replace function auth.uid() returns uuid language sql stable as $uid$
  select pg_catalog.current_setting('test.actor_id', true)::uuid
$uid$;

do $test$
declare
  actor uuid := gen_random_uuid();
  foreign_actor uuid := gen_random_uuid();
  r uuid := gen_random_uuid();
  r2 uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  b3 uuid := gen_random_uuid();
  b2 uuid := gen_random_uuid();
  m uuid := gen_random_uuid();
  m3 uuid := gen_random_uuid();
  m2 uuid := gen_random_uuid();
  catalog uuid := gen_random_uuid();
  catalog2 uuid := gen_random_uuid();
  category uuid := gen_random_uuid();
  category2 uuid := gen_random_uuid();
  product uuid := gen_random_uuid();
  product2 uuid := gen_random_uuid();
  modifier_group uuid := gen_random_uuid();
  modifier_group2 uuid := gen_random_uuid();
  modifier_option uuid := gen_random_uuid();
  modifier_option2 uuid := gen_random_uuid();
  flour uuid := gen_random_uuid();
  sugar uuid := gen_random_uuid();
  foreign_flour uuid := gen_random_uuid();
  recipe_v1 uuid;
  recipe_v2 uuid;
  foreign_recipe uuid := gen_random_uuid();
  result jsonb;
  visible bigint;
  active_count integer;
  state text;
  err_message text;
  tbl text;
  role_name text;
  function_oid oid := pg_catalog.to_regprocedure('app_private.publish_inventory_recipe(uuid,uuid,jsonb)');
begin
  -- RLS must be ENABLED and FORCED on both recipe tables.
  foreach tbl in array array['inventory_recipes','inventory_recipe_lines'] loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relname = tbl and c.relrowsecurity and c.relforcerowsecurity
    ) then raise exception 'missing FORCE RLS: %', tbl; end if;
  end loop;

  -- No direct write grants; only app_api may execute the publisher.
  foreach tbl in array array['inventory_recipes','inventory_recipe_lines'] loop
    foreach role_name in array array['authenticated','app_api','anon','service_role','public'] loop
      if pg_catalog.has_table_privilege(role_name::name, 'app.' || tbl, 'INSERT,UPDATE,DELETE,TRUNCATE') then
        raise exception 'direct write grant: %.%', role_name, tbl;
      end if;
    end loop;
  end loop;
  if function_oid is null then
    raise exception 'publish_inventory_recipe missing';
  end if;
  if not pg_catalog.has_function_privilege('app_api', function_oid, 'EXECUTE') then
    raise exception 'app_api cannot execute publish_inventory_recipe';
  end if;
  foreach role_name in array array['authenticated','anon','service_role','public'] loop
    if pg_catalog.has_function_privilege(role_name, function_oid, 'EXECUTE') then
      raise exception '% can execute publish_inventory_recipe', role_name;
    end if;
  end loop;

  insert into auth.users(id,email) values
    (actor, 'inventory-recipes@invalid.test'),
    (foreign_actor, 'inventory-recipes-foreign@invalid.test');
  insert into app.restaurants(id,name,time_zone) values
    (r, 'inventory recipes', 'America/Hermosillo'),
    (r2, 'foreign inventory recipes', 'America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (b, r, 'inventory recipes'),
    (b3, r, 'inventory recipes second branch'),
    (b2, r2, 'foreign inventory recipes');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values
    (m, actor, r, b, actor),
    (m3, actor, r, b3, actor),
    (m2, foreign_actor, r2, b2, foreign_actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values
    (m, 'cashier', actor),
    (m3, 'cashier', actor),
    (m2, 'cashier', foreign_actor);

  insert into app.menu_catalogs(id,restaurant_id,version,currency,published_by) values
    (catalog, r, 1, 'MXN', actor),
    (catalog2, r2, 1, 'MXN', foreign_actor);
  insert into app.menu_categories(restaurant_id,catalog_id,id,name,active,display_order) values
    (r, catalog, category, 'Recipes', true, 1),
    (r2, catalog2, category2, 'Foreign recipes', true, 1);
  insert into app.menu_products(
    restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor
  ) values
    (r, catalog, product, category, 'Recipe product', 'RECIPE-1', true, 1, 'kitchen', 'piece', 10000),
    (r2, catalog2, product2, category2, 'Foreign recipe product', 'RECIPE-2', true, 1, 'kitchen', 'piece', 10000);
  insert into app.menu_modifier_groups(
    restaurant_id,catalog_id,id,product_id,name,active,display_order,minimum_quantity,maximum_quantity
  ) values
    (r, catalog, modifier_group, product, 'Extras', true, 1, 0, 1),
    (r2, catalog2, modifier_group2, product2, 'Foreign extras', true, 1, 0, 1);
  insert into app.menu_modifier_options(
    restaurant_id,catalog_id,group_id,id,name,unit_price_minor,active,maximum_quantity
  ) values
    (r, catalog, modifier_group, modifier_option, 'Extra cheese', 500, true, 1),
    (r2, catalog2, modifier_group2, modifier_option2, 'Foreign extra', 500, true, 1);
  insert into app.inventory_items(id,restaurant_id,name,unit_code) values
    (flour, r, 'Recipe flour', 'g'),
    (sugar, r, 'Recipe sugar', 'ml'),
    (foreign_flour, r2, 'Foreign recipe flour', 'g');

  -- 1. Publishing v1 then v2 leaves only v2 active and keeps v1 as history.
  result := app_private.publish_inventory_recipe(actor, r, pg_catalog.jsonb_build_object(
    'productId', product,
    'notes', 'first version',
    'lines', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('itemId', flour, 'quantity', 500, 'unitCode', 'g'),
      pg_catalog.jsonb_build_object('itemId', sugar, 'quantity', 200, 'unitCode', 'ml')
    )
  ));
  if (result->>'version')::integer is distinct from 1 then raise exception 'first publish version %', result; end if;
  recipe_v1 := (result->>'recipeId')::uuid;
  if (select count(*) from app.inventory_recipe_lines where recipe_id = recipe_v1) <> 2 then
    raise exception 'first recipe lines not stored';
  end if;

  result := app_private.publish_inventory_recipe(actor, r, pg_catalog.jsonb_build_object(
    'productId', product,
    'lines', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('itemId', flour, 'quantity', 600, 'unitCode', 'g')
    )
  ));
  if (result->>'version')::integer is distinct from 2 then raise exception 'second publish version %', result; end if;
  recipe_v2 := (result->>'recipeId')::uuid;
  if (select active from app.inventory_recipes where id = recipe_v1) is distinct from false then
    raise exception 'v1 still active after v2 publish';
  end if;
  if (select active from app.inventory_recipes where id = recipe_v2) is not true then
    raise exception 'v2 not active';
  end if;
  select count(*) into active_count from app.inventory_recipes
  where restaurant_id = r and product_id = product and modifier_id is null and active;
  if active_count <> 1 then raise exception 'active recipe count %, expected 1', active_count; end if;
  if (select version from app.inventory_recipes where id = recipe_v1) is distinct from 1 then
    raise exception 'v1 version overwritten';
  end if;

  -- Modifier-scoped recipes publish and deactivate independently from the base recipe.
  result := app_private.publish_inventory_recipe(actor, r, pg_catalog.jsonb_build_object(
    'productId', product,
    'modifierId', modifier_option,
    'lines', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('itemId', sugar, 'quantity', 50, 'unitCode', 'ml')
    )
  ));
  if (result->>'version')::integer is distinct from 1 then raise exception 'modifier publish version %', result; end if;
  if (select active from app.inventory_recipes where id = recipe_v2) is not true then
    raise exception 'modifier publish deactivated the base recipe';
  end if;

  -- 2. An item from another restaurant is rejected.
  begin
    perform app_private.publish_inventory_recipe(actor, r, pg_catalog.jsonb_build_object(
      'productId', product,
      'lines', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('itemId', foreign_flour, 'quantity', 10, 'unitCode', 'g')
      )
    ));
    raise exception 'foreign item recipe accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_RECIPE_ITEM_SCOPE_INVALID' then raise; end if;
  end;

  -- 3. Quantity zero, a decimal quantity and an incompatible unit are all rejected.
  begin
    perform app_private.publish_inventory_recipe(actor, r, pg_catalog.jsonb_build_object(
      'productId', product,
      'lines', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('itemId', flour, 'quantity', 0, 'unitCode', 'g')
      )
    ));
    raise exception 'zero quantity accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_RECIPE_LINE_QUANTITY_INVALID' then raise; end if;
  end;
  begin
    perform app_private.publish_inventory_recipe(actor, r, pg_catalog.jsonb_build_object(
      'productId', product,
      'lines', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('itemId', flour, 'quantity', 1.5::numeric, 'unitCode', 'g')
      )
    ));
    raise exception 'decimal quantity accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_RECIPE_LINE_QUANTITY_INVALID' then raise; end if;
  end;
  begin
    perform app_private.publish_inventory_recipe(actor, r, pg_catalog.jsonb_build_object(
      'productId', product,
      'lines', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('itemId', flour, 'quantity', 10, 'unitCode', 'ml')
      )
    ));
    raise exception 'incompatible unit accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_RECIPE_UNIT_INCOMPATIBLE' then raise; end if;
  end;

  -- 4. Two active recipes for the same product and modifier scope cannot coexist.
  begin
    insert into app.inventory_recipes (restaurant_id, product_id, modifier_id, version, active, created_by)
    values (r, product, null, 99, true, actor);
    raise exception 'second active recipe accepted';
  exception when unique_violation then null; end;

  -- The recipe line snapshot cannot be updated.
  begin
    update app.inventory_recipe_lines set quantity = 1 where recipe_id = recipe_v2;
    raise exception 'recipe line update accepted';
  exception when sqlstate '42501' then null; end;

  -- 5. An actor from another restaurant cannot publish (tenant isolation).
  begin
    perform app_private.publish_inventory_recipe(foreign_actor, r, pg_catalog.jsonb_build_object(
      'productId', product,
      'lines', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('itemId', flour, 'quantity', 10, 'unitCode', 'g')
      )
    ));
    raise exception 'foreign actor published a recipe';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;

  -- A product from another restaurant is out of scope.
  begin
    perform app_private.publish_inventory_recipe(actor, r, pg_catalog.jsonb_build_object(
      'productId', product2,
      'lines', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('itemId', flour, 'quantity', 10, 'unitCode', 'g')
      )
    ));
    raise exception 'foreign product recipe accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_RECIPE_PRODUCT_SCOPE_INVALID' then raise; end if;
  end;

  -- 6. RLS: a member of branch A only sees recipes and lines of its own restaurant.
  insert into app.inventory_recipes (
    id, restaurant_id, product_id, modifier_id, version, active, created_by
  ) values (
    foreign_recipe, r2, product2, null, 1, true, foreign_actor
  );
  insert into app.inventory_recipe_lines (recipe_id, item_id, quantity, unit_code)
  values (foreign_recipe, foreign_flour, 100, 'g');

  perform pg_catalog.set_config('test.actor_id', actor::text, true);
  execute 'set local role authenticated';
  select count(*) into visible from app.inventory_recipes where id in (recipe_v1, recipe_v2);
  if visible <> 2 then raise exception 'own recipes visible: %', visible; end if;
  select count(*) into visible from app.inventory_recipes where id = foreign_recipe;
  if visible <> 0 then raise exception 'foreign recipe visible: %', visible; end if;
  select count(*) into visible from app.inventory_recipe_lines where recipe_id = recipe_v2;
  if visible <> 1 then raise exception 'own recipe lines visible: %', visible; end if;
  select count(*) into visible from app.inventory_recipe_lines where recipe_id = foreign_recipe;
  if visible <> 0 then raise exception 'foreign recipe lines visible: %', visible; end if;
  begin
    insert into app.inventory_recipes (restaurant_id, product_id, version)
    values (r, product, 50);
    raise exception 'authenticated inserted a recipe';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
end $test$;
rollback;
