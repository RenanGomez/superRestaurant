-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises 20261106000100_menu_size_presets.sql:
--   1. Guardar con presets y variante con sizePresetId:
--      save_menu_catalog accepts sizePresets and variants referencing them;
--      build_menu_catalog_state emits sizePresets and variant.sizePresetId;
--      replay is idempotent.
--   2. Variante con preset de otro catálogo / inexistente / inactivo es rechazada con conflict.
--   3. Preset duplicado por casing (ej. 'Mediana' vs 'mediana') o id es rechazado con conflict.
--   4. Renombrar preset en nuevo catálogo sincroniza variant.name y NO toca snapshots históricos de órdenes.
--   5. Payload legado sin claves nuevas (sin sizePresets, variante sin sizePresetId) sigue funcionando.
begin;
do $menu_size_presets_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant_a uuid := gen_random_uuid();
  branch_a uuid := gen_random_uuid();
  membership_a uuid := gen_random_uuid();
  restaurant_b uuid := gen_random_uuid();
  branch_b uuid := gen_random_uuid();
  membership_b uuid := gen_random_uuid();
  category uuid := gen_random_uuid();
  pizza uuid := gen_random_uuid();
  v_mediana uuid := gen_random_uuid();
  v_grande uuid := gen_random_uuid();
  preset_mediana uuid := gen_random_uuid();
  preset_grande uuid := gen_random_uuid();
  preset_foreign uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  now_at timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  save_catalog_1 uuid := gen_random_uuid();
  save_catalog_2 uuid := gen_random_uuid();
  save_catalog_legacy uuid := gen_random_uuid();
  save_event uuid := gen_random_uuid();
  save_key uuid := gen_random_uuid();
  save_status text;
  save_state jsonb;
  payload jsonb;
  legacy_payload jsonb;
  order_id uuid := gen_random_uuid();
  historical_variant_name text;
  synced_variant_name text;
begin
  if actor is null then raise exception 'SIZE_PRESETS_TEST_ACTOR_REQUIRED'; end if;

  -- Tenancy setup
  insert into app.restaurants(id, name, time_zone) values(restaurant_a, 'rollback size presets a', 'America/Hermosillo');
  insert into app.branches(id, restaurant_id, name) values(branch_a, restaurant_a, 'rollback size presets branch a');
  insert into app.memberships(id, user_id, restaurant_id, branch_id, granted_by)
    values(membership_a, actor, restaurant_a, branch_a, actor);
  insert into app.membership_role_grants(membership_id, role_code, granted_by) values(membership_a, 'manager', actor);

  insert into app.restaurants(id, name, time_zone) values(restaurant_b, 'rollback size presets b', 'America/Hermosillo');
  insert into app.branches(id, restaurant_id, name) values(branch_b, restaurant_b, 'rollback size presets branch b');
  insert into app.memberships(id, user_id, restaurant_id, branch_id, granted_by)
    values(membership_b, actor, restaurant_b, branch_b, actor);
  insert into app.membership_role_grants(membership_id, role_code, granted_by) values(membership_b, 'manager', actor);

  -- ----------------------------------------------------------------
  -- 1. Guardar con presets y variante con sizePresetId
  -- ----------------------------------------------------------------
  payload := pg_catalog.jsonb_build_object(
    'sizePresets', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id', preset_mediana::text, 'name', 'Mediana', 'displayOrder', 0, 'active', true),
      pg_catalog.jsonb_build_object('id', preset_grande::text, 'name', 'Grande', 'displayOrder', 1, 'active', true)
    ),
    'categories', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('categoryId', category::text, 'name', 'Pizzas', 'active', true, 'displayOrder', 0)
    ),
    'products', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'productId', pizza::text, 'categoryId', category::text, 'name', 'Pizza Margarita', 'sku', null,
        'active', true, 'displayOrder', 0, 'stationId', 'kitchen', 'unit', 'piece', 'unitPriceMinor', 10000,
        'tax', null,
        'variants', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'variantId', v_mediana::text, 'name', 'Mediana', 'unitPriceMinor', 12000,
            'active', true, 'displayOrder', 0, 'sku', 'PZ-M', 'sizePresetId', preset_mediana::text
          ),
          pg_catalog.jsonb_build_object(
            'variantId', v_grande::text, 'name', 'Grande', 'unitPriceMinor', 18000,
            'active', true, 'displayOrder', 1, 'sku', 'PZ-G', 'sizePresetId', preset_grande::text
          )
        )
      )
    ),
    'modifierGroups', pg_catalog.jsonb_build_array()
  );

  execute 'set local role app_api';
  select s.status, s.state into save_status, save_state from app_private.save_menu_catalog(
    actor, restaurant_a, branch_a, save_event, save_key, device, now_at, 0, save_catalog_1, 'MXN', payload
  ) s;
  execute 'reset role';

  if save_status <> 'saved' then raise exception 'SIZE_PRESETS_SAVE_1_REJECTED: %', save_status; end if;

  -- Assert sizePresets in state
  if pg_catalog.jsonb_array_length(save_state#>'{catalog,sizePresets}') <> 2
    or save_state#>>'{catalog,sizePresets,0,id}' is distinct from preset_mediana::text
    or save_state#>>'{catalog,sizePresets,0,name}' is distinct from 'Mediana'
    or save_state#>>'{catalog,sizePresets,1,id}' is distinct from preset_grande::text
    or save_state#>>'{catalog,sizePresets,1,name}' is distinct from 'Grande'
  then raise exception 'SIZE_PRESETS_STATE_PRESETS_MISMATCH'; end if;

  -- Assert variant.sizePresetId in state
  if save_state#>>'{catalog,products,0,variants,0,sizePresetId}' is distinct from preset_mediana::text
    or save_state#>>'{catalog,products,0,variants,1,sizePresetId}' is distinct from preset_grande::text
  then raise exception 'SIZE_PRESETS_STATE_VARIANTS_MISMATCH'; end if;

  -- Replay is idempotent
  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor, restaurant_a, branch_a, save_event, save_key, device, now_at, 0, save_catalog_1, 'MXN', payload
  ) s;
  execute 'reset role';

  if save_status <> 'replayed' then raise exception 'SIZE_PRESETS_REPLAY_REJECTED: %', save_status; end if;

  -- ----------------------------------------------------------------
  -- 2. Variante con preset de otro catálogo / inexistente / inactivo (rechazo)
  -- ----------------------------------------------------------------
  -- Inexistente / foreign UUID
  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor, restaurant_a, branch_a, gen_random_uuid(), gen_random_uuid(), device, now_at, 1, gen_random_uuid(), 'MXN',
    pg_catalog.jsonb_set(payload, '{products,0,variants,0,sizePresetId}', pg_catalog.to_jsonb(gen_random_uuid()::text))
  ) s;
  execute 'reset role';
  if save_status <> 'conflict' then raise exception 'SIZE_PRESETS_NONEXISTENT_ACCEPTED'; end if;

  -- Inactivo
  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor, restaurant_a, branch_a, gen_random_uuid(), gen_random_uuid(), device, now_at, 1, gen_random_uuid(), 'MXN',
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(payload, '{sizePresets,0,active}', 'false'::jsonb),
      '{products,0,variants,0,sizePresetId}',
      pg_catalog.to_jsonb(preset_mediana::text)
    )
  ) s;
  execute 'reset role';
  if save_status <> 'conflict' then raise exception 'SIZE_PRESETS_INACTIVE_ACCEPTED'; end if;

  -- ----------------------------------------------------------------
  -- 3. Preset duplicado por casing (rechazo)
  -- ----------------------------------------------------------------
  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor, restaurant_a, branch_a, gen_random_uuid(), gen_random_uuid(), device, now_at, 1, gen_random_uuid(), 'MXN',
    pg_catalog.jsonb_set(payload, '{sizePresets}', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id', gen_random_uuid()::text, 'name', 'Familiar', 'displayOrder', 0, 'active', true),
      pg_catalog.jsonb_build_object('id', gen_random_uuid()::text, 'name', 'familiar', 'displayOrder', 1, 'active', true)
    ))
  ) s;
  execute 'reset role';
  if save_status <> 'conflict' then raise exception 'SIZE_PRESETS_DUPLICATE_CASING_ACCEPTED'; end if;

  -- Duplicado por ID (rechazo)
  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor, restaurant_a, branch_a, gen_random_uuid(), gen_random_uuid(), device, now_at, 1, gen_random_uuid(), 'MXN',
    pg_catalog.jsonb_set(payload, '{sizePresets}', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id', preset_mediana::text, 'name', 'Chica', 'displayOrder', 0, 'active', true),
      pg_catalog.jsonb_build_object('id', preset_mediana::text, 'name', 'Grande', 'displayOrder', 1, 'active', true)
    ))
  ) s;
  execute 'reset role';
  if save_status <> 'conflict' then raise exception 'SIZE_PRESETS_DUPLICATE_ID_ACCEPTED'; end if;

  -- ----------------------------------------------------------------
  -- 4. Renombrar preset sincroniza variante y NO toca snapshots de órdenes
  -- ----------------------------------------------------------------
  -- Insertamos orden histórica capturada bajo el catálogo versión 1
  insert into app.orders (id, restaurant_id, branch_id, table_id, channel, status, aggregate, version, created_by, updated_by)
  values (
    order_id, restaurant_a, branch_a, null, 'counter', 'draft',
    pg_catalog.jsonb_build_object(
      'schemaVersion', '1',
      'orderId', order_id::text,
      'restaurantId', restaurant_a::text,
      'branchId', branch_a::text,
      'channel', 'counter',
      'currency', 'MXN',
      'timeZone', 'America/Hermosillo',
      'status', 'draft',
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'orderItemId', gen_random_uuid()::text,
          'snapshot', pg_catalog.jsonb_build_object(
            'catalogVersion', save_catalog_1::text,
            'productId', pizza::text,
            'name', 'Pizza Margarita',
            'variantId', v_mediana::text,
            'variantName', 'Mediana',
            'unitPrice', pg_catalog.jsonb_build_object('amountMinor', 12000, 'currency', 'MXN')
          )
        )
      )
    ),
    1, actor, actor
  );

  -- Guardamos catálogo versión 2 renombrando preset Mediana a 'Mediana Especial'
  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor, restaurant_a, branch_a, gen_random_uuid(), gen_random_uuid(), device, now_at, 1, save_catalog_2, 'MXN',
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(payload, '{sizePresets,0,name}', '"Mediana Especial"'::jsonb),
      '{products,0,variants,0,name}', '"Mediana"'::jsonb -- el variant traía el nombre viejo en payload
    )
  ) s;
  execute 'reset role';
  if save_status <> 'saved' then raise exception 'SIZE_PRESETS_RENAME_SAVE_REJECTED: %', save_status; end if;

  -- Verificar que la variante en DB sincronizó su nombre con el preset
  select variant.name into synced_variant_name
  from app.menu_product_variants variant
  where variant.restaurant_id = restaurant_a and variant.catalog_id = save_catalog_2 and variant.id = v_mediana;
  if synced_variant_name <> 'Mediana Especial' then
    raise exception 'SIZE_PRESETS_VARIANT_NAME_NOT_SYNCED: %', synced_variant_name;
  end if;

  -- Verificar que el snapshot histórico de la orden NO fue alterado
  select aggregate#>>'{items,0,snapshot,variantName}' into historical_variant_name
  from app.orders where id = order_id;
  if historical_variant_name <> 'Mediana' then
    raise exception 'SIZE_PRESETS_HISTORICAL_SNAPSHOT_MUTATED: %', historical_variant_name;
  end if;

  -- ----------------------------------------------------------------
  -- 5. Payload legado sin claves nuevas sigue funcionando
  -- ----------------------------------------------------------------
  legacy_payload := payload - 'sizePresets';
  legacy_payload := pg_catalog.jsonb_set(
    legacy_payload,
    '{products,0,variants}',
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'variantId', gen_random_uuid()::text, 'name', 'Chica Legado', 'unitPriceMinor', 10000,
        'active', true, 'displayOrder', 0, 'sku', null
      )
    )
  );

  execute 'set local role app_api';
  select s.status, s.state into save_status, save_state from app_private.save_menu_catalog(
    actor, restaurant_a, branch_a, gen_random_uuid(), gen_random_uuid(), device, now_at, 2, save_catalog_legacy, 'MXN', legacy_payload
  ) s;
  execute 'reset role';

  if save_status <> 'saved' then raise exception 'SIZE_PRESETS_LEGACY_SAVE_REJECTED: %', save_status; end if;
  if save_state#>'{catalog,sizePresets}' is distinct from '[]'::jsonb then
    raise exception 'SIZE_PRESETS_LEGACY_PRESETS_NOT_EMPTY';
  end if;
  if save_state#>>'{catalog,products,0,variants,0,sizePresetId}' is not null then
    raise exception 'SIZE_PRESETS_LEGACY_VARIANT_PRESET_NOT_NULL';
  end if;

end;
$menu_size_presets_tests$;
rollback;
