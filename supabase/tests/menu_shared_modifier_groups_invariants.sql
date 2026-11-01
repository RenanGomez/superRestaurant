-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises 20261101000200_menu_shared_modifier_groups.sql:
--   1. a group shared by two products (null legacy owner) saves and reads back; its assignments exist;
--   2. replay of that save is idempotent;
--   3. the legacy payload shape (groups with productId, products without modifierGroupIds) still saves
--      and its replay with the normalized (explicit) shape matches;
--   4. rejections, none advancing the version: legacy owner shared with another product, a product
--      listing an unknown group, a repeated id, a group of ANOTHER restaurant, a legacy owner that does
--      not list its own group;
--   5. the legacy-owner trigger assigns a group inserted with a product_id, and product_id may be null;
--   6. the half-and-half pricing rules are exercised by catalog_halves_product_level_invariants.sql,
--      which inserts groups with the legacy owner and therefore runs through the assignment table.
begin;
do $menu_shared_modifier_groups_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant_a uuid := gen_random_uuid();
  branch_a uuid := gen_random_uuid();
  membership_a uuid := gen_random_uuid();
  restaurant_b uuid := gen_random_uuid();
  branch_b uuid := gen_random_uuid();
  membership_b uuid := gen_random_uuid();
  category uuid := gen_random_uuid();
  category_b uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid();
  p2 uuid := gen_random_uuid();
  p_b uuid := gen_random_uuid();
  g_shared uuid := gen_random_uuid();
  g_own uuid := gen_random_uuid();
  g_b uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  now_at timestamptz := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
  save_status text;
  save_state jsonb;
  save_event uuid;
  save_key uuid;
  payload jsonb;
  payload_b jsonb;
  legacy jsonb;
  scenario jsonb;
  version_now bigint;
  assignment_count bigint;
begin
  if actor is null then raise exception 'SHARED_GROUPS_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone) values(restaurant_a,'rollback-only shared groups a','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(branch_a,restaurant_a,'rollback-only shared groups branch a');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values(membership_a,actor,restaurant_a,branch_a,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values(membership_a,'manager',actor);
  insert into app.restaurants(id,name,time_zone) values(restaurant_b,'rollback-only shared groups b','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(branch_b,restaurant_b,'rollback-only shared groups branch b');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values(membership_b,actor,restaurant_b,branch_b,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values(membership_b,'manager',actor);

  payload := pg_catalog.jsonb_build_object(
    'categories',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'categoryId',category::text,'name','Comida','active',true,'displayOrder',0)),
    'products',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('productId',p1::text,'categoryId',category::text,'name','Hamburguesa','sku',null,
        'active',true,'displayOrder',0,'stationId','kitchen','unit','piece','unitPriceMinor',12000,'tax',null,
        'modifierGroupIds',pg_catalog.jsonb_build_array(g_shared::text,g_own::text)),
      pg_catalog.jsonb_build_object('productId',p2::text,'categoryId',category::text,'name','Wrap','sku',null,
        'active',true,'displayOrder',1,'stationId','kitchen','unit','piece','unitPriceMinor',9000,'tax',null,
        'modifierGroupIds',pg_catalog.jsonb_build_array(g_shared::text))
    ),
    'modifierGroups',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('groupId',g_shared::text,'productId',null,'name','Extras','active',true,
        'displayOrder',0,'minimumQuantity',0,'maximumQuantity',2,'options',pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('optionId',gen_random_uuid()::text,'name','Queso','unitPriceMinor',1500,'active',true,'maximumQuantity',null))),
      pg_catalog.jsonb_build_object('groupId',g_own::text,'productId',p1::text,'name','Termino','active',true,
        'displayOrder',1,'minimumQuantity',0,'maximumQuantity',1,'options',pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('optionId',gen_random_uuid()::text,'name','Medio','unitPriceMinor',0,'active',true,'maximumQuantity',null)))
    )
  );

  -- 1. shared group saves and reads back
  save_event := gen_random_uuid(); save_key := gen_random_uuid();
  execute 'set local role app_api';
  select s.status,s.state into save_status,save_state from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,0,gen_random_uuid(),'MXN',payload) s;
  execute 'reset role';
  if save_status<>'saved' then raise exception 'SHARED_GROUPS_SAVE_REJECTED'; end if;
  if save_state#>'{catalog,products,0,modifierGroupIds}' is distinct from pg_catalog.jsonb_build_array(g_shared::text,g_own::text)
    or save_state#>'{catalog,products,1,modifierGroupIds}' is distinct from pg_catalog.jsonb_build_array(g_shared::text)
    or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(save_state#>'{catalog,modifierGroups}') grp
        where grp.value->'productId' = 'null'::jsonb) <> 1
  then raise exception 'SHARED_GROUPS_STATE_ROUNDTRIP'; end if;
  select pg_catalog.count(*) into assignment_count from app.menu_product_modifier_groups assignment
  where assignment.restaurant_id=restaurant_a;
  if assignment_count<>3 then raise exception 'SHARED_GROUPS_ASSIGNMENT_COUNT_%',assignment_count; end if;

  -- 2. replay is idempotent
  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,0,
    (select head.catalog_id from app.menu_catalog_heads head where head.restaurant_id=restaurant_a),'MXN',payload) s;
  execute 'reset role';
  if save_status<>'replayed' then raise exception 'SHARED_GROUPS_REPLAY_%',save_status; end if;

  -- 3. legacy shape saves; replay with the normalized shape matches
  legacy := pg_catalog.jsonb_build_object(
    'categories',payload->'categories',
    'products',pg_catalog.jsonb_build_array(payload#>'{products,0}' - 'modifierGroupIds',payload#>'{products,1}' - 'modifierGroupIds'),
    'modifierGroups',pg_catalog.jsonb_build_array(
      (payload#>'{modifierGroups,0}') || pg_catalog.jsonb_build_object('productId',p2::text),
      payload#>'{modifierGroups,1}')
  );
  save_event := gen_random_uuid(); save_key := gen_random_uuid();
  execute 'set local role app_api';
  select s.status,s.state into save_status,save_state from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,1,gen_random_uuid(),'MXN',legacy) s;
  execute 'reset role';
  if save_status<>'saved' then raise exception 'SHARED_GROUPS_LEGACY_SAVE_REJECTED'; end if;
  if save_state#>'{catalog,products,1,modifierGroupIds}' is distinct from pg_catalog.jsonb_build_array(g_shared::text)
    or save_state#>'{catalog,products,0,modifierGroupIds}' is distinct from pg_catalog.jsonb_build_array(g_own::text)
  then raise exception 'SHARED_GROUPS_LEGACY_DERIVATION'; end if;
  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,1,
    (select head.catalog_id from app.menu_catalog_heads head where head.restaurant_id=restaurant_a),'MXN',
    pg_catalog.jsonb_build_object(
      'categories',legacy->'categories',
      'products',pg_catalog.jsonb_build_array(
        (legacy#>'{products,0}') || pg_catalog.jsonb_build_object('modifierGroupIds',pg_catalog.jsonb_build_array(g_own::text)),
        (legacy#>'{products,1}') || pg_catalog.jsonb_build_object('modifierGroupIds',pg_catalog.jsonb_build_array(g_shared::text))),
      'modifierGroups',legacy->'modifierGroups')) s;
  execute 'reset role';
  if save_status<>'replayed' then raise exception 'SHARED_GROUPS_LEGACY_REPLAY_%',save_status; end if;

  -- 4. rejections; a group of another restaurant first needs to exist
  payload_b := pg_catalog.jsonb_build_object(
    'categories',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'categoryId',category_b::text,'name','Comida','active',true,'displayOrder',0)),
    'products',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('productId',p_b::text,'categoryId',category_b::text,'name','Otro','sku',null,
        'active',true,'displayOrder',0,'stationId','kitchen','unit','piece','unitPriceMinor',100,'tax',null,
        'modifierGroupIds',pg_catalog.jsonb_build_array(g_b::text))),
    'modifierGroups',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('groupId',g_b::text,'productId',null,'name','Ajeno','active',true,
        'displayOrder',0,'minimumQuantity',0,'maximumQuantity',1,'options',pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('optionId',gen_random_uuid()::text,'name','X','unitPriceMinor',1,'active',true,'maximumQuantity',null)))));
  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor,restaurant_b,branch_b,gen_random_uuid(),gen_random_uuid(),device,now_at,0,gen_random_uuid(),'MXN',payload_b) s;
  execute 'reset role';
  if save_status<>'saved' then raise exception 'SHARED_GROUPS_OTHER_RESTAURANT_SAVE'; end if;

  for scenario in select value from pg_catalog.jsonb_array_elements(pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('label','owner_shared','path','{products,1,modifierGroupIds}',
      'value',pg_catalog.jsonb_build_array(g_shared::text,g_own::text)),
    pg_catalog.jsonb_build_object('label','unknown_group','path','{products,1,modifierGroupIds}',
      'value',pg_catalog.jsonb_build_array(gen_random_uuid()::text)),
    pg_catalog.jsonb_build_object('label','repeated_id','path','{products,1,modifierGroupIds}',
      'value',pg_catalog.jsonb_build_array(g_shared::text,g_shared::text)),
    pg_catalog.jsonb_build_object('label','other_restaurant_group','path','{products,1,modifierGroupIds}',
      'value',pg_catalog.jsonb_build_array(g_shared::text,g_b::text)),
    pg_catalog.jsonb_build_object('label','owner_not_listed','path','{products,0,modifierGroupIds}',
      'value',pg_catalog.jsonb_build_array(g_shared::text)),
    pg_catalog.jsonb_build_object('label','bad_shape','path','{products,1,modifierGroupIds}','value','"x"'::jsonb)
  )) loop
    execute 'set local role app_api';
    select s.status into save_status from app_private.save_menu_catalog(
      actor,restaurant_a,branch_a,gen_random_uuid(),gen_random_uuid(),device,now_at,2,gen_random_uuid(),'MXN',
      pg_catalog.jsonb_set(payload,(scenario->>'path')::text[],scenario->'value')) s;
    execute 'reset role';
    if save_status<>'conflict' then raise exception 'SHARED_GROUPS_REJECT_%',upper(scenario->>'label'); end if;
  end loop;
  select head.version into version_now from app.menu_catalog_heads head where head.restaurant_id=restaurant_a;
  if version_now<>2 then raise exception 'SHARED_GROUPS_REJECTED_SAVE_ADVANCED_VERSION'; end if;

  -- 5. legacy writers: product_id nullable, and a group inserted with a product_id is assigned to it
  declare
    fixture_catalog uuid := gen_random_uuid();
    fixture_group uuid := gen_random_uuid();
    fixture_shared uuid := gen_random_uuid();
  begin
    insert into app.menu_catalogs(id,restaurant_id,version,currency,published_by) values(fixture_catalog,restaurant_b,9,'MXN',actor);
    insert into app.menu_categories(restaurant_id,catalog_id,id,name,active,display_order)
      values(restaurant_b,fixture_catalog,category_b,'Comida',true,1);
    insert into app.menu_products(restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor)
      values(restaurant_b,fixture_catalog,p_b,category_b,'Otro',null,true,1,'kitchen','piece',100);
    insert into app.menu_modifier_groups(restaurant_id,catalog_id,id,product_id,name,active,display_order,minimum_quantity,maximum_quantity)
      values(restaurant_b,fixture_catalog,fixture_group,p_b,'Legado',true,0,0,1),
            (restaurant_b,fixture_catalog,fixture_shared,null,'Compartido',true,1,0,1);
    if not exists (select 1 from app.menu_product_modifier_groups assignment
        where assignment.restaurant_id=restaurant_b and assignment.catalog_id=fixture_catalog
          and assignment.product_id=p_b and assignment.group_id=fixture_group)
      or exists (select 1 from app.menu_product_modifier_groups assignment
        where assignment.catalog_id=fixture_catalog and assignment.group_id=fixture_shared)
    then raise exception 'SHARED_GROUPS_LEGACY_OWNER_TRIGGER'; end if;
    -- Cross-scope assignment is rejected by the composite foreign keys.
    begin
      insert into app.menu_product_modifier_groups(restaurant_id,catalog_id,product_id,group_id,display_order)
        values(restaurant_a,fixture_catalog,p_b,fixture_shared,0);
      raise exception 'SHARED_GROUPS_CROSS_SCOPE_ACCEPTED';
    exception when foreign_key_violation then null;
    end;
  end;
end
$menu_shared_modifier_groups_tests$;
rollback;
