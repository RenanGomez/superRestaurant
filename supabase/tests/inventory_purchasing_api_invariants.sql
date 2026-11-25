begin;

do $test$
declare
  manager uuid := gen_random_uuid();
  cashier uuid := gen_random_uuid();
  foreign_actor uuid := gen_random_uuid();
  r uuid := gen_random_uuid();
  r2 uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  b2 uuid := gen_random_uuid();
  manager_membership uuid := gen_random_uuid();
  cashier_membership uuid := gen_random_uuid();
  foreign_membership uuid := gen_random_uuid();
  flour uuid := gen_random_uuid();
  sugar uuid := gen_random_uuid();
  foreign_item uuid := gen_random_uuid();
  supplier uuid;
  dormant_supplier uuid;
  foreign_supplier uuid := gen_random_uuid();
  foreign_order uuid := gen_random_uuid();
  order_id uuid;
  result jsonb;
  row_count bigint;
  total bigint;
  visible_name text;
  state text;
  err_message text;
  function_name text;
begin
  foreach function_name in array array[
    'app_private.list_inventory_suppliers(uuid,uuid,boolean)',
    'app_private.read_inventory_supplier_for_manage(uuid,uuid)',
    'app_private.create_inventory_supplier(uuid,uuid,text,text,boolean)',
    'app_private.update_inventory_supplier(uuid,uuid,text,text,boolean)',
    'app_private.list_inventory_purchase_orders(uuid,uuid,uuid,text,integer)',
    'app_private.read_inventory_purchase_order(uuid,uuid)'
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
    (manager, 'inventory-purchasing-api-manager@invalid.test'),
    (cashier, 'inventory-purchasing-api-cashier@invalid.test'),
    (foreign_actor, 'inventory-purchasing-api-foreign@invalid.test');
  insert into app.restaurants(id, name, time_zone) values
    (r, 'inventory purchasing api', 'America/Hermosillo'),
    (r2, 'foreign inventory purchasing api', 'America/Hermosillo');
  insert into app.branches(id, restaurant_id, name) values
    (b, r, 'inventory purchasing api'),
    (b2, r2, 'foreign inventory purchasing api');
  insert into app.memberships(id, user_id, restaurant_id, branch_id, granted_by) values
    (manager_membership, manager, r, b, manager),
    (cashier_membership, cashier, r, b, cashier),
    (foreign_membership, foreign_actor, r2, b2, foreign_actor);
  insert into app.membership_role_grants(membership_id, role_code, granted_by) values
    (manager_membership, 'manager', manager),
    (cashier_membership, 'cashier', cashier),
    (foreign_membership, 'manager', foreign_actor);
  insert into app.inventory_items(id, restaurant_id, name, unit_code) values
    (flour, r, 'Purchasing flour', 'g'),
    (sugar, r, 'Purchasing sugar', 'ml'),
    (foreign_item, r2, 'Foreign purchasing flour', 'g');
  insert into app.inventory_suppliers(id, restaurant_id, name) values
    (foreign_supplier, r2, 'Foreign supplier');
  insert into app.inventory_purchase_orders(
    id, restaurant_id, branch_id, supplier_id, status, currency, idempotency_key, created_by
  ) values
    (foreign_order, r2, b2, foreign_supplier, 'draft', 'MXN', 'purchasing-api-foreign', foreign_actor);
  insert into app.inventory_purchase_order_lines(
    restaurant_id, order_id, item_id, quantity, unit_code, unit_cost_minor
  ) values
    (r2, foreign_order, foreign_item, 10, 'g', 500);

  execute 'set local role app_api';

  -- Supplier creation is manage-only, validates payload and keeps the active name unique.
  supplier := (select s.id from app_private.create_inventory_supplier(
    manager, r, 'Purchasing supplier', '+52 555 0000', true) as s);
  if supplier is null then raise exception 'supplier creation returned no row'; end if;
  begin
    perform app_private.create_inventory_supplier(manager, r, 'Purchasing supplier', null, true);
    raise exception 'duplicate active supplier name was accepted';
  exception when unique_violation then
    null;
  end;
  dormant_supplier := (select s.id from app_private.create_inventory_supplier(
    manager, r, 'Dormant supplier', null, false) as s);
  if dormant_supplier is null then raise exception 'inactive supplier creation returned no row'; end if;
  begin
    perform app_private.create_inventory_supplier(manager, r, '   ', null, true);
    raise exception 'blank supplier name was accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_SUPPLIER_PAYLOAD_INVALID' then raise; end if;
  end;

  select count(*) into row_count
  from app_private.list_inventory_suppliers(manager, r, false);
  if row_count <> 1 then raise exception 'active suppliers = %, expected 1', row_count; end if;
  select count(*) into row_count
  from app_private.list_inventory_suppliers(manager, r, true);
  if row_count <> 2 then raise exception 'all suppliers = %, expected 2', row_count; end if;
  select count(*) into row_count
  from app_private.list_inventory_suppliers(manager, r2, true);
  if row_count <> 0 then raise exception 'foreign supplier leaked into list'; end if;

  -- A membership without a managing role raises; an actor with no membership sees nothing.
  begin
    perform app_private.list_inventory_suppliers(cashier, r, false);
    raise exception 'cashier listed suppliers';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;
  select count(*) into row_count
  from app_private.list_inventory_suppliers(foreign_actor, r, false);
  if row_count <> 0 then raise exception 'foreign actor listed suppliers'; end if;

  -- Update returns the changed row; unknown or foreign ids return no row at all.
  select s.name into visible_name
  from app_private.update_inventory_supplier(manager, supplier, 'Purchasing supplier v2', null, true) as s;
  if visible_name <> 'Purchasing supplier v2' then raise exception 'supplier update name = %', visible_name; end if;
  select count(*) into row_count
  from app_private.update_inventory_supplier(manager, gen_random_uuid(), 'Missing', null, true);
  if row_count <> 0 then raise exception 'update of an unknown supplier returned a row'; end if;
  select count(*) into row_count
  from app_private.update_inventory_supplier(manager, foreign_supplier, 'Hijacked', null, true);
  if row_count <> 0 then raise exception 'update of a foreign supplier revealed a row'; end if;
  select count(*) into row_count
  from app_private.read_inventory_supplier_for_manage(manager, foreign_supplier);
  if row_count <> 0 then raise exception 'read of a foreign supplier revealed a row'; end if;

  -- Two lines through the existing writer; the read must sum integer minor units.
  result := app_private.inventory_create_purchase_order(manager, r, b, pg_catalog.jsonb_build_object(
    'supplierId', supplier,
    'currency', 'MXN',
    'idempotencyKey', 'purchasing-api-order-1',
    'lines', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('itemId', flour, 'quantity', 100, 'unitCode', 'g', 'unitCostMinor', 250),
      pg_catalog.jsonb_build_object('itemId', sugar, 'quantity', 50, 'unitCode', 'ml', 'unitCostMinor', 1000)
    )
  ));
  order_id := (result ->> 'orderId')::uuid;

  select count(*) into row_count
  from app_private.list_inventory_purchase_orders(manager, r, b, null, 100);
  if row_count <> 1 then raise exception 'purchase orders = %, expected 1', row_count; end if;
  select o.total_minor, o.supplier_name into total, visible_name
  from app_private.list_inventory_purchase_orders(manager, r, b, null, 100) as o;
  if total <> 75000 then raise exception 'purchase order total = %, expected 75000', total; end if;
  if visible_name <> 'Purchasing supplier v2' then raise exception 'supplier name = %', visible_name; end if;

  select count(*) into row_count
  from app_private.list_inventory_purchase_orders(manager, r, b, 'received', 100);
  if row_count <> 0 then raise exception 'status filter returned % rows', row_count; end if;

  begin
    perform app_private.list_inventory_purchase_orders(cashier, r, b, null, 100);
    raise exception 'cashier listed purchase orders';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;

  -- Detail returns the header plus both lines with their item names.
  select o.total_minor into total
  from app_private.read_inventory_purchase_order(manager, order_id) as o;
  if total <> 75000 then raise exception 'detail total = %, expected 75000', total; end if;
  select pg_catalog.jsonb_array_length(o.lines)::bigint into row_count
  from app_private.read_inventory_purchase_order(manager, order_id) as o;
  if row_count <> 2 then raise exception 'detail lines = %, expected 2', row_count; end if;
  if not exists (
    select 1
    from app_private.read_inventory_purchase_order(manager, order_id) as o
    cross join lateral pg_catalog.jsonb_array_elements(o.lines) as line
    where line ->> 'item_name' = 'Purchasing flour'
      and (line ->> 'quantity')::integer = 100
      and (line ->> 'unit_cost_minor')::bigint = 250
  ) then
    raise exception 'detail is missing the flour line with its item name';
  end if;

  -- Foreign orders are invisible and a non-managing member is denied.
  select count(*) into row_count
  from app_private.read_inventory_purchase_order(manager, foreign_order);
  if row_count <> 0 then raise exception 'foreign purchase order was readable'; end if;
  begin
    perform app_private.read_inventory_purchase_order(cashier, order_id);
    raise exception 'cashier read a purchase order detail';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;

  execute 'reset role';
end $test$;
rollback;
