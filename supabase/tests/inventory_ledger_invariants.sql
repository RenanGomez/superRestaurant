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
  b3 uuid := gen_random_uuid();
  m uuid := gen_random_uuid();
  m2 uuid := gen_random_uuid();
  m3 uuid := gen_random_uuid();
  item uuid := gen_random_uuid();
  foreign_item uuid := gen_random_uuid();
  deleted_item uuid := gen_random_uuid();
  warehouse uuid := gen_random_uuid();
  warehouse2 uuid := gen_random_uuid();
  warehouse3 uuid := gen_random_uuid();
  foreign_warehouse uuid := gen_random_uuid();
  inactive_warehouse uuid := gen_random_uuid();
  source uuid := gen_random_uuid();
  movement_id uuid;
  sale_movement uuid;
  result jsonb;
  balance integer;
  visible bigint;
  state text;
  err_message text;
  constraint_hit text;
  role_name text;
  tbl text;
  function_oid oid := pg_catalog.to_regprocedure('app_private.inventory_record_movement(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,text,uuid,uuid,timestamptz,uuid)');
begin
  -- RLS must be ENABLED and FORCED on the ledger and the derived balances.
  foreach tbl in array array['inventory_movements','inventory_balances'] loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relname = tbl and c.relrowsecurity and c.relforcerowsecurity
    ) then raise exception 'missing FORCE RLS: %', tbl; end if;
  end loop;

  -- Clients and PUBLIC cannot write the tables, and no client role may execute the raw writer; app_api
  -- reaches the ledger only through per-operation wrappers (e.g. inventory_record_manual_movement).
  foreach tbl in array array['inventory_movements','inventory_balances'] loop
    foreach role_name in array array['authenticated','app_api','anon','service_role','public'] loop
      if pg_catalog.has_table_privilege(role_name::name, 'app.' || tbl, 'INSERT,UPDATE,DELETE,TRUNCATE') then
        raise exception 'direct write grant: %.%', role_name, tbl;
      end if;
    end loop;
  end loop;
  if function_oid is null then
    raise exception 'inventory_record_movement missing';
  end if;
  foreach role_name in array array['app_api','authenticated','anon','service_role','public'] loop
    if pg_catalog.has_function_privilege(role_name, function_oid, 'EXECUTE') then
      raise exception '% can execute inventory_record_movement', role_name;
    end if;
  end loop;

  insert into auth.users(id,email) values
    (actor, 'inventory-ledger@invalid.test'),
    (foreign_actor, 'inventory-ledger-foreign@invalid.test');
  insert into app.restaurants(id,name,time_zone) values
    (r, 'inventory ledger', 'America/Hermosillo'),
    (r2, 'foreign inventory ledger', 'America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (b, r, 'inventory ledger'),
    (b3, r, 'inventory ledger second branch'),
    (b2, r2, 'foreign inventory ledger');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values
    (m, actor, r, b, actor),
    (m3, actor, r, b3, actor),
    (m2, foreign_actor, r2, b2, foreign_actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values
    (m, 'cashier', actor),
    (m3, 'cashier', actor),
    (m2, 'cashier', foreign_actor);
  insert into app.inventory_items(id,restaurant_id,name,unit_code,deleted_at) values
    (item, r, 'Ledger flour', 'g', null),
    (deleted_item, r, 'Deleted ledger flour', 'g', pg_catalog.clock_timestamp()),
    (foreign_item, r2, 'Foreign ledger flour', 'g', null);
  insert into app.inventory_warehouses(id,restaurant_id,branch_id,name,active) values
    (warehouse, r, b, 'Main', true),
    (warehouse2, r, b, 'Secondary', true),
    (warehouse3, r, b3, 'Third', true),
    (inactive_warehouse, r, b, 'Inactive', false),
    (foreign_warehouse, r2, b2, 'Foreign', true);

  -- Three movements (100, -30, -20) leave a derived balance of 50 and a matching ledger sum.
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

  -- The ledger is immutable: UPDATE and DELETE both fail with SQLSTATE 42501.
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

  -- Same idempotency key and payload returns duplicate without a second movement or balance change.
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

  -- Same idempotency key with a different payload is a hard conflict.
  begin
    perform app_private.inventory_record_movement(
      actor, r, b, warehouse, item, 'receipt', 999, null, 'ledger-duplicate', null, null, null,
      pg_catalog.clock_timestamp(), null);
    raise exception 'idempotency payload change accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;

  -- Same key but a different warehouse or branch must be a conflict, never a silent duplicate.
  result := app_private.inventory_record_movement(
    actor, r, b, warehouse, item, 'receipt', 5, null, 'ledger-scope-key', null, null, null,
    pg_catalog.clock_timestamp(), null);
  if result ->> 'status' <> 'recorded' then raise exception 'scope fixture not recorded: %', result; end if;
  begin
    perform app_private.inventory_record_movement(
      actor, r, b, warehouse2, item, 'receipt', 5, null, 'ledger-scope-key', null, null, null,
      pg_catalog.clock_timestamp(), null);
    raise exception 'same key on another warehouse accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;
  begin
    perform app_private.inventory_record_movement(
      actor, r, b3, warehouse3, item, 'receipt', 5, null, 'ledger-scope-key', null, null, null,
      pg_catalog.clock_timestamp(), null);
    raise exception 'same key on another branch accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;

  -- quantity_delta = 0 is rejected by the non-zero check (with a valid reason).
  begin
    insert into app.inventory_movements (
      restaurant_id, branch_id, warehouse_id, item_id, kind, quantity_delta, unit_code,
      occurred_at, actor_id, reason, idempotency_key
    ) values (
      r, b, warehouse, item, 'adjustment', 0, 'g', pg_catalog.clock_timestamp(), actor,
      'inventory adjustment', 'ledger-zero'
    );
    raise exception 'zero quantity_delta accepted';
  exception when check_violation then
    get stacked diagnostics constraint_hit = constraint_name;
    if constraint_hit <> 'inventory_movements_quantity_delta_non_zero' then raise; end if;
  end;

  -- waste without reason is rejected by the reason check.
  begin
    insert into app.inventory_movements (
      restaurant_id, branch_id, warehouse_id, item_id, kind, quantity_delta, unit_code,
      occurred_at, actor_id, reason, idempotency_key
    ) values (
      r, b, warehouse, item, 'waste', -1, 'g', pg_catalog.clock_timestamp(), actor, null, 'ledger-waste'
    );
    raise exception 'waste without reason accepted';
  exception when check_violation then
    get stacked diagnostics constraint_hit = constraint_name;
    if constraint_hit <> 'inventory_movements_reason_required' then raise; end if;
  end;

  -- sale_reversal without compensates_movement_id is rejected by the table check.
  begin
    insert into app.inventory_movements (
      restaurant_id, branch_id, warehouse_id, item_id, kind, quantity_delta, unit_code,
      occurred_at, actor_id, reason, idempotency_key, compensates_movement_id
    ) values (
      r, b, warehouse, item, 'sale_reversal', 5, 'g', pg_catalog.clock_timestamp(), actor,
      'reversal', 'ledger-reversal-missing', null
    );
    raise exception 'sale_reversal without compensation accepted';
  exception when check_violation then
    get stacked diagnostics constraint_hit = constraint_name;
    if constraint_hit <> 'inventory_movements_reversal_compensation_required' then raise; end if;
  end;

  -- An actor from another restaurant cannot record in this scope and cannot read its movements.
  begin
    perform app_private.inventory_record_movement(
      foreign_actor, r, b, warehouse, item, 'receipt', 10, null, 'ledger-foreign-write', null, null, null,
      pg_catalog.clock_timestamp(), null);
    raise exception 'foreign actor recorded a movement';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '42501' or err_message <> 'INVENTORY_ACTOR_FORBIDDEN' then raise; end if;
  end;

  -- An item from another restaurant is out of scope.
  begin
    perform app_private.inventory_record_movement(
      actor, r, b, warehouse, foreign_item, 'receipt', 1, null, 'ledger-foreign-item', null, null, null,
      pg_catalog.clock_timestamp(), null);
    raise exception 'foreign item movement accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_ITEM_SCOPE_INVALID' then raise; end if;
  end;

  -- A warehouse belonging to another branch is out of scope.
  begin
    perform app_private.inventory_record_movement(
      actor, r, b, foreign_warehouse, item, 'receipt', 1, null, 'ledger-foreign-warehouse', null, null, null,
      pg_catalog.clock_timestamp(), null);
    raise exception 'foreign warehouse movement accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_WAREHOUSE_SCOPE_INVALID' then raise; end if;
  end;

  -- A logically deleted item and an inactive warehouse reject new movements.
  begin
    perform app_private.inventory_record_movement(
      actor, r, b, warehouse, deleted_item, 'receipt', 1, null, 'ledger-deleted-item', null, null, null,
      pg_catalog.clock_timestamp(), null);
    raise exception 'deleted item movement accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_ITEM_INACTIVE' then raise; end if;
  end;
  begin
    perform app_private.inventory_record_movement(
      actor, r, b, inactive_warehouse, item, 'receipt', 1, null, 'ledger-inactive-warehouse', null, null, null,
      pg_catalog.clock_timestamp(), null);
    raise exception 'inactive warehouse movement accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_WAREHOUSE_INACTIVE' then raise; end if;
  end;

  -- sale_reversal must compensate a sale_consumption of the same scope with the exact inverse delta.
  select id into sale_movement from app.inventory_movements
  where restaurant_id = r and idempotency_key = 'ledger-sale-1';
  begin
    perform app_private.inventory_record_movement(
      actor, r, b, warehouse2, item, 'sale_reversal', 30, null, 'ledger-reversal-other-warehouse',
      null, null, sale_movement, pg_catalog.clock_timestamp(), null);
    raise exception 'reversal against another warehouse accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_REVERSAL_INVALID' then raise; end if;
  end;
  begin
    perform app_private.inventory_record_movement(
      actor, r, b, warehouse, item, 'sale_reversal', 5, null, 'ledger-reversal-sign',
      null, null, sale_movement, pg_catalog.clock_timestamp(), null);
    raise exception 'reversal with the wrong sign accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_REVERSAL_INVALID' then raise; end if;
  end;
  begin
    perform app_private.inventory_record_movement(
      actor, r, b, warehouse, item, 'sale_reversal', -100, null, 'ledger-reversal-receipt',
      null, null, movement_id, pg_catalog.clock_timestamp(), null);
    raise exception 'reversal of a non consumption accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_REVERSAL_INVALID' then raise; end if;
  end;
  result := app_private.inventory_record_movement(
    actor, r, b, warehouse, item, 'sale_reversal', 30, null, 'ledger-reversal',
    null, null, sale_movement, pg_catalog.clock_timestamp(), null);
  if result ->> 'status' <> 'recorded' then raise exception 'valid reversal not recorded: %', result; end if;
  begin
    perform app_private.inventory_record_movement(
      actor, r, b, warehouse, item, 'sale_reversal', 30, null, 'ledger-reversal-duplicate',
      null, null, sale_movement, pg_catalog.clock_timestamp(), null);
    raise exception 'second reversal of the same consumption accepted';
  exception when others then
    get stacked diagnostics state = returned_sqlstate, err_message = message_text;
    if state <> '22000' or err_message <> 'INVENTORY_REVERSAL_INVALID' then raise; end if;
  end;
  result := app_private.inventory_record_movement(
    actor, r, b, warehouse, item, 'sale_reversal', 30, null, 'ledger-reversal',
    null, null, sale_movement, pg_catalog.clock_timestamp(), null);
  if result ->> 'status' <> 'duplicate' then raise exception 'reversal replay not duplicate: %', result; end if;

  -- A duplicated source (different key) violates the source uniqueness index.
  result := app_private.inventory_record_movement(
    actor, r, b, warehouse, item, 'receipt', 1, null, 'ledger-source-1', 'purchase', source, null,
    pg_catalog.clock_timestamp(), null);
  if result ->> 'status' <> 'recorded' then raise exception 'source fixture not recorded: %', result; end if;
  begin
    perform app_private.inventory_record_movement(
      actor, r, b, warehouse, item, 'receipt', 2, null, 'ledger-source-2', 'purchase', source, null,
      pg_catalog.clock_timestamp(), null);
    raise exception 'duplicated source accepted';
  exception when unique_violation then null; end;

  -- A foreign actor with an active movement produces a balance that the local actor cannot see or update.
  result := app_private.inventory_record_movement(
    foreign_actor, r2, b2, foreign_warehouse, foreign_item, 'receipt', 7, null,
    'ledger-foreign-balance', null, null, null, pg_catalog.clock_timestamp(), null);
  if result ->> 'status' <> 'recorded' then raise exception 'foreign balance fixture not recorded: %', result; end if;

  perform pg_catalog.set_config('test.actor_id', actor::text, true);
  execute 'set local role authenticated';
  select count(*) into visible from app.inventory_movements where restaurant_id = r;
  if visible = 0 then raise exception 'own actor cannot read own movements'; end if;
  select count(*) into visible from app.inventory_balances
  where warehouse_id = warehouse and item_id = item;
  if visible <> 1 then raise exception 'own actor cannot read own balance'; end if;
  select count(*) into visible from app.inventory_balances
  where warehouse_id = foreign_warehouse and item_id = foreign_item;
  if visible <> 0 then raise exception 'foreign balance visible: %', visible; end if;
  begin
    update app.inventory_balances set quantity = quantity + 1
    where warehouse_id = foreign_warehouse and item_id = foreign_item;
    raise exception 'foreign balance update accepted';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  select quantity into balance from app.inventory_balances
  where warehouse_id = foreign_warehouse and item_id = foreign_item;
  if balance <> 7 then raise exception 'foreign balance changed to %', balance; end if;

  perform pg_catalog.set_config('test.actor_id', foreign_actor::text, true);
  execute 'set local role authenticated';
  select count(*) into visible from app.inventory_movements where restaurant_id = r;
  if visible <> 0 then raise exception 'foreign actor read % movements', visible; end if;
  execute 'reset role';
end $test$;
rollback;
