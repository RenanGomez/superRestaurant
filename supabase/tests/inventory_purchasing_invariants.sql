begin;

-- Disposable local cluster stubs auth.uid() to NULL; point it at a transaction-local GUC so the RLS
-- policies can be exercised as a real member. Everything is rolled back at the end.
create or replace function auth.uid() returns uuid language sql stable as $uid$
  select pg_catalog.current_setting('test.actor_id', true)::uuid
$uid$;

do $test$
declare
  actor uuid := gen_random_uuid();
  cashier_actor uuid := gen_random_uuid();
  other_branch_actor uuid := gen_random_uuid();
  foreign_actor uuid := gen_random_uuid();
  r uuid := gen_random_uuid();
  r2 uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  b3 uuid := gen_random_uuid();
  b2 uuid := gen_random_uuid();
  m uuid := gen_random_uuid();
  mc uuid := gen_random_uuid();
  mb uuid := gen_random_uuid();
  mf uuid := gen_random_uuid();
  supplier uuid := gen_random_uuid();
  foreign_supplier uuid := gen_random_uuid();
  item_g uuid := gen_random_uuid();
  item_ml uuid := gen_random_uuid();
  foreign_item uuid := gen_random_uuid();
  line_g uuid;
  line_ml uuid;
  warehouse uuid := gen_random_uuid();
  warehouse2 uuid := gen_random_uuid();
  po_id uuid;
  po2_id uuid;
  foreign_po_id uuid;
  payload jsonb;
  result jsonb;
  replay jsonb;
  movement_count bigint;
  balance integer;
  visible bigint;
  state text;
  err_message text;
  constraint_hit text;
  tbl text;
  role_name text;
  function_create oid := pg_catalog.to_regprocedure('app_private.inventory_create_purchase_order(uuid,uuid,uuid,jsonb)');
  function_receive oid := pg_catalog.to_regprocedure('app_private.inventory_receive_purchase_order(uuid,uuid,jsonb)');
begin
  -- 7. RLS must be ENABLED and FORCED; clients cannot write the tables nor execute the functions.
  foreach tbl in array array['inventory_suppliers', 'inventory_purchase_orders', 'inventory_purchase_order_lines'] loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relname = tbl and c.relrowsecurity and c.relforcerowsecurity
    ) then raise exception 'missing FORCE RLS: %', tbl; end if;
    foreach role_name in array array['authenticated', 'app_api', 'anon', 'service_role', 'public'] loop
      if pg_catalog.has_table_privilege(role_name::name, 'app.' || tbl, 'INSERT,UPDATE,DELETE,TRUNCATE') then
        raise exception 'direct write grant: %.%', role_name, tbl;
      end if;
    end loop;
  end loop;
  if function_create is null then raise exception 'inventory_create_purchase_order missing'; end if;
  if function_receive is null then raise exception 'inventory_receive_purchase_order missing'; end if;
  if not pg_catalog.has_function_privilege('app_api', function_create, 'EXECUTE') then
    raise exception 'app_api cannot execute inventory_create_purchase_order';
  end if;
  if not pg_catalog.has_function_privilege('app_api', function_receive, 'EXECUTE') then
    raise exception 'app_api cannot execute inventory_receive_purchase_order';
  end if;
  foreach role_name in array array['authenticated', 'anon', 'service_role', 'public'] loop
    if pg_catalog.has_function_privilege(role_name, function_create, 'EXECUTE') then
      raise exception '% can execute inventory_create_purchase_order', role_name;
    end if;
    if pg_catalog.has_function_privilege(role_name, function_receive, 'EXECUTE') then
      raise exception '% can execute inventory_receive_purchase_order', role_name;
    end if;
  end loop;

  insert into auth.users(id, email) values
    (actor, 'inventory-purchasing@invalid.test'),
    (cashier_actor, 'inventory-purchasing-cashier@invalid.test'),
    (other_branch_actor, 'inventory-purchasing-other-branch@invalid.test'),
    (foreign_actor, 'inventory-purchasing-foreign@invalid.test');
  insert into app.restaurants(id, name, time_zone) values
    (r, 'inventory purchasing', 'America/Hermosillo'),
    (r2, 'foreign inventory purchasing', 'America/Hermosillo');
  insert into app.branches(id, restaurant_id, name) values
    (b, r, 'inventory purchasing'),
    (b3, r, 'inventory purchasing second branch'),
    (b2, r2, 'foreign inventory purchasing');
  insert into app.memberships(id, user_id, restaurant_id, branch_id, granted_by) values
    (m, actor, r, b, actor),
    (mc, cashier_actor, r, b, cashier_actor),
    (mb, other_branch_actor, r, b3, other_branch_actor),
    (mf, foreign_actor, r2, b2, foreign_actor);
  insert into app.membership_role_grants(membership_id, role_code, granted_by) values
    (m, 'manager', actor),
    (mc, 'cashier', cashier_actor),
    (mb, 'manager', other_branch_actor),
    (mf, 'manager', foreign_actor);
  insert into app.inventory_suppliers(id, restaurant_id, name, contact) values
    (supplier, r, 'Purchasing supplier', 'buyer@invalid.test'),
    (foreign_supplier, r2, 'Foreign purchasing supplier', null);
  insert into app.inventory_items(id, restaurant_id, name, unit_code) values
    (item_g, r, 'Purchasing flour', 'g'),
    (item_ml, r, 'Purchasing oil', 'ml'),
    (foreign_item, r2, 'Foreign purchasing flour', 'g');
  insert into app.inventory_warehouses(id, restaurant_id, branch_id, name) values
    (warehouse, r, b, 'Main'),
    (warehouse2, r, b, 'Secondary');

  payload := pg_catalog.jsonb_build_object(
    'supplierId', supplier,
    'currency', 'MXN',
    'lines', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('itemId', item_g, 'quantity', 100, 'unitCode', 'g', 'unitCostMinor', 250),
      pg_catalog.jsonb_build_object('itemId', item_ml, 'quantity', 40, 'unitCode', 'ml', 'unitCostMinor', 75)
    )
  );

  -- 1. A valid purchase order is created as draft with two lines.
  result := app_private.inventory_create_purchase_order(actor, r, b, payload);
  if (result ->> 'status') <> 'draft' then raise exception 'create status %', result; end if;
  po_id := (result ->> 'orderId')::uuid;
  select count(*) into movement_count from app.inventory_purchase_order_lines as l where l.order_id = po_id;
  if movement_count <> 2 then raise exception 'create did not persist two lines'; end if;
  if (select o.created_by from app.inventory_purchase_orders as o where o.id = po_id) <> actor then
    raise exception 'created_by not recorded';
  end if;

  -- An item from another restaurant is rejected.
  begin
    perform app_private.inventory_create_purchase_order(actor, r, b, pg_catalog.jsonb_build_object(
      'supplierId', supplier,
      'currency', 'MXN',
      'lines', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('itemId', foreign_item, 'quantity', 1, 'unitCode', 'g', 'unitCostMinor', 1)
      )
    ));
    raise exception 'foreign item purchase order accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_PURCHASE_ITEM_SCOPE_INVALID' then raise; end if;
  end;

  -- Decimal, zero and negative quantities are rejected; so is a mismatched unit.
  begin
    perform app_private.inventory_create_purchase_order(actor, r, b, pg_catalog.jsonb_build_object(
      'supplierId', supplier,
      'currency', 'MXN',
      'lines', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('itemId', item_g, 'quantity', 1.5, 'unitCode', 'g', 'unitCostMinor', 1)
      )
    ));
    raise exception 'decimal quantity accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_PURCHASE_LINE_INVALID' then raise; end if;
  end;
  begin
    perform app_private.inventory_create_purchase_order(actor, r, b, pg_catalog.jsonb_build_object(
      'supplierId', supplier,
      'currency', 'MXN',
      'lines', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('itemId', item_g, 'quantity', 0, 'unitCode', 'g', 'unitCostMinor', 1)
      )
    ));
    raise exception 'zero quantity accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_PURCHASE_LINE_INVALID' then raise; end if;
  end;
  begin
    perform app_private.inventory_create_purchase_order(actor, r, b, pg_catalog.jsonb_build_object(
      'supplierId', supplier,
      'currency', 'MXN',
      'lines', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('itemId', item_g, 'quantity', -5, 'unitCode', 'g', 'unitCostMinor', 1)
      )
    ));
    raise exception 'negative quantity accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_PURCHASE_LINE_INVALID' then raise; end if;
  end;
  begin
    perform app_private.inventory_create_purchase_order(actor, r, b, pg_catalog.jsonb_build_object(
      'supplierId', supplier,
      'currency', 'MXN',
      'lines', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('itemId', item_g, 'quantity', 10, 'unitCode', 'ml', 'unitCostMinor', 1)
      )
    ));
    raise exception 'mismatched unit accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_PURCHASE_LINE_INVALID' then raise; end if;
  end;

  -- 2. The status check rejects an unknown lifecycle value.
  begin
    insert into app.inventory_purchase_orders (
      restaurant_id, branch_id, supplier_id, status, currency, created_by
    ) values (r, b, supplier, 'bogus', 'MXN', actor);
    raise exception 'invalid purchase order status accepted';
  exception when check_violation then
    get stacked diagnostics constraint_hit = constraint_name;
    if constraint_hit <> 'inventory_purchase_orders_status_valid' then raise; end if;
  end;

  select l.id into line_g from app.inventory_purchase_order_lines as l
  where l.order_id = po_id and l.item_id = item_g;
  select l.id into line_ml from app.inventory_purchase_order_lines as l
  where l.order_id = po_id and l.item_id = item_ml;

  -- 3. Reception appends one receipt movement per line and the ledger balance matches.
  result := app_private.inventory_receive_purchase_order(
    actor, po_id, pg_catalog.jsonb_build_object('warehouseId', warehouse));
  if (result ->> 'status') <> 'received' then raise exception 'receive status %', result; end if;
  if pg_catalog.jsonb_array_length(result -> 'movements') <> 2 then
    raise exception 'receive returned % movements', result;
  end if;
  select count(*) into movement_count
  from app.inventory_movements as mv
  join app.inventory_purchase_order_lines as l
    on l.id = mv.source_id and l.restaurant_id = mv.restaurant_id
  where l.order_id = po_id
    and mv.source_type = 'purchase_order_line'
    and mv.kind = 'receipt'
    and mv.idempotency_key = 'receipt:' || po_id::text || ':' || l.id::text;
  if movement_count <> 2 then raise exception 'receipt movements %, expected 2', movement_count; end if;
  if (select o.status from app.inventory_purchase_orders as o where o.id = po_id) <> 'received' then
    raise exception 'order not marked received';
  end if;
  if (select o.received_at from app.inventory_purchase_orders as o where o.id = po_id) is null then
    raise exception 'received_at not recorded';
  end if;
  select bal.quantity into balance from app.inventory_balances as bal
  where bal.warehouse_id = warehouse and bal.item_id = item_g;
  if balance <> 100 then raise exception 'flour balance %, expected 100', balance; end if;
  select bal.quantity into balance from app.inventory_balances as bal
  where bal.warehouse_id = warehouse and bal.item_id = item_ml;
  if balance <> 40 then raise exception 'oil balance %, expected 40', balance; end if;
  select coalesce(pg_catalog.sum(mv.quantity_delta), 0::bigint) into balance from app.inventory_movements as mv
  where mv.warehouse_id = warehouse and mv.item_id = item_g;
  if balance <> 100 then raise exception 'flour ledger sum %, expected 100', balance; end if;
  if (select mv.unit_cost_minor from app.inventory_movements as mv
      where mv.source_type = 'purchase_order_line' and mv.source_id = line_g and mv.kind = 'receipt') <> 250
  then raise exception 'receipt unit cost not recorded'; end if;
  if (select mv.currency from app.inventory_movements as mv
      where mv.source_type = 'purchase_order_line' and mv.source_id = line_g and mv.kind = 'receipt') <> 'MXN'
  then raise exception 'receipt currency not recorded'; end if;

  -- 4. Replaying the reception returns the same result, without duplicating movements or balance.
  replay := app_private.inventory_receive_purchase_order(
    actor, po_id, pg_catalog.jsonb_build_object('warehouseId', warehouse));
  if (replay ->> 'status') <> 'received' then raise exception 'replay status %', replay; end if;
  if (replay -> 'movements') <> (result -> 'movements') then raise exception 'replay result differs'; end if;
  select count(*) into movement_count
  from app.inventory_movements as mv
  join app.inventory_purchase_order_lines as l
    on l.id = mv.source_id and l.restaurant_id = mv.restaurant_id
  where l.order_id = po_id and mv.source_type = 'purchase_order_line' and mv.kind = 'receipt';
  if movement_count <> 2 then raise exception 'replay duplicated movements: %', movement_count; end if;
  select bal.quantity into balance from app.inventory_balances as bal
  where bal.warehouse_id = warehouse and bal.item_id = item_g;
  if balance <> 100 then raise exception 'replay changed flour balance to %', balance; end if;

  -- 5. Receiving an already received order never moves stock again, even with another warehouse.
  replay := app_private.inventory_receive_purchase_order(
    actor, po_id, pg_catalog.jsonb_build_object('warehouseId', warehouse2));
  if (replay ->> 'status') <> 'received' then raise exception 'second receive status %', replay; end if;
  select count(*) into movement_count
  from app.inventory_movements as mv
  join app.inventory_purchase_order_lines as l
    on l.id = mv.source_id and l.restaurant_id = mv.restaurant_id
  where l.order_id = po_id and mv.source_type = 'purchase_order_line' and mv.kind = 'receipt';
  if movement_count <> 2 then raise exception 'second receive created movements: %', movement_count; end if;
  select coalesce(pg_catalog.sum(mv.quantity_delta), 0::bigint) into balance from app.inventory_movements as mv
  where mv.warehouse_id = warehouse2 and mv.item_id = item_g;
  if balance <> 0 then raise exception 'second receive moved stock: %', balance; end if;

  -- 6. Actors from another branch or restaurant can neither create nor receive.
  begin
    perform app_private.inventory_create_purchase_order(foreign_actor, r, b, payload);
    raise exception 'foreign actor created a purchase order';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_PURCHASE_ACTOR_FORBIDDEN' then raise; end if;
  end;
  begin
    perform app_private.inventory_create_purchase_order(other_branch_actor, r, b, payload);
    raise exception 'other branch actor created a purchase order';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_PURCHASE_ACTOR_FORBIDDEN' then raise; end if;
  end;
  begin
    perform app_private.inventory_create_purchase_order(cashier_actor, r, b, payload);
    raise exception 'cashier created a purchase order';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_PURCHASE_ACTOR_FORBIDDEN' then raise; end if;
  end;

  result := app_private.inventory_create_purchase_order(actor, r, b, payload);
  po2_id := (result ->> 'orderId')::uuid;
  begin
    perform app_private.inventory_receive_purchase_order(
      foreign_actor, po2_id, pg_catalog.jsonb_build_object('warehouseId', warehouse));
    raise exception 'foreign actor received a purchase order';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_PURCHASE_ACTOR_FORBIDDEN' then raise; end if;
  end;
  begin
    perform app_private.inventory_receive_purchase_order(
      other_branch_actor, po2_id, pg_catalog.jsonb_build_object('warehouseId', warehouse));
    raise exception 'other branch actor received a purchase order';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_PURCHASE_ACTOR_FORBIDDEN' then raise; end if;
  end;
  if (select o.status from app.inventory_purchase_orders as o where o.id = po2_id) <> 'draft' then
    raise exception 'forbidden receive changed the order status';
  end if;
  select count(*) into movement_count
  from app.inventory_movements as mv
  join app.inventory_purchase_order_lines as l
    on l.id = mv.source_id and l.restaurant_id = mv.restaurant_id
  where l.order_id = po2_id and mv.kind = 'receipt';
  if movement_count <> 0 then raise exception 'forbidden receive moved stock: %', movement_count; end if;

  -- RLS read scope: a foreign restaurant order is invisible while the own order is visible.
  result := app_private.inventory_create_purchase_order(foreign_actor, r2, b2, pg_catalog.jsonb_build_object(
    'supplierId', foreign_supplier,
    'currency', 'MXN',
    'lines', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('itemId', foreign_item, 'quantity', 5, 'unitCode', 'g', 'unitCostMinor', 10)
    )
  ));
  foreign_po_id := (result ->> 'orderId')::uuid;

  perform pg_catalog.set_config('test.actor_id', actor::text, true);
  execute 'set local role authenticated';
  select count(*) into visible from app.inventory_purchase_orders as o where o.id = po_id;
  if visible <> 1 then raise exception 'own purchase order not visible'; end if;
  select count(*) into visible from app.inventory_purchase_orders as o where o.id = foreign_po_id;
  if visible <> 0 then raise exception 'foreign purchase order visible'; end if;
  select count(*) into visible from app.inventory_suppliers as s where s.id = foreign_supplier;
  if visible <> 0 then raise exception 'foreign supplier visible'; end if;
  begin
    insert into app.inventory_suppliers(restaurant_id, name) values (r, 'Hacked supplier');
    raise exception 'authenticated wrote a supplier';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
end $test$;
rollback;
