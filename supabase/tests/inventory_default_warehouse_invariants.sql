begin;

-- Disposable local cluster: the fixture rows and every call run inside this transaction and are
-- rolled back at the end. The point is that a branch keeps at most one active default warehouse and
-- that only the private SECURITY DEFINER wrappers move it; app_api never gets DML on the table.
do $test$
declare
  manager uuid := gen_random_uuid();
  r uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  manager_membership uuid := gen_random_uuid();
  first_warehouse uuid;
  second_warehouse uuid;
  active_defaults bigint;
  is_default_value boolean;
  active_value boolean;
  state text;
  err_message text;
begin
  -- 1. app_api has no direct DML on the warehouse table; the wrappers are the only entry points.
  if pg_catalog.has_table_privilege('app_api', 'app.inventory_warehouses', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception 'app_api has DML on app.inventory_warehouses';
  end if;

  insert into auth.users(id, email) values
    (manager, 'inventory-default-manager@invalid.test');
  insert into app.restaurants(id, name, time_zone) values
    (r, 'inventory default warehouse', 'America/Hermosillo');
  insert into app.branches(id, restaurant_id, name) values
    (b, r, 'inventory default warehouse');
  insert into app.memberships(id, user_id, restaurant_id, branch_id, granted_by) values
    (manager_membership, manager, r, b, manager);
  insert into app.membership_role_grants(membership_id, role_code, granted_by) values
    (manager_membership, 'manager', manager);

  execute 'set local role app_api';

  -- 2. First warehouse is the default; exactly one active default exists for the branch.
  select created.id into first_warehouse
  from app_private.create_inventory_warehouse(manager, r, b, 'Bodega central', true, true) as created;
  if first_warehouse is null then raise exception 'manager could not create the first warehouse'; end if;

  select count(*) into active_defaults
  from app_private.list_inventory_warehouses(manager, r, b)
  where is_default and active;
  if active_defaults <> 1 then raise exception 'expected 1 active default, got %', active_defaults; end if;

  -- 3. Creating a second default moves it: the previous one is left false.
  select created.id into second_warehouse
  from app_private.create_inventory_warehouse(manager, r, b, 'Cámara fría', true, true) as created;
  if second_warehouse is null then raise exception 'manager could not create the second warehouse'; end if;

  select is_default into is_default_value
  from app_private.list_inventory_warehouses(manager, r, b)
  where id = first_warehouse;
  if is_default_value then raise exception 'first warehouse kept the default after moving it'; end if;

  select is_default into is_default_value
  from app_private.list_inventory_warehouses(manager, r, b)
  where id = second_warehouse;
  if not is_default_value then raise exception 'second warehouse did not become the default'; end if;

  select count(*) into active_defaults
  from app_private.list_inventory_warehouses(manager, r, b)
  where is_default and active;
  if active_defaults <> 1 then raise exception 'expected 1 default after the move, got %', active_defaults; end if;

  -- 4. Updating a warehouse to default moves it back and clears the other.
  perform app_private.update_inventory_warehouse(manager, first_warehouse, 'Bodega central', true, true);
  select is_default into is_default_value
  from app_private.list_inventory_warehouses(manager, r, b)
  where id = second_warehouse;
  if is_default_value then raise exception 'second warehouse kept the default after the update move'; end if;
  select count(*) into active_defaults
  from app_private.list_inventory_warehouses(manager, r, b)
  where is_default and active;
  if active_defaults <> 1 then raise exception 'expected 1 default after the update, got %', active_defaults; end if;

  -- 5. Deactivating the default forces is_default false and leaves zero active defaults.
  perform app_private.update_inventory_warehouse(manager, first_warehouse, 'Bodega central', false, true);
  select active, is_default into active_value, is_default_value
  from app_private.list_inventory_warehouses(manager, r, b)
  where id = first_warehouse;
  if active_value or is_default_value then
    raise exception 'deactivated warehouse kept active=% default=%', active_value, is_default_value;
  end if;
  select count(*) into active_defaults
  from app_private.list_inventory_warehouses(manager, r, b)
  where is_default and active;
  if active_defaults <> 0 then raise exception 'expected 0 active defaults, got %', active_defaults; end if;

  -- 6. Creating a default while inactive fails with 22000 and never persists the row.
  begin
    perform app_private.create_inventory_warehouse(manager, r, b, 'Bodega inválida', false, true);
    raise exception 'inactive default warehouse was created';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_WAREHOUSE_DEFAULT_REQUIRES_ACTIVE' then
      raise;
    end if;
  end;

  select count(*) into active_defaults
  from app_private.list_inventory_warehouses(manager, r, b)
  where name = 'Bodega inválida';
  if active_defaults <> 0 then raise exception 'rejected inactive default warehouse leaked a row'; end if;

  -- 7. read_inventory_warehouse_for_manage also exposes the default flag to app_api.
  select w.is_default into is_default_value
  from app_private.read_inventory_warehouse_for_manage(manager, second_warehouse) as w;
  if is_default_value is null then raise exception 'read for manage did not expose is_default'; end if;

  execute 'reset role';
end $test$;
rollback;
