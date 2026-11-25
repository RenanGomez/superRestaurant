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
  b3 uuid := gen_random_uuid();
  manager_membership uuid := gen_random_uuid();
  cashier_membership uuid := gen_random_uuid();
  foreign_membership uuid := gen_random_uuid();
  item uuid := gen_random_uuid();
  foreign_item uuid := gen_random_uuid();
  warehouse_a uuid := gen_random_uuid();
  warehouse_b uuid := gen_random_uuid();
  other_branch_warehouse uuid := gen_random_uuid();
  foreign_warehouse uuid := gen_random_uuid();
  result jsonb;
  pair uuid;
  balance_a integer;
  balance_b integer;
  visible bigint;
  state text;
  err_message text;
  function_name text;
begin
  foreach function_name in array array[
    'app_private.inventory_transfer(uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,text,uuid)',
    'app_private.list_inventory_movements(uuid,uuid,uuid,uuid,uuid,integer)',
    'app_private.list_inventory_balances(uuid,uuid,uuid,uuid)'
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
    (manager, 'inventory-movements-manager@invalid.test'),
    (cashier, 'inventory-movements-cashier@invalid.test'),
    (foreign_actor, 'inventory-movements-foreign@invalid.test');
  insert into app.restaurants(id, name, time_zone) values
    (r, 'inventory movements', 'America/Hermosillo'),
    (r2, 'foreign inventory movements', 'America/Hermosillo');
  insert into app.branches(id, restaurant_id, name) values
    (b, r, 'inventory movements'),
    (b2, r2, 'foreign inventory movements'),
    (b3, r, 'inventory movements second branch');
  insert into app.memberships(id, user_id, restaurant_id, branch_id, granted_by) values
    (manager_membership, manager, r, b, manager),
    (cashier_membership, cashier, r, b, cashier),
    (foreign_membership, foreign_actor, r2, b2, foreign_actor);
  insert into app.membership_role_grants(membership_id, role_code, granted_by) values
    (manager_membership, 'manager', manager),
    (cashier_membership, 'cashier', cashier),
    (foreign_membership, 'manager', foreign_actor);
  insert into app.inventory_items(id, restaurant_id, name, unit_code) values
    (item, r, 'Movement flour', 'g'),
    (foreign_item, r2, 'Foreign movement flour', 'g');
  insert into app.inventory_warehouses(id, restaurant_id, branch_id, name, active) values
    (warehouse_a, r, b, 'Main', true),
    (warehouse_b, r, b, 'Kitchen', true),
    (other_branch_warehouse, r, b3, 'Other branch', true),
    (foreign_warehouse, r2, b2, 'Foreign', true);

  -- Seed stock in the source warehouse and a foreign movement that must never leak.
  result := app_private.inventory_record_movement(
    manager, r, b, warehouse_a, item, 'receipt', 50, null, 'movements-api-seed',
    null, null, null, pg_catalog.clock_timestamp(), null);
  if result ->> 'status' <> 'recorded' then raise exception 'seed not recorded: %', result; end if;
  result := app_private.inventory_record_movement(
    foreign_actor, r2, b2, foreign_warehouse, foreign_item, 'receipt', 7, null, 'movements-api-foreign',
    null, null, null, pg_catalog.clock_timestamp(), null);
  if result ->> 'status' <> 'recorded' then raise exception 'foreign seed not recorded: %', result; end if;

  execute 'set local role app_api';

  -- One call moves stock to the other warehouse and leaves two movements with the same pair id.
  result := app_private.inventory_transfer(
    manager, r, b, warehouse_a, warehouse_b, item, 10, 'g', 'transfer to kitchen',
    'movements-api-transfer', null);
  if result ->> 'status' <> 'recorded' then raise exception 'transfer not recorded: %', result; end if;
  pair := (result ->> 'transferPairId')::uuid;
  if pair is null then raise exception 'transfer pair id missing: %', result; end if;
  if pg_catalog.jsonb_array_length(result -> 'movements') <> 2 then
    raise exception 'transfer movements = %', result -> 'movements';
  end if;
  if (
    select count(*)
    from pg_catalog.jsonb_array_elements(result -> 'movements') as e
    where (e ->> 'transferPairId')::uuid = pair
  ) <> 2 then
    raise exception 'transfer movements do not share pair %', pair;
  end if;
  if not exists (
    select 1
    from pg_catalog.jsonb_array_elements(result -> 'movements') as e
    where e ->> 'kind' = 'transfer_out'
      and (e ->> 'quantityDelta')::integer = -10
  ) then
    raise exception 'missing transfer_out movement: %', result -> 'movements';
  end if;
  if not exists (
    select 1
    from pg_catalog.jsonb_array_elements(result -> 'movements') as e
    where e ->> 'kind' = 'transfer_in'
      and (e ->> 'quantityDelta')::integer = 10
  ) then
    raise exception 'missing transfer_in movement: %', result -> 'movements';
  end if;

  select quantity into balance_a
  from app_private.list_inventory_balances(manager, r, b, warehouse_a) as bal
  where bal.item_id = item;
  select quantity into balance_b
  from app_private.list_inventory_balances(manager, r, b, warehouse_b) as bal
  where bal.item_id = item;
  if balance_a <> 40 or balance_b <> 10 then
    raise exception 'transfer balances = %/%', balance_a, balance_b;
  end if;

  select count(*) into visible
  from app_private.list_inventory_movements(manager, r, b, null, null, 100);
  if visible <> 3 then raise exception 'branch movements = %, expected 3', visible; end if;
  select count(*) into visible
  from app_private.list_inventory_movements(manager, r, b, null, null, 100) as mv
  where mv.transfer_pair_id = pair;
  if visible <> 2 then raise exception 'paired movements = %, expected 2', visible; end if;

  -- A replay with the same keys returns duplicate and never moves stock again.
  result := app_private.inventory_transfer(
    manager, r, b, warehouse_a, warehouse_b, item, 10, 'g', 'transfer to kitchen',
    'movements-api-transfer', null);
  if result ->> 'status' <> 'duplicate' then raise exception 'replay status = %', result; end if;
  if (result ->> 'transferPairId')::uuid <> pair then
    raise exception 'replay changed the pair to %', result ->> 'transferPairId';
  end if;
  select quantity into balance_a
  from app_private.list_inventory_balances(manager, r, b, warehouse_a) as bal
  where bal.item_id = item;
  select quantity into balance_b
  from app_private.list_inventory_balances(manager, r, b, warehouse_b) as bal
  where bal.item_id = item;
  if balance_a <> 40 or balance_b <> 10 then
    raise exception 'replay moved stock to %/%', balance_a, balance_b;
  end if;
  select count(*) into visible
  from app_private.list_inventory_movements(manager, r, b, null, null, 100);
  if visible <> 3 then raise exception 'replay duplicated movements: %', visible; end if;

  -- A membership without a managing role cannot transfer.
  begin
    perform app_private.inventory_transfer(
      cashier, r, b, warehouse_a, warehouse_b, item, 1, 'g', 'cashier transfer',
      'movements-api-cashier', null);
    raise exception 'cashier transferred stock';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;

  -- Both warehouses must belong to the requested branch.
  begin
    perform app_private.inventory_transfer(
      manager, r, b, warehouse_a, other_branch_warehouse, item, 1, 'g', 'other branch',
      'movements-api-other-branch', null);
    raise exception 'transfer accepted a warehouse from another branch';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_WAREHOUSE_SCOPE_INVALID' then raise; end if;
  end;

  -- Reads are branch-scoped and membership-checked: no path sees the other restaurant.
  begin
    perform app_private.list_inventory_movements(manager, r2, b2, null, null, 100);
    raise exception 'manager read the foreign movement list';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;
  begin
    perform app_private.list_inventory_balances(manager, r2, b2, null);
    raise exception 'manager read the foreign balance list';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;
  select coalesce(pg_catalog.sum(quantity), 0)::integer into balance_a
  from app_private.list_inventory_balances(manager, r, b, null);
  if balance_a <> 50 then raise exception 'branch balance sum = %, expected 50', balance_a; end if;

  -- Out-of-range limits do not break the read: the function clamps to 1..200 with 100 as default.
  select count(*) into visible
  from app_private.list_inventory_movements(manager, r, b, null, null, 0);
  if visible <> 3 then raise exception 'limit 0 returned %, expected 3', visible; end if;
  select count(*) into visible
  from app_private.list_inventory_movements(manager, r, b, null, null, 1000);
  if visible <> 3 then raise exception 'limit 1000 returned %, expected 3', visible; end if;

  execute 'reset role';
end $test$;
rollback;
