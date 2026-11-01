-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises 20261101000100_menu_category_appearance.sql:
--   1. a save WITHOUT category colour/imagePath (older producer) is accepted, stores nulls, reads back
--      colour/imagePath as null and replays as before;
--   2. a save WITH a palette colour and a category image round-trips through build_menu_catalog_state
--      and replays idempotently (also when the replay sends explicit nulls on an old snapshot);
--   3. a colour outside the palette (or a hex value) and an image path that belongs to another
--      restaurant, another category or the products segment are rejected as conflicts without
--      advancing the version;
--   4. table CHECKs reject the same values when written directly;
--   5. the palette in the CHECK is exactly the TypeScript palette (parity is asserted by the API test).
begin;
do $menu_category_appearance_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant_a uuid := gen_random_uuid();
  restaurant_b uuid := gen_random_uuid();
  branch_a uuid := gen_random_uuid();
  branch_b uuid := gen_random_uuid();
  membership_a uuid := gen_random_uuid();
  membership_b uuid := gen_random_uuid();
  category uuid := gen_random_uuid();
  other_category uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  now_at timestamptz := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
  catalog_one uuid := gen_random_uuid();
  catalog_two uuid := gen_random_uuid();
  save_event uuid;
  save_key uuid;
  save_status text;
  save_state jsonb;
  payload jsonb;
  styled jsonb;
  good_path text;
  scenario jsonb;
begin
  if actor is null then raise exception 'MENU_CATEGORY_APPEARANCE_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone) values(restaurant_a,'rollback-only category appearance A','America/Hermosillo');
  insert into app.restaurants(id,name,time_zone) values(restaurant_b,'rollback-only category appearance B','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(branch_a,restaurant_a,'rollback-only category appearance branch A');
  insert into app.branches(id,restaurant_id,name) values(branch_b,restaurant_b,'rollback-only category appearance branch B');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values(membership_a,actor,restaurant_a,branch_a,actor);
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values(membership_b,actor,restaurant_b,branch_b,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values(membership_a,'manager',actor),(membership_b,'manager',actor);

  good_path := restaurant_a::text||'/categories/'||category::text||'/0123456789abcdef0123456789abcdef.webp';

  -- 1. Older producer: categories without colour/imagePath.
  payload := pg_catalog.jsonb_build_object(
    'categories',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'categoryId',category::text,'name','Pizzas','active',true,'displayOrder',0)),
    'products','[]'::jsonb,'modifierGroups','[]'::jsonb);
  save_event := gen_random_uuid(); save_key := gen_random_uuid();
  execute 'set local role app_api';
  select s.status,s.state into save_status,save_state from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,0,catalog_one,'MXN',payload) s;
  execute 'reset role';
  if save_status<>'saved' then raise exception 'MENU_CATEGORY_APPEARANCE_OLD_SAVE_REJECTED_%',save_status; end if;
  if save_state#>'{catalog,categories,0,color}' is distinct from 'null'::jsonb
    or save_state#>'{catalog,categories,0,imagePath}' is distinct from 'null'::jsonb
  then raise exception 'MENU_CATEGORY_APPEARANCE_OLD_STATE_NOT_NULL'; end if;
  if exists (select 1 from app.menu_categories c where c.restaurant_id=restaurant_a and c.id=category
    and (c.color is not null or c.image_path is not null))
  then raise exception 'MENU_CATEGORY_APPEARANCE_OLD_ROW_NOT_NULL'; end if;
  -- Replay with the same payload, and with explicit nulls (normalized as absent).
  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,0,catalog_one,'MXN',payload) s;
  if save_status<>'replayed' then raise exception 'MENU_CATEGORY_APPEARANCE_OLD_REPLAY_%',save_status; end if;
  select s.status into save_status from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,0,catalog_one,'MXN',
    pg_catalog.jsonb_set(payload,'{categories,0}',(payload#>'{categories,0}')
      ||pg_catalog.jsonb_build_object('color',null,'imagePath',null))) s;
  execute 'reset role';
  if save_status<>'replayed' then raise exception 'MENU_CATEGORY_APPEARANCE_NULL_REPLAY_%',save_status; end if;

  -- 2. Colour and image round trip, then idempotent replay.
  styled := pg_catalog.jsonb_set(payload,'{categories,0}',(payload#>'{categories,0}')
    ||pg_catalog.jsonb_build_object('color','mint','imagePath',good_path));
  save_event := gen_random_uuid(); save_key := gen_random_uuid();
  execute 'set local role app_api';
  select s.status,s.state into save_status,save_state from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,1,catalog_two,'MXN',styled) s;
  execute 'reset role';
  if save_status<>'saved' then raise exception 'MENU_CATEGORY_APPEARANCE_SAVE_REJECTED_%',save_status; end if;
  if save_state#>>'{catalog,categories,0,color}' is distinct from 'mint'
    or save_state#>>'{catalog,categories,0,imagePath}' is distinct from good_path
  then raise exception 'MENU_CATEGORY_APPEARANCE_STATE_ROUNDTRIP'; end if;
  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,1,catalog_two,'MXN',styled) s;
  if save_status<>'replayed' then raise exception 'MENU_CATEGORY_APPEARANCE_REPLAY_%',save_status; end if;
  -- Same key with a different colour or image is a conflict, never a silent replay.
  select s.status into save_status from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,1,catalog_two,'MXN',
    pg_catalog.jsonb_set(styled,'{categories,0,color}','"sky"')) s;
  execute 'reset role';
  if save_status<>'conflict' then raise exception 'MENU_CATEGORY_APPEARANCE_DIVERGENT_REPLAY_%',save_status; end if;

  -- 3. Rejections: all conflicts, none advances the version.
  for scenario in select value from pg_catalog.jsonb_array_elements(pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('label','color_outside_palette','value',pg_catalog.jsonb_build_object('color','red')),
    pg_catalog.jsonb_build_object('label','color_hex','value',pg_catalog.jsonb_build_object('color','#aabbcc')),
    pg_catalog.jsonb_build_object('label','color_not_string','value',pg_catalog.jsonb_build_object('color',3)),
    pg_catalog.jsonb_build_object('label','other_restaurant_path','value',pg_catalog.jsonb_build_object(
      'imagePath',restaurant_b::text||'/categories/'||category::text||'/0123456789abcdef0123456789abcdef.webp')),
    pg_catalog.jsonb_build_object('label','other_category_path','value',pg_catalog.jsonb_build_object(
      'imagePath',restaurant_a::text||'/categories/'||other_category::text||'/0123456789abcdef0123456789abcdef.webp')),
    pg_catalog.jsonb_build_object('label','products_segment','value',pg_catalog.jsonb_build_object(
      'imagePath',restaurant_a::text||'/products/'||category::text||'/0123456789abcdef0123456789abcdef.webp')),
    pg_catalog.jsonb_build_object('label','bad_extension','value',pg_catalog.jsonb_build_object(
      'imagePath',restaurant_a::text||'/categories/'||category::text||'/0123456789abcdef0123456789abcdef.gif')),
    pg_catalog.jsonb_build_object('label','unknown_key','value',pg_catalog.jsonb_build_object('extra',true))
  )) loop
    execute 'set local role app_api';
    select s.status into save_status from app_private.save_menu_catalog(
      actor,restaurant_a,branch_a,gen_random_uuid(),gen_random_uuid(),device,now_at,2,gen_random_uuid(),'MXN',
      pg_catalog.jsonb_set(payload,'{categories,0}',(payload#>'{categories,0}')||(scenario->'value'))) s;
    execute 'reset role';
    if save_status<>'conflict' then raise exception 'MENU_CATEGORY_APPEARANCE_SAVE_%',upper(scenario->>'label'); end if;
  end loop;
  if (select head.version from app.menu_catalog_heads head where head.restaurant_id=restaurant_a)<>2
  then raise exception 'MENU_CATEGORY_APPEARANCE_REJECTED_SAVE_ADVANCED_VERSION'; end if;

  -- 4. Table CHECKs reject the same values written directly.
  begin
    update app.menu_categories set color='#aabbcc' where restaurant_id=restaurant_a and id=category;
    raise exception 'MENU_CATEGORY_APPEARANCE_HEX_ACCEPTED';
  exception when check_violation then null;
  end;
  begin
    update app.menu_categories set color='' where restaurant_id=restaurant_a and id=category;
    raise exception 'MENU_CATEGORY_APPEARANCE_EMPTY_COLOR_ACCEPTED';
  exception when check_violation then null;
  end;
  begin
    update app.menu_categories set image_path=restaurant_b::text||'/categories/'||category::text||'/0123456789abcdef0123456789abcdef.png'
    where restaurant_id=restaurant_a and id=category;
    raise exception 'MENU_CATEGORY_APPEARANCE_FOREIGN_PATH_ACCEPTED';
  exception when check_violation then null;
  end;
  begin
    update app.menu_categories set image_path=restaurant_a::text||'/categories/'||other_category::text||'/0123456789abcdef0123456789abcdef.png'
    where restaurant_id=restaurant_a and id=category;
    raise exception 'MENU_CATEGORY_APPEARANCE_OTHER_CATEGORY_PATH_ACCEPTED';
  exception when check_violation then null;
  end;
  -- 5. The CHECK lists exactly the eight palette tokens.
  if (select pg_catalog.count(*) from unnest(array['rose','peach','sand','mint','sky','lilac','butter','sage']) as token
      where pg_catalog.pg_get_constraintdef((select oid from pg_catalog.pg_constraint
        where conname='menu_categories_color_valid' and conrelid='app.menu_categories'::regclass)) like '%'''||token||'''%')<>8
  then raise exception 'MENU_CATEGORY_APPEARANCE_PALETTE_CHECK_MISMATCH'; end if;
  update app.menu_categories set color='lilac', image_path=good_path where restaurant_id=restaurant_a and id=category;
end
$menu_category_appearance_tests$;
commit;
