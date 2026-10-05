-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises 20261006000400_catalog_halves.sql:
--   1. save_menu_catalog / build_menu_catalog_state round-trip a size's `fraction` config, replay a
--      null fraction as absent, and reject fraction groups that belong to another product.
--   2. replace_capture_selection_plan accepts a per-line `fraction` and rejects malformed ones.
--   3. confirm_capture_draft_v3 recomputes the half-and-half snapshot (greater flavor price, extras at
--      half price rounded up, exclusion markers, per-half breakdown) and conflicts on any drift:
--      wrong price, inactive/foreign flavor, unknown exclusion, fraction on a size without halves,
--      full-price extras, dropped breakdown.
--   4. list_kds_tickets prints one headline per half plus per-half extras/exclusions.
--   5. table invariants: CHECKs on the fraction columns.
begin;
do $catalog_halves_tests$
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
  other_pizza uuid := gen_random_uuid();
  g_flavor uuid := gen_random_uuid();
  g_extra uuid := gen_random_uuid();
  g_foreign uuid := gen_random_uuid();
  o_pep uuid := gen_random_uuid();
  o_haw uuid := gen_random_uuid();
  o_off uuid := gen_random_uuid();
  o_queso uuid := gen_random_uuid();
  v_small uuid := gen_random_uuid();
  v_large uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  shift uuid := gen_random_uuid();
  now_at timestamptz := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
  stamp text := pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  save_catalog uuid := gen_random_uuid();
  save_status text;
  save_state jsonb;
  payload jsonb;
  save_variant jsonb;
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
  money20 jsonb; mod_extra jsonb; mod_excl jsonb; bd_a jsonb; bd_b jsonb;
  tickets jsonb; ticket_names jsonb;
  slot_a jsonb; slot_b jsonb;
  save_event uuid; save_key uuid;
begin
  if actor is null then raise exception 'CATALOG_HALVES_TEST_ACTOR_REQUIRED'; end if;

  -- ---------------------------------------------------------------- 1. save / state / replay
  insert into app.restaurants(id,name,time_zone) values(restaurant_a,'rollback-only halves save','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(branch_a,restaurant_a,'rollback-only halves save branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values(membership_a,actor,restaurant_a,branch_a,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values(membership_a,'manager',actor);

  save_variant := pg_catalog.jsonb_build_object(
    'variantId',v_large::text,'name','Grande','unitPriceMinor',20000,'active',true,'displayOrder',0,'sku',null,
    'fraction',pg_catalog.jsonb_build_object(
      'enabled',true,'flavorGroupId',g_flavor::text,'extraGroupId',g_extra::text,
      'excludableIngredientIds',pg_catalog.jsonb_build_array('cebolla','piña')
    )
  );
  payload := pg_catalog.jsonb_build_object(
    'categories',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'categoryId',category::text,'name','Pizzas','active',true,'displayOrder',0)),
    'products',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'productId',pizza::text,'categoryId',category::text,'name','Pizza','sku',null,'active',true,'displayOrder',0,
        'stationId','kitchen','unit','piece','unitPriceMinor',0,'tax',null,'variants',pg_catalog.jsonb_build_array(save_variant)),
      pg_catalog.jsonb_build_object(
        'productId',other_pizza::text,'categoryId',category::text,'name','Otra','sku',null,'active',true,'displayOrder',1,
        'stationId','kitchen','unit','piece','unitPriceMinor',100,'tax',null)
    ),
    'modifierGroups',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('groupId',g_flavor::text,'productId',pizza::text,'name','Sabor','active',true,
        'displayOrder',0,'minimumQuantity',0,'maximumQuantity',2,'options',pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('optionId',o_pep::text,'name','Pepperoni','unitPriceMinor',0,'active',true,'maximumQuantity',null),
          pg_catalog.jsonb_build_object('optionId',o_haw::text,'name','Hawaiana','unitPriceMinor',22000,'active',true,'maximumQuantity',null))),
      pg_catalog.jsonb_build_object('groupId',g_extra::text,'productId',pizza::text,'name','Extras','active',true,
        'displayOrder',1,'minimumQuantity',0,'maximumQuantity',5,'options',pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('optionId',o_queso::text,'name','Queso extra','unitPriceMinor',2501,'active',true,'maximumQuantity',null))),
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
  if save_status<>'saved' then raise exception 'CATALOG_HALVES_SAVE_REJECTED'; end if;
  if save_state#>'{catalog,products,0,variants,0,fraction}' is distinct from pg_catalog.jsonb_build_object(
      'enabled',true,'flavorGroupId',g_flavor::text,'extraGroupId',g_extra::text,
      'excludableIngredientIds',pg_catalog.jsonb_build_array('cebolla','piña'))
  then raise exception 'CATALOG_HALVES_STATE_ROUNDTRIP'; end if;
  -- A size without a fraction reads back `fraction: null`.
  payload := pg_catalog.jsonb_set(payload,'{products,0,variants,0}',save_variant - 'fraction');
  save_event := gen_random_uuid(); save_key := gen_random_uuid(); save_catalog := gen_random_uuid();
  execute 'set local role app_api';
  select s.status,s.state into save_status,save_state from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,1,save_catalog,'MXN',payload) s;
  if save_status<>'saved' or save_state#>'{catalog,products,0,variants,0,fraction}' is distinct from 'null'::jsonb
  then raise exception 'CATALOG_HALVES_NULL_FRACTION_STATE'; end if;
  -- An explicit null fraction replays as the absent key.
  select s.status into save_status from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,1,save_catalog,'MXN',
    pg_catalog.jsonb_set(payload,'{products,0,variants,0,fraction}','null'::jsonb)) s;
  if save_status<>'replayed' then raise exception 'CATALOG_HALVES_NULL_FRACTION_REPLAY'; end if;
  -- A flavor group of ANOTHER product, an enabled config without flavors and a repeated label are conflicts.
  for scenario in select value from pg_catalog.jsonb_array_elements(pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('label','foreign_group','fraction',pg_catalog.jsonb_build_object(
      'enabled',true,'flavorGroupId',g_foreign::text,'extraGroupId',null,'excludableIngredientIds',pg_catalog.jsonb_build_array())),
    pg_catalog.jsonb_build_object('label','enabled_without_flavor','fraction',pg_catalog.jsonb_build_object(
      'enabled',true,'flavorGroupId',null,'extraGroupId',null,'excludableIngredientIds',pg_catalog.jsonb_build_array())),
    pg_catalog.jsonb_build_object('label','same_group','fraction',pg_catalog.jsonb_build_object(
      'enabled',true,'flavorGroupId',g_flavor::text,'extraGroupId',g_flavor::text,'excludableIngredientIds',pg_catalog.jsonb_build_array())),
    pg_catalog.jsonb_build_object('label','duplicate_label','fraction',pg_catalog.jsonb_build_object(
      'enabled',true,'flavorGroupId',g_flavor::text,'extraGroupId',null,'excludableIngredientIds',pg_catalog.jsonb_build_array('a','a'))),
    pg_catalog.jsonb_build_object('label','bad_shape','fraction',pg_catalog.jsonb_build_object('enabled',true))
  )) loop
    select s.status into save_status from app_private.save_menu_catalog(
      actor,restaurant_a,branch_a,gen_random_uuid(),gen_random_uuid(),device,now_at,2,gen_random_uuid(),'MXN',
      pg_catalog.jsonb_set(payload,'{products,0,variants,0,fraction}',scenario->'fraction')) s;
    if save_status<>'conflict' then raise exception 'CATALOG_HALVES_SAVE_%',upper(scenario->>'label'); end if;
  end loop;
  execute 'reset role';
  if (select head.version from app.menu_catalog_heads head where head.restaurant_id=restaurant_a)<>2
  then raise exception 'CATALOG_HALVES_REJECTED_SAVE_ADVANCED_VERSION'; end if;

  -- ---------------------------------------------------------------- 2. confirm fixtures
  insert into app.restaurants(id,name,time_zone) values(restaurant,'rollback-only halves confirm','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(branch,restaurant,'rollback-only halves branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values(membership,actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values(membership,'cashier',actor),(membership,'kitchen',actor);
  insert into app.menu_catalogs(id,restaurant_id,version,currency,published_by) values(catalog,restaurant,1,'MXN',actor);
  insert into app.menu_categories(restaurant_id,catalog_id,id,name,active,display_order)
    values(restaurant,catalog,category,'Comida',true,1);
  insert into app.menu_products(
    restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor
  ) values (restaurant,catalog,pizza,category,'Pizza',null,true,1,'kitchen','piece',0);
  insert into app.menu_modifier_groups(
    restaurant_id,catalog_id,id,product_id,name,active,display_order,minimum_quantity,maximum_quantity
  ) values
    (restaurant,catalog,g_flavor,pizza,'Sabor',true,0,0,2),
    (restaurant,catalog,g_extra,pizza,'Extras',true,1,0,5);
  insert into app.menu_modifier_options(restaurant_id,catalog_id,group_id,id,name,unit_price_minor,active)
    values
    (restaurant,catalog,g_flavor,o_pep,'Pepperoni',0,true),
    (restaurant,catalog,g_flavor,o_haw,'Hawaiana',22000,true),
    (restaurant,catalog,g_flavor,o_off,'Agotada',24000,false),
    (restaurant,catalog,g_extra,o_queso,'Queso extra',2501,true);
  insert into app.menu_product_variants(
    restaurant_id,catalog_id,product_id,id,name,sku,unit_price_minor,active,display_order,
    fraction_enabled,fraction_flavor_group_id,fraction_extra_group_id,fraction_excludable_ingredient_ids
  ) values
    (restaurant,catalog,pizza,v_small,'Chica',null,12000,true,0,false,null,null,'{}'),
    (restaurant,catalog,pizza,v_large,'Grande',null,20000,true,1,true,g_flavor,g_extra,array['cebolla','piña']);
  insert into app.menu_catalog_heads(restaurant_id,catalog_id,version,updated_at,updated_by)
    values(restaurant,catalog,1,now_at,actor);
  insert into app.operational_shifts(id,restaurant_id,branch_id,name,status,opened_at,opened_by)
    values(shift,restaurant,branch,'rollback halves confirmation','open',now_at-interval '1 minute',actor);

  money20 := pg_catalog.jsonb_build_object('amountMinor',20000,'currency','MXN');
  mod_extra := pg_catalog.jsonb_build_object(
    'modifierId','extra:half-a:'||o_queso::text,'name','Queso extra','groupId','fraction-extra','groupName','extra:half-a',
    'groupCatalogVersion',catalog::text,'unitPrice',pg_catalog.jsonb_build_object('amountMinor',1251,'currency','MXN'),'quantity',1);
  mod_excl := pg_catalog.jsonb_build_object(
    'modifierId','exclude:half-a:cebolla','name','Sin cebolla','groupId','fraction-exclusion','groupName','exclude:half-a',
    'groupCatalogVersion',catalog::text,'unitPrice',pg_catalog.jsonb_build_object('amountMinor',0,'currency','MXN'),'quantity',1);
  bd_a := pg_catalog.jsonb_build_object('fraction','half-a','flavorOptionId',o_pep::text,'flavorName','Pepperoni','amountMinor',20000);
  bd_b := pg_catalog.jsonb_build_object('fraction','half-b','flavorOptionId',o_haw::text,'flavorName','Hawaiana','amountMinor',22000);
  slot_a := pg_catalog.jsonb_build_object('fraction','half-a','flavorOptionId',o_pep::text,
    'extraOptionIds',pg_catalog.jsonb_build_array(o_queso::text),'excludedIngredientIds',pg_catalog.jsonb_build_array('cebolla'));
  slot_b := pg_catalog.jsonb_build_object('fraction','half-b','flavorOptionId',o_haw::text,
    'extraOptionIds',pg_catalog.jsonb_build_array(),'excludedIngredientIds',pg_catalog.jsonb_build_array());

  scenarios := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('label','halves_ok','variant',v_large,
      'slots',pg_catalog.jsonb_build_array(slot_a,slot_b),'unit',22000,
      'mods',pg_catalog.jsonb_build_array(mod_extra,mod_excl),'breakdown',pg_catalog.jsonb_build_array(bd_a,bd_b),'expect','applied'),
    pg_catalog.jsonb_build_object('label','halves_plain_ok','variant',v_large,
      'slots',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_set(pg_catalog.jsonb_set(slot_a,'{extraOptionIds}','[]'::jsonb),'{excludedIngredientIds}','[]'::jsonb),slot_b),
      'unit',22000,'mods',pg_catalog.jsonb_build_array(),'breakdown',pg_catalog.jsonb_build_array(bd_a,bd_b),'expect','applied'),
    pg_catalog.jsonb_build_object('label','wrong_price','variant',v_large,
      'slots',pg_catalog.jsonb_build_array(slot_a,slot_b),'unit',20000,
      'mods',pg_catalog.jsonb_build_array(mod_extra,mod_excl),'breakdown',pg_catalog.jsonb_build_array(bd_a,bd_b),'expect','conflict'),
    pg_catalog.jsonb_build_object('label','full_price_extra','variant',v_large,
      'slots',pg_catalog.jsonb_build_array(slot_a,slot_b),'unit',22000,
      'mods',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_set(mod_extra,'{unitPrice,amountMinor}','2501'::jsonb),mod_excl),
      'breakdown',pg_catalog.jsonb_build_array(bd_a,bd_b),'expect','conflict'),
    pg_catalog.jsonb_build_object('label','dropped_breakdown','variant',v_large,
      'slots',pg_catalog.jsonb_build_array(slot_a,slot_b),'unit',22000,
      'mods',pg_catalog.jsonb_build_array(mod_extra,mod_excl),'breakdown',null,'expect','conflict'),
    pg_catalog.jsonb_build_object('label','inactive_flavor','variant',v_large,
      'slots',pg_catalog.jsonb_build_array(slot_a,pg_catalog.jsonb_set(slot_b,'{flavorOptionId}',pg_catalog.to_jsonb(o_off::text))),
      'unit',24000,'mods',pg_catalog.jsonb_build_array(mod_extra,mod_excl),
      'breakdown',pg_catalog.jsonb_build_array(bd_a,pg_catalog.jsonb_set(bd_b,'{flavorOptionId}',pg_catalog.to_jsonb(o_off::text))),'expect','conflict'),
    pg_catalog.jsonb_build_object('label','extra_as_flavor','variant',v_large,
      'slots',pg_catalog.jsonb_build_array(slot_a,pg_catalog.jsonb_set(slot_b,'{flavorOptionId}',pg_catalog.to_jsonb(o_queso::text))),
      'unit',22000,'mods',pg_catalog.jsonb_build_array(mod_extra,mod_excl),'breakdown',pg_catalog.jsonb_build_array(bd_a,bd_b),'expect','conflict'),
    pg_catalog.jsonb_build_object('label','unknown_exclusion','variant',v_large,
      'slots',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_set(slot_a,'{excludedIngredientIds}',pg_catalog.jsonb_build_array('jamon')),slot_b),
      'unit',22000,'mods',pg_catalog.jsonb_build_array(mod_extra,mod_excl),'breakdown',pg_catalog.jsonb_build_array(bd_a,bd_b),'expect','conflict'),
    pg_catalog.jsonb_build_object('label','size_without_halves','variant',v_small,
      'slots',pg_catalog.jsonb_build_array(slot_a,slot_b),'unit',22000,
      'mods',pg_catalog.jsonb_build_array(mod_extra,mod_excl),'breakdown',pg_catalog.jsonb_build_array(bd_a,bd_b),'expect','conflict'),
    pg_catalog.jsonb_build_object('label','plan_three_slots','variant',v_large,
      'slots',pg_catalog.jsonb_build_array(slot_a,slot_b,slot_b),'unit',22000,'mods',pg_catalog.jsonb_build_array(),
      'breakdown',pg_catalog.jsonb_build_array(bd_a,bd_b),'planExpect','rejected'),
    pg_catalog.jsonb_build_object('label','plan_wrong_slot_order','variant',v_large,
      'slots',pg_catalog.jsonb_build_array(slot_b,slot_a),'unit',22000,'mods',pg_catalog.jsonb_build_array(),
      'breakdown',pg_catalog.jsonb_build_array(bd_a,bd_b),'planExpect','rejected')
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
    if created->>'status'<>'applied' then raise exception 'CATALOG_HALVES_CREATE_REJECTED'; end if;
    lease := created#>>'{record,detail,attentionLeaseId}';

    command := pg_catalog.jsonb_build_object(
      'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
      'captureDraftId',target_capture::text,'expectedVersion',1,'attentionLeaseId',lease,
      'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,'occurredAt',stamp
    );
    plan := pg_catalog.jsonb_build_object(
      'schemaVersion',1,'catalogVersion',catalog::text,'lines',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'lineId',line_id::text,'productId',pizza::text,'variantId',scenario->'variant','quantity',1,'note',null,
          'fraction',pg_catalog.jsonb_build_object('geometry','halves','slots',scenario->'slots'),
          'modifierGroups',pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('groupId',g_flavor::text,'selections',pg_catalog.jsonb_build_array()),
            pg_catalog.jsonb_build_object('groupId',g_extra::text,'selections',pg_catalog.jsonb_build_array())
          )
        )
      )
    );
    execute 'set local role app_api';
    result := app_private.replace_capture_selection_plan(actor,command,plan);
    execute 'reset role';
    if scenario->>'planExpect'='rejected' then
      if result->>'status'<>'rejected' then raise exception 'CATALOG_HALVES_PLAN_%',upper(scenario->>'label'); end if;
      continue;
    end if;
    if result->>'status'<>'applied' then raise exception 'CATALOG_HALVES_PLAN_APPLY_REJECTED_%',upper(scenario->>'label'); end if;

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
      'catalogVersion',catalog::text,'productId',pizza::text,'name','Pizza','stationId','kitchen','unit','piece',
      'unitPrice',pg_catalog.jsonb_build_object('amountMinor',(scenario->>'unit')::bigint,'currency','MXN'),
      'modifiers',scenario->'mods','variantId',scenario->>'variant',
      'variantName',case when (scenario->>'variant')::uuid=v_large then 'Grande' else 'Chica' end,
      'geometry','halves'
    );
    if pg_catalog.jsonb_typeof(scenario->'breakdown')='array' then
      snap := snap||pg_catalog.jsonb_build_object('fractionBreakdown',scenario->'breakdown');
    end if;
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
      raise exception 'CATALOG_HALVES_CONFIRM_SCENARIO_%',upper(scenario->>'label');
    end if;
    if scenario->>'expect'='applied' and not exists (
      select 1 from app.orders placed
      where placed.restaurant_id=restaurant and placed.branch_id=branch and placed.id=confirmed_order
        and placed.aggregate#>'{items,0,snapshot}' = snap
    ) then raise exception 'CATALOG_HALVES_SNAPSHOT_NOT_PERSISTED'; end if;
    if scenario->>'expect'<>'applied' and exists (
      select 1 from app.orders placed
      where placed.restaurant_id=restaurant and placed.branch_id=branch and placed.id=confirmed_order
    ) then raise exception 'CATALOG_HALVES_REJECTED_ORDER_PERSISTED'; end if;

    -- ------------------------------------------------------------ 4. kitchen ticket per half
    if scenario->>'label'='halves_ok' then
      update app.orders set status='open', aggregate=pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(aggregate,'{status}','"open"'),'{items,0,status}','"sent"')
      where restaurant_id=restaurant and branch_id=branch and id=confirmed_order;
      execute 'set local role app_api';
      tickets := app_private.list_kds_tickets(actor,restaurant,branch,'kitchen');
      execute 'reset role';
      select pg_catalog.jsonb_agg(modifier.value->>'name' order by modifier.ordinality) into ticket_names
      from pg_catalog.jsonb_array_elements(tickets#>'{tickets,0,modifiers}') with ordinality modifier(value,ordinality);
      if ticket_names is distinct from pg_catalog.jsonb_build_array(
        'Mitad A: Pepperoni','Mitad B: Hawaiana','Mitad A: + Queso extra','Mitad A: Sin cebolla')
      then raise exception 'CATALOG_HALVES_KDS_LINES_%',ticket_names::text; end if;
    end if;
  end loop;

  -- ---------------------------------------------------------------- 5. table invariants
  begin
    update app.menu_product_variants set fraction_enabled=true,fraction_flavor_group_id=null
    where restaurant_id=restaurant and catalog_id=catalog and id=v_small;
    raise exception 'CATALOG_HALVES_ENABLED_WITHOUT_FLAVOR_ACCEPTED';
  exception when check_violation then null;
  end;
  begin
    update app.menu_product_variants set fraction_flavor_group_id=g_flavor,fraction_extra_group_id=g_flavor
    where restaurant_id=restaurant and catalog_id=catalog and id=v_small;
    raise exception 'CATALOG_HALVES_SAME_GROUP_ACCEPTED';
  exception when check_violation then null;
  end;
  begin
    update app.menu_product_variants set fraction_excludable_ingredient_ids=array['a',null]
    where restaurant_id=restaurant and catalog_id=catalog and id=v_small;
    raise exception 'CATALOG_HALVES_NULL_LABEL_ACCEPTED';
  exception when check_violation then null;
  end;
end
$catalog_halves_tests$;
commit;
