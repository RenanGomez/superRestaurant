-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises 20261008000200_catalog_halves_product_level.sql:
--   1. save_menu_catalog / build_menu_catalog_state round-trip a product-level `fraction` (also on a
--      product without sizes), replay a null product fraction as absent, and reject: fraction groups of
--      another product, an enabled product setup next to an enabled legacy size setup, a bad shape.
--   2. replace_capture_selection_plan accepts a fraction on a line without size and a null flavor in
--      one slot, and rejects a null flavor in both slots.
--   3. confirm_capture_draft_v3 recomputes the snapshot for a product WITHOUT sizes (greater half, a
--      zero-priced flavor takes the product price) and for a sized product with a product-level setup
--      (size price), including a half built ingredient by ingredient (base price, frozen as 'custom' /
--      'Armada', ingredients at half price rounded up), and conflicts on any drift.
--   4. list_kds_tickets prints 'Mitad A: Armada' for the custom half.
--   5. table invariants: CHECKs on the product fraction columns.
--   6. a flavor/extra group SHARED by two products (null legacy owner, assigned through
--      app.menu_product_modifier_groups) quotes and confirms halves at exactly the prices of the same
--      group with a legacy owner (22000 / 12000 + 1251), and the confirmed snapshot does not change
--      when the shared options are repriced afterwards.
begin;
do $catalog_halves_product_level_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant_a uuid := gen_random_uuid();
  branch_a uuid := gen_random_uuid();
  membership_a uuid := gen_random_uuid();
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  membership uuid := gen_random_uuid();
  catalog uuid := gen_random_uuid();
  category uuid := gen_random_uuid();
  pizza uuid := gen_random_uuid();
  sized_pizza uuid := gen_random_uuid();
  other_pizza uuid := gen_random_uuid();
  g_flavor uuid := gen_random_uuid();
  g_extra uuid := gen_random_uuid();
  g_flavor_s uuid := gen_random_uuid();
  g_extra_s uuid := gen_random_uuid();
  g_foreign uuid := gen_random_uuid();
  o_pep uuid := gen_random_uuid();
  o_haw uuid := gen_random_uuid();
  o_queso uuid := gen_random_uuid();
  o_pep_s uuid := gen_random_uuid();
  o_haw_s uuid := gen_random_uuid();
  o_queso_s uuid := gen_random_uuid();
  v_large uuid := gen_random_uuid();
  shared_pizza uuid := gen_random_uuid();
  shared_pizza_2 uuid := gen_random_uuid();
  g_flavor_sh uuid := gen_random_uuid();
  g_extra_sh uuid := gen_random_uuid();
  o_pep_sh uuid := gen_random_uuid();
  o_haw_sh uuid := gen_random_uuid();
  o_queso_sh uuid := gen_random_uuid();
  shared_orders uuid[] := array[]::uuid[];
  shared_snaps jsonb := '[]'::jsonb;
  shared_order uuid;
  device uuid := gen_random_uuid();
  shift uuid := gen_random_uuid();
  now_at timestamptz := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
  stamp text := pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  save_catalog uuid := gen_random_uuid();
  save_status text;
  save_state jsonb;
  payload jsonb;
  scenarios jsonb;
  scenario jsonb;
  created jsonb;
  lease text;
  target_capture uuid;
  line_id uuid;
  confirmed_order uuid;
  confirmation_event uuid;
  item_event uuid;
  item_id uuid;
  command jsonb;
  plan jsonb;
  result jsonb;
  confirmation_command jsonb;
  order_record jsonb;
  order_audits jsonb;
  snap jsonb;
  tickets jsonb; ticket_names jsonb;
  slot_pep jsonb; slot_haw jsonb; slot_custom jsonb; slot_custom_cheese jsonb;
  slot_pep_s jsonb; slot_haw_s jsonb; slot_custom_s jsonb;
  bd_pep jsonb; bd_haw jsonb; bd_custom jsonb; bd_haw_s jsonb; bd_custom_s jsonb;
  mod_cheese jsonb;
  fraction_cfg jsonb;
  variant_entry jsonb;
  save_event uuid; save_key uuid;
begin
  if actor is null then raise exception 'CATALOG_HALVES_PL_TEST_ACTOR_REQUIRED'; end if;

  -- ---------------------------------------------------------------- 1. save / state / replay
  insert into app.restaurants(id,name,time_zone) values(restaurant_a,'rollback-only product halves save','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(branch_a,restaurant_a,'rollback-only product halves branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values(membership_a,actor,restaurant_a,branch_a,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values(membership_a,'manager',actor);

  fraction_cfg := pg_catalog.jsonb_build_object(
    'enabled',true,'flavorGroupId',g_flavor::text,'extraGroupId',g_extra::text,
    'excludableIngredientIds',pg_catalog.jsonb_build_array('cebolla','piña')
  );
  variant_entry := pg_catalog.jsonb_build_object(
    'variantId',v_large::text,'name','Grande','unitPriceMinor',20000,'active',true,'displayOrder',0,'sku',null
  );
  payload := pg_catalog.jsonb_build_object(
    'categories',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'categoryId',category::text,'name','Pizzas','active',true,'displayOrder',0)),
    'products',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'productId',pizza::text,'categoryId',category::text,'name','Pizza','sku',null,'active',true,'displayOrder',0,
        'stationId','kitchen','unit','piece','unitPriceMinor',12000,'tax',null,'fraction',fraction_cfg),
      pg_catalog.jsonb_build_object(
        'productId',other_pizza::text,'categoryId',category::text,'name','Otra','sku',null,'active',true,'displayOrder',1,
        'stationId','kitchen','unit','piece','unitPriceMinor',100,'tax',null)
    ),
    'modifierGroups',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('groupId',g_flavor::text,'productId',pizza::text,'name','Sabor','active',true,
        'displayOrder',0,'minimumQuantity',0,'maximumQuantity',2,'options',pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('optionId',o_pep::text,'name','Pepperoni','unitPriceMinor',0,'active',true,'maximumQuantity',null))),
      pg_catalog.jsonb_build_object('groupId',g_extra::text,'productId',pizza::text,'name','Ingredientes','active',true,
        'displayOrder',1,'minimumQuantity',0,'maximumQuantity',5,'options',pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('optionId',o_queso::text,'name','Queso','unitPriceMinor',2501,'active',true,'maximumQuantity',null))),
      pg_catalog.jsonb_build_object('groupId',g_foreign::text,'productId',other_pizza::text,'name','Ajeno','active',true,
        'displayOrder',0,'minimumQuantity',0,'maximumQuantity',1,'options',pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('optionId',gen_random_uuid()::text,'name','X','unitPriceMinor',1,'active',true,'maximumQuantity',null)))
    )
  );
  save_event := gen_random_uuid(); save_key := gen_random_uuid();
  execute 'set local role app_api';
  select s.status,s.state into save_status,save_state from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,0,save_catalog,'MXN',payload) s;
  execute 'reset role';
  if save_status<>'saved' then raise exception 'CATALOG_HALVES_PL_SAVE_REJECTED'; end if;
  if (save_state#>'{catalog,products,0,fraction}') - 'lockedIngredientOptionIds' is distinct from fraction_cfg
    or save_state#>'{catalog,products,1,fraction}' is distinct from 'null'::jsonb
    or save_state#>'{catalog,products,0,variants}' is distinct from '[]'::jsonb
  then raise exception 'CATALOG_HALVES_PL_STATE_ROUNDTRIP'; end if;
  if pg_catalog.jsonb_typeof(save_state#>'{catalog,products,0,fraction,lockedIngredientOptionIds}') is distinct from 'array'
    or not (save_state#>'{catalog,products,0,fraction,lockedIngredientOptionIds}' @> pg_catalog.jsonb_build_array(o_queso::text))
    or not (save_state#>'{catalog,products,0,fraction,lockedIngredientOptionIds}' <@ pg_catalog.jsonb_build_array(o_queso::text))
  then raise exception 'CATALOG_HALVES_PL_LOCKED_INGREDIENT_OPTIONS'; end if;
  -- The explicit null product fraction replays as the absent key.
  save_event := gen_random_uuid(); save_key := gen_random_uuid(); save_catalog := gen_random_uuid();
  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,1,save_catalog,'MXN',
    pg_catalog.jsonb_set(payload,'{products,1}',(payload#>'{products,1}')||pg_catalog.jsonb_build_object('fraction',null))) s;
  if save_status<>'saved' then raise exception 'CATALOG_HALVES_PL_NULL_FRACTION_SAVE'; end if;
  select s.status into save_status from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,1,save_catalog,'MXN',payload) s;
  if save_status<>'replayed' then raise exception 'CATALOG_HALVES_PL_NULL_FRACTION_REPLAY'; end if;
  -- Rejections (all conflicts, none advances the version).
  for scenario in select value from pg_catalog.jsonb_array_elements(pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('label','foreign_group','path','{products,0,fraction}','value',pg_catalog.jsonb_build_object(
      'enabled',true,'flavorGroupId',g_foreign::text,'extraGroupId',null,'excludableIngredientIds',pg_catalog.jsonb_build_array())),
    pg_catalog.jsonb_build_object('label','enabled_without_flavor','path','{products,0,fraction}','value',pg_catalog.jsonb_build_object(
      'enabled',true,'flavorGroupId',null,'extraGroupId',null,'excludableIngredientIds',pg_catalog.jsonb_build_array())),
    pg_catalog.jsonb_build_object('label','same_group','path','{products,0,fraction}','value',pg_catalog.jsonb_build_object(
      'enabled',true,'flavorGroupId',g_flavor::text,'extraGroupId',g_flavor::text,'excludableIngredientIds',pg_catalog.jsonb_build_array())),
    pg_catalog.jsonb_build_object('label','duplicate_label','path','{products,0,fraction}','value',pg_catalog.jsonb_build_object(
      'enabled',true,'flavorGroupId',g_flavor::text,'extraGroupId',null,'excludableIngredientIds',pg_catalog.jsonb_build_array('a','a'))),
    pg_catalog.jsonb_build_object('label','bad_shape','path','{products,0,fraction}','value',pg_catalog.jsonb_build_object('enabled',true)),
    pg_catalog.jsonb_build_object('label','duplicate_source','path','{products,0,variants}','value',pg_catalog.jsonb_build_array(
      variant_entry||pg_catalog.jsonb_build_object('fraction',fraction_cfg)))
  )) loop
    execute 'set local role app_api';
    select s.status into save_status from app_private.save_menu_catalog(
      actor,restaurant_a,branch_a,gen_random_uuid(),gen_random_uuid(),device,now_at,2,gen_random_uuid(),'MXN',
      pg_catalog.jsonb_set(payload,(scenario->>'path')::text[],scenario->'value')) s;
    execute 'reset role';
    if save_status<>'conflict' then raise exception 'CATALOG_HALVES_PL_SAVE_%',upper(scenario->>'label'); end if;
  end loop;
  -- A disabled legacy size setup next to the product setup is fine.
  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,gen_random_uuid(),gen_random_uuid(),device,now_at,2,gen_random_uuid(),'MXN',
    pg_catalog.jsonb_set(payload,'{products,0,variants}',pg_catalog.jsonb_build_array(variant_entry||pg_catalog.jsonb_build_object(
      'fraction',pg_catalog.jsonb_build_object('enabled',false,'flavorGroupId',null,'extraGroupId',null,
        'excludableIngredientIds',pg_catalog.jsonb_build_array()))))) s;
  execute 'reset role';
  if save_status<>'saved' then raise exception 'CATALOG_HALVES_PL_DISABLED_LEGACY_REJECTED'; end if;
  if (select head.version from app.menu_catalog_heads head where head.restaurant_id=restaurant_a)<>3
  then raise exception 'CATALOG_HALVES_PL_REJECTED_SAVE_ADVANCED_VERSION'; end if;

  -- ---------------------------------------------------------------- 2. confirm fixtures
  insert into app.restaurants(id,name,time_zone) values(restaurant,'rollback-only product halves confirm','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(branch,restaurant,'rollback-only product halves confirm branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values(membership,actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values(membership,'cashier',actor),(membership,'kitchen',actor);
  insert into app.menu_catalogs(id,restaurant_id,version,currency,published_by) values(catalog,restaurant,1,'MXN',actor);
  insert into app.menu_categories(restaurant_id,catalog_id,id,name,active,display_order)
    values(restaurant,catalog,category,'Comida',true,1);
  insert into app.menu_products(
    restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor,
    fraction_enabled,fraction_flavor_group_id,fraction_extra_group_id,fraction_excludable_ingredient_ids
  ) values
    (restaurant,catalog,pizza,category,'Pizza',null,true,1,'kitchen','piece',12000,true,g_flavor,g_extra,array['cebolla']),
    (restaurant,catalog,sized_pizza,category,'Pizza grande',null,true,2,'kitchen','piece',0,true,g_flavor_s,g_extra_s,array['cebolla']);
  insert into app.menu_modifier_groups(
    restaurant_id,catalog_id,id,product_id,name,active,display_order,minimum_quantity,maximum_quantity
  ) values
    (restaurant,catalog,g_flavor,pizza,'Sabor',true,0,0,2),
    (restaurant,catalog,g_extra,pizza,'Ingredientes',true,1,0,5),
    (restaurant,catalog,g_flavor_s,sized_pizza,'Sabor',true,0,0,2),
    (restaurant,catalog,g_extra_s,sized_pizza,'Ingredientes',true,1,0,5);
  insert into app.menu_modifier_options(restaurant_id,catalog_id,group_id,id,name,unit_price_minor,active)
    values
    (restaurant,catalog,g_flavor,o_pep,'Pepperoni',0,true),
    (restaurant,catalog,g_flavor,o_haw,'Hawaiana',22000,true),
    (restaurant,catalog,g_extra,o_queso,'Queso',2501,true),
    (restaurant,catalog,g_flavor_s,o_pep_s,'Pepperoni',0,true),
    (restaurant,catalog,g_flavor_s,o_haw_s,'Hawaiana',22000,true),
    (restaurant,catalog,g_extra_s,o_queso_s,'Queso',2501,true);
  insert into app.menu_product_variants(
    restaurant_id,catalog_id,product_id,id,name,sku,unit_price_minor,active,display_order
  ) values (restaurant,catalog,sized_pizza,v_large,'Grande',null,20000,true,0);
  -- Shared groups: product_id null, offered to two products through the assignment table.
  insert into app.menu_products(
    restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor,
    fraction_enabled,fraction_flavor_group_id,fraction_extra_group_id,fraction_excludable_ingredient_ids
  ) values
    (restaurant,catalog,shared_pizza,category,'Pizza compartida',null,true,3,'kitchen','piece',12000,true,g_flavor_sh,g_extra_sh,array['cebolla']),
    (restaurant,catalog,shared_pizza_2,category,'Calzone compartido',null,true,4,'kitchen','piece',5000,false,null,null,array[]::text[]);
  insert into app.menu_modifier_groups(
    restaurant_id,catalog_id,id,product_id,name,active,display_order,minimum_quantity,maximum_quantity
  ) values
    (restaurant,catalog,g_flavor_sh,null,'Sabor',true,2,0,2),
    (restaurant,catalog,g_extra_sh,null,'Ingredientes',true,3,0,5);
  insert into app.menu_product_modifier_groups(restaurant_id,catalog_id,product_id,group_id,display_order)
    values
    (restaurant,catalog,shared_pizza,g_flavor_sh,0),(restaurant,catalog,shared_pizza,g_extra_sh,1),
    (restaurant,catalog,shared_pizza_2,g_flavor_sh,0),(restaurant,catalog,shared_pizza_2,g_extra_sh,1);
  insert into app.menu_modifier_options(restaurant_id,catalog_id,group_id,id,name,unit_price_minor,active)
    values
    (restaurant,catalog,g_flavor_sh,o_pep_sh,'Pepperoni',0,true),
    (restaurant,catalog,g_flavor_sh,o_haw_sh,'Hawaiana',22000,true),
    (restaurant,catalog,g_extra_sh,o_queso_sh,'Queso',2501,true);
  if (select pg_catalog.count(*) from app.menu_modifier_groups where catalog_id=catalog and product_id is null)<>2
    or (select pg_catalog.count(*) from app.menu_product_modifier_groups where catalog_id=catalog and group_id=g_flavor_sh)<>2
  then raise exception 'CATALOG_HALVES_PL_SHARED_FIXTURE'; end if;
  insert into app.menu_catalog_heads(restaurant_id,catalog_id,version,updated_at,updated_by)
    values(restaurant,catalog,1,now_at,actor);
  insert into app.operational_shifts(id,restaurant_id,branch_id,name,status,opened_at,opened_by)
    values(shift,restaurant,branch,'rollback product halves confirmation','open',now_at-interval '1 minute',actor);

  mod_cheese := pg_catalog.jsonb_build_object(
    'modifierId','extra:half-a:'||o_queso::text,'name','Queso','groupId','fraction-extra','groupName','extra:half-a',
    'groupCatalogVersion',catalog::text,'unitPrice',pg_catalog.jsonb_build_object('amountMinor',1251,'currency','MXN'),'quantity',1);
  slot_pep := pg_catalog.jsonb_build_object('fraction','half-a','flavorOptionId',o_pep::text,
    'extraOptionIds',pg_catalog.jsonb_build_array(),'excludedIngredientIds',pg_catalog.jsonb_build_array());
  slot_haw := pg_catalog.jsonb_build_object('fraction','half-b','flavorOptionId',o_haw::text,
    'extraOptionIds',pg_catalog.jsonb_build_array(),'excludedIngredientIds',pg_catalog.jsonb_build_array());
  slot_custom := pg_catalog.jsonb_build_object('fraction','half-a','flavorOptionId',null,
    'extraOptionIds',pg_catalog.jsonb_build_array(),'excludedIngredientIds',pg_catalog.jsonb_build_array());
  slot_custom_cheese := pg_catalog.jsonb_set(slot_custom,'{extraOptionIds}',pg_catalog.jsonb_build_array(o_queso::text));
  bd_pep := pg_catalog.jsonb_build_object('fraction','half-a','flavorOptionId',o_pep::text,'flavorName','Pepperoni','amountMinor',12000);
  bd_haw := pg_catalog.jsonb_build_object('fraction','half-b','flavorOptionId',o_haw::text,'flavorName','Hawaiana','amountMinor',22000);
  bd_custom := pg_catalog.jsonb_build_object('fraction','half-a','flavorOptionId','custom','flavorName','Armada','amountMinor',12000);
  slot_pep_s := pg_catalog.jsonb_build_object('fraction','half-a','flavorOptionId',o_pep_s::text,
    'extraOptionIds',pg_catalog.jsonb_build_array(),'excludedIngredientIds',pg_catalog.jsonb_build_array());
  slot_haw_s := pg_catalog.jsonb_build_object('fraction','half-b','flavorOptionId',o_haw_s::text,
    'extraOptionIds',pg_catalog.jsonb_build_array(),'excludedIngredientIds',pg_catalog.jsonb_build_array());
  slot_custom_s := pg_catalog.jsonb_set(slot_pep_s,'{flavorOptionId}','null'::jsonb);
  bd_custom_s := pg_catalog.jsonb_build_object('fraction','half-a','flavorOptionId','custom','flavorName','Armada','amountMinor',20000);
  bd_haw_s := pg_catalog.jsonb_build_object('fraction','half-b','flavorOptionId',o_haw_s::text,'flavorName','Hawaiana','amountMinor',22000);

  scenarios := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('label','nosize_flavors_ok','product',pizza,'variant',null,'groups',pg_catalog.jsonb_build_array(g_flavor,g_extra),
      'slots',pg_catalog.jsonb_build_array(slot_pep,slot_haw),'unit',22000,'mods',pg_catalog.jsonb_build_array(),
      'breakdown',pg_catalog.jsonb_build_array(bd_pep,bd_haw),'expect','applied'),
    pg_catalog.jsonb_build_object('label','nosize_custom_ok','product',pizza,'variant',null,'groups',pg_catalog.jsonb_build_array(g_flavor,g_extra),
      'slots',pg_catalog.jsonb_build_array(slot_custom_cheese,pg_catalog.jsonb_set(slot_pep,'{fraction}','"half-b"')),
      'unit',12000,'mods',pg_catalog.jsonb_build_array(mod_cheese),
      'breakdown',pg_catalog.jsonb_build_array(bd_custom,pg_catalog.jsonb_set(bd_pep,'{fraction}','"half-b"')),'expect','applied'),
    pg_catalog.jsonb_build_object('label','nosize_custom_second_ok','product',pizza,'variant',null,'groups',pg_catalog.jsonb_build_array(g_flavor,g_extra),
      'slots',pg_catalog.jsonb_build_array(slot_pep,pg_catalog.jsonb_set(slot_custom,'{fraction}','"half-b"')),
      'unit',12000,'mods',pg_catalog.jsonb_build_array(),
      'breakdown',pg_catalog.jsonb_build_array(bd_pep,pg_catalog.jsonb_set(bd_custom,'{fraction}','"half-b"')),'expect','applied'),
    pg_catalog.jsonb_build_object('label','nosize_custom_wrong_price','product',pizza,'variant',null,'groups',pg_catalog.jsonb_build_array(g_flavor,g_extra),
      'slots',pg_catalog.jsonb_build_array(slot_custom_cheese,slot_haw),'unit',12000,'mods',pg_catalog.jsonb_build_array(mod_cheese),
      'breakdown',pg_catalog.jsonb_build_array(bd_custom,bd_haw),'expect','conflict'),
    pg_catalog.jsonb_build_object('label','nosize_custom_full_price_extra','product',pizza,'variant',null,'groups',pg_catalog.jsonb_build_array(g_flavor,g_extra),
      'slots',pg_catalog.jsonb_build_array(slot_custom_cheese,pg_catalog.jsonb_set(slot_pep,'{fraction}','"half-b"')),
      'unit',12000,'mods',pg_catalog.jsonb_build_array(pg_catalog.jsonb_set(mod_cheese,'{unitPrice,amountMinor}','2501'::jsonb)),
      'breakdown',pg_catalog.jsonb_build_array(bd_custom,pg_catalog.jsonb_set(bd_pep,'{fraction}','"half-b"')),'expect','conflict'),
    pg_catalog.jsonb_build_object('label','nosize_zero_flavor_at_size_price','product',pizza,'variant',null,'groups',pg_catalog.jsonb_build_array(g_flavor,g_extra),
      'slots',pg_catalog.jsonb_build_array(slot_pep,slot_haw),'unit',22000,'mods',pg_catalog.jsonb_build_array(),
      'breakdown',pg_catalog.jsonb_build_array(pg_catalog.jsonb_set(bd_pep,'{amountMinor}','0'::jsonb),bd_haw),'expect','conflict'),
    pg_catalog.jsonb_build_object('label','nosize_both_custom','product',pizza,'variant',null,'groups',pg_catalog.jsonb_build_array(g_flavor,g_extra),
      'slots',pg_catalog.jsonb_build_array(slot_custom,pg_catalog.jsonb_set(slot_custom,'{fraction}','"half-b"')),
      'unit',12000,'mods',pg_catalog.jsonb_build_array(),'breakdown',pg_catalog.jsonb_build_array(bd_custom),'planExpect','rejected'),
    pg_catalog.jsonb_build_object('label','sized_custom_ok','product',sized_pizza,'variant',v_large,'groups',pg_catalog.jsonb_build_array(g_flavor_s,g_extra_s),
      'slots',pg_catalog.jsonb_build_array(slot_custom_s,slot_haw_s),'unit',22000,'mods',pg_catalog.jsonb_build_array(),
      'breakdown',pg_catalog.jsonb_build_array(bd_custom_s,bd_haw_s),'expect','applied'),
    pg_catalog.jsonb_build_object('label','sized_flavors_use_size_price','product',sized_pizza,'variant',v_large,'groups',pg_catalog.jsonb_build_array(g_flavor_s,g_extra_s),
      'slots',pg_catalog.jsonb_build_array(slot_pep_s,slot_pep_s||pg_catalog.jsonb_build_object('fraction','half-b')),
      'unit',20000,'mods',pg_catalog.jsonb_build_array(),
      'breakdown',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_set(bd_custom_s,'{flavorOptionId}',pg_catalog.to_jsonb(o_pep_s::text))||pg_catalog.jsonb_build_object('flavorName','Pepperoni'),
        pg_catalog.jsonb_build_object('fraction','half-b','flavorOptionId',o_pep_s::text,'flavorName','Pepperoni','amountMinor',20000)),
      'expect','applied')
  );

  -- Same quotes as the legacy-owner scenarios nosize_flavors_ok / nosize_custom_ok, with shared groups.
  scenarios := scenarios || pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('label','shared_flavors_ok','name','Pizza compartida','shared',true,
      'product',shared_pizza,'variant',null,'groups',pg_catalog.jsonb_build_array(g_flavor_sh,g_extra_sh),
      'slots',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_set(slot_pep,'{flavorOptionId}',pg_catalog.to_jsonb(o_pep_sh::text)),
        pg_catalog.jsonb_set(slot_haw,'{flavorOptionId}',pg_catalog.to_jsonb(o_haw_sh::text))),
      'unit',22000,'mods',pg_catalog.jsonb_build_array(),
      'breakdown',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_set(bd_pep,'{flavorOptionId}',pg_catalog.to_jsonb(o_pep_sh::text)),
        pg_catalog.jsonb_set(bd_haw,'{flavorOptionId}',pg_catalog.to_jsonb(o_haw_sh::text))),'expect','applied'),
    pg_catalog.jsonb_build_object('label','shared_custom_ok','name','Pizza compartida','shared',true,
      'product',shared_pizza,'variant',null,'groups',pg_catalog.jsonb_build_array(g_flavor_sh,g_extra_sh),
      'slots',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_set(slot_custom_cheese,'{extraOptionIds}',pg_catalog.jsonb_build_array(o_queso_sh::text)),
        pg_catalog.jsonb_set(pg_catalog.jsonb_set(slot_pep,'{fraction}','"half-b"'),'{flavorOptionId}',pg_catalog.to_jsonb(o_pep_sh::text))),
      'unit',12000,'mods',pg_catalog.jsonb_build_array(pg_catalog.jsonb_set(mod_cheese,'{modifierId}',
        pg_catalog.to_jsonb('extra:half-a:'||o_queso_sh::text))),
      'breakdown',pg_catalog.jsonb_build_array(bd_custom,
        pg_catalog.jsonb_set(pg_catalog.jsonb_set(bd_pep,'{fraction}','"half-b"'),'{flavorOptionId}',pg_catalog.to_jsonb(o_pep_sh::text))),
      'expect','applied'),
    pg_catalog.jsonb_build_object('label','shared_wrong_price','name','Pizza compartida',
      'product',shared_pizza,'variant',null,'groups',pg_catalog.jsonb_build_array(g_flavor_sh,g_extra_sh),
      'slots',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_set(slot_pep,'{flavorOptionId}',pg_catalog.to_jsonb(o_pep_sh::text)),
        pg_catalog.jsonb_set(slot_haw,'{flavorOptionId}',pg_catalog.to_jsonb(o_haw_sh::text))),
      'unit',12000,'mods',pg_catalog.jsonb_build_array(),
      'breakdown',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_set(bd_pep,'{flavorOptionId}',pg_catalog.to_jsonb(o_pep_sh::text)),
        pg_catalog.jsonb_set(bd_haw,'{flavorOptionId}',pg_catalog.to_jsonb(o_haw_sh::text))),'expect','conflict')
  );

  for scenario in select value from pg_catalog.jsonb_array_elements(scenarios) loop
    target_capture := gen_random_uuid();
    line_id := gen_random_uuid();
    confirmed_order := gen_random_uuid();
    confirmation_event := gen_random_uuid();
    item_event := gen_random_uuid();
    item_id := gen_random_uuid();

    execute 'set local role app_api';
    created := app_private.create_capture_draft(actor,pg_catalog.jsonb_build_object(
      'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
      'captureDraftId',target_capture::text,'expectedVersion',0,'eventId',gen_random_uuid()::text,
      'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,'occurredAt',stamp,
      'sourceChannel','phone','fulfillmentChannel','counter'
    ));
    execute 'reset role';
    if created->>'status'<>'applied' then raise exception 'CATALOG_HALVES_PL_CREATE_REJECTED'; end if;
    lease := created#>>'{record,detail,attentionLeaseId}';

    command := pg_catalog.jsonb_build_object(
      'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
      'captureDraftId',target_capture::text,'expectedVersion',1,'attentionLeaseId',lease,
      'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,'occurredAt',stamp
    );
    plan := pg_catalog.jsonb_build_object(
      'schemaVersion',1,'catalogVersion',catalog::text,'lines',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'lineId',line_id::text,'productId',scenario->>'product','variantId',scenario->'variant','quantity',1,'note',null,
          'fraction',pg_catalog.jsonb_build_object('geometry','halves','slots',scenario->'slots'),
          'modifierGroups',(
            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('groupId',group_id.value #>> '{}','selections',pg_catalog.jsonb_build_array()))
            from pg_catalog.jsonb_array_elements(scenario->'groups') group_id(value)
          )
        )
      )
    );
    execute 'set local role app_api';
    result := app_private.replace_capture_selection_plan(actor,command,plan);
    execute 'reset role';
    if scenario->>'planExpect'='rejected' then
      if result->>'status'<>'rejected' then raise exception 'CATALOG_HALVES_PL_PLAN_%',upper(scenario->>'label'); end if;
      continue;
    end if;
    if result->>'status'<>'applied' then raise exception 'CATALOG_HALVES_PL_PLAN_APPLY_REJECTED_%',upper(scenario->>'label'); end if;

    update app.capture_drafts set fulfillment_channel='counter'
    where restaurant_id=restaurant and branch_id=branch and id=target_capture;
    confirmation_command := pg_catalog.jsonb_build_object(
      'schemaVersion',2,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
      'captureDraftId',target_capture::text,'expectedVersion',2,'eventId',confirmation_event::text,
      'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,'occurredAt',stamp,
      'attentionLeaseId',lease,'orderId',confirmed_order::text,'shiftId',shift::text,'tableId',null,
      'currency','MXN','timeZone','America/Hermosillo'
    );
    order_audits := pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'schemaVersion',1,'eventId',confirmation_event::text,'idempotencyKey',confirmation_command->>'idempotencyKey',
        'restaurantId',restaurant::text,'branchId',branch::text,'orderId',confirmed_order::text,'actorId',actor::text,
        'deviceId',device::text,'occurredAt',stamp,'operation','order.created','entityType','order',
        'entityId',confirmed_order::text,'to','draft'
      ),
      pg_catalog.jsonb_build_object(
        'schemaVersion',1,'eventId',item_event::text,'idempotencyKey',gen_random_uuid()::text,
        'restaurantId',restaurant::text,'branchId',branch::text,'orderId',confirmed_order::text,
        'actorId',actor::text,'deviceId',device::text,'occurredAt',stamp,'operation','order.item_added',
        'entityType','order_item','entityId',item_id::text,'orderItemId',item_id::text
      )
    );
    snap := pg_catalog.jsonb_build_object(
      'catalogVersion',catalog::text,'productId',scenario->>'product',
      'name',coalesce(scenario->>'name',case when (scenario->>'product')::uuid=pizza then 'Pizza' else 'Pizza grande' end),
      'stationId','kitchen','unit','piece',
      'unitPrice',pg_catalog.jsonb_build_object('amountMinor',(scenario->>'unit')::bigint,'currency','MXN'),
      'modifiers',scenario->'mods','geometry','halves'
    );
    if pg_catalog.jsonb_typeof(scenario->'variant')='string' then
      snap := snap||pg_catalog.jsonb_build_object('variantId',scenario->>'variant','variantName','Grande');
    end if;
    snap := snap||pg_catalog.jsonb_build_object('fractionBreakdown',scenario->'breakdown');
    order_record := pg_catalog.jsonb_build_object(
      'schemaVersion',1,'orderId',confirmed_order::text,'restaurantId',restaurant::text,'branchId',branch::text,
      'channel','counter','currency','MXN','timeZone','America/Hermosillo','status','draft',
      'items',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'orderItemId',item_id::text,'snapshot',snap,'quantity',1,'restaurantId',restaurant::text,
        'branchId',branch::text,'status','pending','note',null
      ))
    );

    execute 'set local role app_api';
    result := app_private.confirm_capture_draft_v3(actor,confirmation_command,order_record,order_audits);
    execute 'reset role';
    if result->>'status' is distinct from scenario->>'expect' then
      raise exception 'CATALOG_HALVES_PL_CONFIRM_SCENARIO_%',upper(scenario->>'label');
    end if;
    if scenario->>'expect'='applied' and not exists (
      select 1 from app.orders placed
      where placed.restaurant_id=restaurant and placed.branch_id=branch and placed.id=confirmed_order
        and placed.aggregate#>'{items,0,snapshot}' = snap
    ) then raise exception 'CATALOG_HALVES_PL_SNAPSHOT_NOT_PERSISTED'; end if;
    if scenario->>'shared'='true' then
      shared_orders := shared_orders || confirmed_order;
      shared_snaps := shared_snaps || pg_catalog.jsonb_build_array(snap);
    end if;
    if scenario->>'expect'<>'applied' and exists (
      select 1 from app.orders placed
      where placed.restaurant_id=restaurant and placed.branch_id=branch and placed.id=confirmed_order
    ) then raise exception 'CATALOG_HALVES_PL_REJECTED_ORDER_PERSISTED'; end if;

    -- ------------------------------------------------------------ 4. kitchen ticket per half
    if scenario->>'label'='nosize_custom_ok' then
      update app.orders set status='open', aggregate=pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(aggregate,'{status}','"open"'),'{items,0,status}','"sent"')
      where restaurant_id=restaurant and branch_id=branch and id=confirmed_order;
      execute 'set local role app_api';
      tickets := app_private.list_kds_tickets(actor,restaurant,branch,'kitchen');
      execute 'reset role';
      select pg_catalog.jsonb_agg(modifier.value->>'name' order by modifier.ordinality) into ticket_names
      from pg_catalog.jsonb_array_elements(tickets#>'{tickets,0,modifiers}') with ordinality modifier(value,ordinality);
      if ticket_names is distinct from pg_catalog.jsonb_build_array(
        'Mitad A: Armada','Mitad B: Pepperoni','Mitad A: + Queso')
      then raise exception 'CATALOG_HALVES_PL_KDS_LINES_%',ticket_names::text; end if;
    end if;
  end loop;

  -- ---------------------------------------------------------------- 6. frozen snapshots of shared groups
  if pg_catalog.cardinality(shared_orders)<>2 then raise exception 'CATALOG_HALVES_PL_SHARED_ORDERS_%',pg_catalog.cardinality(shared_orders); end if;
  update app.menu_modifier_options set unit_price_minor=unit_price_minor+7000
  where restaurant_id=restaurant and catalog_id=catalog and group_id in (g_flavor_sh,g_extra_sh);
  update app.menu_products set unit_price_minor=unit_price_minor+500
  where restaurant_id=restaurant and catalog_id=catalog and id=shared_pizza;
  for shared_order in select unnest(shared_orders) loop
    if not exists (
      select 1 from app.orders placed
      where placed.restaurant_id=restaurant and placed.branch_id=branch and placed.id=shared_order
        and placed.aggregate#>'{items,0,snapshot}' = shared_snaps->(pg_catalog.array_position(shared_orders,shared_order)-1)
    ) then raise exception 'CATALOG_HALVES_PL_SHARED_SNAPSHOT_CHANGED'; end if;
  end loop;

  -- ---------------------------------------------------------------- 5. table invariants
  begin
    update app.menu_products set fraction_enabled=true,fraction_flavor_group_id=null
    where restaurant_id=restaurant and catalog_id=catalog and id=sized_pizza;
    raise exception 'CATALOG_HALVES_PL_ENABLED_WITHOUT_FLAVOR_ACCEPTED';
  exception when check_violation then null;
  end;
  begin
    update app.menu_products set fraction_flavor_group_id=g_flavor,fraction_extra_group_id=g_flavor
    where restaurant_id=restaurant and catalog_id=catalog and id=pizza;
    raise exception 'CATALOG_HALVES_PL_SAME_GROUP_ACCEPTED';
  exception when check_violation then null;
  end;
  begin
    update app.menu_products set fraction_excludable_ingredient_ids=array['a',null]
    where restaurant_id=restaurant and catalog_id=catalog and id=pizza;
    raise exception 'CATALOG_HALVES_PL_NULL_LABEL_ACCEPTED';
  exception when check_violation then null;
  end;
end
$catalog_halves_product_level_tests$;
commit;
