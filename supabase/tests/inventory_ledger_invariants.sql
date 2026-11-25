begin;

-- Disposable local cluster stubs auth.uid() to NULL; point it at a transaction-local GUC so RLS can
-- be exercised as a real member. Everything is rolled back at the end.
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
  b2 uuid := gen_random_uuid();
  m uuid := gen_random_uuid();
  m2 uuid := gen_random_uuid();
  item uuid := gen_random_uuid();
  foreign_item uuid := gen_random_uuid();
  warehouse uuid := gen_random_uuid();
  foreign_warehouse uuid := gen_random_uuid();
  movement_id uuid;
  result jsonb;
  balance integer;
  visible bigint;
  state text;
  err_message text;
begin
  insert into auth.users(id,email) values
    (actor, 'inventory-ledger@invalid.test'),
    (foreign_actor, 'inventory-ledger-foreign@invalid.test');
  insert into app.restaurants(id,name,time_zone) values
    (r, 'inventory ledger', 'America/Hermosillo'),
    (r2, 'foreign inventory ledger', 'America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (b, r, 'inventory ledger'),
    (b2, r2, 'foreign inventory ledger');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values
    (m, actor, r, b, actor),
    (m2, foreign_actor, r2, b2, foreign_actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values
    (m, 'cashier', actor),
    (m2, 'cashier', foreign_actor);
  insert into app.inventory_items(id,restaurant_id,name,unit_code) values
    (item, r, 'Ledger flour', 'g'),
    (foreign_item, r2, 'Foreign ledger flour', 'g');
  insert into app.inventory_warehouses(id,restaurant_id,branch_id,name) values
    (warehouse, r, b, 'Main'),
    (foreign_warehouse, r2, b2, 'Foreign');

  -- 8. Three movements (100, -30, -20) leave a derived balance of 50 and a matching ledger sum.
  result := app_private.inventory_record_movement(
    actor, r, b, warehouse, item, 'receipt', 100, null, 'ledger-in', null, null, null,
    pg_catalog.clock_timestamp(), null);
  if result ->> 'status' <> 'recorded' then raise exception 'receipt not recorded: %', result; end if;
  result := app_private.inventory_record_movement(
    actor, r, b, warehouse, item, 'sale_consumption', -30, null, 'ledger-sale-1', null, null, null,
    pg_catalog.clock_timestamp(), null);
  if result ->> 'status' <> 'recorded' then raise exception 'consumption 1 not recorded: %', result; end if;
  result := app_private.inventory_record_movement(
    actor, r, b, warehouse, item, 'sale_consumption', -20, null, 'ledger-sale-2', null, null, null,
    pg_catalog.clock_timestamp(), null);
  if result ->> 'status' <> 'recorded' then raise exception 'consumption 2 not recorded: %', result; end if;
  if (result ->> 'balance')::integer <> 50 then raise exception 'returned balance mismatch: %', result; end if;
  select quantity into balance from app.inventory_balances
  where warehouse_id = warehouse and item_id = item;
  if balance <> 50 then raise exception 'derived balance %, expected 50', balance; end if;
  select coalesce(pg_catalog.sum(quantity_delta), 0::bigint) into balance from app.inventory_movements
  where warehouse_id = warehouse and item_id = item;
  if balance <> 50 then raise exception 'ledger sum %, expected 50', balance; end if;

  -- 1. The ledger is immutable: UPDATE and DELETE both fail with SQLSTATE 42501.
  select id into movement_id from app.inventory_movements
  where restaurant_id = r and idempotency_key = 'ledger-in';
  begin
    update app.inventory_movements set reason = 'tampered' where id = movement_id;
    raise exception 'inventory movement update accepted';
  exception when sqlstate '42501' then null; end;
  begin
    delete from app.inventory_movements where id = movement_id;
    raise exception 'inventory movement delete accepted';
  exception when sqlstate '42501' then null; end;

  -- 2. Same idempotency key and payload returns duplicate without a second movement or balance change.
  result := app_private.inventory_record_movement(
    actor, r, b, warehouse, item, 'receipt', 100, null, 'ledger-duplicate', null, null, null,
    pg_catalog.clock_timestamp(), null);
  if result ->> 'status' <> 'recorded' then raise exception 'duplicate fixture not recorded: %', result; end if;
  result := app_private.inventory_record_movement(
    actor, r, b, warehouse, item, 'receipt', 100, null, 'ledger-duplicate', null, null, null,
    pg_catalog.clock_timestamp(), null);
  if result ->> 'status' <> 'duplicate' then raise exception 'replay not duplicate: %', result; end if;
  if (select count(*) from app.inventory_movements
      where restaurant_id = r and idempotency_key = 'ledger-duplicate') <> 1
  then raise exception 'duplicate idempotency key created a second movement'; end if;
  select quantity into balance from app.inventory_balances
  where warehouse_id = warehouse and item_id = item;
  if balance <> 150 then raise exception 'duplicate changed balance to %, expected 150', balance; end if;

  -- 3. Same idempotency key with a different payload is a hard conflict.
  begin
    perform app_private.inventory_record_movement(
      actor, r, b, warehouse, item, 'receipt', 999, null, 'ledger-duplicate', null, null, null,
      pg_catalog.clock_timestamp(), null);
    raise exception 'idempotency payload change accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;

  -- 4. quantity_delta = 0 is rejected by the table check.
  begin
    insert into app.inventory_movements (
      restaurant_id, branch_id, warehouse_id, item_id, kind, quantity_delta, unit_code,
      occurred_at, actor_id, idempotency_key
    ) values (
      r, b, warehouse, item, 'adjustment', 0, 'g', pg_catalog.clock_timestamp(), actor, 'ledger-zero'
    );
    raise exception 'zero quantity_delta accepted';
  exception when check_violation then null; end;

  -- 5. waste without reason is rejected by the table check.
  begin
    insert into app.inventory_movements (
      restaurant_id, branch_id, warehouse_id, item_id, kind, quantity_delta, unit_code,
      occurred_at, actor_id, reason, idempotency_key
    ) values (
      r, b, warehouse, item, 'waste', -1, 'g', pg_catalog.clock_timestamp(), actor, null, 'ledger-waste'
    );
    raise exception 'waste without reason accepted';
  exception when check_violation then null; end;

  -- 6. sale_reversal without compensates_movement_id is rejected by the table check.
  begin
    insert into app.inventory_movements (
      restaurant_id, branch_id, warehouse_id, item_id, kind, quantity_delta, unit_code,
      occurred_at, actor_id, reason, idempotency_key, compensates_movement_id
    ) values (
      r, b, warehouse, item, 'sale_reversal', 5, 'g', pg_catalog.clock_timestamp(), actor,
      'reversal', 'ledger-reversal', null
    );
    raise exception 'sale_reversal without compensation accepted';
  exception when check_violation then null; end;

  -- 7. An actor from another restaurant cannot record in this scope and cannot read its movements.
  begin
    perform app_private.inventory_record_movement(
      foreign_actor, r, b, warehouse, item, 'receipt', 10, null, 'ledger-foreign-write', null, null, null,
      pg_catalog.clock_timestamp(), null);
    raise exception 'foreign actor recorded a movement';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;

  perform pg_catalog.set_config('test.actor_id', actor::text, true);
  execute 'set local role authenticated';
  select count(*) into visible from app.inventory_movements where restaurant_id = r;
  if visible = 0 then raise exception 'own actor cannot read own movements'; end if;
  execute 'reset role';

  perform pg_catalog.set_config('test.actor_id', foreign_actor::text, true);
  execute 'set local role authenticated';
  select count(*) into visible from app.inventory_movements where restaurant_id = r;
  if visible <> 0 then raise exception 'foreign actor read % movements', visible; end if;
  execute 'reset role';
end $test$;
rollback;
