begin;

do $test$
declare
  actor uuid := gen_random_uuid();
  r uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  m uuid := gen_random_uuid();
  product uuid := gen_random_uuid();
  catalog uuid := gen_random_uuid();
  category uuid := gen_random_uuid();
  flour uuid := gen_random_uuid();
  warehouse uuid := gen_random_uuid();
  order_ref uuid := gen_random_uuid();
  item uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  event uuid := gen_random_uuid();
  key text := gen_random_uuid()::text;
  occurred timestamptz;
  occurred_text text;
  reason text := 'customer changed mind';
  aggregate jsonb;
  item_obj jsonb;
  audit jsonb;
  cancelled_item jsonb;
  cancelled_order jsonb;
  result jsonb;
  balance integer;
  movement_count bigint;
  reversal_count bigint;
  consumption_count bigint;
  role_name text;
  function_oid oid := pg_catalog.to_regprocedure('app_private.persist_order_item_cancellation_with_inventory(uuid,bigint,jsonb,jsonb)');
begin
  -- 0. Schema contract: server-only wrapper with the same security pattern as the rest.
  if function_oid is null then
    raise exception 'persist_order_item_cancellation_with_inventory(uuid,bigint,jsonb,jsonb) missing';
  end if;

  foreach role_name in array array['authenticated', 'anon', 'service_role', 'public'] loop
    if pg_catalog.has_function_privilege(role_name, function_oid, 'EXECUTE') then
      raise exception '% can execute the line cancel inventory wrapper', role_name;
    end if;
  end loop;
  if not pg_catalog.has_function_privilege('app_api', function_oid, 'EXECUTE') then
    raise exception 'app_api cannot execute the line cancel inventory wrapper';
  end if;
  if pg_catalog.obj_description(function_oid, 'pg_proc') is null
    or pg_catalog.obj_description(function_oid, 'pg_proc')
      not like '%Call this instead of persist_order_item_cancellation%'
  then raise exception 'missing API comment on persist_order_item_cancellation_with_inventory'; end if;

  insert into auth.users(id, email) values (actor, 'inventory-line-cancel@invalid.test');
  insert into app.restaurants(id, name, time_zone) values (r, 'inventory line cancel', 'America/Hermosillo');
  insert into app.branches(id, restaurant_id, name) values (b, r, 'inventory line cancel');
  insert into app.memberships(id, user_id, restaurant_id, branch_id, granted_by) values (m, actor, r, b, actor);
  insert into app.membership_role_grants(membership_id, role_code, granted_by) values (m, 'manager', actor);

  insert into app.inventory_items(id, restaurant_id, name, unit_code) values
    (flour, r, 'Line cancel flour', 'g');
  insert into app.inventory_warehouses(id, restaurant_id, branch_id, name, active, is_default) values
    (warehouse, r, b, 'Main', true, true);

  insert into app.menu_catalogs(id, restaurant_id, version, currency, published_by) values
    (catalog, r, 1, 'MXN', actor);
  insert into app.menu_categories(restaurant_id, catalog_id, id, name, active, display_order) values
    (r, catalog, category, 'Line cancel', true, 1);
  insert into app.menu_products(
    restaurant_id, catalog_id, id, category_id, name, sku, active, display_order, station_id, unit, unit_price_minor
  ) values (
    r, catalog, product, category, 'Line cancel', 'LC-1', true, 1, 'kitchen', 'piece', 1000
  );

  perform app_private.publish_inventory_recipe(actor, r, pg_catalog.jsonb_build_object(
    'productId', product,
    'lines', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('itemId', flour, 'quantity', 250, 'unitCode', 'g')
    )
  ));
  perform app_private.inventory_record_movement(
    actor, r, b, warehouse, flour, 'receipt', 1000, null, 'line-cancel-initial-flour',
    null, null, null, pg_catalog.clock_timestamp(), null
  );

  aggregate := pg_catalog.jsonb_build_object(
    'schemaVersion', '1', 'orderId', order_ref::text, 'restaurantId', r::text, 'branchId', b::text,
    'channel', 'counter', 'currency', 'MXN', 'timeZone', 'America/Hermosillo', 'status', 'open',
    'items', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'orderItemId', item::text,
        'snapshot', pg_catalog.jsonb_build_object(
          'productId', product::text, 'geometry', 'whole', 'stationId', 'kitchen'
        ),
        'quantity', 2, 'restaurantId', r::text, 'branchId', b::text, 'status', 'pending', 'note', null
      )
    )
  );
  insert into app.orders(id, restaurant_id, branch_id, channel, status, aggregate, version, created_by, updated_by)
  values (order_ref, r, b, 'counter', 'open', aggregate, 1, actor, actor);

  -- 1. The sale consumes 2 x 250 = 500 of flour on the default warehouse.
  result := app_private.inventory_consume_order(actor, r, b, order_ref);
  if result ->> 'status' <> 'recorded' then raise exception 'line sale not recorded: %', result; end if;
  select quantity into balance from app.inventory_balances where warehouse_id = warehouse and item_id = flour;
  if balance <> 500 then raise exception 'line sale balance %, expected 500', balance; end if;

  occurred := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  occurred_text := pg_catalog.to_char(occurred at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  select e.value into item_obj from pg_catalog.jsonb_array_elements(aggregate -> 'items') as e(value)
  where e.value ->> 'orderItemId' = item::text;

  audit := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'actorId', actor::text, 'restaurantId', r::text, 'branchId', b::text,
    'orderId', order_ref::text, 'deviceId', device::text, 'occurredAt', occurred_text, 'reason', reason,
    'eventId', event::text, 'idempotencyKey', key,
    'operation', 'order_item.state_changed', 'entityType', 'order_item', 'entityId', item::text,
    'orderItemId', item::text, 'from', 'pending', 'to', 'cancelled'
  );
  cancelled_item := (item_obj - 'status')
    || pg_catalog.jsonb_build_object(
      'status', 'cancelled',
      'cancellationAudit', pg_catalog.jsonb_build_object(
        'eventId', event::text, 'idempotencyKey', key, 'from', 'pending',
        'actorId', actor::text, 'branchId', b::text, 'deviceId', device::text,
        'occurredAt', occurred_text, 'reason', reason
      )
    );
  cancelled_order := pg_catalog.jsonb_set(aggregate, '{items}', pg_catalog.jsonb_build_array(cancelled_item));

  -- 2. The wrapper persists the cancellation and reverses exactly the sale consumption.
  result := app_private.persist_order_item_cancellation_with_inventory(actor, 1, cancelled_order, audit);
  if result ->> 'status' is distinct from 'saved' then
    raise exception 'line cancel status %', result;
  end if;
  if result #>> '{inventory,status}' is distinct from 'recorded' then
    raise exception 'line cancel inventory %', result -> 'inventory';
  end if;
  if result #>> '{inventory,orderItemId}' is distinct from item::text then
    raise exception 'line cancel reversed another item: %', result -> 'inventory';
  end if;

  select quantity into balance from app.inventory_balances where warehouse_id = warehouse and item_id = flour;
  if balance <> 1000 then raise exception 'flour balance after line cancel %, expected 1000', balance; end if;

  select pg_catalog.count(*) into movement_count
  from app.inventory_movements
  where restaurant_id = r and source_type = 'order_item' and source_id = item
    and kind = 'sale_consumption';
  if movement_count <> 1 then raise exception 'line sale movements %, expected 1', movement_count; end if;

  select pg_catalog.count(*) into reversal_count
  from app.inventory_movements
  where restaurant_id = r and source_type = 'order_item' and source_id = item
    and kind = 'sale_reversal' and compensates_movement_id is not null;
  if reversal_count <> 1 then raise exception 'line reversal count %, expected 1', reversal_count; end if;

  select pg_catalog.count(*) into consumption_count
  from app.inventory_consumptions as ic
  where ic.restaurant_id = r and ic.order_id = order_ref and ic.order_item_id = item and ic.cause = 'cancel';
  if consumption_count <> 1 then raise exception 'line cancel rows %, expected 1', consumption_count; end if;

  -- 3. Replaying the same command returns replayed, reverses nothing and answers no inventory key.
  result := app_private.persist_order_item_cancellation_with_inventory(actor, 1, cancelled_order, audit);
  if result ->> 'status' is distinct from 'replayed' then
    raise exception 'line cancel replay status %', result;
  end if;
  if result ? 'inventory' then raise exception 'line cancel replay touched inventory: %', result; end if;

  select pg_catalog.count(*) into reversal_count
  from app.inventory_movements
  where restaurant_id = r and source_type = 'order_item' and source_id = item
    and kind = 'sale_reversal' and compensates_movement_id is not null;
  if reversal_count <> 1 then raise exception 'line cancel replay duplicated reversal: %', reversal_count; end if;
  select pg_catalog.count(*) into consumption_count
  from app.inventory_consumptions as ic
  where ic.restaurant_id = r and ic.order_id = order_ref and ic.order_item_id = item and ic.cause = 'cancel';
  if consumption_count <> 1 then raise exception 'line cancel replay duplicated rows: %', consumption_count; end if;
  select quantity into balance from app.inventory_balances where warehouse_id = warehouse and item_id = flour;
  if balance <> 1000 then raise exception 'line cancel replay changed flour balance to %', balance; end if;
end $test$;
rollback;
