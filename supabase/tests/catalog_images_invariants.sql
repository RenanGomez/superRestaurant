-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises the catalog-images candidate (ADR-011): app_private.save_menu_catalog accepts a null
-- or well-formed imagePath per product/option and app_private.get_menu_catalog echoes it back
-- unchanged; a path borrowed from another restaurant or another row's own id is rejected by the
-- app.menu_products/app.menu_modifier_options CHECK (surfaced as a save 'conflict', never a raw
-- constraint violation reaching the caller); a malformed path shape is rejected the same way. The
-- storage.buckets/storage.objects assertions only run when the Storage extension schema exists;
-- on a bare local Postgres cluster (no Storage) they are skipped and reported as remote-only.
begin;
do $catalog_images_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant uuid := gen_random_uuid();
  other_restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  membership uuid := gen_random_uuid();
  category_id uuid := gen_random_uuid();
  product_id uuid := gen_random_uuid();
  other_product_id uuid := gen_random_uuid();
  group_id uuid := gen_random_uuid();
  option_id uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  legacy_event uuid := gen_random_uuid();
  legacy_key uuid := gen_random_uuid();
  legacy_catalog uuid := gen_random_uuid();
  now_text text := pg_catalog.to_char(pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  good_product_path text := restaurant::text || '/products/' || product_id::text || '/' || replace(gen_random_uuid()::text,'-','') || '.jpg';
  good_option_path text := restaurant::text || '/options/' || option_id::text || '/' || replace(gen_random_uuid()::text,'-','') || '.png';
  foreign_restaurant_path text := other_restaurant::text || '/products/' || product_id::text || '/' || replace(gen_random_uuid()::text,'-','') || '.jpg';
  wrong_target_path text := restaurant::text || '/products/' || other_product_id::text || '/' || replace(gen_random_uuid()::text,'-','') || '.jpg';
  malformed_path text := restaurant::text || '/products/' || product_id::text || '/not-a-uuid.gif';
  payload jsonb;
  result_status text;
  result_state jsonb;
  read_back jsonb;
  product_row jsonb;
  option_row jsonb;
begin
  if actor is null then raise exception 'CATALOG_IMAGES_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone) values
    (restaurant,'rollback-only catalog images','America/Hermosillo'),
    (other_restaurant,'rollback-only catalog images foreign','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values (branch,restaurant,'rollback-only catalog images branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values (membership,actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values (membership,'manager',actor);

  payload := pg_catalog.jsonb_build_object(
    'categories', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'categoryId', category_id::text, 'name', 'Tacos', 'active', true, 'displayOrder', 0
    )),
    'products', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'productId', product_id::text, 'categoryId', category_id::text, 'name', 'Taco', 'sku', null,
      'active', true, 'displayOrder', 0, 'stationId', 'kitchen', 'unit', 'piece', 'unitPriceMinor', 4900,
      'tax', null, 'imagePath', good_product_path
    )),
    'modifierGroups', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'groupId', group_id::text, 'productId', product_id::text, 'name', 'Salsa', 'active', true,
      'displayOrder', 0, 'minimumQuantity', 0, 'maximumQuantity', 1,
      'options', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'optionId', option_id::text, 'name', 'Verde', 'unitPriceMinor', 0, 'active', true,
        'maximumQuantity', null, 'imagePath', good_option_path
      ))
    ))
  );

  -- Well-formed imagePath on both a product and an option is saved and read back unchanged.
  select status, state into result_status, result_state from app_private.save_menu_catalog(
    actor, restaurant, branch, gen_random_uuid(), gen_random_uuid(), device, now_text::timestamptz,
    0, gen_random_uuid(), 'MXN', payload
  );
  if result_status <> 'saved' then raise exception 'CATALOG_IMAGES_SAVE_WITH_IMAGE_REJECTED: % %', result_status, result_state; end if;
  product_row := result_state->'catalog'->'products'->0;
  option_row := result_state->'catalog'->'modifierGroups'->0->'options'->0;
  if product_row->>'imagePath' is distinct from good_product_path then
    raise exception 'CATALOG_IMAGES_PRODUCT_IMAGE_PATH_MISMATCH: %', product_row;
  end if;
  if option_row->>'imagePath' is distinct from good_option_path then
    raise exception 'CATALOG_IMAGES_OPTION_IMAGE_PATH_MISMATCH: %', option_row;
  end if;

  read_back := app_private.get_menu_catalog(actor, restaurant, branch);
  if (read_back->'catalog'->'products'->0->>'imagePath') is distinct from good_product_path then
    raise exception 'CATALOG_IMAGES_READ_BACK_PRODUCT_MISMATCH: %', read_back;
  end if;

  -- A null imagePath on both is accepted and read back as null (next published version).
  payload := pg_catalog.jsonb_set(payload, '{products,0,imagePath}', 'null'::jsonb);
  payload := pg_catalog.jsonb_set(payload, '{modifierGroups,0,options,0,imagePath}', 'null'::jsonb);
  select status, state into result_status, result_state from app_private.save_menu_catalog(
    actor, restaurant, branch, gen_random_uuid(), gen_random_uuid(), device, now_text::timestamptz,
    1, gen_random_uuid(), 'MXN', payload
  );
  if result_status <> 'saved' then raise exception 'CATALOG_IMAGES_SAVE_WITH_NULL_IMAGE_REJECTED: % %', result_status, result_state; end if;
  if (result_state->'catalog'->'products'->0->'imagePath') <> 'null'::jsonb then
    raise exception 'CATALOG_IMAGES_NULL_IMAGE_NOT_ECHOED: %', result_state;
  end if;

  -- A path whose restaurant segment names a different tenant is rejected as a conflict, never a
  -- raw constraint violation escaping to the caller.
  payload := pg_catalog.jsonb_set(payload, '{products,0,imagePath}', pg_catalog.to_jsonb(foreign_restaurant_path));
  select status, state into result_status, result_state from app_private.save_menu_catalog(
    actor, restaurant, branch, gen_random_uuid(), gen_random_uuid(), device, now_text::timestamptz,
    2, gen_random_uuid(), 'MXN', payload
  );
  if result_status <> 'conflict' then raise exception 'CATALOG_IMAGES_FOREIGN_RESTAURANT_PATH_ACCEPTED: % %', result_status, result_state; end if;

  -- A path whose target-id segment names a different product than the row it is attached to is
  -- also rejected.
  payload := pg_catalog.jsonb_set(payload, '{products,0,imagePath}', pg_catalog.to_jsonb(wrong_target_path));
  select status, state into result_status, result_state from app_private.save_menu_catalog(
    actor, restaurant, branch, gen_random_uuid(), gen_random_uuid(), device, now_text::timestamptz,
    2, gen_random_uuid(), 'MXN', payload
  );
  if result_status <> 'conflict' then raise exception 'CATALOG_IMAGES_WRONG_TARGET_PATH_ACCEPTED: % %', result_status, result_state; end if;

  -- A malformed path shape (no uuid32 filename) is rejected.
  payload := pg_catalog.jsonb_set(payload, '{products,0,imagePath}', pg_catalog.to_jsonb(malformed_path));
  select status, state into result_status, result_state from app_private.save_menu_catalog(
    actor, restaurant, branch, gen_random_uuid(), gen_random_uuid(), device, now_text::timestamptz,
    2, gen_random_uuid(), 'MXN', payload
  );
  if result_status <> 'conflict' then raise exception 'CATALOG_IMAGES_MALFORMED_PATH_ACCEPTED: % %', result_status, result_state; end if;

  -- Pre-migration shape: a save without the imagePath key is accepted (stored as null), and a retry
  -- of that exact command, now carrying an explicit null (new API), replays instead of conflicting.
  payload := pg_catalog.jsonb_set(payload, '{products,0}', (payload->'products'->0) - 'imagePath');
  payload := pg_catalog.jsonb_set(payload, '{modifierGroups,0,options,0}', (payload->'modifierGroups'->0->'options'->0) - 'imagePath');
  select status, state into result_status, result_state from app_private.save_menu_catalog(
    actor, restaurant, branch, legacy_event, legacy_key, device, now_text::timestamptz,
    2, legacy_catalog, 'MXN', payload
  );
  if result_status <> 'saved' then raise exception 'CATALOG_IMAGES_LEGACY_SHAPE_REJECTED: % %', result_status, result_state; end if;
  if (result_state->'catalog'->'products'->0->'imagePath') <> 'null'::jsonb
    or (result_state->'catalog'->'modifierGroups'->0->'options'->0->'imagePath') <> 'null'::jsonb then
    raise exception 'CATALOG_IMAGES_LEGACY_SHAPE_NOT_NULL: %', result_state;
  end if;
  payload := pg_catalog.jsonb_set(payload, '{products,0,imagePath}', 'null'::jsonb);
  payload := pg_catalog.jsonb_set(payload, '{modifierGroups,0,options,0,imagePath}', 'null'::jsonb);
  select status, state into result_status, result_state from app_private.save_menu_catalog(
    actor, restaurant, branch, legacy_event, legacy_key, device, now_text::timestamptz,
    2, legacy_catalog, 'MXN', payload
  );
  if result_status <> 'replayed' then raise exception 'CATALOG_IMAGES_LEGACY_RETRY_NOT_REPLAYED: % %', result_status, result_state; end if;

  raise notice 'CATALOG_IMAGES_DOMAIN_INVARIANTS_OK';
end $catalog_images_tests$;

do $catalog_images_storage_tests$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'CATALOG_IMAGES_STORAGE_INVARIANTS_SKIPPED_NO_STORAGE_SCHEMA_REMOTE_ONLY';
    return;
  end if;

  if not exists (
    select 1 from storage.buckets
    where id = 'catalog-images' and public and file_size_limit = 2097152
      and allowed_mime_types = array['image/jpeg','image/png','image/webp']
  ) then raise exception 'CATALOG_IMAGES_BUCKET_MISSING_OR_MISCONFIGURED'; end if;

  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and roles && array['public','anon','authenticated']::name[]
      and cmd in ('INSERT','UPDATE','DELETE','ALL')
      -- same bucket-scoped criterion as the migration: restricted to another bucket is fine
      and (
        strpos(coalesce(qual,'') || coalesce(with_check,''), 'bucket_id') = 0
        or strpos(coalesce(qual,'') || coalesce(with_check,''), 'catalog-images') > 0
      )
  ) then raise exception 'CATALOG_IMAGES_CLIENT_WRITE_POLICY_PRESENT'; end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'catalog_images_public_read' and cmd = 'SELECT'
  ) then raise exception 'CATALOG_IMAGES_PUBLIC_READ_POLICY_MISSING'; end if;

  raise notice 'CATALOG_IMAGES_STORAGE_INVARIANTS_OK';
end $catalog_images_storage_tests$;
commit;
