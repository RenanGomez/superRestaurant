begin;

-- Disposable local cluster stubs auth.uid() to NULL; point it at a transaction-local GUC so the RLS
-- policy can be exercised as a real member. Everything is rolled back at the end.
create or replace function auth.uid() returns uuid language sql stable as $uid$
  select pg_catalog.current_setting('test.actor_id', true)::uuid
$uid$;

do $test$
declare
  actor uuid := gen_random_uuid();
  foreign_actor uuid := gen_random_uuid();
  branch_actor uuid := gen_random_uuid();
  r uuid := gen_random_uuid();
  r2 uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  b3 uuid := gen_random_uuid();
  b2 uuid := gen_random_uuid();
  m uuid := gen_random_uuid();
  m2 uuid := gen_random_uuid();
  m3 uuid := gen_random_uuid();
  catalog uuid := gen_random_uuid();
  catalog2 uuid := gen_random_uuid();
  category uuid := gen_random_uuid();
  category2 uuid := gen_random_uuid();
  simple_product uuid := gen_random_uuid();
  pizza_product uuid := gen_random_uuid();
  half_a uuid := gen_random_uuid();
  half_b uuid := gen_random_uuid();
  no_recipe_product uuid := gen_random_uuid();
  foreign_product uuid := gen_random_uuid();
  flour uuid := gen_random_uuid();
  cheese uuid := gen_random_uuid();
  olive uuid := gen_random_uuid();
  foreign_flour uuid := gen_random_uuid();
  warehouse uuid := gen_random_uuid();
  foreign_warehouse uuid := gen_random_uuid();
  order1 uuid := gen_random_uuid();
  order2 uuid := gen_random_uuid();
  order3 uuid := gen_random_uuid();
  order_foreign uuid := gen_random_uuid();
  simple_item uuid := gen_random_uuid();
  pizza_item uuid := gen_random_uuid();
  no_recipe_item uuid := gen_random_uuid();
  sent_item uuid := gen_random_uuid();
  pending_item uuid := gen_random_uuid();
  result jsonb;
  balance integer;
  flour_delta integer;
  cheese_delta integer;
  olive_delta integer;
  movement_count bigint;
  reversal_count bigint;
  consumption_count bigint;
  visible bigint;
  state text;
  err_message text;
  role_name text;
  occurred timestamptz;
  occurred_text text;
  reason text := 'customer changed mind';
  device uuid := gen_random_uuid();
  command_event uuid := gen_random_uuid();
  command_key text := gen_random_uuid()::text;
  line_event uuid := gen_random_uuid();
  line_key text := gen_random_uuid()::text;
  order3_aggregate jsonb;
  line_order jsonb;
  final_order jsonb;
  sent_item_obj jsonb;
  pending_item_obj jsonb;
  sent_item_cancelled jsonb;
  pending_item_cancelled jsonb;
  line_step_audit jsonb;
  order_step_audit jsonb;
  line_item_audit jsonb;
  order_cancel_audit jsonb;
  pending_cancel_audit jsonb;
  command jsonb;
  steps jsonb;
  expected_events jsonb;
  function_consume oid := pg_catalog.to_regprocedure('app_private.inventory_consume_order(uuid,uuid,uuid,uuid)');
  function_reverse oid := pg_catalog.to_regprocedure('app_private.inventory_reverse_order_item(uuid,uuid,uuid,uuid,uuid)');
  function_confirm oid := pg_catalog.to_regprocedure('app_private.confirm_capture_draft_v3_with_inventory(uuid,jsonb,jsonb,jsonb)');
  function_cancel oid := pg_catalog.to_regprocedure('app_private.cancel_order_with_inventory(uuid,jsonb,jsonb)');
  function_events oid := pg_catalog.to_regprocedure('app_private.inventory_cancellation_event_ids(jsonb,jsonb)');
begin
  -- 0. Schema contract: FORCE RLS, no direct writes, server-only functions, default warehouse.
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relname = 'inventory_consumptions'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then raise exception 'missing FORCE RLS: inventory_consumptions'; end if;

  foreach role_name in array array['authenticated', 'app_api', 'anon', 'service_role', 'public'] loop
    if pg_catalog.has_table_privilege(role_name::name, 'app.inventory_consumptions', 'INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'direct write grant: %.inventory_consumptions', role_name;
    end if;
  end loop;

  if function_consume is null then raise exception 'inventory_consume_order(uuid,uuid,uuid,uuid) missing'; end if;
  if pg_catalog.to_regprocedure('app_private.inventory_consume_order(uuid,uuid,uuid,uuid,uuid)') is not null then
    raise exception 'inventory_consume_order still accepts a caller warehouse';
  end if;
  if function_reverse is null then raise exception 'inventory_reverse_order_item missing'; end if;
  if function_confirm is null then raise exception 'confirm_capture_draft_v3_with_inventory missing'; end if;
  if function_cancel is null then raise exception 'cancel_order_with_inventory missing'; end if;
  if function_events is null then raise exception 'inventory_cancellation_event_ids missing'; end if;

  if not exists (
    select 1 from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relname = 'inventory_warehouses'
      and a.attname = 'is_default' and not a.attisdropped
  ) then raise exception 'inventory_warehouses.is_default missing'; end if;
  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'app' and tablename = 'inventory_warehouses'
      and indexname = 'inventory_warehouses_one_default_idx'
  ) then raise exception 'default warehouse unique index missing'; end if;

  foreach role_name in array array['authenticated', 'anon', 'service_role', 'public'] loop
    if pg_catalog.has_function_privilege(role_name, function_consume, 'EXECUTE')
      or pg_catalog.has_function_privilege(role_name, function_reverse, 'EXECUTE')
      or pg_catalog.has_function_privilege(role_name, function_confirm, 'EXECUTE')
      or pg_catalog.has_function_privilege(role_name, function_cancel, 'EXECUTE')
    then raise exception '% can execute an inventory sale function', role_name; end if;
  end loop;
  if not pg_catalog.has_function_privilege('app_api', function_consume, 'EXECUTE')
    or not pg_catalog.has_function_privilege('app_api', function_reverse, 'EXECUTE')
    or not pg_catalog.has_function_privilege('app_api', function_confirm, 'EXECUTE')
    or not pg_catalog.has_function_privilege('app_api', function_cancel, 'EXECUTE')
  then raise exception 'app_api cannot execute an inventory sale function'; end if;
  if pg_catalog.has_function_privilege('app_api', function_events, 'EXECUTE') then
    raise exception 'app_api can execute the internal event-set helper';
  end if;

  -- The existing confirmation/cancellation keep their grants; they are not edited by this slice.
  if not pg_catalog.has_function_privilege('app_api',
      'app_private.confirm_capture_draft_v3(uuid,jsonb,jsonb,jsonb)', 'EXECUTE')
    or not pg_catalog.has_function_privilege('app_api',
      'app_private.cancel_order(uuid,jsonb,jsonb)', 'EXECUTE')
  then raise exception 'existing sale functions lost their grant'; end if;

  if pg_catalog.obj_description(function_confirm, 'pg_proc') is null
    or pg_catalog.obj_description(function_confirm, 'pg_proc') not like '%Call this instead of confirm_capture_draft_v3%'
  then raise exception 'missing API comment on confirm_capture_draft_v3_with_inventory'; end if;
  if pg_catalog.obj_description(function_cancel, 'pg_proc') is null
    or pg_catalog.obj_description(function_cancel, 'pg_proc') not like '%Call this instead of cancel_order%'
  then raise exception 'missing API comment on cancel_order_with_inventory'; end if;

  insert into auth.users(id, email) values
    (actor, 'inventory-sale@invalid.test'),
    (foreign_actor, 'inventory-sale-foreign@invalid.test'),
    (branch_actor, 'inventory-sale-branch@invalid.test');
  insert into app.restaurants(id, name, time_zone) values
    (r, 'inventory sale', 'America/Hermosillo'),
    (r2, 'foreign inventory sale', 'America/Hermosillo');
  insert into app.branches(id, restaurant_id, name) values
    (b, r, 'inventory sale'),
    (b3, r, 'inventory sale second branch'),
    (b2, r2, 'foreign inventory sale');
  -- Managers: only a manager may cancel a whole order; consumption accepts any active membership.
  insert into app.memberships(id, user_id, restaurant_id, branch_id, granted_by) values
    (m, actor, r, b, actor),
    (m3, branch_actor, r, b3, branch_actor),
    (m2, foreign_actor, r2, b2, foreign_actor);
  insert into app.membership_role_grants(membership_id, role_code, granted_by) values
    (m, 'manager', actor),
    (m3, 'manager', branch_actor),
    (m2, 'manager', foreign_actor);

  insert into app.menu_catalogs(id, restaurant_id, version, currency, published_by) values
    (catalog, r, 1, 'MXN', actor),
    (catalog2, r2, 1, 'MXN', foreign_actor);
  insert into app.menu_categories(restaurant_id, catalog_id, id, name, active, display_order) values
    (r, catalog, category, 'Sale', true, 1),
    (r2, catalog2, category2, 'Foreign sale', true, 1);
  insert into app.menu_products(
    restaurant_id, catalog_id, id, category_id, name, sku, active, display_order, station_id, unit, unit_price_minor
  ) values
    (r, catalog, simple_product, category, 'Simple', 'SALE-1', true, 1, 'kitchen', 'piece', 10000),
    (r, catalog, pizza_product, category, 'Pizza', 'SALE-2', true, 2, 'kitchen', 'piece', 20000),
    (r, catalog, half_a, category, 'Pizza half A', 'SALE-3', true, 3, 'kitchen', 'piece', 10000),
    (r, catalog, half_b, category, 'Pizza half B', 'SALE-4', true, 4, 'kitchen', 'piece', 10000),
    (r, catalog, no_recipe_product, category, 'No recipe', 'SALE-5', true, 5, 'kitchen', 'piece', 5000),
    (r2, catalog2, foreign_product, category2, 'Foreign', 'SALE-6', true, 1, 'kitchen', 'piece', 10000);

  insert into app.inventory_items(id, restaurant_id, name, unit_code) values
    (flour, r, 'Sale flour', 'g'),
    (cheese, r, 'Sale cheese', 'g'),
    (olive, r, 'Sale olive', 'g'),
    (foreign_flour, r2, 'Foreign sale flour', 'g');
  -- The main warehouse starts WITHOUT is_default so the skip path can be exercised first.
  insert into app.inventory_warehouses(id, restaurant_id, branch_id, name, active, is_default) values
    (warehouse, r, b, 'Main', true, false),
    (foreign_warehouse, r2, b2, 'Foreign', true, false);

  -- Recipes: simple has flour+cheese; half A has flour 200 and olive 121 (ceil -> 61); half B shares
  -- flour with half A, so both halves must aggregate into a single flour movement.
  perform app_private.publish_inventory_recipe(actor, r, pg_catalog.jsonb_build_object(
    'productId', simple_product,
    'lines', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('itemId', flour, 'quantity', 300, 'unitCode', 'g'),
      pg_catalog.jsonb_build_object('itemId', cheese, 'quantity', 100, 'unitCode', 'g')
    )
  ));
  perform app_private.publish_inventory_recipe(actor, r, pg_catalog.jsonb_build_object(
    'productId', half_a,
    'lines', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('itemId', flour, 'quantity', 200, 'unitCode', 'g'),
      pg_catalog.jsonb_build_object('itemId', olive, 'quantity', 121, 'unitCode', 'g')
    )
  ));
  perform app_private.publish_inventory_recipe(actor, r, pg_catalog.jsonb_build_object(
    'productId', half_b,
    'lines', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('itemId', flour, 'quantity', 120, 'unitCode', 'g'),
      pg_catalog.jsonb_build_object('itemId', cheese, 'quantity', 120, 'unitCode', 'g')
    )
  ));

  -- Opening stock, recorded through the ledger writer.
  perform app_private.inventory_record_movement(
    actor, r, b, warehouse, flour, 'receipt', 10000, null, 'sale-initial-flour',
    null, null, null, pg_catalog.clock_timestamp(), null
  );
  perform app_private.inventory_record_movement(
    actor, r, b, warehouse, cheese, 'receipt', 5000, null, 'sale-initial-cheese',
    null, null, null, pg_catalog.clock_timestamp(), null
  );
  perform app_private.inventory_record_movement(
    actor, r, b, warehouse, olive, 'receipt', 1000, null, 'sale-initial-olive',
    null, null, null, pg_catalog.clock_timestamp(), null
  );

  -- Persisted sale aggregates: one simple line (quantity 2) and one halves pizza (quantity 1).
  insert into app.orders(id, restaurant_id, branch_id, channel, status, aggregate, version, created_by, updated_by)
  values (
    order1, r, b, 'counter', 'open',
    pg_catalog.jsonb_build_object(
      'schemaVersion', '1', 'orderId', order1::text, 'restaurantId', r::text, 'branchId', b::text,
      'channel', 'counter', 'currency', 'MXN', 'timeZone', 'America/Hermosillo', 'status', 'open',
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'orderItemId', simple_item::text,
          'snapshot', pg_catalog.jsonb_build_object('productId', simple_product::text, 'geometry', 'whole'),
          'quantity', 2, 'restaurantId', r::text, 'branchId', b::text, 'status', 'pending', 'note', null
        ),
        pg_catalog.jsonb_build_object(
          'orderItemId', pizza_item::text,
          'snapshot', pg_catalog.jsonb_build_object(
            'productId', pizza_product::text, 'geometry', 'halves',
            'pizzaHalves', pg_catalog.jsonb_build_object('halves', pg_catalog.jsonb_build_array(
              pg_catalog.jsonb_build_object('fraction', 'half-a', 'productId', half_a::text),
              pg_catalog.jsonb_build_object('fraction', 'half-b', 'productId', half_b::text)
            ))
          ),
          'quantity', 1, 'restaurantId', r::text, 'branchId', b::text, 'status', 'pending', 'note', null
        )
      )
    ),
    1, actor, actor
  );
  insert into app.orders(id, restaurant_id, branch_id, channel, status, aggregate, version, created_by, updated_by)
  values (
    order2, r, b, 'counter', 'open',
    pg_catalog.jsonb_build_object(
      'schemaVersion', '1', 'orderId', order2::text, 'restaurantId', r::text, 'branchId', b::text,
      'channel', 'counter', 'currency', 'MXN', 'timeZone', 'America/Hermosillo', 'status', 'open',
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'orderItemId', no_recipe_item::text,
          'snapshot', pg_catalog.jsonb_build_object('productId', no_recipe_product::text, 'geometry', 'whole'),
          'quantity', 1, 'restaurantId', r::text, 'branchId', b::text, 'status', 'pending', 'note', null
        )
      )
    ),
    1, actor, actor
  );

  -- 1. Without a default warehouse, consumption skips and writes nothing.
  result := app_private.inventory_consume_order(actor, r, b, order1);
  if result ->> 'status' is distinct from 'skipped'
    or result ->> 'reason' is distinct from 'no_default_warehouse'
  then raise exception 'sale without default warehouse not skipped: %', result; end if;
  select pg_catalog.count(*) into movement_count
  from app.inventory_movements
  where restaurant_id = r and source_type = 'order_item'
    and source_id in (simple_item, pizza_item);
  if movement_count <> 0 then raise exception 'skipped sale wrote % movements', movement_count; end if;
  select pg_catalog.count(*) into consumption_count
  from app.inventory_consumptions where restaurant_id = r and order_id = order1;
  if consumption_count <> 0 then raise exception 'skipped sale wrote % consumption rows', consumption_count; end if;

  update app.inventory_warehouses set is_default = true where id = warehouse;

  -- 2. Confirmation consumes the recipe of a simple line and a halves pizza on the default warehouse.
  result := app_private.inventory_consume_order(actor, r, b, order1);
  if result ->> 'status' <> 'recorded' then raise exception 'sale not recorded: %', result; end if;

  select pg_catalog.count(*) into movement_count
  from app.inventory_movements
  where restaurant_id = r and source_type = 'order_item'
    and source_id in (simple_item, pizza_item) and kind = 'sale_consumption';
  if movement_count <> 5 then raise exception 'sale_consumption count %, expected 5', movement_count; end if;

  select quantity_delta into flour_delta from app.inventory_movements
  where restaurant_id = r and source_id = simple_item and kind = 'sale_consumption' and item_id = flour;
  if flour_delta <> -600 then raise exception 'simple flour delta %, expected -600', flour_delta; end if;
  select quantity_delta into cheese_delta from app.inventory_movements
  where restaurant_id = r and source_id = simple_item and kind = 'sale_consumption' and item_id = cheese;
  if cheese_delta <> -200 then raise exception 'simple cheese delta %, expected -200', cheese_delta; end if;

  -- Shared ingredient: one aggregated flour movement for both halves (ceil 200/2 + ceil 120/2 = 160).
  select pg_catalog.count(*), coalesce(pg_catalog.sum(quantity_delta), 0::bigint)::integer
    into movement_count, flour_delta
  from app.inventory_movements
  where restaurant_id = r and source_id = pizza_item and kind = 'sale_consumption' and item_id = flour;
  if movement_count <> 1 or flour_delta <> -160 then
    raise exception 'pizza flour movements % delta %, expected 1 x -160', movement_count, flour_delta;
  end if;
  -- Odd recipe 121 on a half: ceil(121 / 2) = 61, not 60.
  select quantity_delta into olive_delta from app.inventory_movements
  where restaurant_id = r and source_id = pizza_item and kind = 'sale_consumption' and item_id = olive;
  if olive_delta <> -61 then raise exception 'half odd olive delta %, expected -61 (ceil 121/2)', olive_delta; end if;
  select quantity_delta into cheese_delta from app.inventory_movements
  where restaurant_id = r and source_id = pizza_item and kind = 'sale_consumption' and item_id = cheese;
  if cheese_delta <> -60 then raise exception 'half B cheese delta %, expected -60 (ceil 120/2)', cheese_delta; end if;

  select quantity into balance from app.inventory_balances where warehouse_id = warehouse and item_id = flour;
  if balance <> 9240 then raise exception 'flour balance %, expected 9240', balance; end if;
  select quantity into balance from app.inventory_balances where warehouse_id = warehouse and item_id = cheese;
  if balance <> 4740 then raise exception 'cheese balance %, expected 4740', balance; end if;
  select quantity into balance from app.inventory_balances where warehouse_id = warehouse and item_id = olive;
  if balance <> 939 then raise exception 'olive balance %, expected 939', balance; end if;

  select pg_catalog.count(*) into consumption_count
  from app.inventory_consumptions where restaurant_id = r and order_id = order1 and cause = 'sale';
  if consumption_count <> 2 then raise exception 'sale consumption rows %, expected 2', consumption_count; end if;

  -- 3. Replaying the same confirmation (same keys) neither duplicates movements nor changes balances.
  result := app_private.inventory_consume_order(actor, r, b, order1);
  if result ->> 'status' <> 'recorded' then raise exception 'sale replay not recorded: %', result; end if;
  select pg_catalog.count(*) into movement_count
  from app.inventory_movements
  where restaurant_id = r and source_type = 'order_item'
    and source_id in (simple_item, pizza_item) and kind = 'sale_consumption';
  if movement_count <> 5 then raise exception 'sale replay changed movements to %', movement_count; end if;
  select pg_catalog.count(*) into consumption_count
  from app.inventory_consumptions where restaurant_id = r and order_id = order1 and cause = 'sale';
  if consumption_count <> 2 then raise exception 'sale replay changed consumption rows to %', consumption_count; end if;
  select quantity into balance from app.inventory_balances where warehouse_id = warehouse and item_id = flour;
  if balance <> 9240 then raise exception 'sale replay changed flour balance to %', balance; end if;

  -- 3b. The wrappers short-circuit on a non-applied result and never touch stock.
  select pg_catalog.count(*) into movement_count from app.inventory_movements where restaurant_id = r;
  result := app_private.confirm_capture_draft_v3_with_inventory(actor, null, null, null);
  if result ->> 'status' is distinct from 'rejected' then raise exception 'confirm wrapper status %', result; end if;
  result := app_private.cancel_order_with_inventory(actor, null, null);
  if result ->> 'status' is distinct from 'conflict' then raise exception 'cancel wrapper status %', result; end if;
  if (select pg_catalog.count(*) from app.inventory_movements where restaurant_id = r) <> movement_count then
    raise exception 'a rejected wrapper call wrote movements';
  end if;

  -- 4. A product with no active recipe produces no movement, no sale row and is not an error.
  result := app_private.inventory_consume_order(actor, r, b, order2);
  if result ->> 'status' <> 'recorded' then raise exception 'no-recipe sale failed: %', result; end if;
  select pg_catalog.count(*) into movement_count
  from app.inventory_movements
  where restaurant_id = r and source_type = 'order_item' and source_id = no_recipe_item;
  if movement_count <> 0 then raise exception 'no-recipe product created % movements', movement_count; end if;
  select pg_catalog.count(*) into consumption_count
  from app.inventory_consumptions where restaurant_id = r and order_id = order2;
  if consumption_count <> 0 then raise exception 'no-recipe product created % consumption rows', consumption_count; end if;

  -- 5. Tenant and branch isolation.
  begin
    perform app_private.inventory_consume_order(foreign_actor, r, b, order1);
    raise exception 'foreign restaurant actor consumed inventory';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;
  begin
    perform app_private.inventory_consume_order(branch_actor, r, b, order1);
    raise exception 'actor of another branch consumed inventory';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;
  begin
    perform app_private.inventory_reverse_order_item(branch_actor, r, b, order1, simple_item);
    raise exception 'actor of another branch reversed inventory';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;
  begin
    perform app_private.inventory_consume_order(branch_actor, r, b3, order1);
    raise exception 'order of another branch accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_ORDER_SCOPE_INVALID' then raise; end if;
  end;
  begin
    perform app_private.inventory_reverse_order_item(branch_actor, r, b3, order1, simple_item);
    raise exception 'order of another branch reversed';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_ORDER_SCOPE_INVALID' then raise; end if;
  end;

  -- A real row in the other restaurant makes the policy check non-vacuous.
  insert into app.orders(id, restaurant_id, branch_id, channel, status, aggregate, version, created_by, updated_by)
  values (
    order_foreign, r2, b2, 'counter', 'open',
    pg_catalog.jsonb_build_object(
      'schemaVersion', '1', 'orderId', order_foreign::text, 'restaurantId', r2::text, 'branchId', b2::text,
      'channel', 'counter', 'currency', 'MXN', 'timeZone', 'America/Hermosillo', 'status', 'open',
      'items', pg_catalog.jsonb_build_array()
    ),
    1, foreign_actor, foreign_actor
  );
  insert into app.inventory_consumptions(
    restaurant_id, branch_id, order_id, order_item_id, cause, warehouse_id, created_by, source_version
  ) values (
    r2, b2, order_foreign, gen_random_uuid(), 'sale', foreign_warehouse, foreign_actor, 1
  );
  if pg_catalog.has_table_privilege('app_api', 'app.inventory_consumptions', 'SELECT') then
    raise exception 'app_api can read inventory_consumptions';
  end if;

  perform pg_catalog.set_config('test.actor_id', foreign_actor::text, true);
  execute 'set local role authenticated';
  select pg_catalog.count(*) into visible from app.inventory_consumptions where restaurant_id = r;
  if visible <> 0 then raise exception 'foreign actor read % consumption rows', visible; end if;
  select pg_catalog.count(*) into visible from app.inventory_consumptions where restaurant_id = r2;
  if visible <> 1 then raise exception 'own foreign row not visible: %', visible; end if;
  execute 'reset role';

  perform pg_catalog.set_config('test.actor_id', actor::text, true);
  execute 'set local role authenticated';
  select pg_catalog.count(*) into visible from app.inventory_consumptions where restaurant_id = r;
  if visible < 2 then raise exception 'own actor sees only % consumption rows', visible; end if;
  select pg_catalog.count(*) into visible from app.inventory_consumptions where restaurant_id = r2;
  if visible <> 0 then raise exception 'foreign consumption rows visible: %', visible; end if;
  execute 'reset role';

  -- 6. Cancelling the simple line restores its exact quantities and the replay does not duplicate it.
  result := app_private.inventory_reverse_order_item(actor, r, b, order1, simple_item);
  if result ->> 'status' <> 'recorded' then raise exception 'reversal not recorded: %', result; end if;
  select pg_catalog.count(*) into reversal_count
  from app.inventory_movements
  where restaurant_id = r and source_type = 'order_item' and source_id = simple_item
    and kind = 'sale_reversal' and compensates_movement_id is not null;
  if reversal_count <> 2 then raise exception 'reversal count %, expected 2', reversal_count; end if;
  select quantity into balance from app.inventory_balances where warehouse_id = warehouse and item_id = flour;
  if balance <> 9840 then raise exception 'flour balance after cancel %, expected 9840', balance; end if;
  select quantity into balance from app.inventory_balances where warehouse_id = warehouse and item_id = cheese;
  if balance <> 4940 then raise exception 'cheese balance after cancel %, expected 4940', balance; end if;

  result := app_private.inventory_reverse_order_item(actor, r, b, order1, simple_item);
  if result ->> 'status' <> 'recorded' then raise exception 'reversal replay not recorded: %', result; end if;
  -- The replay query must apply the same filter as the first one: compensates_movement_id is not null.
  select pg_catalog.count(*) into reversal_count
  from app.inventory_movements
  where restaurant_id = r and source_type = 'order_item' and source_id = simple_item
    and kind = 'sale_reversal' and compensates_movement_id is not null;
  if reversal_count <> 2 then raise exception 'reversal replay duplicated movements: %', reversal_count; end if;
  select pg_catalog.count(*) into consumption_count
  from app.inventory_consumptions
  where restaurant_id = r and order_id = order1 and order_item_id = simple_item and cause = 'cancel';
  if consumption_count <> 1 then raise exception 'cancel consumption rows %, expected 1', consumption_count; end if;

  -- 7. Sale plus cancellation returns every item to the initial balance.
  result := app_private.inventory_reverse_order_item(actor, r, b, order1, pizza_item);
  if result ->> 'status' <> 'recorded' then raise exception 'pizza reversal not recorded: %', result; end if;
  select pg_catalog.count(*) into reversal_count
  from app.inventory_movements
  where restaurant_id = r and source_type = 'order_item' and source_id = pizza_item
    and kind = 'sale_reversal' and compensates_movement_id is not null;
  if reversal_count <> 3 then raise exception 'pizza reversal count %, expected 3', reversal_count; end if;
  select quantity into balance from app.inventory_balances where warehouse_id = warehouse and item_id = flour;
  if balance <> 10000 then raise exception 'final flour balance %, expected 10000', balance; end if;
  select quantity into balance from app.inventory_balances where warehouse_id = warehouse and item_id = cheese;
  if balance <> 5000 then raise exception 'final cheese balance %, expected 5000', balance; end if;
  select quantity into balance from app.inventory_balances where warehouse_id = warehouse and item_id = olive;
  if balance <> 1000 then raise exception 'final olive balance %, expected 1000', balance; end if;
  select coalesce(pg_catalog.sum(quantity_delta), 0::bigint)::integer into flour_delta
  from app.inventory_movements where restaurant_id = r and item_id = flour;
  if flour_delta <> 10000 then raise exception 'flour ledger sum %, expected 10000', flour_delta; end if;
  select coalesce(pg_catalog.sum(quantity_delta), 0::bigint)::integer into cheese_delta
  from app.inventory_movements where restaurant_id = r and item_id = cheese;
  if cheese_delta <> 5000 then raise exception 'cheese ledger sum %, expected 5000', cheese_delta; end if;
  select coalesce(pg_catalog.sum(quantity_delta), 0::bigint)::integer into olive_delta
  from app.inventory_movements where restaurant_id = r and item_id = olive;
  if olive_delta <> 1000 then raise exception 'olive ledger sum %, expected 1000', olive_delta; end if;

  -- 8. Real cancellation through the wrapper: a sent line needs its own step, a pending line is
  --    auto-cancelled by the order step. Both must be covered by the reversal.
  order3_aggregate := pg_catalog.jsonb_build_object(
    'schemaVersion', '1', 'orderId', order3::text, 'restaurantId', r::text, 'branchId', b::text,
    'channel', 'counter', 'currency', 'MXN', 'timeZone', 'America/Hermosillo', 'status', 'open',
    'items', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'orderItemId', sent_item::text,
        'snapshot', pg_catalog.jsonb_build_object(
          'productId', simple_product::text, 'geometry', 'whole', 'stationId', 'kitchen'
        ),
        'quantity', 1, 'restaurantId', r::text, 'branchId', b::text, 'status', 'sent', 'note', null
      ),
      pg_catalog.jsonb_build_object(
        'orderItemId', pending_item::text,
        'snapshot', pg_catalog.jsonb_build_object(
          'productId', no_recipe_product::text, 'geometry', 'whole', 'stationId', 'kitchen'
        ),
        'quantity', 1, 'restaurantId', r::text, 'branchId', b::text, 'status', 'pending', 'note', null
      )
    )
  );
  insert into app.orders(id, restaurant_id, branch_id, channel, status, aggregate, version, created_by, updated_by)
  values (order3, r, b, 'counter', 'open', order3_aggregate, 1, actor, actor);

  result := app_private.inventory_consume_order(actor, r, b, order3);
  if result ->> 'status' <> 'recorded' then raise exception 'order3 sale not recorded: %', result; end if;
  select quantity into balance from app.inventory_balances where warehouse_id = warehouse and item_id = flour;
  if balance <> 9700 then raise exception 'order3 flour balance %, expected 9700', balance; end if;
  select quantity into balance from app.inventory_balances where warehouse_id = warehouse and item_id = cheese;
  if balance <> 4900 then raise exception 'order3 cheese balance %, expected 4900', balance; end if;

  occurred := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  occurred_text := pg_catalog.to_char(occurred at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  select e.value into sent_item_obj from pg_catalog.jsonb_array_elements(order3_aggregate -> 'items') as e(value)
  where e.value ->> 'orderItemId' = sent_item::text;
  select e.value into pending_item_obj from pg_catalog.jsonb_array_elements(order3_aggregate -> 'items') as e(value)
  where e.value ->> 'orderItemId' = pending_item::text;

  line_item_audit := pg_catalog.jsonb_build_object(
    'eventId', line_event::text, 'idempotencyKey', line_key, 'from', 'sent',
    'actorId', actor::text, 'branchId', b::text, 'deviceId', device::text,
    'occurredAt', occurred_text, 'reason', reason,
    'authorization', pg_catalog.jsonb_build_object('approved', true, 'actorId', actor::text)
  );
  sent_item_cancelled := (sent_item_obj - 'status')
    || pg_catalog.jsonb_build_object('status', 'cancelled', 'cancellationAudit', line_item_audit);
  line_order := pg_catalog.jsonb_set(
    order3_aggregate, '{items}', pg_catalog.jsonb_build_array(sent_item_cancelled, pending_item_obj)
  );

  order_cancel_audit := pg_catalog.jsonb_build_object(
    'eventId', command_event::text, 'idempotencyKey', command_key, 'from', 'open',
    'actorId', actor::text, 'branchId', b::text, 'deviceId', device::text,
    'occurredAt', occurred_text, 'reason', reason,
    'authorization', pg_catalog.jsonb_build_object('approved', true, 'actorId', actor::text)
  );
  pending_cancel_audit := pg_catalog.jsonb_build_object(
    'eventId', command_event::text, 'idempotencyKey', command_key, 'from', 'pending',
    'actorId', actor::text, 'branchId', b::text, 'deviceId', device::text,
    'occurredAt', occurred_text, 'reason', reason,
    'authorization', pg_catalog.jsonb_build_object('approved', true, 'actorId', actor::text)
  );
  pending_item_cancelled := (pending_item_obj - 'status')
    || pg_catalog.jsonb_build_object('status', 'cancelled', 'cancellationAudit', pending_cancel_audit);
  final_order := pg_catalog.jsonb_set(
      line_order, '{items}', pg_catalog.jsonb_build_array(sent_item_cancelled, pending_item_cancelled)
    ) || pg_catalog.jsonb_build_object('status', 'cancelled', 'cancellationAudit', order_cancel_audit);

  line_step_audit := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'actorId', actor::text, 'restaurantId', r::text, 'branchId', b::text,
    'orderId', order3::text, 'deviceId', device::text, 'occurredAt', occurred_text, 'reason', reason,
    'authorization', pg_catalog.jsonb_build_object('approved', true, 'actorId', actor::text),
    'eventId', line_event::text, 'idempotencyKey', line_key,
    'operation', 'order_item.state_changed', 'entityType', 'order_item', 'entityId', sent_item::text,
    'orderItemId', sent_item::text, 'from', 'sent', 'to', 'cancelled'
  );
  order_step_audit := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'actorId', actor::text, 'restaurantId', r::text, 'branchId', b::text,
    'orderId', order3::text, 'deviceId', device::text, 'occurredAt', occurred_text, 'reason', reason,
    'authorization', pg_catalog.jsonb_build_object('approved', true, 'actorId', actor::text),
    'eventId', command_event::text, 'idempotencyKey', command_key,
    'operation', 'order.state_changed', 'entityType', 'order', 'entityId', order3::text,
    'from', 'open', 'to', 'cancelled',
    'automaticallyCancelledOrderItemIds', pg_catalog.jsonb_build_array(pending_item::text)
  );

  command := pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('restaurantId', r::text, 'branchId', b::text),
    'orderId', order3::text, 'expectedVersion', 1, 'eventId', command_event::text,
    'idempotencyKey', command_key, 'deviceId', device::text, 'occurredAt', occurred_text, 'reason', reason
  );
  steps := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('order', line_order, 'audit', line_step_audit),
    pg_catalog.jsonb_build_object('order', final_order, 'audit', order_step_audit)
  );

  -- The helper set must contain both the command event and the kitchen line event.
  expected_events := app_private.inventory_cancellation_event_ids(command, steps);
  if pg_catalog.jsonb_array_length(expected_events) <> 2
    or not (expected_events ? command_event::text)
    or not (expected_events ? line_event::text)
  then raise exception 'cancellation event set % does not cover command+line', expected_events; end if;

  result := app_private.cancel_order_with_inventory(actor, command, steps);
  if result ->> 'status' is distinct from 'saved' then raise exception 'wrapper cancel status %', result; end if;
  if result #>> '{order,status}' is distinct from 'cancelled' then
    raise exception 'wrapper cancel order status %', result #>> '{order,status}';
  end if;

  select pg_catalog.count(*) into reversal_count
  from app.inventory_movements
  where restaurant_id = r and source_type = 'order_item' and source_id = sent_item
    and kind = 'sale_reversal' and compensates_movement_id is not null;
  if reversal_count <> 2 then raise exception 'wrapper reversal count %, expected 2', reversal_count; end if;
  select pg_catalog.count(*) into consumption_count
  from app.inventory_consumptions
  where restaurant_id = r and order_id = order3 and order_item_id = sent_item and cause = 'cancel';
  if consumption_count <> 1 then raise exception 'wrapper cancel rows %, expected 1', consumption_count; end if;
  select pg_catalog.count(*) into consumption_count
  from app.inventory_consumptions
  where restaurant_id = r and order_id = order3 and order_item_id = pending_item and cause = 'cancel';
  if consumption_count <> 0 then raise exception 'no-consumption line kept % cancel rows', consumption_count; end if;
  select quantity into balance from app.inventory_balances where warehouse_id = warehouse and item_id = flour;
  if balance <> 10000 then raise exception 'wrapper cancel flour balance %, expected 10000', balance; end if;
  select quantity into balance from app.inventory_balances where warehouse_id = warehouse and item_id = cheese;
  if balance <> 5000 then raise exception 'wrapper cancel cheese balance %, expected 5000', balance; end if;

  -- Replaying the command returns a replay and never reverses twice.
  result := app_private.cancel_order_with_inventory(actor, command, steps);
  if result ->> 'status' is distinct from 'replayed' then raise exception 'wrapper cancel replay status %', result; end if;
  select quantity into balance from app.inventory_balances where warehouse_id = warehouse and item_id = flour;
  if balance <> 10000 then raise exception 'wrapper replay changed flour balance to %', balance; end if;
end $test$;
rollback;
