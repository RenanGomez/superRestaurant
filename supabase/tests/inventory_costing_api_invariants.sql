begin;

do $test$
declare
  manager uuid := gen_random_uuid();
  foreign_actor uuid := gen_random_uuid();
  unaffiliated uuid := gen_random_uuid();
  r uuid := gen_random_uuid();
  r2 uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  b2 uuid := gen_random_uuid();
  manager_membership uuid := gen_random_uuid();
  foreign_membership uuid := gen_random_uuid();
  flour uuid := gen_random_uuid();
  sugar uuid := gen_random_uuid();
  oil uuid := gen_random_uuid();
  warehouse_ref uuid := gen_random_uuid();
  catalog_id uuid := gen_random_uuid();
  category_id uuid := gen_random_uuid();
  product_id uuid := gen_random_uuid();
  result jsonb;
  visible bigint;
  quantity integer;
  min_quantity integer;
  deficit integer;
  value_minor bigint;
  unit_cost_minor bigint;
  currency text;
  remainder integer;
  line_quantity integer;
  purchase_unit_factor integer;
  line_cost_minor bigint;
  line_unit_code text;
  price_minor bigint;
  cost_minor bigint;
  margin_minor bigint;
  state text;
  err_message text;
  function_name text;
begin
  foreach function_name in array array[
    'app_private.list_inventory_alerts(uuid,uuid,uuid)',
    'app_private.inventory_average_cost(uuid,uuid,uuid,uuid,uuid)',
    'app_private.list_inventory_product_costs(uuid,uuid,uuid)',
    'app_private.read_inventory_product_margin(uuid,uuid,uuid,uuid)'
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

  insert into auth.users(id, email) values
    (manager, 'inventory-costing-manager@invalid.test'),
    (foreign_actor, 'inventory-costing-foreign@invalid.test'),
    (unaffiliated, 'inventory-costing-unaffiliated@invalid.test');
  insert into app.restaurants(id, name, time_zone) values
    (r, 'inventory costing', 'America/Hermosillo'),
    (r2, 'foreign inventory costing', 'America/Hermosillo');
  insert into app.branches(id, restaurant_id, name) values
    (b, r, 'inventory costing'),
    (b2, r2, 'foreign inventory costing');
  insert into app.memberships(id, user_id, restaurant_id, branch_id, granted_by) values
    (manager_membership, manager, r, b, manager),
    (foreign_membership, foreign_actor, r2, b2, foreign_actor);
  insert into app.membership_role_grants(membership_id, role_code, granted_by) values
    (manager_membership, 'manager', manager),
    (foreign_membership, 'manager', foreign_actor);

  insert into app.inventory_items(id, restaurant_id, name, unit_code, min_quantity) values
    (flour, r, 'Costing flour', 'g', 5),
    (sugar, r, 'Costing sugar', 'ml', 1),
    (oil, r, 'Costing oil', 'ml', 0);
  insert into app.inventory_warehouses(id, restaurant_id, branch_id, name, active, is_default) values
    (warehouse_ref, r, b, 'Costing main', true, true);

  insert into app.menu_catalogs(id, restaurant_id, version, currency, published_by) values
    (catalog_id, r, 1, 'MXN', manager);
  insert into app.menu_categories(restaurant_id, catalog_id, id, name, active, display_order) values
    (r, catalog_id, category_id, 'Costing', true, 1);
  insert into app.menu_products(
    restaurant_id, catalog_id, id, category_id, name, sku, active, display_order,
    station_id, unit, unit_price_minor
  ) values
    (r, catalog_id, product_id, category_id, 'Costing product', 'COSTING-1', true, 1,
     'kitchen', 'piece', 20000);
  insert into app.menu_catalog_heads(restaurant_id, catalog_id, version, updated_at, updated_by) values
    (r, catalog_id, 1, pg_catalog.clock_timestamp(), manager);

  -- Two receipts with different unit costs: 1*100 + 2*101 = 302 over 3 units => 101 (half up)
  -- with division remainder 2. Sugar is above its minimum and must not alert.
  insert into app.inventory_movements(
    restaurant_id, branch_id, warehouse_id, item_id, kind, quantity_delta, unit_code,
    occurred_at, actor_id, idempotency_key, unit_cost_minor, currency
  ) values
    (r, b, warehouse_ref, flour, 'receipt', 1, 'g', pg_catalog.clock_timestamp(), manager,
     'costing-flour-one', 100, 'MXN'),
    (r, b, warehouse_ref, flour, 'receipt', 2, 'g', pg_catalog.clock_timestamp(), manager,
     'costing-flour-two', 101, 'MXN'),
    (r, b, warehouse_ref, sugar, 'receipt', 5, 'ml', pg_catalog.clock_timestamp(), manager,
     'costing-sugar-one', 200, 'MXN');
  insert into app.inventory_balances(warehouse_id, item_id, quantity) values
    (warehouse_ref, flour, 3),
    (warehouse_ref, sugar, 5);

  result := app_private.publish_inventory_recipe(manager, r, pg_catalog.jsonb_build_object(
    'productId', product_id,
    'lines', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('itemId', flour, 'quantity', 150, 'unitCode', 'g'),
      pg_catalog.jsonb_build_object('itemId', sugar, 'quantity', 20, 'unitCode', 'ml')
    )
  ));
  if result ->> 'recipeId' is null then raise exception 'recipe was not published: %', result; end if;

  execute 'set local role app_api';

  -- Alerts only include stock below its positive minimum; the deficit is derived from the balance.
  select count(*) into visible from app_private.list_inventory_alerts(manager, r, b);
  if visible <> 1 then raise exception 'alerts = %, expected 1', visible; end if;
  select a.quantity, a.min_quantity, a.deficit
  into quantity, min_quantity, deficit
  from app_private.list_inventory_alerts(manager, r, b) as a
  where a.item_id = flour and a.warehouse_id = warehouse_ref;
  if quantity <> 3 or min_quantity <> 5 or deficit <> 2 then
    raise exception 'flour alert = %/%/%', quantity, min_quantity, deficit;
  end if;
  if exists (
    select 1 from app_private.list_inventory_alerts(manager, r, b) as a
    where a.item_id = sugar
  ) then
    raise exception 'sugar alerted above its minimum';
  end if;

  -- Weighted average from receipts: 302 / 3 = 101 with non-negative remainder 2.
  select c.quantity, c.value_minor, c.unit_cost_minor, c.currency, c.rounding_remainder
  into quantity, value_minor, unit_cost_minor, currency, remainder
  from app_private.inventory_average_cost(manager, r, b, warehouse_ref, flour) as c;
  if quantity <> 3 or value_minor <> 302 or unit_cost_minor <> 101
    or currency <> 'MXN' or remainder <> 2
  then
    raise exception 'flour average = %/%/%/%/%',
      quantity, value_minor, unit_cost_minor, currency, remainder;
  end if;

  -- An item without receipts has no average and no currency; it must not invent a cost.
  select c.quantity, c.value_minor, c.unit_cost_minor, c.currency, c.rounding_remainder
  into quantity, value_minor, unit_cost_minor, currency, remainder
  from app_private.inventory_average_cost(manager, r, b, warehouse_ref, oil) as c;
  if quantity <> 0 or value_minor <> 0 or unit_cost_minor <> 0
    or currency is not null or remainder <> 0
  then
    raise exception 'empty average = %/%/%/%/%',
      quantity, value_minor, unit_cost_minor, currency, remainder;
  end if;

  -- Product cost explodes the active recipe and multiplies each line by the average unit cost.
  select count(*) into visible from app_private.list_inventory_product_costs(manager, r, product_id);
  if visible <> 2 then raise exception 'product cost lines = %, expected 2', visible; end if;
  select c.quantity, c.purchase_unit_factor, c.unit_cost_minor, c.line_cost_minor, c.currency, c.unit_code
  into line_quantity, purchase_unit_factor, unit_cost_minor, line_cost_minor, currency, line_unit_code
  from app_private.list_inventory_product_costs(manager, r, product_id) as c
  where c.item_id = flour;
  if line_quantity <> 150 or purchase_unit_factor <> 1 or unit_cost_minor <> 101
    or line_cost_minor <> 15150 or currency <> 'MXN' or line_unit_code <> 'g'
  then
    raise exception 'flour product cost = %/%/%/%/%/%',
      line_quantity, purchase_unit_factor, unit_cost_minor, line_cost_minor, currency, line_unit_code;
  end if;
  select c.line_cost_minor into line_cost_minor
  from app_private.list_inventory_product_costs(manager, r, product_id) as c
  where c.item_id = sugar;
  if line_cost_minor <> 4000 then raise exception 'sugar line cost = %', line_cost_minor; end if;

  -- Margin uses the current published catalog price minus the current active recipe cost.
  select m.price_minor, m.cost_minor, m.margin_minor, m.currency
  into price_minor, cost_minor, margin_minor, currency
  from app_private.read_inventory_product_margin(manager, r, b, product_id) as m;
  if price_minor <> 20000 or cost_minor <> 19150 or margin_minor <> 850 or currency <> 'MXN' then
    raise exception 'margin = %/%/%/%', price_minor, cost_minor, margin_minor, currency;
  end if;

  -- Tenant isolation and missing membership fail closed with 42501.
  begin
    perform app_private.list_inventory_alerts(manager, r2, b2);
    raise exception 'manager read foreign alerts';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;
  begin
    perform app_private.inventory_average_cost(manager, r2, b2, warehouse_ref, flour);
    raise exception 'manager read foreign average cost';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;
  begin
    perform app_private.list_inventory_product_costs(manager, r2, product_id);
    raise exception 'manager read foreign product costs';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;
  begin
    perform app_private.read_inventory_product_margin(manager, r2, b2, product_id);
    raise exception 'manager read a foreign margin';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;
  begin
    perform app_private.list_inventory_alerts(unaffiliated, r, b);
    raise exception 'unaffiliated actor read alerts';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;

  -- A warehouse outside the branch is a request error, not a silent zero.
  begin
    perform app_private.inventory_average_cost(manager, r, b, gen_random_uuid(), flour);
    raise exception 'average cost accepted a foreign warehouse';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_WAREHOUSE_SCOPE_INVALID' then raise; end if;
  end;

  execute 'reset role';
end $test$;
rollback;
