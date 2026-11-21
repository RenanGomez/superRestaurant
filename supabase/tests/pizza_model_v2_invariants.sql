-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises 20261120000100_pizza_model_v2.sql (P3-2):
--   1. app_private.pizza_halves_price_v2 reproduces the 10 parity vectors of docs/architecture/PIZZA_MODEL_V2.md
--      (the same cases as packages/domain/src/fraction-pricing.ts), in minor units.
--   2. save_menu_catalog / build_menu_catalog_state round-trip the V2 product fields, replay a null pizzaMode as
--      absent, and reject (conflict, no version advance): V2 fields without a mode, a custom product without a
--      base group, a base/extra group that is not assigned to the product or is foreign to the release, the base
--      group among the extras, recipe options outside the base group, duplicates, an out-of-range free count,
--      an unknown mode and a V2 product that also carries a legacy fraction setup.
--   3. table CHECKs: a legacy row keeps the neutral values; custom needs a base group; base not in extras;
--      arrays without duplicates; 0..40 free ingredients.
--   4. replace_capture_selection_plan: plan schemaVersion 2 accepts `pizza` lines; schemaVersion 1 cannot carry
--      one; rule versions v1/unknown and the legacy two-custom-halves selection are rejected with an explicit
--      reason; idempotent replay through the capture command journal, conflict on the same key with a new plan.
--   5. confirm_capture_draft_v3 prices V2 lines from the catalog (never from the client), freezes the
--      versioned snapshot, conflicts on drift / foreign scope / a price conflict between halves, replays the
--      confirmation without a second order, and the persisted snapshot survives catalog repricing.
begin;

-- ---------------------------------------------------------------- helpers (dropped by the rollback)
create function pg_temp.opt(p_id text, p_price bigint) returns jsonb language sql as $f$
  select pg_catalog.jsonb_build_object('optionId',p_id,'groupId','g','name','Option '||p_id,'priceMinor',p_price)
$f$;
create function pg_temp.half(
  p_fraction text, p_product text, p_kind text, p_base bigint, p_free integer,
  p_ingredients jsonb default '[]'::jsonb, p_extras jsonb default '[]'::jsonb, p_removed jsonb default '[]'::jsonb
) returns jsonb language sql as $f$
  select pg_catalog.jsonb_build_object(
    'fraction',p_fraction,'productId',p_product,'productName','Pizza '||p_product,'stationId','kitchen',
    'sizeId','size-1','sizeName','Grande','kind',p_kind,'basePriceMinor',p_base,'freeIngredientCount',p_free,
    'ingredients',p_ingredients,'extras',p_extras,'removedIngredientOptionIds',p_removed)
$f$;
create function pg_temp.price(p_a jsonb, p_b jsonb) returns jsonb language sql as $f$
  select app_private.pizza_halves_price_v2(pg_catalog.jsonb_build_object(
    'ruleVersion','pizza-halves-v2','currency','MXN','halves',pg_catalog.jsonb_build_array(p_a,p_b)))
$f$;
-- Frozen snapshot of a V2 line, the way confirm_capture_draft_v3 builds it (charges, then removals).
create function pg_temp.pizza_snapshot(
  p_catalog uuid, p_product uuid, p_name text, p_result jsonb, p_removed jsonb
) returns jsonb language sql as $f$
  select pg_catalog.jsonb_build_object(
    'catalogVersion',p_catalog::text,'productId',p_product::text,'name',p_name,'stationId','kitchen','unit','piece',
    'unitPrice',p_result->'basePrice',
    'modifiers',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'modifierId','pizza-'||(charge.value->>'role')||':'
          ||(case when pg_catalog.jsonb_array_length(charge.value->'fractions')=2 then 'both' else charge.value->'fractions'->>0 end)
          ||':'||(charge.value->>'optionId'),
        'name',charge.value->>'name',
        'groupId',case charge.value->>'role' when 'ingredient' then 'pizza-ingredient' else 'pizza-extra' end,
        'groupName',(charge.value->>'role')||':'
          ||(case when pg_catalog.jsonb_array_length(charge.value->'fractions')=2 then 'both' else charge.value->'fractions'->>0 end),
        'groupCatalogVersion',p_catalog::text,'unitPrice',charge.value->'amount','quantity',1
      ) order by charge.ordinality)
      from pg_catalog.jsonb_array_elements(p_result->'charges') with ordinality charge(value,ordinality)
    ),'[]'::jsonb) || coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'modifierId','exclude:'||(removed.value->>'fraction')||':'||(removed.value->>'optionId'),
        'name','Sin '||(removed.value->>'name'),'groupId','fraction-exclusion',
        'groupName','exclude:'||(removed.value->>'fraction'),'groupCatalogVersion',p_catalog::text,
        'unitPrice',pg_catalog.jsonb_build_object('amountMinor',0,'currency','MXN'),'quantity',1
      ) order by removed.ordinality)
      from pg_catalog.jsonb_array_elements(p_removed) with ordinality removed(value,ordinality)
    ),'[]'::jsonb),
    'geometry','halves','pizzaHalves',p_result)
$f$;

do $pizza_model_v2_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  -- save fixtures (restaurant_a) -- also the "foreign" restaurant for the scope tests
  restaurant_a uuid := gen_random_uuid(); branch_a uuid := gen_random_uuid(); membership_a uuid := gen_random_uuid();
  catalog_a uuid := gen_random_uuid(); category_a uuid := gen_random_uuid(); foreign_product uuid := gen_random_uuid();
  save_catalog uuid := gen_random_uuid(); s_cat uuid := gen_random_uuid();
  sp_custom uuid := gen_random_uuid(); sp_legacy uuid := gen_random_uuid();
  sg_base uuid := gen_random_uuid(); sg_extra uuid := gen_random_uuid(); sg_other uuid := gen_random_uuid();
  so_1 uuid := gen_random_uuid(); so_2 uuid := gen_random_uuid(); so_x uuid := gen_random_uuid(); so_o uuid := gen_random_uuid();
  -- confirm fixtures
  restaurant uuid := gen_random_uuid(); branch uuid := gen_random_uuid(); membership uuid := gen_random_uuid();
  catalog uuid := gen_random_uuid(); category uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); spec uuid := gen_random_uuid(); spec_locked uuid := gen_random_uuid();
  p3 uuid := gen_random_uuid(); p4 uuid := gen_random_uuid(); p_legacy uuid := gen_random_uuid();
  g_base uuid := gen_random_uuid(); g_extra uuid := gen_random_uuid(); g_bx uuid := gen_random_uuid(); g_by uuid := gen_random_uuid();
  o_a uuid := gen_random_uuid(); o_b uuid := gen_random_uuid(); o_c uuid := gen_random_uuid(); o_e uuid := gen_random_uuid();
  o_conf uuid := gen_random_uuid();
  pq uuid := gen_random_uuid(); g_min uuid := gen_random_uuid(); g_xmax uuid := gen_random_uuid();
  m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); m3 uuid := gen_random_uuid();
  x1 uuid := gen_random_uuid(); x2 uuid := gen_random_uuid();
  pv uuid := gen_random_uuid(); pt1 uuid := gen_random_uuid(); pt2 uuid := gen_random_uuid();
  v_small uuid := gen_random_uuid(); v_large uuid := gen_random_uuid();
  device uuid := gen_random_uuid(); shift uuid := gen_random_uuid();
  now_at timestamptz := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
  stamp text := pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  save_status text; save_state jsonb; payload jsonb; scenario jsonb; scenarios jsonb; vector jsonb; res jsonb;
  save_event uuid; save_key uuid; created jsonb; lease text; target_capture uuid; line_id uuid;
  confirmed_order uuid; confirmation_event uuid; item_event uuid; item_id uuid; command jsonb; plan jsonb;
  result jsonb; replay jsonb; confirmation_command jsonb; order_record jsonb; order_audits jsonb; snap jsonb;
  pizza_line jsonb; pizza_result jsonb; first_snap jsonb; first_order uuid; first_total bigint; attempts integer;
  item_sum bigint;
begin
  if actor is null then raise exception 'PIZZA_V2_TEST_ACTOR_REQUIRED'; end if;

  -- ---------------------------------------------------------------- 1. the 10 parity vectors (minor units)
  vector := pg_temp.price(
    pg_temp.half('half-a','p1','specialty',1500,0), pg_temp.half('half-b','p2','specialty',1800,0));
  if vector#>>'{total,amountMinor}' <> '1800' or vector#>>'{basePrice,amountMinor}' <> '1800'
    or vector->>'baseFraction' <> 'half-b' or vector->>'ruleVersion' <> 'pizza-halves-v2' or vector->'schemaVersion' <> '1'::jsonb
    or vector#>>'{total,currency}' <> 'MXN'
  then raise exception 'PIZZA_V2_VECTOR_1_%',vector::text; end if;

  vector := pg_temp.price(
    pg_temp.half('half-a','p1','custom',1000,0,pg_catalog.jsonb_build_array(pg_temp.opt('A',101))),
    pg_temp.half('half-b','p2','custom',1000,0,pg_catalog.jsonb_build_array(pg_temp.opt('B',103))));
  if vector#>>'{total,amountMinor}' <> '1103' then raise exception 'PIZZA_V2_VECTOR_2_%',vector::text; end if;
  -- the charges are frozen per option: 51 + 52, neither free
  if vector#>'{charges,0,amount,amountMinor}' <> '51'::jsonb or vector#>'{charges,1,amount,amountMinor}' <> '52'::jsonb
    or vector#>'{charges,0,fractions}' <> '["half-a"]'::jsonb or vector#>'{charges,0,free}' <> 'false'::jsonb
  then raise exception 'PIZZA_V2_VECTOR_2_CHARGES_%',vector->'charges'; end if;

  vector := pg_temp.price(
    pg_temp.half('half-a','p1','custom',1000,4,pg_catalog.jsonb_build_array(pg_temp.opt('A',100),pg_temp.opt('B',200))),
    pg_temp.half('half-b','p2','custom',1000,4));
  if vector#>>'{total,amountMinor}' <> '1000' or vector#>'{freeAssignmentOrder}' <> '["A","B"]'::jsonb
  then raise exception 'PIZZA_V2_VECTOR_3_%',vector::text; end if;

  vector := pg_temp.price(
    pg_temp.half('half-a','p1','custom',1000,2,pg_catalog.jsonb_build_array(pg_temp.opt('A',100),pg_temp.opt('B',200))),
    pg_temp.half('half-b','p2','custom',1000,2,pg_catalog.jsonb_build_array(pg_temp.opt('A',100),pg_temp.opt('C',300))));
  if vector#>>'{total,amountMinor}' <> '1150' or vector#>'{freeAssignmentOrder}' <> '["A","B"]'::jsonb
    or vector#>'{charges,2,amount,amountMinor}' <> '150'::jsonb
  then raise exception 'PIZZA_V2_VECTOR_4_%',vector::text; end if;

  vector := pg_temp.price(
    pg_temp.half('half-a','p1','custom',1000,2,pg_catalog.jsonb_build_array(
      pg_temp.opt('A',100),pg_temp.opt('B',200),pg_temp.opt('D',401))),
    pg_temp.half('half-b','p2','custom',1000,2,pg_catalog.jsonb_build_array(pg_temp.opt('A',100),pg_temp.opt('B',200))));
  if vector#>>'{total,amountMinor}' <> '1201' then raise exception 'PIZZA_V2_VECTOR_5_%',vector::text; end if;

  -- N comes from the more expensive custom half (1200 -> N=2), not from the first one
  vector := pg_temp.price(
    pg_temp.half('half-a','p1','custom',1000,1,pg_catalog.jsonb_build_array(
      pg_temp.opt('A',100),pg_temp.opt('B',200),pg_temp.opt('C',300))),
    pg_temp.half('half-b','p2','custom',1200,2,pg_catalog.jsonb_build_array(
      pg_temp.opt('A',100),pg_temp.opt('B',200),pg_temp.opt('C',300))));
  if vector#>>'{total,amountMinor}' <> '1500' or vector->>'freeIngredientCountFraction' <> 'half-b'
    or vector->>'freeIngredientCount' <> '2'
  then raise exception 'PIZZA_V2_VECTOR_6_%',vector::text; end if;

  -- tie on price: the smaller productId decides N, whichever half it is on (half-a has the bigger id here)
  vector := pg_temp.price(
    pg_temp.half('half-a','00000000-0000-4000-8000-000000000002','custom',1000,2,pg_catalog.jsonb_build_array(
      pg_temp.opt('A',100),pg_temp.opt('B',200))),
    pg_temp.half('half-b','00000000-0000-4000-8000-000000000001','custom',1000,1,pg_catalog.jsonb_build_array(
      pg_temp.opt('A',100),pg_temp.opt('B',200))));
  if vector#>>'{total,amountMinor}' <> '1200' or vector->>'freeIngredientCount' <> '1'
    or vector->>'freeIngredientCountFraction' <> 'half-b'
  then raise exception 'PIZZA_V2_VECTOR_7_%',vector::text; end if;

  -- mixed: a specialty half (1500) and a custom half (1000, N=1); N applies only to the custom half's ingredients
  vector := pg_temp.price(
    pg_temp.half('half-a','p1','specialty',1500,0),
    pg_temp.half('half-b','p2','custom',1000,1,pg_catalog.jsonb_build_array(pg_temp.opt('A',100),pg_temp.opt('B',201))));
  if vector#>>'{total,amountMinor}' <> '1601' or vector#>>'{basePrice,amountMinor}' <> '1500'
  then raise exception 'PIZZA_V2_VECTOR_8_%',vector::text; end if;

  -- an extra never consumes N; one in both halves is charged in full
  vector := pg_temp.price(
    pg_temp.half('half-a','p1','custom',1000,0,pg_catalog.jsonb_build_array(pg_temp.opt('A',101)),
      pg_catalog.jsonb_build_array(pg_temp.opt('E',75))),
    pg_temp.half('half-b','p2','custom',1000,0,pg_catalog.jsonb_build_array(pg_temp.opt('A',101)),
      pg_catalog.jsonb_build_array(pg_temp.opt('E',75))));
  if vector#>>'{total,amountMinor}' <> '1176' or vector#>>'{charges,1,role}' <> 'extra'
    or vector#>'{charges,1,free}' <> 'false'::jsonb
  then raise exception 'PIZZA_V2_VECTOR_9_%',vector::text; end if;

  -- the same optionId at two prices is an error and yields no total
  vector := pg_temp.price(
    pg_temp.half('half-a','p1','custom',1000,0,pg_catalog.jsonb_build_array(pg_temp.opt('A',100))),
    pg_temp.half('half-b','p2','custom',1000,0,pg_catalog.jsonb_build_array(pg_temp.opt('A',101))));
  if vector ? 'total' or vector#>>'{issues,0,code}' <> 'pizza_ingredient_price_conflict'
  then raise exception 'PIZZA_V2_VECTOR_10_%',vector::text; end if;

  -- more domain issue codes: specialty with ingredients, custom with removals, duplicates, role clash, legacy/unknown versions
  for scenario in select value from pg_catalog.jsonb_array_elements(pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('code','specialty_ingredients_not_allowed','a',
      pg_temp.half('half-a','p1','specialty',1500,0,pg_catalog.jsonb_build_array(pg_temp.opt('A',100))),
      'b',pg_temp.half('half-b','p2','custom',1000,0)),
    pg_catalog.jsonb_build_object('code','removal_not_allowed','a',
      pg_temp.half('half-a','p1','custom',1000,0,'[]'::jsonb,'[]'::jsonb,pg_catalog.jsonb_build_array('A')),
      'b',pg_temp.half('half-b','p2','custom',1000,0)),
    pg_catalog.jsonb_build_object('code','option_duplicate','a',
      pg_temp.half('half-a','p1','custom',1000,0,pg_catalog.jsonb_build_array(pg_temp.opt('A',100),pg_temp.opt('A',100))),
      'b',pg_temp.half('half-b','p2','custom',1000,0)),
    pg_catalog.jsonb_build_object('code','option_role_conflict','a',
      pg_temp.half('half-a','p1','custom',1000,0,pg_catalog.jsonb_build_array(pg_temp.opt('A',100)),
        pg_catalog.jsonb_build_array(pg_temp.opt('A',100))),
      'b',pg_temp.half('half-b','p2','custom',1000,0)),
    pg_catalog.jsonb_build_object('code','pizza_extra_price_conflict','a',
      pg_temp.half('half-a','p1','custom',1000,0,'[]'::jsonb,pg_catalog.jsonb_build_array(pg_temp.opt('E',50))),
      'b',pg_temp.half('half-b','p2','custom',1000,0,'[]'::jsonb,pg_catalog.jsonb_build_array(pg_temp.opt('E',51))))
  )) loop
    vector := pg_temp.price(scenario->'a',scenario->'b');
    if vector ? 'total' or vector#>>'{issues,0,code}' is distinct from scenario->>'code'
    then raise exception 'PIZZA_V2_ISSUE_%_%',upper(scenario->>'code'),vector::text; end if;
  end loop;
  vector := app_private.pizza_halves_price_v2(pg_catalog.jsonb_build_object(
    'ruleVersion','pizza-halves-v1','currency','MXN','halves',pg_catalog.jsonb_build_array(
      pg_temp.half('half-a','p1','specialty',1500,0),pg_temp.half('half-b','p2','specialty',1500,0))));
  if vector#>>'{issues,0,code}' <> 'rule_version_legacy' or vector ? 'total' then raise exception 'PIZZA_V2_RULE_V1_%',vector::text; end if;
  vector := app_private.pizza_halves_price_v2(pg_catalog.jsonb_build_object(
    'ruleVersion','pizza-halves-v1','currency','MXN','halves',pg_catalog.jsonb_build_array(
      pg_temp.half('half-a','p1','custom',1000,0),pg_temp.half('half-b','p2','custom',1000,0))));
  if vector#>>'{issues,0,code}' <> 'fraction_both_custom' then raise exception 'PIZZA_V2_LEGACY_BOTH_CUSTOM_%',vector::text; end if;
  vector := app_private.pizza_halves_price_v2(pg_catalog.jsonb_build_object(
    'ruleVersion','pizza-halves-v9','currency','MXN','halves',pg_catalog.jsonb_build_array(
      pg_temp.half('half-a','p1','specialty',1500,0),pg_temp.half('half-b','p2','specialty',1500,0))));
  if vector#>>'{issues,0,code}' <> 'rule_version_unknown' then raise exception 'PIZZA_V2_RULE_UNKNOWN_%',vector::text; end if;
  vector := app_private.pizza_halves_price_v2(pg_catalog.jsonb_build_object(
    'ruleVersion','pizza-halves-v2','currency','MXN','halves',pg_catalog.jsonb_build_array(
      pg_temp.half('half-a','p1','specialty',1500,0),pg_temp.half('half-a','p2','specialty',1500,0))));
  if vector#>>'{issues,0,code}' <> 'halves_mismatch' then raise exception 'PIZZA_V2_HALVES_MISMATCH_%',vector::text; end if;

  -- ---------------------------------------------------------------- 2. save / state / replay (restaurant_a)
  insert into app.restaurants(id,name,time_zone) values(restaurant_a,'rollback-only pizza v2 save','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(branch_a,restaurant_a,'rollback-only pizza v2 save branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values(membership_a,actor,restaurant_a,branch_a,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values(membership_a,'manager',actor);

  payload := pg_catalog.jsonb_build_object(
    'categories',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'categoryId',s_cat::text,'name','Pizzas','active',true,'displayOrder',0)),
    'products',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'productId',sp_custom::text,'categoryId',s_cat::text,'name','Pizza armada','sku',null,'active',true,'displayOrder',0,
        'stationId','kitchen','unit','piece','unitPriceMinor',12000,'tax',null,
        'pizzaMode','custom','freeIngredientCount',2,'baseGroupId',sg_base::text,
        'defaultIngredientOptionIds',pg_catalog.jsonb_build_array(so_1::text),'customizeAtOrder',true,
        'extraGroupIds',pg_catalog.jsonb_build_array(sg_extra::text),
        'modifierGroupIds',pg_catalog.jsonb_build_array(sg_base::text,sg_extra::text)),
      pg_catalog.jsonb_build_object(
        'productId',sp_legacy::text,'categoryId',s_cat::text,'name','Refresco','sku',null,'active',true,'displayOrder',1,
        'stationId','bar','unit','piece','unitPriceMinor',100,'tax',null,
        'modifierGroupIds',pg_catalog.jsonb_build_array(sg_other::text))
    ),
    'modifierGroups',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('groupId',sg_base::text,'productId',null,'name','Ingredientes','active',true,
        'displayOrder',0,'minimumQuantity',0,'maximumQuantity',40,'options',pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('optionId',so_1::text,'name','Queso','unitPriceMinor',2500,'active',true,'maximumQuantity',null),
          pg_catalog.jsonb_build_object('optionId',so_2::text,'name','Jamon','unitPriceMinor',3000,'active',true,'maximumQuantity',null))),
      pg_catalog.jsonb_build_object('groupId',sg_extra::text,'productId',null,'name','Extras','active',true,
        'displayOrder',1,'minimumQuantity',0,'maximumQuantity',10,'options',pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('optionId',so_x::text,'name','Orilla de queso','unitPriceMinor',4000,'active',true,'maximumQuantity',null))),
      pg_catalog.jsonb_build_object('groupId',sg_other::text,'productId',null,'name','Hielo','active',true,
        'displayOrder',2,'minimumQuantity',0,'maximumQuantity',1,'options',pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('optionId',so_o::text,'name','Con hielo','unitPriceMinor',0,'active',true,'maximumQuantity',null)))
    )
  );
  save_event := gen_random_uuid(); save_key := gen_random_uuid();
  execute 'set local role app_api';
  select s.status,s.state into save_status,save_state from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,0,save_catalog,'MXN',payload) s;
  execute 'reset role';
  if save_status<>'saved' then raise exception 'PIZZA_V2_SAVE_REJECTED_%',save_status; end if;
  -- (product order is display_order: custom first, then the legacy product)
  if save_state#>>'{catalog,products,0,pizzaMode}' is distinct from 'custom'
    or save_state#>'{catalog,products,0,freeIngredientCount}' is distinct from '2'::jsonb
    or save_state#>>'{catalog,products,0,baseGroupId}' is distinct from sg_base::text
    or save_state#>'{catalog,products,0,defaultIngredientOptionIds}' is distinct from pg_catalog.jsonb_build_array(so_1::text)
    or save_state#>'{catalog,products,0,customizeAtOrder}' is distinct from 'true'::jsonb
    or save_state#>'{catalog,products,0,extraGroupIds}' is distinct from pg_catalog.jsonb_build_array(sg_extra::text)
    or (save_state#>'{catalog,products,1}') ?| array['pizzaMode','freeIngredientCount','baseGroupId',
      'defaultIngredientOptionIds','customizeAtOrder','extraGroupIds']
  then raise exception 'PIZZA_V2_STATE_ROUNDTRIP_%',save_state#>'{catalog,products}'; end if;
  -- scope of the stored row: the catalog and groups it points at belong to the very same restaurant and release
  if not exists (
    select 1 from app.menu_products product
    join app.menu_modifier_groups base_group on base_group.restaurant_id=product.restaurant_id
      and base_group.catalog_id=product.catalog_id and base_group.id=product.base_group_id
    where product.restaurant_id=restaurant_a and product.catalog_id=save_catalog and product.id=sp_custom
      and product.pizza_mode='custom' and product.free_ingredient_count=2 and product.customize_at_order
      and product.extra_group_ids=array[sg_extra] and product.default_ingredient_option_ids=array[so_1]
  ) or exists (
    select 1 from app.menu_products product
    where product.restaurant_id=restaurant_a and product.catalog_id=save_catalog and product.id=sp_legacy
      and (product.pizza_mode is not null or product.free_ingredient_count<>0 or product.base_group_id is not null
        or product.customize_at_order or pg_catalog.cardinality(product.default_ingredient_option_ids)<>0
        or pg_catalog.cardinality(product.extra_group_ids)<>0)
  ) then raise exception 'PIZZA_V2_SAVE_ROW_SCOPE'; end if;

  -- replay: the same payload under the same idempotency key replays; an explicit null pizzaMode equals the absent key
  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,0,save_catalog,'MXN',payload) s;
  if save_status<>'replayed' then raise exception 'PIZZA_V2_SAVE_REPLAY_%',save_status; end if;
  save_event := gen_random_uuid(); save_key := gen_random_uuid(); save_catalog := gen_random_uuid();
  select s.status into save_status from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,1,save_catalog,'MXN',
    pg_catalog.jsonb_set(payload,'{products,1}',(payload#>'{products,1}')||pg_catalog.jsonb_build_object('pizzaMode',null))) s;
  if save_status<>'saved' then raise exception 'PIZZA_V2_NULL_MODE_SAVE_%',save_status; end if;
  select s.status into save_status from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,1,save_catalog,'MXN',payload) s;
  if save_status<>'replayed' then raise exception 'PIZZA_V2_NULL_MODE_REPLAY_%',save_status; end if;
  execute 'reset role';

  -- rejections: all conflicts, none advances the version (head is at 2)
  for scenario in select value from pg_catalog.jsonb_array_elements(pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('label','v2_keys_without_mode','path','{products,1}',
      'value',(payload#>'{products,1}')||pg_catalog.jsonb_build_object('freeIngredientCount',1)),
    pg_catalog.jsonb_build_object('label','custom_without_base','path','{products,0}',
      'value',(payload#>'{products,0}')||pg_catalog.jsonb_build_object('baseGroupId',null,'defaultIngredientOptionIds',pg_catalog.jsonb_build_array())),
    pg_catalog.jsonb_build_object('label','base_group_unassigned','path','{products,0}',
      'value',(payload#>'{products,0}')||pg_catalog.jsonb_build_object('baseGroupId',sg_other::text)),
    pg_catalog.jsonb_build_object('label','base_group_foreign','path','{products,0}',
      'value',(payload#>'{products,0}')||pg_catalog.jsonb_build_object('baseGroupId',gen_random_uuid()::text)),
    pg_catalog.jsonb_build_object('label','extra_group_foreign','path','{products,0}',
      'value',(payload#>'{products,0}')||pg_catalog.jsonb_build_object('extraGroupIds',pg_catalog.jsonb_build_array(gen_random_uuid()::text))),
    pg_catalog.jsonb_build_object('label','extra_group_unassigned','path','{products,0}',
      'value',(payload#>'{products,0}')||pg_catalog.jsonb_build_object('extraGroupIds',pg_catalog.jsonb_build_array(sg_other::text))),
    pg_catalog.jsonb_build_object('label','base_in_extras','path','{products,0}',
      'value',(payload#>'{products,0}')||pg_catalog.jsonb_build_object('extraGroupIds',pg_catalog.jsonb_build_array(sg_base::text))),
    pg_catalog.jsonb_build_object('label','extra_duplicate','path','{products,0}',
      'value',(payload#>'{products,0}')||pg_catalog.jsonb_build_object('extraGroupIds',pg_catalog.jsonb_build_array(sg_extra::text,sg_extra::text))),
    pg_catalog.jsonb_build_object('label','default_outside_base_group','path','{products,0}',
      'value',(payload#>'{products,0}')||pg_catalog.jsonb_build_object('defaultIngredientOptionIds',pg_catalog.jsonb_build_array(so_x::text))),
    pg_catalog.jsonb_build_object('label','default_unknown_option','path','{products,0}',
      'value',(payload#>'{products,0}')||pg_catalog.jsonb_build_object('defaultIngredientOptionIds',pg_catalog.jsonb_build_array(gen_random_uuid()::text))),
    pg_catalog.jsonb_build_object('label','default_duplicate','path','{products,0}',
      'value',(payload#>'{products,0}')||pg_catalog.jsonb_build_object('defaultIngredientOptionIds',pg_catalog.jsonb_build_array(so_1::text,so_1::text))),
    pg_catalog.jsonb_build_object('label','free_count_over_40','path','{products,0}',
      'value',(payload#>'{products,0}')||pg_catalog.jsonb_build_object('freeIngredientCount',41)),
    pg_catalog.jsonb_build_object('label','free_count_negative','path','{products,0}',
      'value',(payload#>'{products,0}')||pg_catalog.jsonb_build_object('freeIngredientCount',-1)),
    pg_catalog.jsonb_build_object('label','unknown_mode','path','{products,0}',
      'value',(payload#>'{products,0}')||pg_catalog.jsonb_build_object('pizzaMode','mitad')),
    pg_catalog.jsonb_build_object('label','extra_key','path','{products,0}',
      'value',(payload#>'{products,0}')||pg_catalog.jsonb_build_object('unknownKey',1)),
    pg_catalog.jsonb_build_object('label','legacy_fraction_next_to_v2','path','{products,0}',
      'value',(payload#>'{products,0}')||pg_catalog.jsonb_build_object('fraction',pg_catalog.jsonb_build_object(
        'enabled',true,'flavorGroupId',sg_base::text,'extraGroupId',null,'excludableIngredientIds',pg_catalog.jsonb_build_array())))
  )) loop
    execute 'set local role app_api';
    select s.status into save_status from app_private.save_menu_catalog(
      actor,restaurant_a,branch_a,gen_random_uuid(),gen_random_uuid(),device,now_at,2,gen_random_uuid(),'MXN',
      pg_catalog.jsonb_set(payload,(scenario->>'path')::text[],scenario->'value')) s;
    execute 'reset role';
    if save_status<>'conflict' then raise exception 'PIZZA_V2_SAVE_%_%',upper(scenario->>'label'),save_status; end if;
  end loop;
  -- a V2 product with a disabled legacy size setup is fine
  if (select head.version from app.menu_catalog_heads head where head.restaurant_id=restaurant_a)<>2
  then raise exception 'PIZZA_V2_REJECTED_SAVE_ADVANCED_VERSION'; end if;

  -- ---------------------------------------------------------------- 3. confirm fixtures
  insert into app.restaurants(id,name,time_zone) values(restaurant,'rollback-only pizza v2 confirm','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(branch,restaurant,'rollback-only pizza v2 confirm branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values(membership,actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values(membership,'cashier',actor);
  insert into app.menu_catalogs(id,restaurant_id,version,currency,published_by) values(catalog,restaurant,1,'MXN',actor);
  insert into app.menu_categories(restaurant_id,catalog_id,id,name,active,display_order) values(restaurant,catalog,category,'Pizzas',true,1);
  -- the foreign restaurant also owns a V2 product (its own catalog); the confirm restaurant must never read it
  insert into app.menu_catalogs(id,restaurant_id,version,currency,published_by) values(catalog_a,restaurant_a,9,'MXN',actor);
  insert into app.menu_categories(restaurant_id,catalog_id,id,name,active,display_order) values(restaurant_a,catalog_a,category_a,'Ajena',true,1);
  insert into app.menu_products(
    restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor,
    fraction_enabled,fraction_flavor_group_id,fraction_extra_group_id,fraction_excludable_ingredient_ids,
    pizza_mode,free_ingredient_count,base_group_id,default_ingredient_option_ids,customize_at_order,extra_group_ids
  ) values
    (restaurant_a,catalog_a,foreign_product,category_a,'Pizza ajena',null,true,1,'kitchen','piece',1000,false,null,null,array[]::text[],
      'custom',0,gen_random_uuid(),array[]::uuid[],false,array[]::uuid[]);
  insert into app.menu_products(
    restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor,
    fraction_enabled,fraction_flavor_group_id,fraction_extra_group_id,fraction_excludable_ingredient_ids,
    pizza_mode,free_ingredient_count,base_group_id,default_ingredient_option_ids,customize_at_order,extra_group_ids
  ) values
    (restaurant,catalog,p1,category,'Pizza armada chica',null,true,1,'kitchen','piece',1000,false,null,null,array[]::text[],
      'custom',1,g_base,array[]::uuid[],false,array[g_extra]),
    (restaurant,catalog,p2,category,'Pizza armada grande',null,true,2,'kitchen','piece',1200,false,null,null,array[]::text[],
      'custom',2,g_base,array[]::uuid[],false,array[g_extra]),
    (restaurant,catalog,spec,category,'Hawaiana',null,true,3,'kitchen','piece',1500,false,null,null,array[]::text[],
      'specialty',0,g_base,array[o_a],true,array[g_extra]),
    (restaurant,catalog,spec_locked,category,'Pepperoni',null,true,4,'kitchen','piece',1400,false,null,null,array[]::text[],
      'specialty',0,g_base,array[o_a],false,array[g_extra]),
    (restaurant,catalog,p3,category,'Armada X',null,true,5,'kitchen','piece',1000,false,null,null,array[]::text[],
      'custom',0,g_bx,array[]::uuid[],false,array[]::uuid[]),
    (restaurant,catalog,p4,category,'Armada Y',null,true,6,'kitchen','piece',1000,false,null,null,array[]::text[],
      'custom',0,g_by,array[]::uuid[],false,array[]::uuid[]),
    (restaurant,catalog,p_legacy,category,'Refresco',null,true,7,'bar','piece',100,false,null,null,array[]::text[],
      null,0,null,array[]::uuid[],false,array[]::uuid[]);
  -- pv: one product with two sizes; pt1/pt2: identical products except pt2 carries a tax configuration
  insert into app.menu_products(
    restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor,
    fraction_enabled,fraction_flavor_group_id,fraction_extra_group_id,fraction_excludable_ingredient_ids,
    pizza_mode,free_ingredient_count,base_group_id,default_ingredient_option_ids,customize_at_order,extra_group_ids
  ) values
    (restaurant,catalog,pv,category,'Armada con tamanos',null,true,9,'kitchen','piece',1000,false,null,null,array[]::text[],
      'custom',0,g_base,array[]::uuid[],false,array[g_extra]),
    (restaurant,catalog,pt1,category,'Armada sin impuesto',null,true,10,'kitchen','piece',1000,false,null,null,array[]::text[],
      'custom',0,g_base,array[]::uuid[],false,array[g_extra]);
  insert into app.menu_products(
    restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor,
    tax_id,tax_name,tax_rule_version,tax_rate_numerator,tax_rate_denominator,tax_inclusion,
    fraction_enabled,fraction_flavor_group_id,fraction_extra_group_id,fraction_excludable_ingredient_ids,
    pizza_mode,free_ingredient_count,base_group_id,default_ingredient_option_ids,customize_at_order,extra_group_ids
  ) values
    (restaurant,catalog,pt2,category,'Armada con impuesto',null,true,11,'kitchen','piece',1000,
      'iva','IVA','mx-2026',16,100,'included',false,null,null,array[]::text[],
      'custom',0,g_base,array[]::uuid[],false,array[g_extra]);
  insert into app.menu_product_variants(restaurant_id,catalog_id,product_id,id,name,sku,unit_price_minor,active,display_order) values
    (restaurant,catalog,pv,v_small,'Chica',null,1000,true,0),
    (restaurant,catalog,pv,v_large,'Grande',null,1200,true,1);
  -- pq: ingredients must be 1..2 per half, extras at most 1 per half
  insert into app.menu_products(
    restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor,
    fraction_enabled,fraction_flavor_group_id,fraction_extra_group_id,fraction_excludable_ingredient_ids,
    pizza_mode,free_ingredient_count,base_group_id,default_ingredient_option_ids,customize_at_order,extra_group_ids
  ) values
    (restaurant,catalog,pq,category,'Armada acotada',null,true,8,'kitchen','piece',1000,false,null,null,array[]::text[],
      'custom',0,g_min,array[]::uuid[],false,array[g_xmax]);
  insert into app.menu_modifier_groups(
    restaurant_id,catalog_id,id,product_id,name,active,display_order,minimum_quantity,maximum_quantity
  ) values
    (restaurant,catalog,g_min,null,'Ingredientes acotados',true,4,1,2),
    (restaurant,catalog,g_xmax,null,'Extras acotados',true,5,0,1),
    (restaurant,catalog,g_base,null,'Ingredientes',true,0,0,40),
    (restaurant,catalog,g_extra,null,'Extras',true,1,0,10),
    (restaurant,catalog,g_bx,null,'Ingredientes X',true,2,0,40),
    (restaurant,catalog,g_by,null,'Ingredientes Y',true,3,0,40);
  insert into app.menu_product_modifier_groups(restaurant_id,catalog_id,product_id,group_id,display_order) values
    (restaurant,catalog,p1,g_base,0),(restaurant,catalog,p1,g_extra,1),
    (restaurant,catalog,p2,g_base,0),(restaurant,catalog,p2,g_extra,1),
    (restaurant,catalog,spec,g_base,0),(restaurant,catalog,spec,g_extra,1),
    (restaurant,catalog,spec_locked,g_base,0),(restaurant,catalog,spec_locked,g_extra,1),
    (restaurant,catalog,p3,g_bx,0),(restaurant,catalog,p4,g_by,0),
    (restaurant,catalog,pq,g_min,0),(restaurant,catalog,pq,g_xmax,1);
  insert into app.menu_modifier_options(restaurant_id,catalog_id,group_id,id,name,unit_price_minor,active) values
    (restaurant,catalog,g_base,o_a,'Ing A',100,true),
    (restaurant,catalog,g_base,o_b,'Ing B',200,true),
    (restaurant,catalog,g_base,o_c,'Ing C',300,true),
    (restaurant,catalog,g_extra,o_e,'Extra E',75,true),
    (restaurant,catalog,g_bx,o_conf,'Ing conflicto',100,true),
    (restaurant,catalog,g_by,o_conf,'Ing conflicto',101,true),
    (restaurant,catalog,g_min,m1,'Min 1',100,true),
    (restaurant,catalog,g_min,m2,'Min 2',200,true),
    (restaurant,catalog,g_min,m3,'Min 3',300,true),
    (restaurant,catalog,g_xmax,x1,'Extra 1',60,true),
    (restaurant,catalog,g_xmax,x2,'Extra 2',80,true);
  insert into app.menu_catalog_heads(restaurant_id,catalog_id,version,updated_at,updated_by) values(restaurant,catalog,1,now_at,actor);
  insert into app.operational_shifts(id,restaurant_id,branch_id,name,status,opened_at,opened_by)
    values(shift,restaurant,branch,'rollback pizza v2 confirmation','open',now_at-interval '1 minute',actor);

  -- table CHECKs (each insert must fail; the nested block rolls the failed insert back)
  for scenario in select value from pg_catalog.jsonb_array_elements(pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('label','legacy_with_free_count','mode',null,'free',3,'base',null,'defaults','{}','extras','{}','custom_at',false),
    pg_catalog.jsonb_build_object('label','legacy_with_base','mode',null,'free',0,'base',g_base,'defaults','{}','extras','{}','custom_at',false),
    pg_catalog.jsonb_build_object('label','legacy_with_customize','mode',null,'free',0,'base',null,'defaults','{}','extras','{}','custom_at',true),
    pg_catalog.jsonb_build_object('label','custom_without_base','mode','custom','free',0,'base',null,'defaults','{}','extras','{}','custom_at',false),
    pg_catalog.jsonb_build_object('label','unknown_mode','mode','x','free',0,'base',g_base,'defaults','{}','extras','{}','custom_at',false),
    pg_catalog.jsonb_build_object('label','free_over_40','mode','custom','free',41,'base',g_base,'defaults','{}','extras','{}','custom_at',false),
    pg_catalog.jsonb_build_object('label','base_in_extras','mode','custom','free',0,'base',g_base,'defaults','{}','extras',pg_catalog.jsonb_build_array(g_base),'custom_at',false),
    pg_catalog.jsonb_build_object('label','duplicate_defaults','mode','custom','free',0,'base',g_base,'defaults',pg_catalog.jsonb_build_array(o_a,o_a),'extras','{}','custom_at',false),
    pg_catalog.jsonb_build_object('label','defaults_without_base','mode','specialty','free',0,'base',null,'defaults',pg_catalog.jsonb_build_array(o_a),'extras','{}','custom_at',false)
  )) loop
    begin
      insert into app.menu_products(
        restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor,
        fraction_enabled,fraction_flavor_group_id,fraction_extra_group_id,fraction_excludable_ingredient_ids,
        pizza_mode,free_ingredient_count,base_group_id,default_ingredient_option_ids,customize_at_order,extra_group_ids
      ) values (
        restaurant,catalog,gen_random_uuid(),category,'check',null,true,50,'kitchen','piece',1,false,null,null,array[]::text[],
        scenario->>'mode',(scenario->>'free')::integer,(scenario->>'base')::uuid,
        coalesce((select array_agg(value::uuid) from pg_catalog.jsonb_array_elements_text(
          case when pg_catalog.jsonb_typeof(scenario->'defaults')='array' then scenario->'defaults' else '[]'::jsonb end) value),array[]::uuid[]),
        (scenario->>'custom_at')::boolean,
        coalesce((select array_agg(value::uuid) from pg_catalog.jsonb_array_elements_text(
          case when pg_catalog.jsonb_typeof(scenario->'extras')='array' then scenario->'extras' else '[]'::jsonb end) value),array[]::uuid[])
      );
      raise exception 'PIZZA_V2_CHECK_NOT_ENFORCED_%',upper(scenario->>'label');
    exception when check_violation then null;
    end;
  end loop;

  -- ---------------------------------------------------------------- 4. plan rejections with explicit reasons
  target_capture := gen_random_uuid();
  execute 'set local role app_api';
  created := app_private.create_capture_draft(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',target_capture::text,'expectedVersion',0,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,'occurredAt',stamp,
    'sourceChannel','phone','fulfillmentChannel','counter'));
  execute 'reset role';
  if created->>'status'<>'applied' then raise exception 'PIZZA_V2_CREATE_REJECTED_%',created->>'status'; end if;
  lease := created#>>'{record,detail,attentionLeaseId}';
  command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',target_capture::text,'expectedVersion',1,'attentionLeaseId',lease,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,'occurredAt',stamp);
  line_id := gen_random_uuid();
  pizza_line := pg_catalog.jsonb_build_object(
    'lineId',line_id::text,'productId',p1::text,'variantId',null,'quantity',1,'note',null,'modifierGroups','[]'::jsonb,
    'pizza',pg_catalog.jsonb_build_object('ruleVersion','pizza-halves-v2','halves',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('fraction','half-a','productId',p1::text,'variantId',null,
        'ingredientOptionIds',pg_catalog.jsonb_build_array(o_a::text),'extraOptionIds','[]'::jsonb,'removedIngredientOptionIds','[]'::jsonb),
      pg_catalog.jsonb_build_object('fraction','half-b','productId',p2::text,'variantId',null,
        'ingredientOptionIds','[]'::jsonb,'extraOptionIds','[]'::jsonb,'removedIngredientOptionIds','[]'::jsonb))));
  for scenario in select value from pg_catalog.jsonb_array_elements(pg_catalog.jsonb_build_array(
    -- a plan schemaVersion 1 cannot carry a pizza line (a legacy client cannot store a V2 selection)
    pg_catalog.jsonb_build_object('label','v1_plan_with_pizza','plan_version',1,'line',pizza_line),
    pg_catalog.jsonb_build_object('label','rule_v1','plan_version',2,'reason','rule_version_legacy',
      'line',pg_catalog.jsonb_set(pizza_line,'{pizza,ruleVersion}','"pizza-halves-v1"')),
    pg_catalog.jsonb_build_object('label','rule_unknown','plan_version',2,'reason','rule_version_unknown',
      'line',pg_catalog.jsonb_set(pizza_line,'{pizza,ruleVersion}','"pizza-halves-v9"')),
    pg_catalog.jsonb_build_object('label','pizza_and_fraction','plan_version',2,
      'line',pizza_line||pg_catalog.jsonb_build_object('fraction',pg_catalog.jsonb_build_object('geometry','halves','slots','[]'::jsonb))),
    pg_catalog.jsonb_build_object('label','pizza_extra_key','plan_version',2,
      'line',pg_catalog.jsonb_set(pizza_line,'{pizza,halves,0}',(pizza_line#>'{pizza,halves,0}')||pg_catalog.jsonb_build_object('x',1))),
    pg_catalog.jsonb_build_object('label','pizza_one_half','plan_version',2,
      'line',pg_catalog.jsonb_set(pizza_line,'{pizza,halves}',pg_catalog.jsonb_build_array(pizza_line#>'{pizza,halves,0}'))),
    pg_catalog.jsonb_build_object('label','pizza_line_product_not_half_a','plan_version',2,
      'line',pg_catalog.jsonb_set(pizza_line,'{productId}',pg_catalog.to_jsonb(p2::text))),
    pg_catalog.jsonb_build_object('label','pizza_bad_option_id','plan_version',2,
      'line',pg_catalog.jsonb_set(pizza_line,'{pizza,halves,0,ingredientOptionIds}','["not-a-uuid"]'::jsonb)),
    -- the legacy selection with two custom halves keeps being rejected, now with an explicit reason
    pg_catalog.jsonb_build_object('label','legacy_both_custom','plan_version',1,'reason','fraction_both_custom',
      'line',pg_catalog.jsonb_build_object(
        'lineId',line_id::text,'productId',p1::text,'variantId',null,'quantity',1,'note',null,'modifierGroups','[]'::jsonb,
        'fraction',pg_catalog.jsonb_build_object('geometry','halves','slots',pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('fraction','half-a','flavorOptionId',null,'extraOptionIds','[]'::jsonb,'excludedIngredientIds','[]'::jsonb),
          pg_catalog.jsonb_build_object('fraction','half-b','flavorOptionId',null,'extraOptionIds','[]'::jsonb,'excludedIngredientIds','[]'::jsonb)))))
  )) loop
    execute 'set local role app_api';
    result := app_private.replace_capture_selection_plan(actor,command,pg_catalog.jsonb_build_object(
      'schemaVersion',(scenario->>'plan_version')::integer,'catalogVersion',catalog::text,
      'lines',pg_catalog.jsonb_build_array(scenario->'line')));
    execute 'reset role';
    if result->>'status'<>'rejected' or result->>'reason' is distinct from scenario->>'reason' then
      raise exception 'PIZZA_V2_PLAN_%_%',upper(scenario->>'label'),result::text;
    end if;
  end loop;
  -- nothing was stored by the rejected plans
  if exists (select 1 from app.capture_repeat_order_plans where restaurant_id=restaurant and branch_id=branch and capture_draft_id=target_capture)
    or exists (select 1 from app.capture_command_events where restaurant_id=restaurant and branch_id=branch
      and capture_draft_id=target_capture and operation='capture.selection_replaced')
  then raise exception 'PIZZA_V2_REJECTED_PLAN_STORED'; end if;
  -- the V2 plan is accepted, replays through the command journal, and conflicts if the same key carries another plan
  plan := pg_catalog.jsonb_build_object('schemaVersion',2,'catalogVersion',catalog::text,'lines',pg_catalog.jsonb_build_array(pizza_line));
  execute 'set local role app_api';
  result := app_private.replace_capture_selection_plan(actor,command,plan);
  replay := app_private.replace_capture_selection_plan(actor,command,plan);
  execute 'reset role';
  if result->>'status'<>'applied' then raise exception 'PIZZA_V2_PLAN_APPLY_%',result::text; end if;
  if replay->>'status'<>'replayed' or replay->'record' is distinct from result->'record' then
    raise exception 'PIZZA_V2_PLAN_REPLAY_%',replay::text;
  end if;
  execute 'set local role app_api';
  replay := app_private.replace_capture_selection_plan(actor,command,pg_catalog.jsonb_set(plan,'{lines,0,quantity}','2'::jsonb));
  execute 'reset role';
  if replay->>'status'<>'conflict' then raise exception 'PIZZA_V2_PLAN_KEY_REUSE_%',replay::text; end if;
  if (select pg_catalog.count(*) from app.capture_command_events where restaurant_id=restaurant and branch_id=branch
      and capture_draft_id=target_capture and operation='capture.selection_replaced')<>1
    or (select selection_plan from app.capture_repeat_order_plans where restaurant_id=restaurant and branch_id=branch
      and capture_draft_id=target_capture) is distinct from plan
  then raise exception 'PIZZA_V2_PLAN_JOURNAL'; end if;

  -- ---------------------------------------------------------------- 5. confirm: price from the catalog, frozen snapshot
  scenarios := pg_catalog.jsonb_build_array(
    -- custom 1000/N=1 + custom 1200/N=2; A in half-a, B in half-b, C in both: N=2 frees A and B, C costs 300 -> 1500
    pg_catalog.jsonb_build_object('label','custom_pair_ok','expect','applied','total',1500,'free_order',pg_catalog.jsonb_build_array(o_a,o_b),
      'a',pg_catalog.jsonb_build_object('product',p1,'ing',pg_catalog.jsonb_build_array(o_a,o_c),'extra','[]'::jsonb,'removed','[]'::jsonb),
      'b',pg_catalog.jsonb_build_object('product',p2,'ing',pg_catalog.jsonb_build_array(o_b,o_c),'extra','[]'::jsonb,'removed','[]'::jsonb)),
    -- specialty 1500 (recipe A removed) + custom 1000/N=1 with A free, B at half (100) and extra E at half (38) -> 1638
    pg_catalog.jsonb_build_object('label','mixed_with_extra_and_removal_ok','expect','applied','total',1638,'free_order',pg_catalog.jsonb_build_array(o_a),
      'a',pg_catalog.jsonb_build_object('product',spec,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed',pg_catalog.jsonb_build_array(o_a)),
      'b',pg_catalog.jsonb_build_object('product',p1,'ing',pg_catalog.jsonb_build_array(o_a,o_b),'extra',pg_catalog.jsonb_build_array(o_e),'removed','[]'::jsonb),
      'removal_mods',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('fraction','half-a','optionId',o_a,'name','Ing A'))),
    -- two specialties: the greater base price wins and nothing else is charged
    pg_catalog.jsonb_build_object('label','two_specialties_ok','expect','applied','total',1500,'free_order','[]'::jsonb,
      'a',pg_catalog.jsonb_build_object('product',spec_locked,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb),
      'b',pg_catalog.jsonb_build_object('product',spec,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb)),
    -- vector 10 end to end: the same optionId priced 100 in one base group and 101 in the other
    pg_catalog.jsonb_build_object('label','price_conflict_between_halves','expect','conflict','reason','pizza_ingredient_price_conflict',
      'a',pg_catalog.jsonb_build_object('product',p3,'ing',pg_catalog.jsonb_build_array(o_conf),'extra','[]'::jsonb,'removed','[]'::jsonb),
      'b',pg_catalog.jsonb_build_object('product',p4,'ing',pg_catalog.jsonb_build_array(o_conf),'extra','[]'::jsonb,'removed','[]'::jsonb)),
    -- a specialty that does not allow editing at order time cannot take extras or removals
    pg_catalog.jsonb_build_object('label','locked_specialty_extra','expect','conflict',
      'a',pg_catalog.jsonb_build_object('product',spec_locked,'ing','[]'::jsonb,'extra',pg_catalog.jsonb_build_array(o_e),'removed','[]'::jsonb),
      'b',pg_catalog.jsonb_build_object('product',p1,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb)),
    pg_catalog.jsonb_build_object('label','locked_specialty_removal','expect','conflict',
      'a',pg_catalog.jsonb_build_object('product',spec_locked,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed',pg_catalog.jsonb_build_array(o_a)),
      'b',pg_catalog.jsonb_build_object('product',p1,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb)),
    -- removing something that is not part of the product's recipe
    pg_catalog.jsonb_build_object('label','removal_outside_recipe','expect','conflict',
      'a',pg_catalog.jsonb_build_object('product',spec,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed',pg_catalog.jsonb_build_array(o_b)),
      'b',pg_catalog.jsonb_build_object('product',p1,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb)),
    -- an ingredient of the extra group is not a base ingredient; an unknown option; the same option twice
    pg_catalog.jsonb_build_object('label','ingredient_outside_base_group','expect','conflict',
      'a',pg_catalog.jsonb_build_object('product',p1,'ing',pg_catalog.jsonb_build_array(o_e),'extra','[]'::jsonb,'removed','[]'::jsonb),
      'b',pg_catalog.jsonb_build_object('product',p2,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb)),
    pg_catalog.jsonb_build_object('label','ingredient_unknown','expect','conflict',
      'a',pg_catalog.jsonb_build_object('product',p1,'ing',pg_catalog.jsonb_build_array(gen_random_uuid()),'extra','[]'::jsonb,'removed','[]'::jsonb),
      'b',pg_catalog.jsonb_build_object('product',p2,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb)),
    pg_catalog.jsonb_build_object('label','ingredient_duplicated','expect','conflict','reason','option_duplicate',
      'a',pg_catalog.jsonb_build_object('product',p1,'ing',pg_catalog.jsonb_build_array(o_a,o_a),'extra','[]'::jsonb,'removed','[]'::jsonb),
      'b',pg_catalog.jsonb_build_object('product',p2,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb)),
    -- a half that is not a V2 product, an unknown product, and a product of another restaurant: the plan
    -- is refused at replace time (pizza_quantities_valid returns false for a missing product/base group)
    pg_catalog.jsonb_build_object('label','half_is_legacy_product','expect','plan_conflict',
      'a',pg_catalog.jsonb_build_object('product',p1,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb),
      'b',pg_catalog.jsonb_build_object('product',p_legacy,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb)),
    pg_catalog.jsonb_build_object('label','half_unknown_product','expect','plan_conflict',
      'a',pg_catalog.jsonb_build_object('product',p1,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb),
      'b',pg_catalog.jsonb_build_object('product',gen_random_uuid(),'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb)),
    pg_catalog.jsonb_build_object('label','half_of_other_restaurant','expect','plan_conflict',
      'a',pg_catalog.jsonb_build_object('product',p1,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb),
      'b',pg_catalog.jsonb_build_object('product',foreign_product,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb)),
    pg_catalog.jsonb_build_object('label','line_product_of_other_restaurant','expect','plan_conflict',
      'a',pg_catalog.jsonb_build_object('product',foreign_product,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb),
      'b',pg_catalog.jsonb_build_object('product',p1,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb)),
    -- min/max of the pizza groups, per half: ingredients 1..2, extras 0..1 (the plan is refused at replace time)
    pg_catalog.jsonb_build_object('label','quantities_ok','expect','applied','total',1150,'free_order','[]'::jsonb,
      'a',pg_catalog.jsonb_build_object('product',pq,'ing',pg_catalog.jsonb_build_array(m1),'extra','[]'::jsonb,'removed','[]'::jsonb),
      'b',pg_catalog.jsonb_build_object('product',pq,'ing',pg_catalog.jsonb_build_array(m2),'extra','[]'::jsonb,'removed','[]'::jsonb)),
    pg_catalog.jsonb_build_object('label','half_a_below_minimum','expect','plan_conflict',
      'a',pg_catalog.jsonb_build_object('product',pq,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb),
      'b',pg_catalog.jsonb_build_object('product',pq,'ing',pg_catalog.jsonb_build_array(m2),'extra','[]'::jsonb,'removed','[]'::jsonb)),
    pg_catalog.jsonb_build_object('label','half_b_below_minimum','expect','plan_conflict',
      'a',pg_catalog.jsonb_build_object('product',pq,'ing',pg_catalog.jsonb_build_array(m1),'extra','[]'::jsonb,'removed','[]'::jsonb),
      'b',pg_catalog.jsonb_build_object('product',pq,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb)),
    pg_catalog.jsonb_build_object('label','half_a_above_maximum','expect','plan_conflict',
      'a',pg_catalog.jsonb_build_object('product',pq,'ing',pg_catalog.jsonb_build_array(m1,m2,m3),'extra','[]'::jsonb,'removed','[]'::jsonb),
      'b',pg_catalog.jsonb_build_object('product',pq,'ing',pg_catalog.jsonb_build_array(m1),'extra','[]'::jsonb,'removed','[]'::jsonb)),
    pg_catalog.jsonb_build_object('label','half_b_above_maximum','expect','plan_conflict',
      'a',pg_catalog.jsonb_build_object('product',pq,'ing',pg_catalog.jsonb_build_array(m1),'extra','[]'::jsonb,'removed','[]'::jsonb),
      'b',pg_catalog.jsonb_build_object('product',pq,'ing',pg_catalog.jsonb_build_array(m1,m2,m3),'extra','[]'::jsonb,'removed','[]'::jsonb)),
    pg_catalog.jsonb_build_object('label','half_a_extras_above_maximum','expect','plan_conflict',
      'a',pg_catalog.jsonb_build_object('product',pq,'ing',pg_catalog.jsonb_build_array(m1),'extra',pg_catalog.jsonb_build_array(x1,x2),'removed','[]'::jsonb),
      'b',pg_catalog.jsonb_build_object('product',pq,'ing',pg_catalog.jsonb_build_array(m1),'extra','[]'::jsonb,'removed','[]'::jsonb)),
    pg_catalog.jsonb_build_object('label','half_b_extras_above_maximum','expect','plan_conflict',
      'a',pg_catalog.jsonb_build_object('product',pq,'ing',pg_catalog.jsonb_build_array(m1),'extra','[]'::jsonb,'removed','[]'::jsonb),
      'b',pg_catalog.jsonb_build_object('product',pq,'ing',pg_catalog.jsonb_build_array(m1),'extra',pg_catalog.jsonb_build_array(x1,x2),'removed','[]'::jsonb)),
    -- both halves of one pizza share size and fiscal treatment: same product with two sizes, and two
    -- products whose tax configuration differs, are conflicts at confirm
    pg_catalog.jsonb_build_object('label','halves_different_size','expect','conflict','a_variant',v_small,'b_variant',v_large,
      'a',pg_catalog.jsonb_build_object('product',pv,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb),
      'b',pg_catalog.jsonb_build_object('product',pv,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb)),
    pg_catalog.jsonb_build_object('label','halves_different_tax','expect','conflict',
      'a',pg_catalog.jsonb_build_object('product',pt1,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb),
      'b',pg_catalog.jsonb_build_object('product',pt2,'ing','[]'::jsonb,'extra','[]'::jsonb,'removed','[]'::jsonb)),
    -- the client sent a wrong frozen snapshot for an otherwise valid line
    pg_catalog.jsonb_build_object('label','tampered_total','expect','conflict','tamper',true,
      'a',pg_catalog.jsonb_build_object('product',p1,'ing',pg_catalog.jsonb_build_array(o_a),'extra','[]'::jsonb,'removed','[]'::jsonb),
      'b',pg_catalog.jsonb_build_object('product',p2,'ing',pg_catalog.jsonb_build_array(o_b),'extra','[]'::jsonb,'removed','[]'::jsonb))
  );

  for scenario in select value from pg_catalog.jsonb_array_elements(scenarios) loop
    target_capture := gen_random_uuid(); line_id := gen_random_uuid(); confirmed_order := gen_random_uuid();
    confirmation_event := gen_random_uuid(); item_event := gen_random_uuid(); item_id := gen_random_uuid();

    execute 'set local role app_api';
    created := app_private.create_capture_draft(actor,pg_catalog.jsonb_build_object(
      'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
      'captureDraftId',target_capture::text,'expectedVersion',0,'eventId',gen_random_uuid()::text,
      'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,'occurredAt',stamp,
      'sourceChannel','phone','fulfillmentChannel','counter'));
    execute 'reset role';
    if created->>'status'<>'applied' then raise exception 'PIZZA_V2_CREATE_REJECTED_%',upper(scenario->>'label'); end if;
    lease := created#>>'{record,detail,attentionLeaseId}';

    command := pg_catalog.jsonb_build_object(
      'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
      'captureDraftId',target_capture::text,'expectedVersion',1,'attentionLeaseId',lease,
      'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,'occurredAt',stamp);
    pizza_line := pg_catalog.jsonb_build_object(
      'lineId',line_id::text,'productId',scenario#>>'{a,product}','variantId',scenario->'a_variant','quantity',1,'note',null,
      'modifierGroups','[]'::jsonb,
      'pizza',pg_catalog.jsonb_build_object('ruleVersion','pizza-halves-v2','halves',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('fraction','half-a','productId',scenario#>>'{a,product}','variantId',scenario->'a_variant',
          'ingredientOptionIds',scenario#>'{a,ing}','extraOptionIds',scenario#>'{a,extra}',
          'removedIngredientOptionIds',scenario#>'{a,removed}'),
        pg_catalog.jsonb_build_object('fraction','half-b','productId',scenario#>>'{b,product}','variantId',scenario->'b_variant',
          'ingredientOptionIds',scenario#>'{b,ing}','extraOptionIds',scenario#>'{b,extra}',
          'removedIngredientOptionIds',scenario#>'{b,removed}'))));
    plan := pg_catalog.jsonb_build_object('schemaVersion',2,'catalogVersion',catalog::text,'lines',pg_catalog.jsonb_build_array(pizza_line));
    execute 'set local role app_api';
    result := app_private.replace_capture_selection_plan(actor,command,plan);
    execute 'reset role';
    if scenario->>'expect'='plan_conflict' then
      -- the plan builder refuses it against the published release; nothing is stored
      if result->>'status'<>'conflict' or result->>'reason'<>'pizza_quantity_invalid' then
        raise exception 'PIZZA_V2_PLAN_QUANTITY_%_%',upper(scenario->>'label'),result::text;
      end if;
      continue;
    end if;
    if result->>'status'<>'applied' then raise exception 'PIZZA_V2_PLAN_NOT_STORED_%_%',upper(scenario->>'label'),result::text; end if;

    update app.capture_drafts set fulfillment_channel='counter'
    where restaurant_id=restaurant and branch_id=branch and id=target_capture;
    confirmation_command := pg_catalog.jsonb_build_object(
      'schemaVersion',2,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
      'captureDraftId',target_capture::text,'expectedVersion',2,'eventId',confirmation_event::text,
      'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,'occurredAt',stamp,
      'attentionLeaseId',lease,'orderId',confirmed_order::text,'shiftId',shift::text,'tableId',null,
      'currency','MXN','timeZone','America/Hermosillo');
    order_audits := pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'schemaVersion',1,'eventId',confirmation_event::text,'idempotencyKey',confirmation_command->>'idempotencyKey',
        'restaurantId',restaurant::text,'branchId',branch::text,'orderId',confirmed_order::text,'actorId',actor::text,
        'deviceId',device::text,'occurredAt',stamp,'operation','order.created','entityType','order',
        'entityId',confirmed_order::text,'to','draft'),
      pg_catalog.jsonb_build_object(
        'schemaVersion',1,'eventId',item_event::text,'idempotencyKey',gen_random_uuid()::text,
        'restaurantId',restaurant::text,'branchId',branch::text,'orderId',confirmed_order::text,
        'actorId',actor::text,'deviceId',device::text,'occurredAt',stamp,'operation','order.item_added',
        'entityType','order_item','entityId',item_id::text,'orderItemId',item_id::text));

    if scenario->>'expect'='applied' or scenario->>'tamper'='true' then
      -- the client-side snapshot is the versioned rule output of the same inputs (never a client amount the
      -- server accepts on faith: the server recomputes it from the catalog and compares)
      -- rebuild through the catalog builder so names, prices and groups are the stored ones
      pizza_result := app_private.pizza_halves_price_v2(app_private.build_pizza_halves_input_v2(restaurant,catalog,'MXN',pizza_line));
      if pizza_result is null or pizza_result ? 'issues' then raise exception 'PIZZA_V2_BUILDER_%_%',upper(scenario->>'label'),pizza_result::text; end if;
      snap := pg_temp.pizza_snapshot(catalog,(scenario#>>'{a,product}')::uuid,
        (select product.name from app.menu_products product where product.restaurant_id=restaurant and product.catalog_id=catalog
          and product.id=(scenario#>>'{a,product}')::uuid),
        pizza_result,coalesce(scenario->'removal_mods','[]'::jsonb));
      if scenario->>'expect'='applied' then
        -- hard-coded expectations independent of the SQL rule: total, free assignment and line sum
        if (pizza_result#>>'{total,amountMinor}')::bigint<>(scenario->>'total')::bigint
          or pizza_result->'freeAssignmentOrder' is distinct from (select coalesce(pg_catalog.jsonb_agg(value::text::jsonb),'[]'::jsonb)
            from pg_catalog.jsonb_array_elements(scenario->'free_order') value)
          or (snap#>>'{unitPrice,amountMinor}')::bigint+(select coalesce(pg_catalog.sum((modifier.value#>>'{unitPrice,amountMinor}')::bigint),0)
            from pg_catalog.jsonb_array_elements(snap->'modifiers') modifier(value))<>(scenario->>'total')::bigint
        then raise exception 'PIZZA_V2_EXPECTED_TOTAL_%_%',upper(scenario->>'label'),snap::text; end if;
      else
        snap := pg_catalog.jsonb_set(snap,'{unitPrice,amountMinor}','1'::jsonb);
      end if;
    else
      snap := '{}'::jsonb;
    end if;
    order_record := pg_catalog.jsonb_build_object(
      'schemaVersion',1,'orderId',confirmed_order::text,'restaurantId',restaurant::text,'branchId',branch::text,
      'channel','counter','currency','MXN','timeZone','America/Hermosillo','status','draft',
      'items',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'orderItemId',item_id::text,'snapshot',snap,'quantity',1,'restaurantId',restaurant::text,
        'branchId',branch::text,'status','pending','note',null)));

    execute 'set local role app_api';
    result := app_private.confirm_capture_draft_v3(actor,confirmation_command,order_record,order_audits);
    execute 'reset role';
    if result->>'status' is distinct from scenario->>'expect'
      or (scenario->>'reason' is not null and result->>'reason' is distinct from scenario->>'reason')
    then raise exception 'PIZZA_V2_CONFIRM_%_%',upper(scenario->>'label'),result::text; end if;
    if scenario->>'expect'='applied' then
      if not exists (
        select 1 from app.orders placed
        where placed.restaurant_id=restaurant and placed.branch_id=branch and placed.id=confirmed_order
          and placed.aggregate#>'{items,0,snapshot}' = snap
      ) then raise exception 'PIZZA_V2_SNAPSHOT_NOT_PERSISTED_%',upper(scenario->>'label'); end if;
      -- the line sum and the frozen rule output agree, as integers in minor units
      item_sum := (snap#>>'{unitPrice,amountMinor}')::bigint+(select coalesce(pg_catalog.sum((modifier.value#>>'{unitPrice,amountMinor}')::bigint),0)
        from pg_catalog.jsonb_array_elements(snap->'modifiers') modifier(value));
      if item_sum<>(snap#>>'{pizzaHalves,total,amountMinor}')::bigint then raise exception 'PIZZA_V2_LINE_SUM_%',upper(scenario->>'label'); end if;
      -- idempotency: the same confirmation replays the original result and creates no second order
      execute 'set local role app_api';
      replay := app_private.confirm_capture_draft_v3(actor,confirmation_command,order_record,order_audits);
      execute 'reset role';
      if replay->>'status'<>'replayed' or replay->'record' is distinct from result->'record'
        or (select pg_catalog.count(*) from app.orders placed where placed.restaurant_id=restaurant and placed.branch_id=branch
            and placed.id=confirmed_order)<>1
        or (select pg_catalog.count(*) from app.capture_command_events journal where journal.restaurant_id=restaurant
            and journal.branch_id=branch and journal.capture_draft_id=target_capture and journal.operation='capture.confirmed')<>1
      then raise exception 'PIZZA_V2_CONFIRM_REPLAY_%_%',upper(scenario->>'label'),replay::text; end if;
      if scenario->>'label'='custom_pair_ok' then first_order := confirmed_order; first_snap := snap; first_total := (scenario->>'total')::bigint; end if;
    else
      if exists (select 1 from app.orders placed where placed.restaurant_id=restaurant and placed.branch_id=branch and placed.id=confirmed_order)
      then raise exception 'PIZZA_V2_REJECTED_ORDER_PERSISTED_%',upper(scenario->>'label'); end if;
    end if;
  end loop;

  -- ---------------------------------------------------------------- 6. frozen history: repricing the catalog changes nothing
  update app.menu_modifier_options set unit_price_minor=unit_price_minor+7000 where restaurant_id=restaurant and catalog_id=catalog;
  update app.menu_products set unit_price_minor=unit_price_minor+500,free_ingredient_count=0,pizza_mode='specialty'
  where restaurant_id=restaurant and catalog_id=catalog and id in (p1,p2);
  if not exists (
    select 1 from app.orders placed
    where placed.restaurant_id=restaurant and placed.branch_id=branch and placed.id=first_order
      and placed.aggregate#>'{items,0,snapshot}' = first_snap
      and (placed.aggregate#>>'{items,0,snapshot,pizzaHalves,total,amountMinor}')::bigint = first_total
  ) then raise exception 'PIZZA_V2_HISTORY_REPRICED'; end if;
end
$pizza_model_v2_tests$;

commit;
