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
  own_item uuid;
  foreign_item uuid;
  deleted_item uuid := gen_random_uuid();
  own_warehouse uuid;
  foreign_warehouse uuid;
  function_name text;
  table_name text;
  visible bigint;
  updated_name text;
  state text;
  err_message text;
begin
  -- 1. app_api keeps no direct access to the protected schema or the inventory tables.
  if pg_catalog.has_schema_privilege('app_api', 'app', 'USAGE') then
    raise exception 'app_api has USAGE on schema app';
  end if;
  foreach table_name in array array['inventory_items', 'inventory_warehouses'] loop
    if pg_catalog.has_table_privilege('app_api', 'app.' || table_name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'app_api has direct privileges on app.%', table_name;
    end if;
  end loop;

  -- 2. app_api can execute the eight catalog wrappers. The raw ledger writer keeps its own existing
  -- grant from 20261126000200 (needed by the future movements API); narrowing it is tracked as debt.
  foreach function_name in array array[
    'app_private.list_inventory_items(uuid,uuid)',
    'app_private.read_inventory_item_for_manage(uuid,uuid)',
    'app_private.create_inventory_item(uuid,uuid,text,text,text,integer,integer,boolean)',
    'app_private.update_inventory_item(uuid,uuid,text,text,text,integer,integer,boolean)',
    'app_private.list_inventory_warehouses(uuid,uuid,uuid)',
    'app_private.read_inventory_warehouse_for_manage(uuid,uuid)',
    'app_private.create_inventory_warehouse(uuid,uuid,uuid,text,boolean)',
    'app_private.update_inventory_warehouse(uuid,uuid,text,boolean)'
  ] loop
    if not pg_catalog.has_function_privilege('app_api', function_name, 'EXECUTE') then
      raise exception 'app_api cannot execute %', function_name;
    end if;
  end loop;

  -- 2b. Each wrapper keeps the hardened shape: postgres-owned SECURITY DEFINER with an empty
  -- search_path, so app_api can execute it without inheriting a caller-controlled lookup path.
  foreach function_name in array array[
    'app_private.list_inventory_items(uuid,uuid)',
    'app_private.read_inventory_item_for_manage(uuid,uuid)',
    'app_private.create_inventory_item(uuid,uuid,text,text,text,integer,integer,boolean)',
    'app_private.update_inventory_item(uuid,uuid,text,text,text,integer,integer,boolean)',
    'app_private.list_inventory_warehouses(uuid,uuid,uuid)',
    'app_private.read_inventory_warehouse_for_manage(uuid,uuid)',
    'app_private.create_inventory_warehouse(uuid,uuid,uuid,text,boolean)',
    'app_private.update_inventory_warehouse(uuid,uuid,text,boolean)'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_proc as p
      join pg_catalog.pg_roles as owner on owner.oid = p.proowner
      where p.oid = pg_catalog.to_regprocedure(function_name)
        and p.prosecdef
        and owner.rolname = 'postgres'
        and coalesce(pg_catalog.array_to_string(p.proconfig, ','), '') in ('search_path=', 'search_path=""')
    ) then
      raise exception 'inventory wrapper % is not postgres-owned SECURITY DEFINER with an empty search_path', function_name;
    end if;
  end loop;

  insert into auth.users(id, email) values
    (manager, 'inventory-api-manager@invalid.test'),
    (cashier, 'inventory-api-cashier@invalid.test'),
    (foreign_actor, 'inventory-api-foreign@invalid.test');
  insert into app.restaurants(id, name, time_zone) values
    (r, 'inventory api', 'America/Hermosillo'),
    (r2, 'foreign inventory api', 'America/Hermosillo');
  insert into app.branches(id, restaurant_id, name) values
    (b, r, 'inventory api'),
    (b2, r2, 'foreign inventory api');
  insert into app.memberships(id, user_id, restaurant_id, branch_id, granted_by) values
    (manager_membership, manager, r, b, manager),
    (cashier_membership, cashier, r, b, cashier),
    (foreign_membership, foreign_actor, r2, b2, foreign_actor);
  insert into app.membership_role_grants(membership_id, role_code, granted_by) values
    (manager_membership, 'manager', manager),
    (cashier_membership, 'cashier', cashier),
    (foreign_membership, 'manager', foreign_actor);

  -- 3. As app_api, a manager creates, lists, reads and updates both entities.
  execute 'set local role app_api';
  select created.id into own_item
  from app_private.create_inventory_item(manager, r, 'FLOUR', 'Flour', 'g', 1000, 0, true) as created;
  if own_item is null then raise exception 'manager could not create an item'; end if;
  select created.id into own_warehouse
  from app_private.create_inventory_warehouse(manager, r, b, 'Main', true) as created;
  if own_warehouse is null then raise exception 'manager could not create a warehouse'; end if;

  select count(*) into visible from app_private.list_inventory_items(manager, r);
  if visible <> 1 then raise exception 'manager listed % items, expected 1', visible; end if;
  select count(*) into visible from app_private.list_inventory_warehouses(manager, r, b);
  if visible <> 1 then raise exception 'manager listed % warehouses, expected 1', visible; end if;
  select count(*) into visible from app_private.read_inventory_item_for_manage(manager, own_item);
  if visible <> 1 then raise exception 'manager could not read the item for manage'; end if;
  select count(*) into visible from app_private.read_inventory_warehouse_for_manage(manager, own_warehouse);
  if visible <> 1 then raise exception 'manager could not read the warehouse for manage'; end if;

  select updated.name into updated_name
  from app_private.update_inventory_item(manager, own_item, 'FLOUR', 'Flour premium', 'g', 1000, 0, true) as updated;
  if updated_name <> 'Flour premium' then raise exception 'item update name = %', updated_name; end if;
  select updated.name into updated_name
  from app_private.update_inventory_warehouse(manager, own_warehouse, 'Main 2', true) as updated;
  if updated_name <> 'Main 2' then raise exception 'warehouse update name = %', updated_name; end if;

  -- 4. A cashier has an active membership but cannot manage: 42501, never a silent no-op.
  begin
    perform app_private.create_inventory_item(cashier, r, 'SUGAR', 'Sugar', 'g', 1, 0, true);
    raise exception 'cashier created an item';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;
  begin
    perform app_private.create_inventory_warehouse(cashier, r, b, 'Cash', true);
    raise exception 'cashier created a warehouse';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;
  begin
    perform app_private.read_inventory_item_for_manage(cashier, own_item);
    raise exception 'cashier read an item for manage';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;
  begin
    perform app_private.read_inventory_warehouse_for_manage(cashier, own_warehouse);
    raise exception 'cashier read a warehouse for manage';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;

  -- 5. A manager of restaurant A neither sees nor mutates restaurant B through any wrapper.
  select created.id into foreign_item
  from app_private.create_inventory_item(foreign_actor, r2, 'FLOUR', 'Foreign flour', 'g', 1, 0, true) as created;
  select created.id into foreign_warehouse
  from app_private.create_inventory_warehouse(foreign_actor, r2, b2, 'Foreign', true) as created;

  select count(*) into visible from app_private.list_inventory_items(manager, r2);
  if visible <> 0 then raise exception 'foreign item list returned % rows', visible; end if;
  select count(*) into visible from app_private.read_inventory_item_for_manage(manager, foreign_item);
  if visible <> 0 then raise exception 'foreign item read for manage returned % rows', visible; end if;
  select count(*) into visible
  from app_private.update_inventory_item(manager, foreign_item, 'FLOUR', 'Hijack', 'g', 1, 0, true);
  if visible <> 0 then raise exception 'foreign item update returned % rows', visible; end if;

  select count(*) into visible from app_private.list_inventory_warehouses(manager, r2, b2);
  if visible <> 0 then raise exception 'foreign warehouse list returned % rows', visible; end if;
  select count(*) into visible from app_private.read_inventory_warehouse_for_manage(manager, foreign_warehouse);
  if visible <> 0 then raise exception 'foreign warehouse read for manage returned % rows', visible; end if;
  select count(*) into visible
  from app_private.update_inventory_warehouse(manager, foreign_warehouse, 'Hijack', true);
  if visible <> 0 then raise exception 'foreign warehouse update returned % rows', visible; end if;

  execute 'reset role';

  -- 6. A logically deleted item is invisible to list and to read-for-manage.
  insert into app.inventory_items(id, restaurant_id, name, unit_code, deleted_at)
    values (deleted_item, r, 'Deleted', 'g', pg_catalog.clock_timestamp());

  execute 'set local role app_api';
  select count(*) into visible from app_private.list_inventory_items(manager, r);
  if visible <> 1 then raise exception 'deleted item leaked into list (% rows)', visible; end if;
  select count(*) into visible from app_private.read_inventory_item_for_manage(manager, deleted_item);
  if visible <> 0 then raise exception 'deleted item read for manage returned % rows', visible; end if;
  select count(*) into visible
  from app_private.update_inventory_item(manager, deleted_item, 'SUGAR', 'Sugar', 'g', 1, 0, true);
  if visible <> 0 then raise exception 'deleted item update returned % rows', visible; end if;
  execute 'reset role';
end $test$;
rollback;
