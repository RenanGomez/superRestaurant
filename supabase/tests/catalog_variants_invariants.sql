-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises 20261006000300_catalog_variants.sql:
--   1. save_menu_catalog / build_menu_catalog_state round-trip the optional per-product `variants`
--      (absent == [], replay normalizes absent vs []), reject duplicate names (case-insensitive),
--      more than 12 variants, malformed variant objects and a viewer without a manager role.
--   2. confirm_capture_draft_v3 revalidates the frozen line price against the catalog variant:
--      correct variant price/id/name/sku applies and is persisted; altered price, dropped or swapped
--      variant, missing variant on a sized product, inactive/unknown/foreign-restaurant variant and
--      a variant on a plain product are all conflicts; a plain product still confirms unchanged.
--   3. table-level invariants: CHECKs, case-insensitive unique name, forced RLS, no API grants.
begin;
do $catalog_variants_tests$
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
  water uuid := gen_random_uuid();
  v_small uuid := gen_random_uuid();
  a_small uuid := gen_random_uuid();
  a_large uuid := gen_random_uuid();
  v_large uuid := gen_random_uuid();
  v_retired uuid := gen_random_uuid();
  v_foreign uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  shift uuid := gen_random_uuid();
  now_at timestamptz := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
  stamp text := pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  save_catalog uuid := gen_random_uuid();
  save_event uuid := gen_random_uuid();
  save_key uuid := gen_random_uuid();
  save_status text;
  save_state jsonb;
  payload jsonb;
  save_product jsonb;
  many jsonb;
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
begin
  if actor is null then raise exception 'CATALOG_VARIANTS_TEST_ACTOR_REQUIRED'; end if;

  -- ---------------------------------------------------------------- 1. save / state / replay
  insert into app.restaurants(id,name,time_zone) values(restaurant_a,'rollback-only variants save','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(branch_a,restaurant_a,'rollback-only variants save branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values(membership_a,actor,restaurant_a,branch_a,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values(membership_a,'manager',actor);

  save_product := pg_catalog.jsonb_build_object(
    'productId',pizza::text,'categoryId',category::text,'name','Pizza','sku',null,'active',true,'displayOrder',0,
    'stationId','kitchen','unit','piece','unitPriceMinor',10000,'tax',null,
    'variants',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('variantId',a_large::text,'name','Grande','unitPriceMinor',20000,'active',true,'displayOrder',1,'sku',null),
      pg_catalog.jsonb_build_object('variantId',a_small::text,'name','Chica','unitPriceMinor',12000,'active',true,'displayOrder',0,'sku','PZ-S')
    )
  );
  payload := pg_catalog.jsonb_build_object(
    'categories',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'categoryId',category::text,'name','Pizzas','active',true,'displayOrder',0)),
    'products',pg_catalog.jsonb_build_array(save_product),
    'modifierGroups',pg_catalog.jsonb_build_array()
  );
  execute 'set local role app_api';
  select s.status,s.state into save_status,save_state from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,0,save_catalog,'MXN',payload) s;
  execute 'reset role';
  if save_status<>'saved' then raise exception 'CATALOG_VARIANTS_SAVE_REJECTED'; end if;
  if save_state#>>'{catalog,products,0,variants,0,variantId}' is distinct from a_small::text
    or save_state#>>'{catalog,products,0,variants,0,unitPriceMinor}' is distinct from '12000'
    or save_state#>>'{catalog,products,0,variants,0,sku}' is distinct from 'PZ-S'
    or save_state#>>'{catalog,products,0,variants,1,variantId}' is distinct from a_large::text
    or save_state#>'{catalog,products,0,variants,1,sku}' is distinct from 'null'::jsonb
    or pg_catalog.jsonb_array_length(save_state#>'{catalog,products,0,variants}')<>2
  then raise exception 'CATALOG_VARIANTS_STATE_MISMATCH'; end if;

  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,0,save_catalog,'MXN',payload) s;
  execute 'reset role';
  if save_status<>'replayed' then raise exception 'CATALOG_VARIANTS_REPLAY_REJECTED'; end if;

  -- Duplicate name, case-insensitively, is a conflict (unique index), and so is >12 variants and a
  -- malformed variant object; none of them may advance the catalog version.
  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,gen_random_uuid(),gen_random_uuid(),device,now_at,1,gen_random_uuid(),'MXN',
    pg_catalog.jsonb_set(payload,'{products,0,variants}',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('variantId',gen_random_uuid()::text,'name','Chica','unitPriceMinor',1,'active',true,'displayOrder',0,'sku',null),
      pg_catalog.jsonb_build_object('variantId',gen_random_uuid()::text,'name','chica','unitPriceMinor',2,'active',true,'displayOrder',1,'sku',null)
    ))) s;
  if save_status<>'conflict' then raise exception 'CATALOG_VARIANTS_DUPLICATE_NAME_ACCEPTED'; end if;

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'variantId',gen_random_uuid()::text,'name','Talla '||n,'unitPriceMinor',1,'active',true,'displayOrder',n,'sku',null))
  into many from pg_catalog.generate_series(1,13) n;
  select s.status into save_status from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,gen_random_uuid(),gen_random_uuid(),device,now_at,1,gen_random_uuid(),'MXN',
    pg_catalog.jsonb_set(payload,'{products,0,variants}',many)) s;
  if save_status<>'conflict' then raise exception 'CATALOG_VARIANTS_TOO_MANY_ACCEPTED'; end if;

  select s.status into save_status from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,gen_random_uuid(),gen_random_uuid(),device,now_at,1,gen_random_uuid(),'MXN',
    pg_catalog.jsonb_set(payload,'{products,0,variants}',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('variantId',gen_random_uuid()::text,'name','Sin precio','active',true,'displayOrder',0,'sku',null)
    ))) s;
  if save_status<>'conflict' then raise exception 'CATALOG_VARIANTS_MALFORMED_ACCEPTED'; end if;

  select s.status into save_status from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,gen_random_uuid(),gen_random_uuid(),device,now_at,1,gen_random_uuid(),'MXN',
    pg_catalog.jsonb_set(payload,'{products,0,variants}',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('variantId',gen_random_uuid()::text,'name','Negativa','unitPriceMinor',-1,'active',true,'displayOrder',0,'sku',null)
    ))) s;
  if save_status<>'conflict' then raise exception 'CATALOG_VARIANTS_NEGATIVE_PRICE_ACCEPTED'; end if;

  select s.status into save_status from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,gen_random_uuid(),gen_random_uuid(),device,now_at,0,gen_random_uuid(),'MXN',payload) s;
  if save_status<>'conflict' then raise exception 'CATALOG_VARIANTS_STALE_VERSION_ACCEPTED'; end if;
  execute 'reset role';
  if (select head.version from app.menu_catalog_heads head where head.restaurant_id=restaurant_a)<>1
  then raise exception 'CATALOG_VARIANTS_REJECTED_SAVE_ADVANCED_VERSION'; end if;

  -- A legacy-shaped save (no `variants` key) and the same retry with `variants: []` are one catalog.
  save_event := gen_random_uuid();
  save_key := gen_random_uuid();
  save_catalog := gen_random_uuid();
  payload := pg_catalog.jsonb_set(payload,'{products,0}',save_product - 'variants');
  execute 'set local role app_api';
  select s.status,s.state into save_status,save_state from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,1,save_catalog,'MXN',payload) s;
  if save_status<>'saved' or save_state#>'{catalog,products,0,variants}' is distinct from '[]'::jsonb
  then raise exception 'CATALOG_VARIANTS_LEGACY_SAVE_REJECTED'; end if;
  select s.status into save_status from app_private.save_menu_catalog(
    actor,restaurant_a,branch_a,save_event,save_key,device,now_at,1,save_catalog,'MXN',
    pg_catalog.jsonb_set(payload,'{products,0}',(payload#>'{products,0}')||'{"variants":[]}'::jsonb)) s;
  if save_status<>'replayed' then raise exception 'CATALOG_VARIANTS_EMPTY_ARRAY_REPLAY_REJECTED'; end if;
  execute 'reset role';

  -- A foreign viewer (no manager grant in that restaurant) is forbidden.
  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(
    gen_random_uuid(),restaurant_a,branch_a,gen_random_uuid(),gen_random_uuid(),device,now_at,2,gen_random_uuid(),'MXN',payload) s;
  execute 'reset role';
  if save_status<>'forbidden' then raise exception 'CATALOG_VARIANTS_FOREIGN_ACTOR_ACCEPTED'; end if;

  -- ---------------------------------------------------------------- 2. confirm_capture_draft_v3
  insert into app.restaurants(id,name,time_zone) values(restaurant,'rollback-only variants confirm','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(branch,restaurant,'rollback-only variants branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values(membership,actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values(membership,'cashier',actor);

  insert into app.menu_catalogs(id,restaurant_id,version,currency,published_by) values(catalog,restaurant,1,'MXN',actor);
  insert into app.menu_categories(restaurant_id,catalog_id,id,name,active,display_order)
    values(restaurant,catalog,category,'Comida',true,1);
  insert into app.menu_products(
    restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor
  ) values
    (restaurant,catalog,pizza,category,'Pizza','PZ-BASE',true,1,'kitchen','piece',10000),
    (restaurant,catalog,water,category,'Agua','AGUA',true,2,'kitchen','piece',2500);
  insert into app.menu_product_variants(
    restaurant_id,catalog_id,product_id,id,name,sku,unit_price_minor,active,display_order
  ) values
    (restaurant,catalog,pizza,v_small,'Chica','PZ-S',12000,true,0),
    (restaurant,catalog,pizza,v_large,'Grande',null,20000,true,1),
    (restaurant,catalog,pizza,v_retired,'Gigante',null,30000,false,2);
  insert into app.menu_catalog_heads(restaurant_id,catalog_id,version,updated_at,updated_by)
    values(restaurant,catalog,1,now_at,actor);
  insert into app.operational_shifts(id,restaurant_id,branch_id,name,status,opened_at,opened_by)
    values(shift,restaurant,branch,'rollback variants confirmation','open',now_at-interval '1 minute',actor);

  scenarios := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('label','small_ok','product',pizza,'pname','Pizza','plan',v_small,'unit',12000,'sku','PZ-S','vid',v_small,'vname','Chica','expect','applied'),
    pg_catalog.jsonb_build_object('label','large_ok_product_sku','product',pizza,'pname','Pizza','plan',v_large,'unit',20000,'sku','PZ-BASE','vid',v_large,'vname','Grande','expect','applied'),
    pg_catalog.jsonb_build_object('label','altered_price','product',pizza,'pname','Pizza','plan',v_small,'unit',10000,'sku','PZ-S','vid',v_small,'vname','Chica','expect','conflict'),
    pg_catalog.jsonb_build_object('label','variant_keys_dropped','product',pizza,'pname','Pizza','plan',v_small,'unit',12000,'sku','PZ-S','vid',null,'vname',null,'expect','conflict'),
    pg_catalog.jsonb_build_object('label','variant_swapped','product',pizza,'pname','Pizza','plan',v_small,'unit',20000,'sku','PZ-BASE','vid',v_large,'vname','Grande','expect','conflict'),
    pg_catalog.jsonb_build_object('label','sized_without_variant','product',pizza,'pname','Pizza','plan',null,'unit',10000,'sku','PZ-BASE','vid',null,'vname',null,'expect','conflict'),
    pg_catalog.jsonb_build_object('label','inactive_variant','product',pizza,'pname','Pizza','plan',v_retired,'unit',30000,'sku','PZ-BASE','vid',v_retired,'vname','Gigante','expect','conflict'),
    pg_catalog.jsonb_build_object('label','unknown_variant','product',pizza,'pname','Pizza','plan',gen_random_uuid(),'unit',12000,'sku','PZ-S','vid',v_small,'vname','Chica','expect','conflict'),
    pg_catalog.jsonb_build_object('label','foreign_restaurant_variant','product',pizza,'pname','Pizza','plan',v_foreign,'unit',12000,'sku','PZ-S','vid',v_small,'vname','Chica','expect','conflict'),
    pg_catalog.jsonb_build_object('label','variant_on_plain_product','product',water,'pname','Agua','plan',v_small,'unit',12000,'sku','PZ-S','vid',v_small,'vname','Chica','expect','conflict'),
    pg_catalog.jsonb_build_object('label','plain_product_ok','product',water,'pname','Agua','plan',null,'unit',2500,'sku','AGUA','vid',null,'vname',null,'expect','applied')
  );

  -- v_foreign is a real variant of ANOTHER restaurant's catalog (the one saved in part 1).
  select variant.id into v_foreign from app.menu_product_variants variant
  where variant.restaurant_id=restaurant_a and variant.product_id=pizza and variant.name='Chica' limit 1;
  if v_foreign is null then raise exception 'CATALOG_VARIANTS_FOREIGN_FIXTURE_MISSING'; end if;
  scenarios := (
    select pg_catalog.jsonb_agg(case when entry.value->>'label'='foreign_restaurant_variant'
      then pg_catalog.jsonb_set(entry.value,'{plan}',pg_catalog.to_jsonb(v_foreign::text)) else entry.value end order by entry.ordinality)
    from pg_catalog.jsonb_array_elements(scenarios) with ordinality entry(value,ordinality)
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
    if created->>'status'<>'applied' then raise exception 'CATALOG_VARIANTS_CREATE_REJECTED'; end if;
    lease := created#>>'{record,detail,attentionLeaseId}';

    command := pg_catalog.jsonb_build_object(
      'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
      'captureDraftId',target_capture::text,'expectedVersion',1,'attentionLeaseId',lease,
      'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,'occurredAt',stamp
    );
    plan := pg_catalog.jsonb_build_object(
      'schemaVersion',1,'catalogVersion',catalog::text,'lines',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'lineId',line_id::text,'productId',scenario->>'product','variantId',scenario->'plan','quantity',1,'note',null,
          'modifierGroups',pg_catalog.jsonb_build_array()
        )
      )
    );
    execute 'set local role app_api';
    result := app_private.replace_capture_selection_plan(actor,command,plan);
    execute 'reset role';
    if result->>'status'<>'applied' then raise exception 'CATALOG_VARIANTS_PLAN_APPLY_REJECTED'; end if;

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
      'catalogVersion',catalog::text,'productId',scenario->>'product','name',scenario->>'pname',
      'stationId','kitchen','unit','piece',
      'unitPrice',pg_catalog.jsonb_build_object('amountMinor',(scenario->>'unit')::bigint,'currency','MXN'),
      'modifiers',pg_catalog.jsonb_build_array()
    );
    if scenario->>'sku' is not null then snap := snap||pg_catalog.jsonb_build_object('sku',scenario->>'sku'); end if;
    if scenario->>'vid' is not null then
      snap := snap||pg_catalog.jsonb_build_object('variantId',scenario->>'vid','variantName',scenario->>'vname');
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
      raise exception 'CATALOG_VARIANTS_CONFIRM_SCENARIO_%',upper(scenario->>'label');
    end if;
    if scenario->>'expect'='applied' and not exists (
      select 1 from app.orders placed
      where placed.restaurant_id=restaurant and placed.branch_id=branch and placed.id=confirmed_order
        and placed.aggregate#>'{items,0,snapshot}' = snap
    ) then raise exception 'CATALOG_VARIANTS_SNAPSHOT_NOT_PERSISTED'; end if;
    if scenario->>'expect'<>'applied' and exists (
      select 1 from app.orders placed
      where placed.restaurant_id=restaurant and placed.branch_id=branch and placed.id=confirmed_order
    ) then raise exception 'CATALOG_VARIANTS_REJECTED_ORDER_PERSISTED'; end if;
  end loop;

  -- ---------------------------------------------------------------- 2b. repeat plan lines may carry a size
  -- The repeat-into-capture function validates the plan shape before touching any row: a line with a
  -- well-formed variantId passes validation (later steps decide), a malformed one or an unknown key is
  -- rejected, and the legacy 4-key line keeps working.
  command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'customerId',gen_random_uuid()::text,'sourceOrderId',gen_random_uuid()::text,
    'captureDraftId',gen_random_uuid()::text,'expectedVersion',1,'attentionLeaseId',gen_random_uuid()::text,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,'occurredAt',stamp
  );
  for scenario in select value from pg_catalog.jsonb_array_elements(pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('label','legacy','extra','{}'::jsonb,'rejected',false),
    pg_catalog.jsonb_build_object('label','variant','extra',pg_catalog.jsonb_build_object('variantId',v_small::text),'rejected',false),
    pg_catalog.jsonb_build_object('label','bad_variant','extra',pg_catalog.jsonb_build_object('variantId','not-a-uuid'),'rejected',true),
    pg_catalog.jsonb_build_object('label','null_variant','extra',pg_catalog.jsonb_build_object('variantId',null),'rejected',true),
    pg_catalog.jsonb_build_object('label','unknown_key','extra',pg_catalog.jsonb_build_object('variantName','Chica'),'rejected',true)
  )) loop
    plan := pg_catalog.jsonb_build_object(
      'schemaVersion',1,'customerId',command->>'customerId','sourceOrderId',command->>'sourceOrderId',
      'catalogVersion',catalog::text,'lines',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'sourceOrderItemId',gen_random_uuid()::text,'productId',pizza::text,'quantity',1,'modifierGroups',pg_catalog.jsonb_build_array()
        ) || (scenario->'extra')
      )
    );
    execute 'set local role app_api';
    result := app_private.repeat_customer_order_into_capture(actor,command,plan);
    execute 'reset role';
    if (result->>'status'='rejected') is distinct from (scenario->>'rejected')::boolean then
      raise exception 'CATALOG_VARIANTS_REPEAT_PLAN_%',upper(scenario->>'label');
    end if;
  end loop;

  -- ---------------------------------------------------------------- 3. table invariants
  begin
    insert into app.menu_product_variants(restaurant_id,catalog_id,product_id,id,name,unit_price_minor,active,display_order)
      values(restaurant,catalog,pizza,gen_random_uuid(),' Padded',100,true,5);
    raise exception 'CATALOG_VARIANTS_PADDED_NAME_ACCEPTED';
  exception when check_violation then null;
  end;
  begin
    insert into app.menu_product_variants(restaurant_id,catalog_id,product_id,id,name,unit_price_minor,active,display_order)
      values(restaurant,catalog,pizza,gen_random_uuid(),'Negative',-1,true,5);
    raise exception 'CATALOG_VARIANTS_NEGATIVE_PRICE_ROW_ACCEPTED';
  exception when check_violation then null;
  end;
  begin
    insert into app.menu_product_variants(restaurant_id,catalog_id,product_id,id,name,unit_price_minor,active,display_order)
      values(restaurant,catalog,pizza,gen_random_uuid(),'CHICA',100,true,5);
    raise exception 'CATALOG_VARIANTS_DUPLICATE_NAME_ROW_ACCEPTED';
  exception when unique_violation then null;
  end;
  begin
    insert into app.menu_product_variants(restaurant_id,catalog_id,product_id,id,name,unit_price_minor,active,display_order)
      values(restaurant,catalog,gen_random_uuid(),gen_random_uuid(),'Orphan',100,true,5);
    raise exception 'CATALOG_VARIANTS_ORPHAN_ROW_ACCEPTED';
  exception when foreign_key_violation then null;
  end;
  -- The same size name exists on the other restaurant's Pizza (Chica) by design: scope is in the key.
  if has_table_privilege('app_api','app.menu_product_variants','select')
    or has_table_privilege('authenticated','app.menu_product_variants','select')
    or has_table_privilege('anon','app.menu_product_variants','select')
    or has_table_privilege('service_role','app.menu_product_variants','select')
  then raise exception 'CATALOG_VARIANTS_TABLE_GRANTED'; end if;
  if not exists (
    select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='app' and c.relname='menu_product_variants' and c.relrowsecurity and c.relforcerowsecurity
  ) then raise exception 'CATALOG_VARIANTS_RLS_NOT_FORCED'; end if;
end
$catalog_variants_tests$;
commit;
