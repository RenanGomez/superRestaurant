begin;

-- The disposable local cluster stubs auth.uid() to NULL. Point it at a transaction-local GUC so the
-- RLS policies can be exercised as an authenticated member; the whole test is rolled back.
create or replace function auth.uid() returns uuid language sql stable as $uid$
  select pg_catalog.current_setting('test.actor_id', true)::uuid
$uid$;

do $test$
declare
  actor uuid := gen_random_uuid();
  r uuid := gen_random_uuid(); r2 uuid := gen_random_uuid();
  b uuid := gen_random_uuid(); b2 uuid := gen_random_uuid(); b3 uuid := gen_random_uuid();
  m uuid := gen_random_uuid();
  own_item uuid := gen_random_uuid(); foreign_item uuid := gen_random_uuid(); deleted_item uuid := gen_random_uuid();
  own_warehouse uuid := gen_random_uuid(); other_branch_warehouse uuid := gen_random_uuid(); foreign_warehouse uuid := gen_random_uuid();
  visible bigint; tbl text;
begin
  -- 4. Both tables must have ENABLE and FORCE row level security.
  foreach tbl in array array['inventory_items','inventory_warehouses'] loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relname = tbl and c.relrowsecurity and c.relforcerowsecurity
    ) then raise exception 'missing FORCE RLS: %', tbl; end if;
  end loop;

  -- 5. No direct write privileges for clients or the API role.
  foreach tbl in array array['inventory_items','inventory_warehouses'] loop
    if pg_catalog.has_table_privilege('authenticated', 'app.' || tbl, 'INSERT,UPDATE,DELETE,TRUNCATE')
      or pg_catalog.has_table_privilege('app_api', 'app.' || tbl, 'INSERT,UPDATE,DELETE,TRUNCATE')
    then raise exception 'direct write grant: %', tbl; end if;
  end loop;

  insert into auth.users(id,email) values (actor, 'inventory@invalid.test');
  insert into app.restaurants(id,name,time_zone) values
    (r, 'inventory', 'America/Hermosillo'),
    (r2, 'foreign', 'America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (b, r, 'inventory'),
    (b3, r, 'second branch'),
    (b2, r2, 'foreign');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values (m, actor, r, b, actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by)
    values (m, 'cashier', actor);

  -- 1. Column constraints reject invalid catalog data.
  begin
    insert into app.inventory_items(id,restaurant_id,name,unit_code) values (gen_random_uuid(), r, 'bad unit', 'kg');
    raise exception 'invalid unit_code accepted';
  exception when check_violation then null; end;
  begin
    insert into app.inventory_items(id,restaurant_id,name,unit_code,purchase_unit_factor) values (gen_random_uuid(), r, 'bad factor', 'g', 0);
    raise exception 'zero purchase_unit_factor accepted';
  exception when check_violation then null; end;
  begin
    insert into app.inventory_items(id,restaurant_id,name,unit_code,min_quantity) values (gen_random_uuid(), r, 'bad min', 'g', -1);
    raise exception 'negative min_quantity accepted';
  exception when check_violation then null; end;

  insert into app.inventory_items(id,restaurant_id,sku,name,unit_code) values
    (own_item, r, 'FLOUR', 'Flour', 'g'),
    (foreign_item, r2, 'FLOUR', 'Foreign flour', 'g');
  insert into app.inventory_warehouses(id,restaurant_id,branch_id,name) values
    (own_warehouse, r, b, 'Main'),
    (other_branch_warehouse, r, b3, 'Other branch'),
    (foreign_warehouse, r2, b2, 'Foreign');

  -- 2 and 3. RLS isolates items by restaurant and warehouses by branch.
  perform pg_catalog.set_config('test.actor_id', actor::text, true);
  execute 'set local role authenticated';
  select count(*) into visible from app.inventory_items where id = own_item;
  if visible <> 1 then raise exception 'own item not visible'; end if;
  select count(*) into visible from app.inventory_items where id = foreign_item;
  if visible <> 0 then raise exception 'foreign item visible'; end if;
  select count(*) into visible from app.inventory_warehouses where id = own_warehouse;
  if visible <> 1 then raise exception 'own warehouse not visible'; end if;
  select count(*) into visible from app.inventory_warehouses where id = other_branch_warehouse;
  if visible <> 0 then raise exception 'other branch warehouse visible'; end if;
  select count(*) into visible from app.inventory_warehouses where id = foreign_warehouse;
  if visible <> 0 then raise exception 'foreign warehouse visible'; end if;
  execute 'reset role';

  -- 6. A logically deleted item frees its SKU for reuse.
  insert into app.inventory_items(id,restaurant_id,sku,name,unit_code) values (deleted_item, r, 'SUGAR', 'Sugar', 'g');
  update app.inventory_items set deleted_at = pg_catalog.clock_timestamp() where id = deleted_item;
  insert into app.inventory_items(id,restaurant_id,sku,name,unit_code) values (gen_random_uuid(), r, 'SUGAR', 'Sugar again', 'g');
end $test$;
rollback;
