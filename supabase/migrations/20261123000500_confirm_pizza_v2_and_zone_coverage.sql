begin;

-- m1-z2b-confirm-pizza-v2:
--   1. Rebuilds app_private.confirm_capture_draft_v3 cleanly from the Pizza V2 canonical body
--      (20261120000100) merged with Z2 delivery zones/settlements/manual-fee checks
--      (20261121000100) and K0-B delivery_customer_required (20261123000100), eliminating all
--      stale base_group_id/extra_group_ids references and enforcing quote expiry on manual-fee
--      delivery quotes as well as covered quotes.
--   2. Restores schema-level enforcement of delivery_zones_coverage_nonempty (dropped as a
--      row-level CHECK in 20261121000100) via DEFERRABLE INITIALLY DEFERRED constraint triggers
--      on app.delivery_zones and app.delivery_zone_settlements, so no active non-deleted zone
--      can ever be committed without at least one postal code or one settlement membership.

create or replace function app_private.confirm_capture_draft_v3(
  p_actor_id uuid,
  p_command jsonb,
  p_order jsonb,
  p_order_audits jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  restaurant uuid; branch uuid; capture uuid; requested_order_id uuid; member uuid;
  expected bigint; fingerprint text; catalog uuid; catalog_currency text;
  stored app.capture_command_events%rowtype;
  repeat_plan app.capture_repeat_order_plans%rowtype;
  stored_quote app.capture_delivery_quotes%rowtype;
  stored_intent app.capture_payment_intents%rowtype;
  current_fulfillment_snapshot uuid; current_channel text;
  fulfillment_change_version bigint; plan_change_version bigint;
  frozen_quote jsonb; frozen_intent jsonb;
  old_result jsonb; mutation_result jsonb; result_record jsonb; base_order jsonb;
  line_record record; item jsonb; expected_snapshot jsonb; expected_modifiers jsonb; expected_note jsonb;
  product app.menu_products%rowtype; line_variant_id uuid; variant_record app.menu_product_variants%rowtype;
  line_index bigint; item_count integer; write_status text;
  line_fraction jsonb; fraction_group_ids uuid[]; fraction_modifiers jsonb; fraction_breakdown jsonb;
  fraction_price bigint; slot_price bigint; slot_index integer; slot_value jsonb; fraction_name text;
  flavor_option app.menu_modifier_options%rowtype; extra_option app.menu_modifier_options%rowtype;
  extra_text text; label_text text;
  fr_enabled boolean; fr_flavor_group uuid; fr_extra_group uuid; fr_labels text[]; fr_locked uuid[]; fr_base bigint;
  line_pizza jsonb; pizza_input jsonb; pizza_result jsonb; pizza_modifiers jsonb;
  v_manual_fee app.capture_delivery_manual_fees%rowtype;
  v_effective_fee bigint;
  v_settlement_id uuid;
  v_settlement_outside boolean;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_command,array[
      'schemaVersion','scope','captureDraftId','expectedVersion','eventId','idempotencyKey','deviceId','occurredAt',
      'attentionLeaseId','orderId','shiftId','tableId','currency','timeZone'
    ])
    or not app_private.jsonb_has_exact_keys(p_command->'scope',array['restaurantId','branchId'])
    or p_command->'schemaVersion' is distinct from '2'::jsonb
    or not coalesce(p_command->>'expectedVersion' ~ '^[1-9][0-9]*$',false)
    or not coalesce(p_command->>'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
    or not coalesce(p_command->>'currency' ~ '^[A-Z]{3}$',false)
    or pg_catalog.char_length(p_command->>'timeZone') not between 1 and 100
    or (p_order is null) is distinct from (p_order_audits is null)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  begin
    restaurant := (p_command#>>'{scope,restaurantId}')::uuid;
    branch := (p_command#>>'{scope,branchId}')::uuid;
    capture := (p_command->>'captureDraftId')::uuid;
    requested_order_id := (p_command->>'orderId')::uuid;
    expected := (p_command->>'expectedVersion')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or capture is null or requested_order_id is null
    or expected not between 1 and 9007199254740990
    or p_command#>>'{scope,restaurantId}' is distinct from restaurant::text
    or p_command#>>'{scope,branchId}' is distinct from branch::text
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  select membership.id into member
  from app.memberships membership
  join app.branches b on b.id=membership.branch_id and b.restaurant_id=membership.restaurant_id
  join app.restaurants r on r.id=membership.restaurant_id
  join app.membership_role_grants grant_record on grant_record.membership_id=membership.id
  where membership.user_id=p_actor_id and membership.restaurant_id=restaurant and membership.branch_id=branch
    and membership.revoked_at is null and b.disabled_at is null and r.disabled_at is null
    and grant_record.revoked_at is null
    and grant_record.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
  order by grant_record.role_code limit 1 for share of membership,b,r,grant_record;
  if member is null then return pg_catalog.jsonb_build_object('status','denied'); end if;

  fingerprint := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'capture.confirmed.v3:'||p_command::text||':'||p_actor_id::text
  ,'UTF8'
  )),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'capture-command:'||p_actor_id::text||':'||restaurant::text||':'||branch::text||':'||(p_command->>'idempotencyKey'),0
  ));
  select * into stored from app.capture_command_events
  where actor_id=p_actor_id and restaurant_id=restaurant and branch_id=branch
    and idempotency_key=p_command->>'idempotencyKey';
  if found then
    if stored.operation<>'capture.confirmed' or stored.command_fingerprint<>fingerprint
      or stored.capture_draft_id<>capture or stored.expected_version<>expected
      or stored.result_capture#>>'{detail,confirmedOrderId}' is distinct from requested_order_id::text
      or not exists (
        select 1 from app.orders confirmed
        join app.order_operational_shifts shift_link on shift_link.restaurant_id=confirmed.restaurant_id
          and shift_link.branch_id=confirmed.branch_id and shift_link.order_id=confirmed.id
        join app.order_fulfillment_snapshots frozen on frozen.restaurant_id=confirmed.restaurant_id
          and frozen.branch_id=confirmed.branch_id and frozen.order_id=confirmed.id
          and frozen.capture_draft_id=capture
        where confirmed.restaurant_id=restaurant and confirmed.branch_id=branch and confirmed.id=requested_order_id
          and shift_link.shift_id=(p_command->>'shiftId')::uuid
      )
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    return pg_catalog.jsonb_build_object('status','replayed','record',stored.result_capture);
  end if;
  if p_order is null then return pg_catalog.jsonb_build_object('status','pending'); end if;

  -- H23: deliveryCharge is an optional key here, exactly like tableId -- the codec omits it
  -- entirely when null (same optional-key convention as orderDiscount/tip) rather than always
  -- writing an explicit null, because persist_order_mutation's later item-add/state-change
  -- mutations require the persisted aggregate outside items/status to stay byte-for-byte
  -- identical; always re-adding the key here would break that equality against every order
  -- persisted without it (every non-delivery order, and every order confirmed before H13).
  if pg_catalog.jsonb_typeof(p_order)<>'object' or pg_catalog.jsonb_typeof(p_order_audits)<>'array'
    or not (
      app_private.jsonb_has_exact_keys(p_order,array[
        'schemaVersion','orderId','restaurantId','branchId','channel','currency','timeZone','status','items'
      ])
      or app_private.jsonb_has_exact_keys(p_order,array[
        'schemaVersion','orderId','restaurantId','branchId','channel','currency','timeZone','status','items','deliveryCharge'
      ])
      or app_private.jsonb_has_exact_keys(p_order,array[
        'schemaVersion','orderId','restaurantId','branchId','channel','tableId','currency','timeZone','status','items'
      ])
      or app_private.jsonb_has_exact_keys(p_order,array[
        'schemaVersion','orderId','restaurantId','branchId','channel','tableId','currency','timeZone','status','items','deliveryCharge'
      ])
    )
    or p_order->>'schemaVersion'<>'1'
    or p_order->>'restaurantId' is distinct from restaurant::text
    or p_order->>'branchId' is distinct from branch::text
    or p_order->>'orderId' is distinct from requested_order_id::text
    or p_order->>'currency' is distinct from p_command->>'currency'
    or p_order->>'timeZone' is distinct from p_command->>'timeZone'
    or p_order->>'status'<>'draft'
    or pg_catalog.jsonb_typeof(p_order->'items')<>'array'
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  item_count := pg_catalog.jsonb_array_length(p_order->'items');
  if pg_catalog.jsonb_array_length(p_order_audits)<>item_count+1
    or p_order_audits->0->>'operation'<>'order.created'
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  select * into repeat_plan from app.capture_repeat_order_plans plan
  where plan.restaurant_id=restaurant and plan.branch_id=branch and plan.capture_draft_id=capture for update;

  if not found then
    if item_count<>0 then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  else
    if (repeat_plan.plan_kind='repeat' and repeat_plan.applied_capture_version<>expected)
      or (repeat_plan.plan_kind='repeat' and repeat_plan.customer_id::text is distinct from repeat_plan.selection_plan->>'customerId')
      or pg_catalog.jsonb_array_length(repeat_plan.selection_plan->'lines')<>item_count
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;

    select head.catalog_id,catalog_record.currency into catalog,catalog_currency
    from app.menu_catalog_heads head
    join app.menu_catalogs catalog_record on catalog_record.restaurant_id=head.restaurant_id
      and catalog_record.id=head.catalog_id and catalog_record.version=head.version
    where head.restaurant_id=restaurant for share of head,catalog_record;
    if not found or catalog_currency is distinct from p_command->>'currency' then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;

    for line_record in
      select line.value, line.ordinality
      from pg_catalog.jsonb_array_elements(repeat_plan.selection_plan->'lines') with ordinality line(value,ordinality)
      order by line.ordinality
    loop
      begin
        select product_record.* into product
        from app.menu_products product_record
        join app.menu_categories category on category.restaurant_id=product_record.restaurant_id
          and category.catalog_id=product_record.catalog_id and category.id=product_record.category_id
        where product_record.restaurant_id=restaurant and product_record.catalog_id=catalog
          and product_record.id=(line_record.value->>'productId')::uuid
          and product_record.active and category.active;
      exception when invalid_text_representation then
        return pg_catalog.jsonb_build_object('status','conflict');
      end;
      if not found then return pg_catalog.jsonb_build_object('status','conflict'); end if;

      -- Catalog sizes: a sized product must name one active variant of this exact catalog release;
      -- a variant on a product without it, an inactive one, or a missing one on a sized product is
      -- a conflict. The frozen unit price below always comes from this catalog row, never the client.
      line_variant_id := null;
      variant_record := null;
      if pg_catalog.jsonb_typeof(line_record.value->'variantId')='string' then
        begin
          line_variant_id := (line_record.value->>'variantId')::uuid;
        exception when invalid_text_representation then
          return pg_catalog.jsonb_build_object('status','conflict');
        end;
        select variant_row.* into variant_record from app.menu_product_variants variant_row
        where variant_row.restaurant_id=restaurant and variant_row.catalog_id=catalog
          and variant_row.product_id=product.id and variant_row.id=line_variant_id and variant_row.active;
        if not found then return pg_catalog.jsonb_build_object('status','conflict'); end if;
      elsif exists (
        select 1 from app.menu_product_variants variant_row
        where variant_row.restaurant_id=restaurant and variant_row.catalog_id=catalog
          and variant_row.product_id=product.id and variant_row.active
      ) then return pg_catalog.jsonb_build_object('status','conflict');
      end if;

      -- Half-and-half: only a product with fractions enabled may be split. The setup is the
      -- product's own when it has one (any size, or no size), otherwise the legacy one of the chosen
      -- size. Its flavor and ingredient groups are priced by the fraction rules below and must
      -- arrive with empty selections.
      line_fraction := null;
      fraction_group_ids := '{}'::uuid[];
      if line_record.value ? 'fraction' then
        line_fraction := line_record.value->'fraction';
        if product.fraction_enabled or product.fraction_flavor_group_id is not null
          or product.fraction_extra_group_id is not null
          or pg_catalog.cardinality(product.fraction_excludable_ingredient_ids)>0
          or pg_catalog.cardinality(product.fraction_locked_ingredient_option_ids)>0
        then
          fr_enabled := product.fraction_enabled;
          fr_flavor_group := product.fraction_flavor_group_id;
          fr_extra_group := product.fraction_extra_group_id;
          fr_labels := product.fraction_excludable_ingredient_ids;
          fr_locked := product.fraction_locked_ingredient_option_ids;
        else
          fr_enabled := coalesce(variant_record.fraction_enabled,false);
          fr_flavor_group := variant_record.fraction_flavor_group_id;
          fr_extra_group := variant_record.fraction_extra_group_id;
          fr_labels := coalesce(variant_record.fraction_excludable_ingredient_ids,'{}'::text[]);
          fr_locked := coalesce(variant_record.fraction_locked_ingredient_option_ids,'{}'::uuid[]);
        end if;
        -- Base price of a half: the size price, or the product price without sizes.
        fr_base := coalesce(variant_record.unit_price_minor,product.unit_price_minor);
        if not fr_enabled or fr_flavor_group is null
          or not app_private.jsonb_has_exact_keys(line_fraction,array['geometry','slots'])
          or line_fraction->>'geometry' is distinct from 'halves'
          or pg_catalog.jsonb_typeof(line_fraction->'slots') is distinct from 'array'
          or pg_catalog.jsonb_array_length(line_fraction->'slots')<>2
          or (line_fraction->'slots'->0->'flavorOptionId'='null'::jsonb
            and line_fraction->'slots'->1->'flavorOptionId'='null'::jsonb)
        then return pg_catalog.jsonb_build_object('status','conflict'); end if;
        fraction_group_ids := pg_catalog.array_remove(array[fr_flavor_group,fr_extra_group],null);
      end if;

      -- Pizza V2 (plan schemaVersion 2): priced by the versioned halves rule from the catalog release.
      -- The line names half-a's product and size; the base groups of that product and the groups holding
      -- its extra options are priced by the rule and must arrive with empty selections, exactly like the
      -- legacy fraction groups.
      line_pizza := null;
      pizza_modifiers := '[]'::jsonb;
      if line_record.value ? 'pizza' then
        if line_record.value ? 'fraction' or product.pizza_mode is null
        then return pg_catalog.jsonb_build_object('status','conflict'); end if;
        line_pizza := line_record.value->'pizza';
        if line_pizza->>'ruleVersion' = 'pizza-halves-v1' then
          return pg_catalog.jsonb_build_object('status','conflict','reason','rule_version_legacy');
        elsif line_pizza->>'ruleVersion' is distinct from 'pizza-halves-v2' then
          return pg_catalog.jsonb_build_object('status','conflict','reason','rule_version_unknown');
        end if;
        fraction_group_ids := pg_catalog.array_remove(product.base_group_ids || coalesce((
          select pg_catalog.array_agg(distinct pizza_extra_option.group_id)
          from app.menu_modifier_options pizza_extra_option
          where pizza_extra_option.restaurant_id=restaurant and pizza_extra_option.catalog_id=catalog
            and pizza_extra_option.id = any (product.extra_option_ids)
        ), '{}'::uuid[]), null);
        pizza_input := app_private.build_pizza_halves_input_v2(restaurant,catalog,catalog_currency,line_record.value);
        if pizza_input is null then return pg_catalog.jsonb_build_object('status','conflict'); end if;
        if not app_private.pizza_quantities_valid(restaurant,catalog,line_record.value)
        then return pg_catalog.jsonb_build_object('status','conflict','reason','pizza_quantity_invalid'); end if;
        pizza_result := app_private.pizza_halves_price_v2(pizza_input);
        if pizza_result ? 'issues' then
          return pg_catalog.jsonb_build_object('status','conflict','reason',pizza_result->'issues'->0->>'code');
        end if;
        -- Every charge (free ones at zero) and every removal becomes a frozen modifier; the line total is
        -- the base price plus these amounts, which equals the rule's total.
        select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'modifierId','pizza-'||(charge.value->>'role')||':'
            ||(case when pg_catalog.jsonb_array_length(charge.value->'fractions')=2 then 'both'
               else charge.value->'fractions'->>0 end)||':'||(charge.value->>'optionId'),
          'name',charge.value->>'name',
          'groupId',case charge.value->>'role' when 'ingredient' then 'pizza-ingredient' else 'pizza-extra' end,
          'groupName',(charge.value->>'role')||':'
            ||(case when pg_catalog.jsonb_array_length(charge.value->'fractions')=2 then 'both'
               else charge.value->'fractions'->>0 end),
          'groupCatalogVersion',catalog::text,
          'unitPrice',charge.value->'amount',
          'quantity',1
        ) order by charge.ordinality),'[]'::jsonb) into pizza_modifiers
        from pg_catalog.jsonb_array_elements(pizza_result->'charges') with ordinality charge(value,ordinality);
        pizza_modifiers := pizza_modifiers||coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'modifierId','exclude:'||(pizza_half.value->>'fraction')||':'||removed.value,
            'name','Sin '||removed_option.name,
            'groupId','fraction-exclusion','groupName','exclude:'||(pizza_half.value->>'fraction'),
            'groupCatalogVersion',catalog::text,
            'unitPrice',pg_catalog.jsonb_build_object('amountMinor',0,'currency',catalog_currency),
            'quantity',1
          ) order by pizza_half.ordinality,removed.ordinality)
          from pg_catalog.jsonb_array_elements(pizza_result->'halves') with ordinality pizza_half(value,ordinality)
          cross join lateral pg_catalog.jsonb_array_elements_text(pizza_half.value->'removedIngredientOptionIds')
            with ordinality removed(value,ordinality)
          join app.menu_products removed_product on removed_product.restaurant_id=restaurant
            and removed_product.catalog_id=catalog and removed_product.id=(pizza_half.value->>'productId')::uuid
          join app.menu_modifier_options removed_option on removed_option.restaurant_id=restaurant
            and removed_option.catalog_id=catalog and removed_option.group_id = any (removed_product.base_group_ids)
            and removed_option.id=removed.value::uuid
        ),'[]'::jsonb);
      end if;

      if exists (
        select 1 from app.menu_modifier_groups catalog_group
        left join lateral (
          select requested.value from pg_catalog.jsonb_array_elements(line_record.value->'modifierGroups') requested(value)
          where requested.value->>'groupId'=catalog_group.id::text
        ) requested_group on true
        where catalog_group.restaurant_id=restaurant and catalog_group.catalog_id=catalog
          and exists (select 1 from app.menu_product_modifier_groups assigned
            where assigned.restaurant_id=catalog_group.restaurant_id and assigned.catalog_id=catalog_group.catalog_id
              and assigned.group_id=catalog_group.id and assigned.product_id=product.id)
          and not (catalog_group.id = any(fraction_group_ids))
          and (not catalog_group.active or requested_group.value is null)
      ) or exists (
        select 1 from pg_catalog.jsonb_array_elements(line_record.value->'modifierGroups') requested_group(value)
        left join app.menu_modifier_groups catalog_group on catalog_group.restaurant_id=restaurant
          and catalog_group.catalog_id=catalog
          and exists (select 1 from app.menu_product_modifier_groups assigned
            where assigned.restaurant_id=catalog_group.restaurant_id and assigned.catalog_id=catalog_group.catalog_id
              and assigned.group_id=catalog_group.id and assigned.product_id=product.id)
          and catalog_group.id=(requested_group.value->>'groupId')::uuid
        where catalog_group.id is null
          or (catalog_group.id = any(fraction_group_ids)
            and pg_catalog.jsonb_array_length(requested_group.value->'selections')<>0)
          or (not (catalog_group.id = any(fraction_group_ids)) and (not catalog_group.active
            or (select coalesce(pg_catalog.sum((selection.value->>'quantity')::integer),0)
                from pg_catalog.jsonb_array_elements(requested_group.value->'selections') selection(value))
              not between catalog_group.minimum_quantity and catalog_group.maximum_quantity))
      ) or exists (
        select 1 from pg_catalog.jsonb_array_elements(line_record.value->'modifierGroups') requested_group(value)
        cross join lateral pg_catalog.jsonb_array_elements(requested_group.value->'selections') selection(value)
        left join app.menu_modifier_options option_record on option_record.restaurant_id=restaurant
          and option_record.catalog_id=catalog and option_record.group_id=(requested_group.value->>'groupId')::uuid
          and option_record.id=(selection.value->>'optionId')::uuid
        where option_record.id is null or not option_record.active
          or (option_record.maximum_quantity is not null
            and (selection.value->>'quantity')::integer>option_record.maximum_quantity)
      ) then return pg_catalog.jsonb_build_object('status','conflict'); end if;

      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'modifierId',option_record.id::text,
        'name',option_record.name,
        'groupId',catalog_group.id::text,
        'groupName',catalog_group.name,
        'groupCatalogVersion',catalog::text,
        'unitPrice',pg_catalog.jsonb_build_object('amountMinor',option_record.unit_price_minor,'currency',catalog_currency),
        'quantity',(selection.value->>'quantity')::integer
      ) order by catalog_group.display_order,catalog_group.id,option_record.id),'[]'::jsonb) into expected_modifiers
      from pg_catalog.jsonb_array_elements(line_record.value->'modifierGroups') requested_group(value)
      cross join lateral pg_catalog.jsonb_array_elements(requested_group.value->'selections') selection(value)
      join app.menu_modifier_groups catalog_group on catalog_group.restaurant_id=restaurant
        and catalog_group.catalog_id=catalog
        and exists (select 1 from app.menu_product_modifier_groups assigned
          where assigned.restaurant_id=catalog_group.restaurant_id and assigned.catalog_id=catalog_group.catalog_id
            and assigned.group_id=catalog_group.id and assigned.product_id=product.id)
        and catalog_group.id=(requested_group.value->>'groupId')::uuid
      join app.menu_modifier_options option_record on option_record.restaurant_id=restaurant
        and option_record.catalog_id=catalog and option_record.group_id=catalog_group.id
        and option_record.id=(selection.value->>'optionId')::uuid;

      fraction_modifiers := '[]'::jsonb;
      fraction_breakdown := '[]'::jsonb;
      fraction_price := 0;
      if line_fraction is not null then
        begin
          for slot_index in 0..1 loop
            slot_value := line_fraction->'slots'->slot_index;
            fraction_name := case slot_index when 0 then 'half-a' else 'half-b' end;
            if not app_private.jsonb_has_exact_keys(slot_value,array['fraction','flavorOptionId','extraOptionIds','excludedIngredientIds'])
              or slot_value->>'fraction' is distinct from fraction_name
              or pg_catalog.jsonb_typeof(slot_value->'extraOptionIds') is distinct from 'array'
              or pg_catalog.jsonb_typeof(slot_value->'excludedIngredientIds') is distinct from 'array'
              or pg_catalog.jsonb_array_length(slot_value->'extraOptionIds')>5
              or (pg_catalog.jsonb_array_length(slot_value->'extraOptionIds')>0 and fr_extra_group is null)
              or (slot_value->'flavorOptionId'='null'::jsonb and fr_extra_group is null)
              or (select pg_catalog.count(distinct extra_value.value)<>pg_catalog.count(*)
                  from pg_catalog.jsonb_array_elements_text(slot_value->'extraOptionIds') extra_value(value))
              or (select pg_catalog.count(distinct label_value.value)<>pg_catalog.count(*)
                  from pg_catalog.jsonb_array_elements_text(slot_value->'excludedIngredientIds') label_value(value))
            then return pg_catalog.jsonb_build_object('status','conflict'); end if;

            if slot_value->'flavorOptionId'='null'::jsonb then
              -- A half built ingredient by ingredient costs the base price and is frozen without a flavor.
              slot_price := fr_base;
              fraction_price := greatest(fraction_price,slot_price);
              fraction_breakdown := fraction_breakdown||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'fraction',fraction_name,'flavorOptionId','custom',
                'flavorName','Armada','amountMinor',slot_price
              ));
            else
              select option_record.* into flavor_option
              from app.menu_modifier_options option_record
              join app.menu_modifier_groups option_group on option_group.restaurant_id=option_record.restaurant_id
                and option_group.catalog_id=option_record.catalog_id and option_group.id=option_record.group_id
              where option_record.restaurant_id=restaurant and option_record.catalog_id=catalog
                and option_record.group_id=fr_flavor_group
                and option_record.id=(slot_value->>'flavorOptionId')::uuid
                and option_record.active and option_group.active;
              if not found then return pg_catalog.jsonb_build_object('status','conflict'); end if;
              -- A flavor priced at zero takes the base price; the greater half sets the unit price.
              slot_price := case when flavor_option.unit_price_minor=0 then fr_base
                else flavor_option.unit_price_minor end;
              fraction_price := greatest(fraction_price,slot_price);
              fraction_breakdown := fraction_breakdown||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'fraction',fraction_name,'flavorOptionId',flavor_option.id::text,
                'flavorName',flavor_option.name,'amountMinor',slot_price
              ));
            end if;

            for extra_text in
              select extra_value.value from pg_catalog.jsonb_array_elements_text(slot_value->'extraOptionIds')
                with ordinality extra_value(value,ordinality) order by extra_value.ordinality
            loop
              select option_record.* into extra_option
              from app.menu_modifier_options option_record
              join app.menu_modifier_groups option_group on option_group.restaurant_id=option_record.restaurant_id
                and option_group.catalog_id=option_record.catalog_id and option_group.id=option_record.group_id
              where option_record.restaurant_id=restaurant and option_record.catalog_id=catalog
                and option_record.group_id=fr_extra_group
                and option_record.id=extra_text::uuid
                and option_record.active and option_group.active;
              if not found then return pg_catalog.jsonb_build_object('status','conflict'); end if;
              -- A half carries half the extra's price, rounded up to the minor unit.
              fraction_modifiers := fraction_modifiers||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'modifierId','extra:'||fraction_name||':'||extra_option.id::text,
                'name',extra_option.name,'groupId','fraction-extra','groupName','extra:'||fraction_name,
                'groupCatalogVersion',catalog::text,
                'unitPrice',pg_catalog.jsonb_build_object(
                  'amountMinor',(extra_option.unit_price_minor+1)/2,'currency',catalog_currency
                ),
                'quantity',1
              ));
            end loop;

            for label_text in
              select label_value.value from pg_catalog.jsonb_array_elements_text(slot_value->'excludedIngredientIds')
                with ordinality label_value(value,ordinality) order by label_value.ordinality
            loop
              if label_text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
                select * into extra_option
                from app.menu_modifier_options
                where restaurant_id = restaurant and catalog_id = catalog
                  and group_id = fr_extra_group and id = label_text::uuid
                  and active;
                if not found or (label_text::uuid = any(fr_locked)) then
                  return pg_catalog.jsonb_build_object('status','conflict');
                end if;
                fraction_modifiers := fraction_modifiers||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                  'modifierId','exclude:'||fraction_name||':'||label_text,
                  'name','Sin '||extra_option.name,'groupId','fraction-exclusion','groupName','exclude:'||fraction_name,
                  'groupCatalogVersion',catalog::text,
                  'unitPrice',pg_catalog.jsonb_build_object('amountMinor',0,'currency',catalog_currency),
                  'quantity',1
                ));
              else
                if not (label_text = any(fr_labels))
                then return pg_catalog.jsonb_build_object('status','conflict'); end if;
                fraction_modifiers := fraction_modifiers||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                  'modifierId','exclude:'||fraction_name||':'||label_text,
                  'name','Sin '||label_text,'groupId','fraction-exclusion','groupName','exclude:'||fraction_name,
                  'groupCatalogVersion',catalog::text,
                  'unitPrice',pg_catalog.jsonb_build_object('amountMinor',0,'currency',catalog_currency),
                  'quantity',1
                ));
              end if;
            end loop;
          end loop;
        exception when invalid_text_representation or invalid_parameter_value then
          return pg_catalog.jsonb_build_object('status','conflict');
        end;
      end if;

      expected_snapshot := pg_catalog.jsonb_build_object(
        'catalogVersion',catalog::text,'productId',product.id::text,'name',product.name,
        'stationId',product.station_id,'unit',product.unit,
        'unitPrice',pg_catalog.jsonb_build_object(
          'amountMinor',case when line_pizza is not null then (pizza_result#>>'{basePrice,amountMinor}')::bigint
            when line_fraction is not null then fraction_price
            else coalesce(variant_record.unit_price_minor,product.unit_price_minor) end,
          'currency',catalog_currency
        ),
        'modifiers',expected_modifiers||fraction_modifiers||pizza_modifiers
      );
      if line_fraction is not null then
        expected_snapshot := expected_snapshot||pg_catalog.jsonb_build_object(
          'geometry','halves','fractionBreakdown',fraction_breakdown
        );
      end if;
      if line_pizza is not null then
        expected_snapshot := expected_snapshot||pg_catalog.jsonb_build_object(
          'geometry','halves','pizzaHalves',pizza_result
        );
      end if;
      if coalesce(variant_record.sku,product.sku) is not null then
        expected_snapshot := expected_snapshot||pg_catalog.jsonb_build_object('sku',coalesce(variant_record.sku,product.sku));
      end if;
      if variant_record.id is not null then
        expected_snapshot := expected_snapshot||pg_catalog.jsonb_build_object(
          'variantId',variant_record.id::text,'variantName',variant_record.name
        );
      end if;
      if product.tax_id is not null then
        expected_snapshot := expected_snapshot||pg_catalog.jsonb_build_object('tax',pg_catalog.jsonb_build_object(
          'taxId',product.tax_id,'name',product.tax_name,'taxRuleVersion',product.tax_rule_version,
          'rate',pg_catalog.jsonb_build_object(
            'numerator',product.tax_rate_numerator::text,'denominator',product.tax_rate_denominator::text
          ),'inclusion',product.tax_inclusion
        ));
      end if;

      if line_record.value ? 'note' then
        expected_note := line_record.value->'note';
      else
        expected_note := 'null'::jsonb;
      end if;

      item := p_order#>array['items',(line_record.ordinality-1)::text];
      if item is null
        or not app_private.jsonb_has_exact_keys(item,array[
          'orderItemId','snapshot','quantity','restaurantId','branchId','status','note'
        ])
        or not coalesce(item->>'orderItemId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
        or item->>'quantity' is distinct from line_record.value->>'quantity'
        or item->>'restaurantId' is distinct from restaurant::text
        or item->>'branchId' is distinct from branch::text
        or item->>'status'<>'pending'
        or item->'snapshot' is distinct from expected_snapshot
        or item->'note' is distinct from expected_note
      then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    end loop;
  end if;

  -- Freeze the delivery quote and payment intent, if any.
  select fulfillment_snapshot_id, fulfillment_channel into current_fulfillment_snapshot, current_channel
  from app.capture_drafts
  where restaurant_id=restaurant and branch_id=branch and id=capture for share;

  select * into stored_quote from app.capture_delivery_quotes
  where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture for share;
  -- Defense in depth: clear_capture_delivery_quote_for_channel already deletes this row the
  -- instant fulfillment_snapshot_id changes, so this should never actually find a mismatch; it
  -- exists purely to fail closed rather than freeze an inconsistent quote/address pairing.
  if found and stored_quote.quote->>'addressSnapshotRef' is distinct from current_fulfillment_snapshot::text then
    return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_quote_stale');
  end if;
  frozen_quote := case when found then stored_quote.quote else null end;

  -- K0-B: delivery always requires a linked customer before confirmation.
  if current_channel = 'delivery' and not exists (
    select 1 from app.capture_drafts
    where restaurant_id=restaurant and branch_id=branch and id=capture and customer_id is not null
  ) then
    return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_customer_required');
  end if;

  -- H10: a delivery capture can never confirm without a live, coverage-eligible quote. This is
  -- deliberately stricter than the staleness check above, which only guards against an
  -- address/snapshot mismatch; here we also require the frozen quote to still be in-date and
  -- either cover the address or carry a live supervisor manual-fee authorization. H14: expiry is
  -- judged against the server's own clock (clock_timestamp()), not the client-supplied occurredAt.
  if current_channel = 'delivery' then
    if frozen_quote is null then
      return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_quote_missing');
    end if;
    if frozen_quote->>'coverageStatus' = 'not_covered' then
      if pg_catalog.jsonb_typeof(frozen_quote->'override') is distinct from 'object'
        or (frozen_quote->'override' ? 'kind' and frozen_quote#>>'{override,kind}' is distinct from 'manual_fee') then
        return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_quote_not_covered');
      end if;
      select * into v_manual_fee from app.capture_delivery_manual_fees
      where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture
        and address_snapshot_ref=current_fulfillment_snapshot for share;
      if not found
        or v_manual_fee.fee_minor is distinct from (frozen_quote#>>'{override,feeMinor}')::bigint
        or v_manual_fee.reason is distinct from frozen_quote#>>'{override,reason}'
        or v_manual_fee.role_code is distinct from frozen_quote#>>'{override,role}'
        or v_manual_fee.actor_id::text is distinct from frozen_quote#>>'{override,actorId}'
        or pg_catalog.to_char(v_manual_fee.authorized_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          is distinct from frozen_quote#>>'{override,overriddenAt}'
        or (frozen_quote->'override' ? 'eventId'
          and v_manual_fee.authorization_event_id::text is distinct from frozen_quote#>>'{override,eventId}')
        or (frozen_quote->'override' ? 'currency'
          and v_manual_fee.currency_code is distinct from frozen_quote#>>'{override,currency}')
      then
        return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_manual_fee_stale');
      end if;
    elsif pg_catalog.jsonb_typeof(frozen_quote->'override')='object' then
      return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_quote_override_not_authorized');
    end if;
    if (frozen_quote->>'expiresAt')::timestamptz <= clock_timestamp() then
      return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_quote_expired');
    end if;
    -- H13: the Order's frozen delivery charge must be exactly the server's own frozen quote --
    -- never relaxed to "close enough", and never trusted from the client without this check. The
    -- API is expected to materialize it from this same quote, but a stale API read (the quote
    -- moved between the API's workspace read and this transaction) must surface as a conflict,
    -- not silently persist a mismatched charge.
    v_effective_fee := case when pg_catalog.jsonb_typeof(frozen_quote->'override')='object'
      then (frozen_quote#>>'{override,feeMinor}')::bigint else (frozen_quote->>'feeMinor')::bigint end;
    if p_order->'deliveryCharge' is null or pg_catalog.jsonb_typeof(p_order->'deliveryCharge')<>'object'
      or not (
        app_private.jsonb_has_exact_keys(p_order->'deliveryCharge',array['amount','quoteId'])
        or app_private.jsonb_has_exact_keys(p_order->'deliveryCharge',array['amount','quoteId','manualFee'])
      )
      or pg_catalog.jsonb_typeof(p_order#>'{deliveryCharge,amount}')<>'object'
      or not app_private.jsonb_has_exact_keys(p_order#>'{deliveryCharge,amount}',array['amountMinor','currency'])
      or (p_order#>'{deliveryCharge,amount,amountMinor}')::text::numeric is distinct from v_effective_fee::numeric
      or p_order#>>'{deliveryCharge,amount,currency}' is distinct from p_order->>'currency'
      or p_order#>>'{deliveryCharge,quoteId}' is distinct from frozen_quote->>'quoteId'
    then
      return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_charge_mismatch');
    end if;
    if pg_catalog.jsonb_typeof(frozen_quote->'override')='object' then
      if p_order#>'{deliveryCharge,manualFee}' is distinct from pg_catalog.jsonb_build_object(
        'eventId', v_manual_fee.authorization_event_id::text,
        'actorId', v_manual_fee.actor_id::text,
        'role', v_manual_fee.role_code,
        'reason', v_manual_fee.reason,
        'authorizedAt', pg_catalog.to_char(v_manual_fee.authorized_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) then
        return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_manual_fee_stale');
      end if;
    elsif p_order#>'{deliveryCharge,manualFee}' is not null
      and p_order#>'{deliveryCharge,manualFee}' <> 'null'::jsonb then
      return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_manual_fee_stale');
    end if;
  -- H23: the key is optional (see the shape check above), so a non-delivery order may omit it
  -- entirely -- that must be accepted exactly like an explicit null, never rejected.
  elsif (p_order ? 'deliveryCharge') and p_order->'deliveryCharge' is distinct from 'null'::jsonb then
    return pg_catalog.jsonb_build_object('status','rejected');
  end if;

  -- Staleness is decided from the actual facts that could have invalidated the intent since it
  -- was set, not from whether ANY unrelated mutation (e.g. delivery instructions) advanced the
  -- draft's version: the selection/repeat plan's change history (H16: read from the command
  -- journal, not repeat_plan.applied_capture_version -- that row is shared by both plan kinds,
  -- but replace_capture_selection_plan DELETES it outright when the selection is cleared to zero
  -- lines, which would otherwise silently reset "the plan's version" to null/0 and hide a real,
  -- intent-invalidating change; capture.selection_replaced/capture.order_repeated are logged
  -- unconditionally, including on that clearing delete, so this is immune to it), the frozen
  -- quote's applied_capture_version, and the version at which the fulfillment/address snapshot
  -- itself last changed (capture.fulfillment_changed). A payment intent set before any of those
  -- moved on is still valid, even if the draft's overall version advanced for an unrelated
  -- reason in between.
  select max(events.result_version) into fulfillment_change_version
  from app.capture_command_events events
  where events.restaurant_id=restaurant and events.branch_id=branch and events.capture_draft_id=capture
    and events.operation='capture.fulfillment_changed';

  select max(events.result_version) into plan_change_version
  from app.capture_command_events events
  where events.restaurant_id=restaurant and events.branch_id=branch and events.capture_draft_id=capture
    and events.operation in ('capture.selection_replaced','capture.order_repeated');

  select * into stored_intent from app.capture_payment_intents
  where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture for share;
  if not found then
    frozen_intent := null;
  elsif coalesce(plan_change_version,0) > stored_intent.applied_capture_version
    or coalesce(stored_quote.applied_capture_version,0) > stored_intent.applied_capture_version
    or coalesce(fulfillment_change_version,0) > stored_intent.applied_capture_version
  then
    return pg_catalog.jsonb_build_object('status','conflict','reason','payment_intent_stale');
  else
    frozen_intent := stored_intent.intent;
  end if;

  begin
    base_order := pg_catalog.jsonb_set(p_order,'{items}','[]'::jsonb,false);
    old_result := app_private.confirm_capture_draft(p_actor_id,p_command,base_order,p_order_audits->0);
    if old_result->>'status'='denied' then
      write_status := 'denied';
      raise exception using errcode='P5100',message='CAPTURE_CONFIRMATION_ATOMIC_ABORT';
    end if;
    if old_result->>'status'<>'applied' then
      write_status := 'conflict';
      raise exception using errcode='P5100',message='CAPTURE_CONFIRMATION_ATOMIC_ABORT';
    end if;
    result_record := old_result->'record';

    if item_count>0 then
      for line_index in 1..item_count loop
        mutation_result := app_private.persist_order_mutation(
          p_actor_id,
          line_index,
          pg_catalog.jsonb_set(p_order,'{items}',(
            select pg_catalog.jsonb_agg(prefix.value order by prefix.ordinality)
            from pg_catalog.jsonb_array_elements(p_order->'items') with ordinality prefix(value,ordinality)
            where prefix.ordinality<=line_index
          ),false),
          p_order_audits->line_index::integer
        );
        if mutation_result->>'status'='forbidden' then
          write_status := 'denied';
          raise exception using errcode='P5100',message='CAPTURE_CONFIRMATION_ATOMIC_ABORT';
        end if;
        if mutation_result->>'status'<>'saved' then
          write_status := 'conflict';
          raise exception using errcode='P5100',message='CAPTURE_CONFIRMATION_ATOMIC_ABORT';
        end if;
      end loop;
    end if;

    -- Additive: the stored snapshot is written as schemaVersion 1 (parseOrderFulfillmentSnapshotV1's
    -- exact key set). Merging deliveryQuote/paymentIntent without also bumping schemaVersion to 2
    -- would leave an object with 12 keys claiming to be schemaVersion 1, which every V1 parser
    -- (an exact-keys match) then rejects outright. schemaVersion 2 is parseOrderFulfillmentSnapshotV2's
    -- contract (shared-types): identical to V1 plus these two nullable fields, nothing else changes.
    select settlement_id, settlement_outside_catalog into v_settlement_id, v_settlement_outside
    from app.customer_fulfillment_snapshots
    where restaurant_id=restaurant and branch_id=branch and id=current_fulfillment_snapshot;

    update app.order_fulfillment_snapshots
    set snapshot = pg_catalog.jsonb_set(
      snapshot || pg_catalog.jsonb_build_object(
        'schemaVersion', 2, 'deliveryQuote', frozen_quote, 'paymentIntent', frozen_intent
      ),
      '{fulfillmentSnapshot}',
      case when pg_catalog.jsonb_typeof(snapshot->'fulfillmentSnapshot')='object'
        then (snapshot->'fulfillmentSnapshot') || pg_catalog.jsonb_build_object(
          'settlementId', v_settlement_id::text,
          'settlementOutsideCatalog', coalesce(v_settlement_outside, false)
        )
        else snapshot->'fulfillmentSnapshot' end
    )
    where restaurant_id=restaurant and branch_id=branch and order_id=requested_order_id
      and capture_draft_id=capture;
    if not found then raise exception using errcode='55000',message='CAPTURE_CONFIRMATION_SNAPSHOT_MISSING'; end if;

    update app.capture_command_events set command_fingerprint=fingerprint
    where actor_id=p_actor_id and restaurant_id=restaurant and branch_id=branch
      and idempotency_key=p_command->>'idempotencyKey' and operation='capture.confirmed'
      and capture_draft_id=capture and expected_version=expected;
    if not found then raise exception using errcode='55000',message='CAPTURE_CONFIRMATION_EVENT_MISSING'; end if;
  exception when sqlstate 'P5100' then
    return pg_catalog.jsonb_build_object('status',write_status);
  end;

  return pg_catalog.jsonb_build_object('status','applied','record',result_record);
end
$function$;

alter function app_private.confirm_capture_draft_v3(uuid,jsonb,jsonb,jsonb) owner to postgres;
revoke all on function app_private.confirm_capture_draft_v3(uuid,jsonb,jsonb,jsonb)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.confirm_capture_draft_v3(uuid,jsonb,jsonb,jsonb) to app_api;

-- Schema-level enforcement of delivery_zones_coverage_nonempty:
-- An active, non-deleted delivery zone must carry at least one legacy postal code OR at least one
-- active settlement membership in app.delivery_zone_settlements (localities alone are inert).
-- Deferred so multi-statement writes in app_private.upsert_delivery_zone (insert/update zone,
-- replace membership rows) are validated atomically at statement-group / transaction boundary.
create function app_private.enforce_delivery_zone_coverage_nonempty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_restaurant uuid;
  v_branch uuid;
  v_zone uuid;
  v_current app.delivery_zones%rowtype;
begin
  if tg_relid = 'app.delivery_zones'::regclass then
    v_restaurant := new.restaurant_id;
    v_branch := new.branch_id;
    v_zone := new.id;
  else
    v_restaurant := old.restaurant_id;
    v_branch := old.branch_id;
    v_zone := old.zone_id;
  end if;

  select * into v_current
  from app.delivery_zones
  where restaurant_id = v_restaurant
    and branch_id = v_branch
    and id = v_zone;

  -- Deleted or inactive zones release app.delivery_zone_settlements by design so another zone can
  -- claim those settlements.
  if not found or not v_current.active or v_current.deleted_at is not null then
    return null;
  end if;

  if coalesce(pg_catalog.cardinality(v_current.postal_codes), 0) = 0
    and not exists (
      select 1
      from app.delivery_zone_settlements dqs
      where dqs.restaurant_id = v_restaurant
        and dqs.branch_id = v_branch
        and dqs.zone_id = v_zone
    )
  then
    raise exception using
      errcode = '23514',
      constraint = 'delivery_zones_coverage_nonempty',
      message = 'DELIVERY_ZONES_COVERAGE_NONEMPTY';
  end if;

  return null;
end
$function$;

alter function app_private.enforce_delivery_zone_coverage_nonempty() owner to postgres;
revoke all on function app_private.enforce_delivery_zone_coverage_nonempty()
  from public, anon, authenticated, service_role, app_api;

comment on function app_private.enforce_delivery_zone_coverage_nonempty() is
  'Deferred constraint trigger enforcing delivery_zones_coverage_nonempty across app.delivery_zones and app.delivery_zone_settlements: every active, non-deleted zone requires at least one postal code or settlement.';

create constraint trigger delivery_zones_coverage_nonempty
  after insert or update on app.delivery_zones
  deferrable initially deferred
  for each row
  execute function app_private.enforce_delivery_zone_coverage_nonempty();

create constraint trigger delivery_zone_settlements_coverage_nonempty
  after delete or update on app.delivery_zone_settlements
  deferrable initially deferred
  for each row
  execute function app_private.enforce_delivery_zone_coverage_nonempty();

commit;
