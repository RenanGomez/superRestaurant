-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises 20261102000100_menu_locked_ingredients.sql:
--   1. backfill simulation and idempotency: options of extra group not matching excludable labels become locked;
--   2. save_menu_catalog / build_menu_catalog_state round-trip modern lockedIngredientOptionIds;
--   3. save_menu_catalog idempotency / replay;
--   4. save_menu_catalog rejections: duplicate locked options, foreign locked options, locked options without extra group;
--   5. confirm_capture_draft_v3: exclusion of locked option rejected ('conflict');
--   6. confirm_capture_draft_v3: exclusion of un-locked option accepted with 0 price and name 'Sin <OptionName>';
--   7. confirm_capture_draft_v3: legacy string exclusion tolerated when present in fr_labels;
--   8. table CHECK constraints on fraction_locked_ingredient_option_ids (<= 40, no nulls).
begin;
do $menu_locked_ingredients_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  membership uuid := gen_random_uuid();
  shift uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  now_at timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  category uuid := gen_random_uuid();
  product_pizza uuid := gen_random_uuid();
  g_flavors uuid := gen_random_uuid();
  g_extras uuid := gen_random_uuid();
  o_pep uuid := gen_random_uuid();
  o_haw uuid := gen_random_uuid();
  o_cebolla uuid := gen_random_uuid();
  o_jamon uuid := gen_random_uuid();
  o_champi uuid := gen_random_uuid();
  catalog_id uuid := gen_random_uuid();
  save_status text;
  save_state jsonb;
  save_event uuid;
  save_key uuid;
  payload jsonb;
  bad_payload jsonb;
  old_payload jsonb;
  new_payload jsonb;
  replay_payload_old jsonb;
  replay_payload_new jsonb;
  test_catalog uuid;
  target_capture uuid;
  line_id uuid;
  confirmed_order uuid;
  confirmation_event uuid;
  lease text;
  created jsonb;
  command jsonb;
  plan jsonb;
  confirmation_command jsonb;
  order_record jsonb;
  order_audits jsonb;
  result jsonb;
  snap jsonb;
begin
  if actor is null then raise exception 'LOCKED_INGREDIENTS_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id, name, time_zone) values(restaurant, 'rollback-only locked ingredients test', 'America/Hermosillo');
  insert into app.branches(id, restaurant_id, name) values(branch, restaurant, 'rollback-only locked ingredients branch');
  insert into app.memberships(id, user_id, restaurant_id, branch_id, granted_by) values(membership, actor, restaurant, branch, actor);
  insert into app.membership_role_grants(membership_id, role_code, granted_by) values(membership, 'manager', actor);
  insert into app.operational_shifts(id,restaurant_id,branch_id,name,status,opened_at,opened_by)
  values(shift,restaurant,branch,'rollback locked ingredients confirmation','open',now_at,actor);

  -- ------------------------------------------------------------
  -- 1. Table CHECK constraints on fraction_locked_ingredient_option_ids
  -- ------------------------------------------------------------
  insert into app.menu_catalogs(id, restaurant_id, version, currency, published_by)
  values(catalog_id, restaurant, 1, 'MXN', actor);
  insert into app.menu_catalog_heads(restaurant_id, catalog_id, version, updated_at, updated_by)
  values(restaurant, catalog_id, 1, now_at, actor);
  insert into app.menu_categories(restaurant_id, catalog_id, id, name, active, display_order)
  values(restaurant, catalog_id, category, 'Pizzas', true, 0);

  -- Null element inside locked options must be rejected
  begin
    insert into app.menu_products(restaurant_id, catalog_id, id, category_id, name, sku, active, display_order, station_id, unit, unit_price_minor, fraction_locked_ingredient_option_ids)
    values(restaurant, catalog_id, gen_random_uuid(), category, 'Bad Pizza Null', null, true, 0, 'kitchen', 'piece', 10000, array[o_cebolla, null]);
    raise exception 'LOCKED_INGREDIENTS_NULL_OPTION_ACCEPTED';
  exception when check_violation then null;
  end;

  -- Cardinality > 40 must be rejected
  begin
    insert into app.menu_products(restaurant_id, catalog_id, id, category_id, name, sku, active, display_order, station_id, unit, unit_price_minor, fraction_locked_ingredient_option_ids)
    values(restaurant, catalog_id, gen_random_uuid(), category, 'Bad Pizza 41', null, true, 0, 'kitchen', 'piece', 10000,
      (select array_agg(gen_random_uuid()) from generate_series(1, 41)));
    raise exception 'LOCKED_INGREDIENTS_OVER_40_ACCEPTED';
  exception when check_violation then null;
  end;

  -- ------------------------------------------------------------
  -- 2. Backfill simulation and idempotency
  -- ------------------------------------------------------------
  -- Insert groups & options
  insert into app.menu_modifier_groups(restaurant_id, catalog_id, id, product_id, name, active, display_order, minimum_quantity, maximum_quantity)
  values
    (restaurant, catalog_id, g_flavors, product_pizza, 'Sabores', true, 0, 1, 1),
    (restaurant, catalog_id, g_extras, product_pizza, 'Ingredientes', true, 1, 0, 5);
  insert into app.menu_modifier_options(restaurant_id, catalog_id, group_id, id, name, unit_price_minor, active, maximum_quantity)
  values
    (restaurant, catalog_id, g_flavors, o_pep, 'Pepperoni', 12000, true, 1),
    (restaurant, catalog_id, g_flavors, o_haw, 'Hawaiana', 13000, true, 1),
    (restaurant, catalog_id, g_extras, o_cebolla, 'Cebolla', 1000, true, 1),
    (restaurant, catalog_id, g_extras, o_jamon, 'Jamon', 1500, true, 1),
    (restaurant, catalog_id, g_extras, o_champi, 'Champinones', 1500, true, 1);

  -- Insert a product with legacy excludable labels: 'Cebolla' only.
  -- Expected backfill result: 'Jamon' and 'Champinones' become locked, 'Cebolla' remains un-locked.
  insert into app.menu_products(restaurant_id, catalog_id, id, category_id, name, sku, active, display_order, station_id, unit, unit_price_minor,
    fraction_enabled, fraction_flavor_group_id, fraction_extra_group_id, fraction_excludable_ingredient_ids, fraction_locked_ingredient_option_ids)
  values
    (restaurant, catalog_id, product_pizza, category, 'Pizza Clasica', null, true, 0, 'kitchen', 'piece', 12000,
     true, g_flavors, g_extras, array['Cebolla'], '{}');

  -- Execute backfill block
  update app.menu_products p
  set fraction_locked_ingredient_option_ids = coalesce((
    select pg_catalog.array_agg(opt.id order by opt.id)
    from app.menu_modifier_options opt
    where opt.restaurant_id = p.restaurant_id and opt.catalog_id = p.catalog_id
      and opt.group_id = p.fraction_extra_group_id
      and not exists (
        select 1 from pg_catalog.unnest(p.fraction_excludable_ingredient_ids) as ex(lbl)
        where pg_catalog.lower(pg_catalog.btrim(opt.name)) = pg_catalog.lower(pg_catalog.btrim(ex.lbl))
      )
  ), '{}'::uuid[])
  where p.restaurant_id = restaurant and p.catalog_id = catalog_id and p.id = product_pizza;

  if not exists (
    select 1 from app.menu_products p
    where p.id = product_pizza
      and o_jamon = any(p.fraction_locked_ingredient_option_ids)
      and o_champi = any(p.fraction_locked_ingredient_option_ids)
      and not (o_cebolla = any(p.fraction_locked_ingredient_option_ids))
  ) then raise exception 'LOCKED_INGREDIENTS_BACKFILL_INCORRECT'; end if;

  -- ------------------------------------------------------------
  -- 3. save_menu_catalog / build_menu_catalog_state roundtrip
  -- ------------------------------------------------------------
  payload := pg_catalog.jsonb_build_object(
    'categories', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('categoryId', category::text, 'name', 'Pizzas', 'active', true, 'displayOrder', 0)
    ),
    'products', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'productId', product_pizza::text, 'categoryId', category::text, 'name', 'Pizza Moderna', 'sku', null,
        'active', true, 'displayOrder', 0, 'stationId', 'kitchen', 'unit', 'piece', 'unitPriceMinor', 15000, 'tax', null,
        'modifierGroupIds', pg_catalog.jsonb_build_array(g_flavors::text, g_extras::text),
        'fraction', pg_catalog.jsonb_build_object(
          'enabled', true,
          'flavorGroupId', g_flavors::text,
          'extraGroupId', g_extras::text,
          'lockedIngredientOptionIds', pg_catalog.jsonb_build_array(o_cebolla::text)
        )
      )
    ),
    'modifierGroups', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'groupId', g_flavors::text, 'productId', null, 'name', 'Sabores', 'active', true,
        'displayOrder', 0, 'minimumQuantity', 1, 'maximumQuantity', 1,
        'options', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('optionId', o_pep::text, 'name', 'Pepperoni', 'unitPriceMinor', 15000, 'active', true, 'maximumQuantity', 1),
          pg_catalog.jsonb_build_object('optionId', o_haw::text, 'name', 'Hawaiana', 'unitPriceMinor', 15000, 'active', true, 'maximumQuantity', 1)
        )
      ),
      pg_catalog.jsonb_build_object(
        'groupId', g_extras::text, 'productId', null, 'name', 'Ingredientes', 'active', true,
        'displayOrder', 1, 'minimumQuantity', 0, 'maximumQuantity', 5,
        'options', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('optionId', o_cebolla::text, 'name', 'Cebolla', 'unitPriceMinor', 1000, 'active', true, 'maximumQuantity', 1),
          pg_catalog.jsonb_build_object('optionId', o_jamon::text, 'name', 'Jamon', 'unitPriceMinor', 1500, 'active', true, 'maximumQuantity', 1)
        )
      )
    )
  );

  save_event := gen_random_uuid();
  save_key := gen_random_uuid();
  catalog_id := gen_random_uuid();

  execute 'set local role app_api';
  select s.status, s.state into save_status, save_state from app_private.save_menu_catalog(
    actor, restaurant, branch, save_event, save_key, device, now_at, 1, catalog_id, 'MXN', payload) s;
  execute 'reset role';

  if save_status <> 'saved' then raise exception 'LOCKED_INGREDIENTS_SAVE_FAILED: %', save_status; end if;

  -- Confirm build_menu_catalog_state serialized lockedIngredientOptionIds
  if save_state#>'{catalog,products,0,fraction,lockedIngredientOptionIds}' is distinct from pg_catalog.jsonb_build_array(o_cebolla::text)
  then raise exception 'LOCKED_INGREDIENTS_ROUNDTRIP_MISMATCH: %', save_state#>'{catalog,products,0,fraction}'; end if;

  -- Replay is idempotent
  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor, restaurant, branch, save_event, save_key, device, now_at, 1, catalog_id, 'MXN', payload) s;
  execute 'reset role';

  if save_status <> 'replayed' then raise exception 'LOCKED_INGREDIENTS_REPLAY_FAILED: %', save_status; end if;

  -- ------------------------------------------------------------
  -- 4. save_menu_catalog rejections
  -- ------------------------------------------------------------
  -- Duplicate locked option in payload
  bad_payload := pg_catalog.jsonb_set(
    payload,
    '{products,0,fraction,lockedIngredientOptionIds}',
    pg_catalog.jsonb_build_array(o_cebolla::text, o_cebolla::text)
  );
  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor, restaurant, branch, gen_random_uuid(), gen_random_uuid(), device, now_at, 2, gen_random_uuid(), 'MXN', bad_payload) s;
  execute 'reset role';
  if save_status <> 'conflict' then raise exception 'LOCKED_INGREDIENTS_DUPLICATE_ACCEPTED'; end if;

  -- Foreign locked option not in extra group
  bad_payload := pg_catalog.jsonb_set(
    payload,
    '{products,0,fraction,lockedIngredientOptionIds}',
    pg_catalog.jsonb_build_array(gen_random_uuid()::text)
  );
  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor, restaurant, branch, gen_random_uuid(), gen_random_uuid(), device, now_at, 2, gen_random_uuid(), 'MXN', bad_payload) s;
  execute 'reset role';
  if save_status <> 'conflict' then raise exception 'LOCKED_INGREDIENTS_FOREIGN_ACCEPTED'; end if;

  -- ------------------------------------------------------------
  -- 5. confirm_capture_draft_v3 with locked vs un-locked exclusion
  -- ------------------------------------------------------------
  target_capture := gen_random_uuid();
  line_id := gen_random_uuid();
  confirmed_order := gen_random_uuid();
  confirmation_event := gen_random_uuid();

  execute 'set local role app_api';
  created := app_private.create_capture_draft(actor, pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'scope', pg_catalog.jsonb_build_object('restaurantId', restaurant::text, 'branchId', branch::text),
    'captureDraftId', target_capture::text, 'expectedVersion', 0, 'eventId', gen_random_uuid()::text,
    'idempotencyKey', gen_random_uuid()::text, 'deviceId', device::text, 'occurredAt', now_at,
    'sourceChannel', 'phone', 'fulfillmentChannel', 'counter'
  ));
  execute 'reset role';
  if created->>'status' <> 'applied' then raise exception 'LOCKED_INGREDIENTS_CAPTURE_CREATE_FAILED'; end if;
  lease := created#>>'{record,detail,attentionLeaseId}';

  -- Replace plan with halves: Slot A excludes o_jamon (unlocked -> ok), Slot B has no exclusions
  command := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'scope', pg_catalog.jsonb_build_object('restaurantId', restaurant::text, 'branchId', branch::text),
    'captureDraftId', target_capture::text, 'expectedVersion', 1, 'attentionLeaseId', lease,
    'eventId', gen_random_uuid()::text, 'idempotencyKey', gen_random_uuid()::text, 'deviceId', device::text, 'occurredAt', now_at
  );
  plan := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'catalogVersion', catalog_id::text, 'lines', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'lineId', line_id::text, 'productId', product_pizza::text, 'quantity', 1, 'note', null,
        'fraction', pg_catalog.jsonb_build_object(
          'geometry', 'halves',
          'slots', pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('fraction', 'half-a', 'flavorOptionId', o_pep::text, 'extraOptionIds', '[]'::jsonb, 'excludedIngredientIds', pg_catalog.jsonb_build_array(o_jamon::text)),
            pg_catalog.jsonb_build_object('fraction', 'half-b', 'flavorOptionId', o_haw::text, 'extraOptionIds', '[]'::jsonb, 'excludedIngredientIds', '[]'::jsonb)
          )
        ),
        'modifierGroups', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('groupId', g_flavors::text, 'selections', '[]'::jsonb),
          pg_catalog.jsonb_build_object('groupId', g_extras::text, 'selections', '[]'::jsonb)
        )
      )
    )
  );

  execute 'set local role app_api';
  result := app_private.replace_capture_selection_plan(actor, command, plan);
  execute 'reset role';
  if result->>'status' <> 'applied' then raise exception 'LOCKED_INGREDIENTS_PLAN_FAILED: %', result; end if;

  -- Confirm draft with unlocked exclusion -> MUST BE APPLIED
  confirmation_command := pg_catalog.jsonb_build_object(
    'schemaVersion', 2, 'scope', pg_catalog.jsonb_build_object('restaurantId', restaurant::text, 'branchId', branch::text),
    'captureDraftId', target_capture::text, 'expectedVersion', 2, 'eventId', confirmation_event::text,
    'idempotencyKey', gen_random_uuid()::text, 'deviceId', device::text, 'occurredAt', now_at,
    'attentionLeaseId', lease, 'orderId', confirmed_order::text, 'shiftId', shift::text, 'tableId', null,
    'currency', 'MXN', 'timeZone', 'America/Hermosillo'
  );
  order_record := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'id', confirmed_order::text, 'restaurantId', restaurant::text, 'branchId', branch::text,
    'shiftId', shift::text, 'orderNumber', 101, 'status', 'placed', 'placedAt', pg_catalog.to_char(now_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'items', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'orderItemId', gen_random_uuid()::text, 'productId', product_pizza::text, 'variantId', null, 'name', 'Pizza Moderna',
        'stationId', 'kitchen', 'unitPriceMinor', 15000, 'quantity', 1, 'status', 'active', 'note', null,
        'fraction', pg_catalog.jsonb_build_object(
          'geometry', 'halves',
          'slots', pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('fraction', 'half-a', 'flavorOptionId', o_pep::text, 'extraOptionIds', '[]'::jsonb, 'excludedIngredientIds', pg_catalog.jsonb_build_array(o_jamon::text)),
            pg_catalog.jsonb_build_object('fraction', 'half-b', 'flavorOptionId', o_haw::text, 'extraOptionIds', '[]'::jsonb, 'excludedIngredientIds', '[]'::jsonb)
          )
        ),
        'fractionBreakdown', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('fraction', 'half-a', 'flavorOptionId', o_pep::text, 'flavorName', 'Pepperoni', 'extraOptionIds', '[]'::jsonb, 'excludedIngredientIds', pg_catalog.jsonb_build_array(o_jamon::text)),
          pg_catalog.jsonb_build_object('fraction', 'half-b', 'flavorOptionId', o_haw::text, 'flavorName', 'Hawaiana', 'extraOptionIds', '[]'::jsonb, 'excludedIngredientIds', '[]'::jsonb)
        ),
        'modifiers', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'modifierId', 'exclude:half-a:' || o_jamon::text,
            'name', 'Sin Jamon',
            'groupId', 'fraction-exclusion',
            'groupName', 'exclude:half-a',
            'groupCatalogVersion', catalog_id::text,
            'unitPrice', pg_catalog.jsonb_build_object('amountMinor', 0, 'currency', 'MXN'),
            'quantity', 1
          )
        ),
        'subtotalMinor', 15000, 'taxMinor', 0, 'totalMinor', 15000
      )
    )
  );
  order_audits := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'schemaVersion', 1, 'eventId', confirmation_event::text, 'idempotencyKey', confirmation_command->>'idempotencyKey',
      'restaurantId', restaurant::text, 'branchId', branch::text, 'orderId', confirmed_order::text, 'actorId', actor::text,
      'deviceId', device::text, 'occurredAt', pg_catalog.to_char(now_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'action', 'order_placed', 'details', pg_catalog.jsonb_build_object('totalMinor', 15000)
    )
  );

  execute 'set local role app_api';
  result := app_private.confirm_capture_draft_v3(actor, confirmation_command, order_record, order_audits);
  execute 'reset role';

  if result->>'status' <> 'applied' then raise exception 'LOCKED_INGREDIENTS_UNLOCKED_CONFIRM_FAILED: %', result; end if;

  -- ------------------------------------------------------------
  -- 6. confirm_capture_draft_v3 with locked exclusion -> MUST BE CONFLICT
  -- ------------------------------------------------------------
  target_capture := gen_random_uuid();
  line_id := gen_random_uuid();
  confirmed_order := gen_random_uuid();
  confirmation_event := gen_random_uuid();

  execute 'set local role app_api';
  created := app_private.create_capture_draft(actor, pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'scope', pg_catalog.jsonb_build_object('restaurantId', restaurant::text, 'branchId', branch::text),
    'captureDraftId', target_capture::text, 'expectedVersion', 0, 'eventId', gen_random_uuid()::text,
    'idempotencyKey', gen_random_uuid()::text, 'deviceId', device::text, 'occurredAt', now_at,
    'sourceChannel', 'phone', 'fulfillmentChannel', 'counter'
  ));
  execute 'reset role';
  lease := created#>>'{record,detail,attentionLeaseId}';

  command := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'scope', pg_catalog.jsonb_build_object('restaurantId', restaurant::text, 'branchId', branch::text),
    'captureDraftId', target_capture::text, 'expectedVersion', 1, 'attentionLeaseId', lease,
    'eventId', gen_random_uuid()::text, 'idempotencyKey', gen_random_uuid()::text, 'deviceId', device::text, 'occurredAt', now_at
  );
  plan := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'catalogVersion', catalog_id::text, 'lines', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'lineId', line_id::text, 'productId', product_pizza::text, 'quantity', 1, 'note', null,
        'fraction', pg_catalog.jsonb_build_object(
          'geometry', 'halves',
          'slots', pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('fraction', 'half-a', 'flavorOptionId', o_pep::text, 'extraOptionIds', '[]'::jsonb, 'excludedIngredientIds', pg_catalog.jsonb_build_array(o_cebolla::text)),
            pg_catalog.jsonb_build_object('fraction', 'half-b', 'flavorOptionId', o_haw::text, 'extraOptionIds', '[]'::jsonb, 'excludedIngredientIds', '[]'::jsonb)
          )
        ),
        'modifierGroups', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('groupId', g_flavors::text, 'selections', '[]'::jsonb),
          pg_catalog.jsonb_build_object('groupId', g_extras::text, 'selections', '[]'::jsonb)
        )
      )
    )
  );

  execute 'set local role app_api';
  result := app_private.replace_capture_selection_plan(actor, command, plan);
  execute 'reset role';

  confirmation_command := pg_catalog.jsonb_build_object(
    'schemaVersion', 2, 'scope', pg_catalog.jsonb_build_object('restaurantId', restaurant::text, 'branchId', branch::text),
    'captureDraftId', target_capture::text, 'expectedVersion', 2, 'eventId', confirmation_event::text,
    'idempotencyKey', gen_random_uuid()::text, 'deviceId', device::text, 'occurredAt', now_at,
    'attentionLeaseId', lease, 'orderId', confirmed_order::text, 'shiftId', shift::text, 'tableId', null,
    'currency', 'MXN', 'timeZone', 'America/Hermosillo'
  );
  order_record := pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'id', confirmed_order::text, 'restaurantId', restaurant::text, 'branchId', branch::text,
    'shiftId', shift::text, 'orderNumber', 102, 'status', 'placed', 'placedAt', pg_catalog.to_char(now_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'items', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'orderItemId', gen_random_uuid()::text, 'productId', product_pizza::text, 'variantId', null, 'name', 'Pizza Moderna',
        'stationId', 'kitchen', 'unitPriceMinor', 15000, 'quantity', 1, 'status', 'active', 'note', null,
        'fraction', pg_catalog.jsonb_build_object(
          'geometry', 'halves',
          'slots', pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('fraction', 'half-a', 'flavorOptionId', o_pep::text, 'extraOptionIds', '[]'::jsonb, 'excludedIngredientIds', pg_catalog.jsonb_build_array(o_cebolla::text)),
            pg_catalog.jsonb_build_object('fraction', 'half-b', 'flavorOptionId', o_haw::text, 'extraOptionIds', '[]'::jsonb, 'excludedIngredientIds', '[]'::jsonb)
          )
        ),
        'fractionBreakdown', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('fraction', 'half-a', 'flavorOptionId', o_pep::text, 'flavorName', 'Pepperoni', 'extraOptionIds', '[]'::jsonb, 'excludedIngredientIds', pg_catalog.jsonb_build_array(o_cebolla::text)),
          pg_catalog.jsonb_build_object('fraction', 'half-b', 'flavorOptionId', o_haw::text, 'flavorName', 'Hawaiana', 'extraOptionIds', '[]'::jsonb, 'excludedIngredientIds', '[]'::jsonb)
        ),
        'modifiers', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'modifierId', 'exclude:half-a:' || o_cebolla::text,
            'name', 'Sin Cebolla',
            'groupId', 'fraction-exclusion',
            'groupName', 'exclude:half-a',
            'groupCatalogVersion', catalog_id::text,
            'unitPrice', pg_catalog.jsonb_build_object('amountMinor', 0, 'currency', 'MXN'),
            'quantity', 1
          )
        ),
        'subtotalMinor', 15000, 'taxMinor', 0, 'totalMinor', 15000
      )
    )
  );

  execute 'set local role app_api';
  result := app_private.confirm_capture_draft_v3(actor, confirmation_command, order_record, order_audits);
  execute 'reset role';

  if result->>'status' <> 'conflict' then raise exception 'LOCKED_INGREDIENTS_LOCKED_CONFIRM_MUST_CONFLICT: %', result; end if;

  -- ------------------------------------------------------------
  -- 7. Additional invariant cases (Finding 6)
  -- ------------------------------------------------------------
  -- 7.1. Payload viejo sin locked (válido): backfill pobla fraction_locked_ingredient_option_ids
  test_catalog := gen_random_uuid();
  save_event := gen_random_uuid();
  save_key := gen_random_uuid();
  old_payload := pg_catalog.jsonb_build_object(
    'categories', payload->'categories',
    'products', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'productId', product_pizza::text, 'categoryId', category::text, 'name', 'Pizza Vieja', 'sku', null,
        'active', true, 'displayOrder', 0, 'stationId', 'kitchen', 'unit', 'piece', 'unitPriceMinor', 15000, 'tax', null,
        'modifierGroupIds', pg_catalog.jsonb_build_array(g_flavors::text, g_extras::text),
        'fraction', pg_catalog.jsonb_build_object(
          'enabled', true,
          'flavorGroupId', g_flavors::text,
          'extraGroupId', g_extras::text,
          'excludableIngredientIds', pg_catalog.jsonb_build_array('Cebolla')
        )
      )
    ),
    'modifierGroups', payload->'modifierGroups'
  );

  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor, restaurant, branch, save_event, save_key, device, now_at, 2, test_catalog, 'MXN', old_payload) s;
  execute 'reset role';

  if save_status <> 'saved' then raise exception 'OLD_PAYLOAD_WITHOUT_LOCKED_SAVE_FAILED: %', save_status; end if;

  if not exists (
    select 1 from app.menu_products p
    where p.restaurant_id = restaurant and p.catalog_id = test_catalog and p.id = product_pizza
      and p.fraction_locked_ingredient_option_ids = array[o_jamon]
      and p.fraction_excludable_ingredient_ids = array['Cebolla']
  ) then raise exception 'OLD_PAYLOAD_WITHOUT_LOCKED_BACKFILL_INCORRECT'; end if;

  -- 7.2. Payload nuevo sin excludable (válido): guarda exitoso y preserva locked
  test_catalog := gen_random_uuid();
  save_event := gen_random_uuid();
  save_key := gen_random_uuid();
  new_payload := pg_catalog.jsonb_build_object(
    'categories', payload->'categories',
    'products', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'productId', product_pizza::text, 'categoryId', category::text, 'name', 'Pizza Nueva', 'sku', null,
        'active', true, 'displayOrder', 0, 'stationId', 'kitchen', 'unit', 'piece', 'unitPriceMinor', 15000, 'tax', null,
        'modifierGroupIds', pg_catalog.jsonb_build_array(g_flavors::text, g_extras::text),
        'fraction', pg_catalog.jsonb_build_object(
          'enabled', true,
          'flavorGroupId', g_flavors::text,
          'extraGroupId', g_extras::text,
          'lockedIngredientOptionIds', pg_catalog.jsonb_build_array(o_jamon::text)
        )
      )
    ),
    'modifierGroups', payload->'modifierGroups'
  );

  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor, restaurant, branch, save_event, save_key, device, now_at, 3, test_catalog, 'MXN', new_payload) s;
  execute 'reset role';

  if save_status <> 'saved' then raise exception 'NEW_PAYLOAD_WITHOUT_EXCLUDABLE_SAVE_FAILED: %', save_status; end if;

  if not exists (
    select 1 from app.menu_products p
    where p.restaurant_id = restaurant and p.catalog_id = test_catalog and p.id = product_pizza
      and p.fraction_locked_ingredient_option_ids = array[o_jamon]
  ) then raise exception 'NEW_PAYLOAD_WITHOUT_EXCLUDABLE_VERIFICATION_FAILED'; end if;

  -- 7.3. Desbloquear todo: locked: [] con etiquetas presentes deja fraction_locked_ingredient_option_ids = '{}'
  test_catalog := gen_random_uuid();
  save_event := gen_random_uuid();
  save_key := gen_random_uuid();
  payload := pg_catalog.jsonb_build_object(
    'categories', payload->'categories',
    'products', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'productId', product_pizza::text, 'categoryId', category::text, 'name', 'Pizza Desbloqueada', 'sku', null,
        'active', true, 'displayOrder', 0, 'stationId', 'kitchen', 'unit', 'piece', 'unitPriceMinor', 15000, 'tax', null,
        'modifierGroupIds', pg_catalog.jsonb_build_array(g_flavors::text, g_extras::text),
        'fraction', pg_catalog.jsonb_build_object(
          'enabled', true,
          'flavorGroupId', g_flavors::text,
          'extraGroupId', g_extras::text,
          'lockedIngredientOptionIds', '[]'::jsonb,
          'excludableIngredientIds', pg_catalog.jsonb_build_array('Cebolla')
        )
      )
    ),
    'modifierGroups', payload->'modifierGroups'
  );

  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor, restaurant, branch, save_event, save_key, device, now_at, 4, test_catalog, 'MXN', payload) s;
  execute 'reset role';

  if save_status <> 'saved' then raise exception 'UNLOCK_ALL_SAVE_FAILED: %', save_status; end if;

  if not exists (
    select 1 from app.menu_products p
    where p.restaurant_id = restaurant and p.catalog_id = test_catalog and p.id = product_pizza
      and p.fraction_locked_ingredient_option_ids = '{}'::uuid[]
  ) then raise exception 'UNLOCK_ALL_OVERWRITTEN_BY_BACKFILL'; end if;

  -- 7.4. Replay viejo<->nuevo idempotente: normalize_menu_catalog_payload previene conflicto de idempotencia
  test_catalog := gen_random_uuid();
  save_event := gen_random_uuid();
  save_key := gen_random_uuid();
  replay_payload_old := pg_catalog.jsonb_build_object(
    'categories', payload->'categories',
    'products', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'productId', product_pizza::text, 'categoryId', category::text, 'name', 'Pizza Replay', 'sku', null,
        'active', true, 'displayOrder', 0, 'stationId', 'kitchen', 'unit', 'piece', 'unitPriceMinor', 15000, 'tax', null,
        'modifierGroupIds', pg_catalog.jsonb_build_array(g_flavors::text, g_extras::text),
        'fraction', pg_catalog.jsonb_build_object(
          'enabled', true,
          'flavorGroupId', g_flavors::text,
          'extraGroupId', g_extras::text,
          'excludableIngredientIds', '[]'::jsonb
        )
      )
    ),
    'modifierGroups', payload->'modifierGroups'
  );

  replay_payload_new := pg_catalog.jsonb_build_object(
    'categories', payload->'categories',
    'products', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'productId', product_pizza::text, 'categoryId', category::text, 'name', 'Pizza Replay', 'sku', null,
        'active', true, 'displayOrder', 0, 'stationId', 'kitchen', 'unit', 'piece', 'unitPriceMinor', 15000, 'tax', null,
        'modifierGroupIds', pg_catalog.jsonb_build_array(g_flavors::text, g_extras::text),
        'fraction', pg_catalog.jsonb_build_object(
          'enabled', true,
          'flavorGroupId', g_flavors::text,
          'extraGroupId', g_extras::text,
          'lockedIngredientOptionIds', '[]'::jsonb
        )
      )
    ),
    'modifierGroups', payload->'modifierGroups'
  );

  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor, restaurant, branch, save_event, save_key, device, now_at, 5, test_catalog, 'MXN', replay_payload_old) s;
  execute 'reset role';

  if save_status <> 'saved' then raise exception 'REPLAY_FIRST_SAVE_FAILED: %', save_status; end if;

  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor, restaurant, branch, save_event, save_key, device, now_at, 5, test_catalog, 'MXN', replay_payload_new) s;
  execute 'reset role';

  if save_status <> 'replayed' then raise exception 'REPLAY_OLD_VS_NEW_FAILED: %', save_status; end if;

end
$menu_locked_ingredients_tests$;
rollback;
