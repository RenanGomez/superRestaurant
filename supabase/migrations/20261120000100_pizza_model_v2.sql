begin;

-- pizza-model-v2 (P3-2): persistence for the Pizza V2 model of docs/architecture/PIZZA_MODEL_V2.md.
--   * app.menu_products gets the V2 columns (pizza_mode, free_ingredient_count, base_group_ids,
--     default_ingredient_option_ids, customize_at_order, extra_option_ids). A legacy product keeps
--     pizza_mode null and every other V2 column at its neutral value (CHECK); no legacy `fraction`
--     configuration is migrated or inferred, and a V2 product cannot also carry a legacy fraction setup.
--   * save_menu_catalog / build_menu_catalog_state / normalize_menu_catalog_payload round-trip the V2
--     fields and validate baseGroupIds, extraOptionIds and defaultIngredientOptionIds by restaurant_id and
--     catalog_id: every base group is assigned to the product in this very release, every extra option is
--     offered by a group assigned to the product, every recipe option belongs to any of the base groups,
--     and no option is both recipe and extra. The legacy input forms baseGroupId/extraGroupIds are parsed
--     and normalized to baseGroupIds/extraOptionIds (the extra groups expand to their active options).
--     Arrays cannot carry foreign keys, and a foreign key from products to groups would be checked before
--     the groups are inserted, so the checks run in the function (the same way the legacy fraction groups
--     are checked) next to the table CHECKs.
--   * app_private.pizza_halves_price_v2 is the SQL twin of resolvePizzaHalvesPricing (packages/domain):
--     same input/snapshot shape, same formula (N of the most expensive custom half, ties by smaller
--     productId then half-a; dedupe by optionId before N; free = first N by price, groupId, optionId;
--     ceil(price/2) per ingredient in one half, the full price in both; extras never consume N).
--   * app_private.build_pizza_halves_input_v2 reads the catalog release and builds that input; the server
--     never trusts a client amount.
--   * replace_capture_selection_plan / confirm_capture_draft_v3 are copied whole from their latest
--     definitions (20261008000200 and 20261102000100) and gain the V2 branch. A plan schemaVersion 2 may
--     carry `pizza` lines (ruleVersion pizza-halves-v2); schemaVersion 1 plans keep their exact legacy
--     keys, so a client that only knows the legacy version cannot store a V2 line and a legacy selection
--     with two custom halves is rejected with the explicit reason `fraction_both_custom`.
--   * Idempotency is the existing app.capture_command_events journal (unique actor, restaurant, branch,
--     key) with the existing advisory lock; there is no parallel mechanism.
-- Rollback (compatible, before any V2 product is published): drop the new constraints/columns and restore
-- the previous definitions of the five replaced functions (20261106000100 for the catalog trio, 20261102000100
-- for confirm_capture_draft_v3, 20261008000200 for replace_capture_selection_plan), then drop the new
-- helper functions.

create function app_private.uuid_array_is_set(p_values uuid[])
returns boolean language sql immutable set search_path = '' as $function$
  select pg_catalog.cardinality(p_values)
    = (select pg_catalog.count(distinct entry.value) from pg_catalog.unnest(p_values) as entry(value))
$function$;

alter table app.menu_products
  add column pizza_mode text,
  add column free_ingredient_count integer not null default 0,
  add column base_group_ids uuid[] not null default '{}'::uuid[],
  add column default_ingredient_option_ids uuid[] not null default '{}'::uuid[],
  add column customize_at_order boolean not null default false,
  add column extra_option_ids uuid[] not null default '{}'::uuid[],
  add constraint menu_products_pizza_mode_valid
    check (pizza_mode is null or pizza_mode in ('specialty', 'custom')),
  add constraint menu_products_pizza_free_count_valid
    check (free_ingredient_count between 0 and 40),
  add constraint menu_products_pizza_arrays_valid check (
    pg_catalog.cardinality(default_ingredient_option_ids) <= 40
    and pg_catalog.array_position(default_ingredient_option_ids, null) is null
    and pg_catalog.cardinality(base_group_ids) <= 200
    and pg_catalog.array_position(base_group_ids, null) is null
    and pg_catalog.cardinality(extra_option_ids) <= 200
    and pg_catalog.array_position(extra_option_ids, null) is null
    and app_private.uuid_array_is_set(default_ingredient_option_ids)
    and app_private.uuid_array_is_set(base_group_ids)
    and app_private.uuid_array_is_set(extra_option_ids)
  ),
  add constraint menu_products_pizza_legacy_neutral check (
    pizza_mode is not null or (
      free_ingredient_count = 0 and not customize_at_order
      and pg_catalog.cardinality(default_ingredient_option_ids) = 0
      and pg_catalog.cardinality(base_group_ids) = 0
      and pg_catalog.cardinality(extra_option_ids) = 0
    )
  ),
  add constraint menu_products_pizza_custom_has_base
    check (pizza_mode is distinct from 'custom' or pg_catalog.cardinality(base_group_ids) > 0),
  add constraint menu_products_pizza_recipe_has_base
    check (pg_catalog.cardinality(default_ingredient_option_ids) = 0
      or pg_catalog.cardinality(base_group_ids) > 0),
  add constraint menu_products_pizza_option_roles
    check (not (default_ingredient_option_ids && extra_option_ids));

-- Shape of the optional Pizza V2 fields of one product entry of a save_menu_catalog payload. The
-- legacy `baseGroupId`/`extraGroupIds` forms are accepted next to the canonical `baseGroupIds`/
-- `extraOptionIds` lists, never together; option-level membership is validated after the insert,
-- against the release rows the function just wrote.
create function app_private.menu_pizza_product_shape_valid(p_payload jsonb, p_product jsonb)
returns boolean language plpgsql immutable set search_path = '' as $function$
declare
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  mode_value jsonb := coalesce(p_product->'pizzaMode', 'null'::jsonb);
  group_ids jsonb := app_private.menu_product_group_ids(p_payload, p_product);
  base_groups jsonb := coalesce(p_product->'baseGroupIds', '[]'::jsonb);
  base_group jsonb := coalesce(p_product->'baseGroupId', 'null'::jsonb);
  extras jsonb := coalesce(p_product->'extraOptionIds', '[]'::jsonb);
  extra_groups jsonb := coalesce(p_product->'extraGroupIds', '[]'::jsonb);
  defaults jsonb := coalesce(p_product->'defaultIngredientOptionIds', '[]'::jsonb);
begin
  if mode_value = 'null'::jsonb then
    -- Fail closed: V2 fields without a mode are never silently dropped.
    return not (p_product ?| array['freeIngredientCount','baseGroupIds','baseGroupId',
      'defaultIngredientOptionIds','customizeAtOrder','extraOptionIds','extraGroupIds']);
  end if;
  if pg_catalog.jsonb_typeof(mode_value) <> 'string' or (mode_value #>> '{}') not in ('specialty', 'custom') then
    return false;
  end if;
  if p_product ? 'freeIngredientCount' and not (
    pg_catalog.jsonb_typeof(p_product->'freeIngredientCount') = 'number'
    and case when (p_product->>'freeIngredientCount') ~ '^[0-9]{1,2}$'
      then (p_product->>'freeIngredientCount')::integer <= 40 else false end
  ) then return false; end if;
  if p_product ? 'customizeAtOrder' and pg_catalog.jsonb_typeof(p_product->'customizeAtOrder') <> 'boolean' then
    return false;
  end if;
  -- Canonical base groups: a bounded list of distinct UUIDs assigned to this product; the legacy single
  -- id is read only when the list is absent (emitting both is ambiguous).
  if p_product ? 'baseGroupIds' and p_product ? 'baseGroupId' then return false; end if;
  if p_product ? 'baseGroupIds' and pg_catalog.jsonb_typeof(p_product->'baseGroupIds') <> 'array' then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(base_groups) <> 'array' or pg_catalog.jsonb_array_length(base_groups) > 200 then
    return false;
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(base_groups) as entry(value)
    where pg_catalog.jsonb_typeof(entry.value) <> 'string'
      or not ((entry.value #>> '{}') ~* uuid_pattern)
      or not (group_ids @> pg_catalog.jsonb_build_array(entry.value))
  ) or (select pg_catalog.count(distinct entry.value) from pg_catalog.jsonb_array_elements(base_groups) as entry(value))
    <> pg_catalog.jsonb_array_length(base_groups)
  then return false; end if;
  if pg_catalog.jsonb_typeof(base_group) not in ('null', 'string') then return false; end if;
  if pg_catalog.jsonb_typeof(base_group) = 'string' and not (
    (base_group #>> '{}') ~* uuid_pattern and group_ids @> pg_catalog.jsonb_build_array(base_group)
  ) then return false; end if;
  if (mode_value #>> '{}') = 'custom' and pg_catalog.jsonb_array_length(base_groups) = 0
    and pg_catalog.jsonb_typeof(base_group) <> 'string' then return false; end if;
  -- Canonical extra options: a bounded list of distinct UUIDs (membership belongs to the release check).
  if p_product ? 'extraOptionIds' and pg_catalog.jsonb_typeof(p_product->'extraOptionIds') <> 'array' then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(extras) <> 'array' or pg_catalog.jsonb_array_length(extras) > 200 then
    return false;
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(extras) as entry(value)
    where pg_catalog.jsonb_typeof(entry.value) <> 'string' or not ((entry.value #>> '{}') ~* uuid_pattern)
  ) or (select pg_catalog.count(distinct entry.value) from pg_catalog.jsonb_array_elements(extras) as entry(value))
    <> pg_catalog.jsonb_array_length(extras)
  then return false; end if;
  -- Legacy extra groups: bounded, distinct and assigned to the product; never next to the option list.
  if p_product ? 'extraOptionIds' and p_product ? 'extraGroupIds' then return false; end if;
  if p_product ? 'extraGroupIds' and pg_catalog.jsonb_typeof(p_product->'extraGroupIds') <> 'array' then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(extra_groups) <> 'array' or pg_catalog.jsonb_array_length(extra_groups) > 24 then
    return false;
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(extra_groups) as entry(value)
    where pg_catalog.jsonb_typeof(entry.value) <> 'string'
      or not ((entry.value #>> '{}') ~* uuid_pattern)
      or not (group_ids @> pg_catalog.jsonb_build_array(entry.value))
  ) or (select pg_catalog.count(distinct entry.value) from pg_catalog.jsonb_array_elements(extra_groups) as entry(value))
    <> pg_catalog.jsonb_array_length(extra_groups)
  then return false; end if;
  -- Recipe option ids: bounded and distinct; the base-group membership is checked against the release and
  -- an option cannot be both part of the recipe and a charged extra.
  if p_product ? 'defaultIngredientOptionIds'
    and pg_catalog.jsonb_typeof(p_product->'defaultIngredientOptionIds') <> 'array' then return false; end if;
  if pg_catalog.jsonb_typeof(defaults) <> 'array' or pg_catalog.jsonb_array_length(defaults) > 40 then return false; end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(defaults) as entry(value)
    where pg_catalog.jsonb_typeof(entry.value) <> 'string' or not ((entry.value #>> '{}') ~* uuid_pattern)
  ) or (select pg_catalog.count(distinct entry.value) from pg_catalog.jsonb_array_elements(defaults) as entry(value))
    <> pg_catalog.jsonb_array_length(defaults)
  then return false; end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(defaults) as entry(value)
    where extras @> pg_catalog.jsonb_build_array(entry.value)
  ) then return false; end if;
  if pg_catalog.jsonb_array_length(defaults) > 0 and pg_catalog.jsonb_array_length(base_groups) = 0
    and pg_catalog.jsonb_typeof(base_group) <> 'string' then return false; end if;
  return true;
end $function$;

-- Replay equivalence: an absent mode equals an explicit null; a V2 product is rewritten to its canonical
-- lists (legacy baseGroupId -> [id], extraGroupIds -> their active option ids, in payload order).
create function app_private.normalize_menu_pizza_product(p_payload jsonb, p_product jsonb)
returns jsonb language sql immutable set search_path = '' as $function$
  select case when coalesce(p_product->'pizzaMode', 'null'::jsonb) = 'null'::jsonb
    then p_product - 'pizzaMode'
    else pg_catalog.jsonb_build_object(
      'baseGroupIds', case
        when p_product ? 'baseGroupIds' then p_product->'baseGroupIds'
        when coalesce(p_product->'baseGroupId', 'null'::jsonb) <> 'null'::jsonb
          then pg_catalog.jsonb_build_array(p_product->'baseGroupId')
        else '[]'::jsonb end,
      'freeIngredientCount', coalesce(p_product->'freeIngredientCount', '0'::jsonb),
      'defaultIngredientOptionIds', coalesce(p_product->'defaultIngredientOptionIds', '[]'::jsonb),
      'customizeAtOrder', coalesce(p_product->'customizeAtOrder', 'false'::jsonb),
      'extraOptionIds', case
        when p_product ? 'extraOptionIds' then p_product->'extraOptionIds'
        when p_product ? 'extraGroupIds' then coalesce((
          select pg_catalog.jsonb_agg(option_row.value->'optionId' order by requested_group.ord, option_row.ord)
          from pg_catalog.jsonb_array_elements(p_product->'extraGroupIds') with ordinality as requested_group(value, ord)
          cross join lateral (
            select grp.value from pg_catalog.jsonb_array_elements(p_payload->'modifierGroups') as grp(value)
            where grp.value->>'groupId' = requested_group.value #>> '{}'
          ) as matched_group(value)
          cross join lateral pg_catalog.jsonb_array_elements(matched_group.value->'options')
            with ordinality as option_row(value, ord)
          where coalesce((option_row.value->>'active')::boolean, false)
        ), '[]'::jsonb)
        else '[]'::jsonb end
    ) || (p_product - 'baseGroupId' - 'extraGroupIds')
  end
$function$;

-- SQL twin of resolvePizzaHalvesPricing. Input: {ruleVersion, currency, halves:[{fraction, productId,
-- productName, stationId, sizeId, sizeName, kind, basePriceMinor, freeIngredientCount,
-- ingredients:[{optionId, groupId, name, priceMinor}], extras:[...], removedIngredientOptionIds:[...]}]}.
-- Returns the frozen snapshot, or {issues:[{code, ...}]} for any rule violation. The caller supplies
-- well-formed values (build_pizza_halves_input_v2 reads them from catalog rows).
create function app_private.pizza_halves_price_v2(p_input jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $function$
declare
  currency text := p_input->>'currency';
  halves jsonb; half jsonb; issues jsonb := '[]'::jsonb; opts jsonb; found_issues jsonb;
  base_price bigint; base_fraction text; free_count integer := 0; free_fraction text;
  charges jsonb; free_order jsonb; charges_total bigint; halves_out jsonb;
begin
  if p_input is null or currency is null or currency !~ '^[A-Z]{3}$'
    or pg_catalog.jsonb_typeof(p_input->'halves') is distinct from 'array'
  then
    return pg_catalog.jsonb_build_object('issues', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('code', 'input_malformed')));
  end if;
  halves := p_input->'halves';
  if pg_catalog.jsonb_array_length(halves) <> 2 or (
    select pg_catalog.count(distinct entry.value->>'fraction')
    from pg_catalog.jsonb_array_elements(halves) as entry(value)
    where entry.value->>'fraction' in ('half-a', 'half-b')
  ) <> 2 then
    return pg_catalog.jsonb_build_object('issues', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('code', 'halves_mismatch')));
  end if;
  if p_input->>'ruleVersion' = 'pizza-halves-v1' then
    return pg_catalog.jsonb_build_object('issues', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'code', case when (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(halves) as entry(value)
          where entry.value->>'kind' = 'custom') = 2 then 'fraction_both_custom' else 'rule_version_legacy' end)));
  elsif p_input->>'ruleVersion' is distinct from 'pizza-halves-v2' then
    return pg_catalog.jsonb_build_object('issues', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('code', 'rule_version_unknown')));
  end if;

  for half in
    select entry.value from pg_catalog.jsonb_array_elements(halves) with ordinality as entry(value, ordinality)
    order by entry.ordinality
  loop
    if half->>'kind' = 'specialty' and pg_catalog.jsonb_array_length(half->'ingredients') > 0 then
      issues := issues || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'code', 'specialty_ingredients_not_allowed', 'fraction', half->>'fraction'));
    end if;
    if half->>'kind' = 'custom' and pg_catalog.jsonb_array_length(half->'removedIngredientOptionIds') > 0 then
      issues := issues || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'code', 'removal_not_allowed', 'fraction', half->>'fraction'));
    end if;
    if (select pg_catalog.count(distinct entry.value->>'optionId')
        from pg_catalog.jsonb_array_elements(half->'ingredients') as entry(value))
      <> pg_catalog.jsonb_array_length(half->'ingredients')
      or (select pg_catalog.count(distinct entry.value->>'optionId')
        from pg_catalog.jsonb_array_elements(half->'extras') as entry(value))
      <> pg_catalog.jsonb_array_length(half->'extras')
    then
      issues := issues || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'code', 'option_duplicate', 'fraction', half->>'fraction'));
    end if;
  end loop;

  -- Flat list of every selected option with its role and half, in input order.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'role', role_entry.role, 'optionId', option_entry.value->>'optionId',
      'groupId', option_entry.value->>'groupId', 'name', option_entry.value->>'name',
      'priceMinor', (option_entry.value->>'priceMinor')::bigint, 'fraction', half_entry.value->>'fraction',
      'seq', (half_entry.ordinality * 10 + role_entry.ord) * 1000 + option_entry.ordinality
    ) order by half_entry.ordinality, role_entry.ord, option_entry.ordinality), '[]'::jsonb)
  into opts
  from pg_catalog.jsonb_array_elements(halves) with ordinality as half_entry(value, ordinality)
  cross join (values ('ingredients', 1), ('extras', 2)) as role_entry(role, ord)
  cross join lateral pg_catalog.jsonb_array_elements(half_entry.value->role_entry.role)
    with ordinality as option_entry(value, ordinality);

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'code', case conflict.role when 'ingredients' then 'pizza_ingredient_price_conflict' else 'pizza_extra_price_conflict' end,
    'optionId', conflict.option_id) order by case conflict.role when 'ingredients' then 0 else 1 end, conflict.option_id), '[]'::jsonb)
  into found_issues
  from (
    select o.role, o."optionId" as option_id
    from pg_catalog.jsonb_to_recordset(opts) as o(role text, "optionId" text, "groupId" text, name text, "priceMinor" bigint, fraction text, seq bigint)
    group by o.role, o."optionId"
    having pg_catalog.count(distinct o."groupId") > 1 or pg_catalog.count(distinct o."priceMinor") > 1
  ) as conflict;
  issues := issues || found_issues;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'code', 'option_role_conflict', 'optionId', clash.option_id) order by clash.option_id), '[]'::jsonb)
  into found_issues
  from (
    select distinct o."optionId" as option_id
    from pg_catalog.jsonb_to_recordset(opts) as o(role text, "optionId" text, "groupId" text, name text, "priceMinor" bigint, fraction text, seq bigint)
    where o.role = 'ingredients' and exists (
      select 1 from pg_catalog.jsonb_to_recordset(opts) as e(role text, "optionId" text, "groupId" text, name text, "priceMinor" bigint, fraction text, seq bigint)
      where e.role = 'extras' and e."optionId" = o."optionId")
  ) as clash;
  issues := issues || found_issues;
  if pg_catalog.jsonb_array_length(issues) > 0 then
    return pg_catalog.jsonb_build_object('issues', issues);
  end if;

  -- Base: the most expensive whole-pizza price (ties keep half-a, which never changes the amount).
  select (entry.value->>'basePriceMinor')::bigint, entry.value->>'fraction' into base_price, base_fraction
  from pg_catalog.jsonb_array_elements(halves) as entry(value)
  order by (entry.value->>'basePriceMinor')::bigint desc, (entry.value->>'fraction') collate "C"
  limit 1;
  -- N: from the most expensive custom half; equal prices fall to the smaller productId, then half-a.
  select (entry.value->>'freeIngredientCount')::integer, entry.value->>'fraction' into free_count, free_fraction
  from pg_catalog.jsonb_array_elements(halves) as entry(value)
  where entry.value->>'kind' = 'custom'
  order by (entry.value->>'basePriceMinor')::bigint desc, (entry.value->>'productId') collate "C",
    (entry.value->>'fraction') collate "C"
  limit 1;
  if not found then free_count := 0; free_fraction := null; end if;

  with merged as (
    select o.role,
      case o.role when 'ingredients' then 1 else 2 end as role_ord,
      case o.role when 'ingredients' then 'ingredient' else 'extra' end as role_name,
      o."optionId" as option_id,
      (pg_catalog.array_agg(o."groupId" order by o.seq))[1] as group_id,
      (pg_catalog.array_agg(o.name order by o.seq))[1] as name,
      (pg_catalog.array_agg(o."priceMinor" order by o.seq))[1] as price,
      pg_catalog.array_agg(distinct o.fraction order by o.fraction) as fractions
    from pg_catalog.jsonb_to_recordset(opts) as o(role text, "optionId" text, "groupId" text, name text, "priceMinor" bigint, fraction text, seq bigint)
    group by o.role, o."optionId"
  ), ranked as (
    select m.*, pg_catalog.row_number() over (
      partition by m.role
      order by case when m.role = 'ingredients' then m.price else 0 end,
        (case when m.role = 'ingredients' then m.group_id else '' end) collate "C",
        m.option_id collate "C"
    ) as rn
    from merged as m
  ), priced as (
    select r.*, (r.role_ord = 1 and r.rn <= free_count) as free,
      case when r.role_ord = 1 and r.rn <= free_count then 0::bigint
        when pg_catalog.cardinality(r.fractions) = 2 then r.price
        else (r.price + 1) / 2 end as amount
    from ranked as r
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'optionId', c.option_id, 'groupId', c.group_id, 'name', c.name, 'role', c.role_name,
      'fractions', pg_catalog.to_jsonb(c.fractions), 'free', c.free,
      'amount', pg_catalog.jsonb_build_object('amountMinor', c.amount, 'currency', currency)
    ) order by c.role_ord, c.rn), '[]'::jsonb),
    coalesce(pg_catalog.jsonb_agg(c.option_id order by c.rn) filter (where c.free), '[]'::jsonb),
    coalesce(pg_catalog.sum(c.amount), 0)::bigint
  into charges, free_order, charges_total
  from priced as c;

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'basePriceMinor', (entry.value->>'basePriceMinor')::bigint,
    'fraction', entry.value->>'fraction',
    'freeIngredientCount', (entry.value->>'freeIngredientCount')::integer,
    'kind', entry.value->>'kind',
    'productId', entry.value->>'productId',
    'productName', entry.value->>'productName',
    'removedIngredientOptionIds', entry.value->'removedIngredientOptionIds',
    'sizeId', entry.value->>'sizeId',
    'sizeName', entry.value->>'sizeName',
    'stationId', entry.value->>'stationId'
  ) order by (entry.value->>'fraction') collate "C") into halves_out
  from pg_catalog.jsonb_array_elements(halves) as entry(value);

  return pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'ruleVersion', 'pizza-halves-v2',
    'currency', currency,
    'basePrice', pg_catalog.jsonb_build_object('amountMinor', base_price, 'currency', currency),
    'baseFraction', base_fraction,
    'freeIngredientCount', free_count,
    'freeIngredientCountFraction', free_fraction,
    'freeAssignmentOrder', free_order,
    'charges', charges,
    'halves', halves_out,
    'total', pg_catalog.jsonb_build_object('amountMinor', base_price + charges_total, 'currency', currency)
  );
end $function$;

-- Shape of the `pizza` object of one selection-plan line (plan schemaVersion 2). Catalog facts are
-- checked later, at confirmation, against the release.
create function app_private.pizza_selection_line_shape_valid(p_line jsonb)
returns boolean language plpgsql immutable set search_path = '' as $function$
declare
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  pizza jsonb := p_line->'pizza';
  half jsonb;
  half_a jsonb;
begin
  if not app_private.jsonb_has_exact_keys(pizza, array['ruleVersion', 'halves'])
    or pizza->>'ruleVersion' is distinct from 'pizza-halves-v2'
    or pg_catalog.jsonb_typeof(pizza->'halves') <> 'array'
    or pg_catalog.jsonb_array_length(pizza->'halves') <> 2
  then return false; end if;
  for half in select entry.value from pg_catalog.jsonb_array_elements(pizza->'halves') as entry(value) loop
    if not app_private.jsonb_has_exact_keys(half, array[
        'fraction', 'productId', 'variantId', 'ingredientOptionIds', 'extraOptionIds', 'removedIngredientOptionIds'
      ])
      or half->>'fraction' not in ('half-a', 'half-b')
      or not coalesce(half->>'productId' ~ uuid_pattern, false)
      or not (pg_catalog.jsonb_typeof(half->'variantId') = 'null'
        or coalesce(half->>'variantId' ~ uuid_pattern, false))
    then return false; end if;
    if pg_catalog.jsonb_typeof(half->'ingredientOptionIds') <> 'array' or pg_catalog.jsonb_array_length(half->'ingredientOptionIds') > 40
      or pg_catalog.jsonb_typeof(half->'extraOptionIds') <> 'array' or pg_catalog.jsonb_array_length(half->'extraOptionIds') > 20
      or pg_catalog.jsonb_typeof(half->'removedIngredientOptionIds') <> 'array'
      or pg_catalog.jsonb_array_length(half->'removedIngredientOptionIds') > 40
    then return false; end if;
    if exists (
      select 1 from pg_catalog.jsonb_array_elements(
        (half->'ingredientOptionIds') || (half->'extraOptionIds') || (half->'removedIngredientOptionIds')
      ) as entry(value)
      where pg_catalog.jsonb_typeof(entry.value) <> 'string' or not ((entry.value #>> '{}') ~ uuid_pattern)
    ) then return false; end if;
  end loop;
  if (select pg_catalog.count(distinct entry.value->>'fraction')
      from pg_catalog.jsonb_array_elements(pizza->'halves') as entry(value)) <> 2
  then return false; end if;
  -- The line itself names the product and size of half-a.
  select entry.value into half_a from pg_catalog.jsonb_array_elements(pizza->'halves') as entry(value)
  where entry.value->>'fraction' = 'half-a';
  return half_a->>'productId' is not distinct from p_line->>'productId'
    and half_a->>'variantId' is not distinct from p_line->>'variantId';
end $function$;

-- Builds the pricing input of a V2 line from the catalog release; null means a catalog conflict (a
-- product, size, option or group that is missing, inactive, foreign to the release or not allowed).
create function app_private.build_pizza_halves_input_v2(
  p_restaurant uuid, p_catalog uuid, p_currency text, p_line jsonb
) returns jsonb language plpgsql stable set search_path = '' as $function$
declare
  pizza jsonb := p_line->'pizza';
  half jsonb; half_product app.menu_products%rowtype; half_variant app.menu_product_variants%rowtype;
  ingredients jsonb; extras jsonb; matched integer;
  halves_out jsonb := '[]'::jsonb;
  size_keys text[] := '{}'::text[]; tax_keys text[] := '{}'::text[];
begin
  if pizza is null or pg_catalog.jsonb_typeof(pizza->'halves') is distinct from 'array'
    or pg_catalog.jsonb_array_length(pizza->'halves') <> 2
  then return null; end if;
  for half in select entry.value from pg_catalog.jsonb_array_elements(pizza->'halves') as entry(value) loop
    select product_record.* into half_product
    from app.menu_products product_record
    join app.menu_categories category on category.restaurant_id = product_record.restaurant_id
      and category.catalog_id = product_record.catalog_id and category.id = product_record.category_id
    where product_record.restaurant_id = p_restaurant and product_record.catalog_id = p_catalog
      and product_record.id = (half->>'productId')::uuid
      and product_record.active and category.active and product_record.pizza_mode is not null;
    if not found then return null; end if;

    half_variant := null;
    if pg_catalog.jsonb_typeof(half->'variantId') = 'string' then
      select variant_row.* into half_variant from app.menu_product_variants variant_row
      where variant_row.restaurant_id = p_restaurant and variant_row.catalog_id = p_catalog
        and variant_row.product_id = half_product.id and variant_row.id = (half->>'variantId')::uuid
        and variant_row.active;
      if not found then return null; end if;
    elsif exists (
      select 1 from app.menu_product_variants variant_row
      where variant_row.restaurant_id = p_restaurant and variant_row.catalog_id = p_catalog
        and variant_row.product_id = half_product.id and variant_row.active
    ) then return null; end if;

    if half->>'fraction' = 'half-a' and (
      half_product.id::text is distinct from p_line->>'productId'
      or half_variant.id::text is distinct from p_line->>'variantId'
    ) then return null; end if;
    size_keys := size_keys || coalesce(pg_catalog.lower(pg_catalog.btrim(half_variant.name)), '');
    tax_keys := tax_keys || pg_catalog.concat_ws('|', half_product.tax_id, half_product.tax_rule_version,
      half_product.tax_rate_numerator::text, half_product.tax_rate_denominator::text, half_product.tax_inclusion);

    -- A specialty only changes its recipe when the product allows it at order time.
    if half_product.pizza_mode = 'specialty' and not half_product.customize_at_order and (
      pg_catalog.jsonb_array_length(half->'extraOptionIds') > 0
      or pg_catalog.jsonb_array_length(half->'removedIngredientOptionIds') > 0
    ) then return null; end if;
    if exists (
      select 1 from pg_catalog.jsonb_array_elements_text(half->'removedIngredientOptionIds') as removed(id)
      where not (removed.id::uuid = any (half_product.default_ingredient_option_ids))
    ) then return null; end if;

    -- Chosen ingredients come from any base group of the half's own product; a request that does not
    -- resolve to exactly one active option of an active group is a conflict (duplicates stay visible
    -- to the pricing rules).
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'optionId', option_record.id::text, 'groupId', option_record.group_id::text,
        'name', option_record.name, 'priceMinor', option_record.unit_price_minor
      ) order by requested.ordinality), '[]'::jsonb), pg_catalog.count(*)
    into ingredients, matched
    from pg_catalog.jsonb_array_elements_text(half->'ingredientOptionIds') with ordinality as requested(id, ordinality)
    join app.menu_modifier_options option_record on option_record.restaurant_id = p_restaurant
      and option_record.catalog_id = p_catalog
      and option_record.group_id = any (half_product.base_group_ids)
      and option_record.id = requested.id::uuid and option_record.active
    join app.menu_modifier_groups option_group on option_group.restaurant_id = option_record.restaurant_id
      and option_group.catalog_id = option_record.catalog_id and option_group.id = option_record.group_id
      and option_group.active;
    if matched <> pg_catalog.jsonb_array_length(half->'ingredientOptionIds') then return null; end if;

    -- Extras are the product's own loose charged options (extraOptionIds), whatever group offers them:
    -- the role is decided by the list the id arrives in, never by the group.
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'optionId', option_record.id::text, 'groupId', option_record.group_id::text,
        'name', option_record.name, 'priceMinor', option_record.unit_price_minor
      ) order by requested.ordinality), '[]'::jsonb), pg_catalog.count(*)
    into extras, matched
    from pg_catalog.jsonb_array_elements_text(half->'extraOptionIds') with ordinality as requested(id, ordinality)
    join app.menu_modifier_options option_record on option_record.restaurant_id = p_restaurant
      and option_record.catalog_id = p_catalog
      and option_record.id = any (half_product.extra_option_ids)
      and option_record.id = requested.id::uuid and option_record.active
    join app.menu_modifier_groups option_group on option_group.restaurant_id = option_record.restaurant_id
      and option_group.catalog_id = option_record.catalog_id and option_group.id = option_record.group_id
      and option_group.active;
    if matched <> pg_catalog.jsonb_array_length(half->'extraOptionIds') then return null; end if;

    halves_out := halves_out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'fraction', half->>'fraction',
      'productId', half_product.id::text,
      'productName', half_product.name,
      'stationId', half_product.station_id,
      'sizeId', coalesce(half_variant.id, half_product.id)::text,
      'sizeName', coalesce(half_variant.name, 'Única'),
      'kind', half_product.pizza_mode,
      'basePriceMinor', coalesce(half_variant.unit_price_minor, half_product.unit_price_minor),
      'freeIngredientCount', half_product.free_ingredient_count,
      'ingredients', ingredients,
      'extras', extras,
      'removedIngredientOptionIds', half->'removedIngredientOptionIds'
    ));
  end loop;
  -- Both halves are the same physical pizza: same size and the same fiscal treatment.
  if size_keys[1] is distinct from size_keys[2] or tax_keys[1] is distinct from tax_keys[2] then return null; end if;
  return pg_catalog.jsonb_build_object(
    'ruleVersion', pizza->>'ruleVersion', 'currency', p_currency, 'halves', halves_out);
exception when invalid_text_representation or invalid_parameter_value or numeric_value_out_of_range then
  return null;
end $function$;

-- Min/max of the pizza groups, per half and per group: the chosen ingredients of a half are counted
-- against each of its product's base groups, the chosen extras against the group each declared extra
-- option belongs to. The minimum of a group only binds where the half can actually choose from it:
-- ingredients of a custom half, extras of a custom half or of a specialty that is customizable at order
-- time; the maximum always binds. Missing products/groups return false (the builder reports the same
-- catalog conflict).
create function app_private.pizza_quantities_valid(
  p_restaurant uuid, p_catalog uuid, p_line jsonb
) returns boolean language plpgsql stable set search_path = '' as $function$
declare
  half jsonb; half_product app.menu_products%rowtype; group_record app.menu_modifier_groups%rowtype;
  chosen integer; base_group_id uuid; extra_group_id uuid;
begin
  if p_line is null or pg_catalog.jsonb_typeof(p_line->'pizza'->'halves') is distinct from 'array' then return false; end if;
  for half in select entry.value from pg_catalog.jsonb_array_elements(p_line->'pizza'->'halves') as entry(value) loop
    select product_record.* into half_product from app.menu_products product_record
    where product_record.restaurant_id = p_restaurant and product_record.catalog_id = p_catalog
      and product_record.id = (half->>'productId')::uuid;
    if not found or half_product.pizza_mode is null then return false; end if;

    foreach base_group_id in array half_product.base_group_ids loop
      select g.* into group_record from app.menu_modifier_groups g
      where g.restaurant_id = p_restaurant and g.catalog_id = p_catalog and g.id = base_group_id;
      if not found then return false; end if;
      select pg_catalog.count(*)::integer into chosen
      from pg_catalog.jsonb_array_elements_text(half->'ingredientOptionIds') as requested(id)
      join app.menu_modifier_options option_record on option_record.restaurant_id = p_restaurant
        and option_record.catalog_id = p_catalog and option_record.group_id = base_group_id
        and option_record.id = requested.id::uuid;
      if chosen > group_record.maximum_quantity
        or (half_product.pizza_mode = 'custom' and chosen < group_record.minimum_quantity)
      then return false; end if;
    end loop;

    for extra_group_id in
      select distinct option_record.group_id from app.menu_modifier_options option_record
      where option_record.restaurant_id = p_restaurant and option_record.catalog_id = p_catalog
        and option_record.id = any (half_product.extra_option_ids)
    loop
      select g.* into group_record from app.menu_modifier_groups g
      where g.restaurant_id = p_restaurant and g.catalog_id = p_catalog and g.id = extra_group_id;
      if not found then return false; end if;
      select pg_catalog.count(*)::integer into chosen
      from pg_catalog.jsonb_array_elements_text(half->'extraOptionIds') as requested(id)
      join app.menu_modifier_options option_record on option_record.restaurant_id = p_restaurant
        and option_record.catalog_id = p_catalog and option_record.group_id = extra_group_id
        and option_record.id = requested.id::uuid;
      if chosen > group_record.maximum_quantity
        or ((half_product.pizza_mode = 'custom' or half_product.customize_at_order)
          and chosen < group_record.minimum_quantity)
      then return false; end if;
    end loop;
  end loop;
  return true;
exception when invalid_text_representation or invalid_parameter_value or numeric_value_out_of_range then
  return false;
end $function$;

alter function app_private.pizza_quantities_valid(uuid, uuid, jsonb) owner to postgres;
revoke all on function app_private.pizza_quantities_valid(uuid, uuid, jsonb) from public, anon, authenticated, service_role, app_api;
alter function app_private.uuid_array_is_set(uuid[]) owner to postgres;
alter function app_private.menu_pizza_product_shape_valid(jsonb, jsonb) owner to postgres;
alter function app_private.normalize_menu_pizza_product(jsonb, jsonb) owner to postgres;
alter function app_private.pizza_halves_price_v2(jsonb) owner to postgres;
alter function app_private.pizza_selection_line_shape_valid(jsonb) owner to postgres;
alter function app_private.build_pizza_halves_input_v2(uuid, uuid, text, jsonb) owner to postgres;
revoke all on function app_private.uuid_array_is_set(uuid[]) from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.menu_pizza_product_shape_valid(jsonb, jsonb) from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.normalize_menu_pizza_product(jsonb, jsonb) from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.pizza_halves_price_v2(jsonb) from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.pizza_selection_line_shape_valid(jsonb) from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.build_pizza_halves_input_v2(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role, app_api;

create or replace function app_private.build_menu_catalog_state(
  p_restaurant_id uuid, p_branch_id uuid, p_catalog_id uuid, p_replayed boolean
) returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare result jsonb;
begin
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('restaurantId', p_restaurant_id::text, 'branchId', p_branch_id::text),
    'catalog', case when catalog.id is null then null else pg_catalog.jsonb_build_object(
      'catalogVersion', catalog.id::text,
      'currency', catalog.currency,
      'sizePresets', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', preset.id::text,
          'name', preset.name,
          'displayOrder', preset.display_order,
          'active', preset.active
        ) order by preset.display_order, preset.id::text)
        from app.menu_size_presets as preset
        where preset.restaurant_id = catalog.restaurant_id and preset.catalog_id = catalog.id
      ), '[]'::jsonb),
      'categories', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'categoryId', category.id::text, 'name', category.name, 'active', category.active,
          'displayOrder', category.display_order,
          'color', category.color, 'imagePath', category.image_path
        ) order by category.display_order, category.id::text)
        from app.menu_categories as category
        where category.restaurant_id = catalog.restaurant_id and category.catalog_id = catalog.id
      ), '[]'::jsonb),
      'products', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'productId', product.id::text, 'categoryId', product.category_id::text, 'name', product.name,
          'sku', product.sku, 'active', product.active, 'displayOrder', product.display_order,
          'stationId', product.station_id, 'unit', product.unit, 'unitPriceMinor', product.unit_price_minor,
          'imagePath', product.image_path,
          'modifierGroupIds', coalesce((
            select pg_catalog.jsonb_agg(assignment.group_id::text order by assignment.display_order, assignment.group_id::text)
            from app.menu_product_modifier_groups as assignment
            where assignment.restaurant_id = product.restaurant_id and assignment.catalog_id = product.catalog_id
              and assignment.product_id = product.id
          ), '[]'::jsonb),
          'fraction', case when product.fraction_enabled or product.fraction_flavor_group_id is not null
            or product.fraction_extra_group_id is not null
            or pg_catalog.cardinality(product.fraction_excludable_ingredient_ids) > 0
            or pg_catalog.cardinality(product.fraction_locked_ingredient_option_ids) > 0
          then pg_catalog.jsonb_build_object(
            'enabled', product.fraction_enabled,
            'flavorGroupId', product.fraction_flavor_group_id::text,
            'extraGroupId', product.fraction_extra_group_id::text,
            'lockedIngredientOptionIds', coalesce(pg_catalog.to_jsonb(product.fraction_locked_ingredient_option_ids), '[]'::jsonb),
            'excludableIngredientIds', coalesce(pg_catalog.to_jsonb(product.fraction_excludable_ingredient_ids), '[]'::jsonb)
          ) else null end,
          'variants', coalesce((
            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
              'variantId', variant.id::text, 'name', variant.name, 'unitPriceMinor', variant.unit_price_minor,
              'active', variant.active, 'displayOrder', variant.display_order, 'sku', variant.sku,
              'sizePresetId', variant.size_preset_id::text,
              'fraction', case when variant.fraction_enabled or variant.fraction_flavor_group_id is not null
                or variant.fraction_extra_group_id is not null
                or pg_catalog.cardinality(variant.fraction_excludable_ingredient_ids) > 0
                or pg_catalog.cardinality(variant.fraction_locked_ingredient_option_ids) > 0
              then pg_catalog.jsonb_build_object(
                'enabled', variant.fraction_enabled,
                'flavorGroupId', variant.fraction_flavor_group_id::text,
                'extraGroupId', variant.fraction_extra_group_id::text,
                'lockedIngredientOptionIds', coalesce(pg_catalog.to_jsonb(variant.fraction_locked_ingredient_option_ids), '[]'::jsonb),
                'excludableIngredientIds', coalesce(pg_catalog.to_jsonb(variant.fraction_excludable_ingredient_ids), '[]'::jsonb)
              ) else null end
            ) order by variant.display_order, variant.id::text)
            from app.menu_product_variants as variant
            where variant.restaurant_id = product.restaurant_id and variant.catalog_id = product.catalog_id
              and variant.product_id = product.id
          ), '[]'::jsonb),
          'tax', case when product.tax_id is null then null else pg_catalog.jsonb_build_object(
            'taxId', product.tax_id, 'name', product.tax_name, 'taxRuleVersion', product.tax_rule_version,
            'rateNumerator', product.tax_rate_numerator, 'rateDenominator', product.tax_rate_denominator,
            'inclusion', product.tax_inclusion
          ) end
        ) || case when product.pizza_mode is null then '{}'::jsonb else pg_catalog.jsonb_build_object(
          'pizzaMode', product.pizza_mode,
          'freeIngredientCount', product.free_ingredient_count,
          'baseGroupIds', coalesce(pg_catalog.to_jsonb(product.base_group_ids), '[]'::jsonb),
          'defaultIngredientOptionIds', coalesce(pg_catalog.to_jsonb(product.default_ingredient_option_ids), '[]'::jsonb),
          'customizeAtOrder', product.customize_at_order,
          'extraOptionIds', coalesce(pg_catalog.to_jsonb(product.extra_option_ids), '[]'::jsonb)
        ) end order by product.display_order, product.id::text)
        from app.menu_products as product
        where product.restaurant_id = catalog.restaurant_id and product.catalog_id = catalog.id
      ), '[]'::jsonb),
      'modifierGroups', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'groupId', modifier_group.id::text, 'productId', modifier_group.product_id::text,
          'name', modifier_group.name, 'active', modifier_group.active,
          'displayOrder', modifier_group.display_order, 'minimumQuantity', modifier_group.minimum_quantity,
          'maximumQuantity', modifier_group.maximum_quantity,
          'options', coalesce((
            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
              'optionId', modifier_option.id::text, 'name', modifier_option.name,
              'unitPriceMinor', modifier_option.unit_price_minor, 'active', modifier_option.active,
              'maximumQuantity', modifier_option.maximum_quantity, 'imagePath', modifier_option.image_path
            ) order by modifier_option.id::text)
            from app.menu_modifier_options as modifier_option
            where modifier_option.restaurant_id = modifier_group.restaurant_id
              and modifier_option.catalog_id = modifier_group.catalog_id
              and modifier_option.group_id = modifier_group.id
          ), '[]'::jsonb)
        ) order by modifier_group.product_id::text nulls first, modifier_group.display_order, modifier_group.id::text)
        from app.menu_modifier_groups as modifier_group
        where modifier_group.restaurant_id = catalog.restaurant_id and modifier_group.catalog_id = catalog.id
      ), '[]'::jsonb),
      'version', catalog.version,
      'updatedAt', pg_catalog.to_char(catalog.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedBy', catalog.published_by::text,
      'replayed', p_replayed
    ) end
  ) into result
  from (select p_restaurant_id as requested_restaurant_id, p_catalog_id as requested_catalog_id) as requested
  left join app.menu_catalogs as catalog
    on catalog.restaurant_id = requested.requested_restaurant_id and catalog.id = requested.requested_catalog_id;
  return result;
end $function$;
create or replace function app_private.normalize_menu_catalog_payload(p_payload jsonb)
returns jsonb language sql immutable set search_path = '' as $function$
  select pg_catalog.jsonb_build_object(
    'sizePresets', coalesce((
      select pg_catalog.jsonb_agg(
        entry.value
        order by entry.ord)
      from pg_catalog.jsonb_array_elements(
        case when p_payload ? 'sizePresets' and p_payload->'sizePresets' <> 'null'::jsonb
             then p_payload->'sizePresets'
             else '[]'::jsonb end
      ) with ordinality as entry(value, ord)
    ), '[]'::jsonb),
    'categories', coalesce((
      select pg_catalog.jsonb_agg(
        entry.value - coalesce((
          select pg_catalog.array_agg(dropped.key)
          from (
            select 'color'::text as key where entry.value->'color' = 'null'::jsonb
            union all
            select 'imagePath'::text where entry.value->'imagePath' = 'null'::jsonb
          ) as dropped
        ), '{}'::text[])
        order by entry.ord)
      from pg_catalog.jsonb_array_elements(p_payload->'categories') with ordinality as entry(value, ord)
    ), '[]'::jsonb),
    'products', coalesce((
      select pg_catalog.jsonb_agg(
        (case when pg_catalog.jsonb_typeof(stripped.value->'variants') = 'array'
          then pg_catalog.jsonb_set(stripped.value, '{variants}', coalesce((
            select pg_catalog.jsonb_agg(
              case
                when normalized_variant.value->'fraction' = 'null'::jsonb then normalized_variant.value - 'fraction'
                when normalized_variant.value ? 'fraction' and normalized_variant.value->'fraction' <> 'null'::jsonb then
                  pg_catalog.jsonb_set(
                    normalized_variant.value,
                    '{fraction}',
                    normalized_variant.value->'fraction'
                      || case when not (normalized_variant.value->'fraction' ? 'excludableIngredientIds')
                           then pg_catalog.jsonb_build_object('excludableIngredientIds', '[]'::jsonb)
                           else '{}'::jsonb end
                  )
                else normalized_variant.value
              end
              order by normalized_variant.ord)
            from (
              select
                case
                  when variant_entry.value->'sizePresetId' = 'null'::jsonb then variant_entry.value - 'sizePresetId'
                  else variant_entry.value
                end as value,
                variant_entry.ord
              from pg_catalog.jsonb_array_elements(stripped.value->'variants') with ordinality as variant_entry(value, ord)
            ) as normalized_variant
          ), '[]'::jsonb))
          else stripped.value end)
        || pg_catalog.jsonb_build_object('modifierGroupIds', app_private.menu_product_group_ids(p_payload, stripped.value))
        order by stripped.ord)
      from (
        select entry.ord,
          app_private.normalize_menu_pizza_product(p_payload, (case
            when entry.value ? 'fraction' and entry.value->'fraction' <> 'null'::jsonb then
              pg_catalog.jsonb_set(
                entry.value,
                '{fraction}',
                entry.value->'fraction'
                  || case when not (entry.value->'fraction' ? 'excludableIngredientIds')
                       then pg_catalog.jsonb_build_object('excludableIngredientIds', '[]'::jsonb)
                       else '{}'::jsonb end
              )
            else entry.value
          end) - coalesce((
          select pg_catalog.array_agg(dropped.key)
          from (
            select 'imagePath'::text as key where entry.value->'imagePath' = 'null'::jsonb
            union all
            select 'fraction'::text where entry.value->'fraction' = 'null'::jsonb
            union all
            select 'variants'::text where entry.value->'variants' = '[]'::jsonb
          ) as dropped
        ), '{}'::text[])) as value
        from pg_catalog.jsonb_array_elements(p_payload->'products') with ordinality as entry(value, ord)
      ) as stripped
    ), '[]'::jsonb),
    'modifierGroups', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_set(
        case when grp.value->'productId' = 'null'::jsonb then grp.value - 'productId' else grp.value end,
        '{options}', coalesce((
        select pg_catalog.jsonb_agg(case when opt.value->'imagePath' = 'null'::jsonb then opt.value - 'imagePath' else opt.value end order by opt.ord)
        from pg_catalog.jsonb_array_elements(grp.value->'options') with ordinality as opt(value, ord)
      ), '[]'::jsonb)) order by grp.ord)
      from pg_catalog.jsonb_array_elements(p_payload->'modifierGroups') with ordinality as grp(value, ord)
    ), '[]'::jsonb)
  )
$function$;
create or replace function app_private.save_menu_catalog(
  p_actor_id uuid, p_restaurant_id uuid, p_branch_id uuid, p_event_id uuid, p_idempotency_key uuid,
  p_device_id uuid, p_occurred_at timestamptz, p_expected_version bigint, p_catalog_id uuid,
  p_currency text, p_payload jsonb
) returns table (status text, state jsonb)
language plpgsql volatile security definer set search_path = '' as $function$
declare
  category jsonb;
  product jsonb;
  product_variant jsonb;
  preset jsonb;
  modifier_group jsonb;
  modifier_option jsonb;
  canonical_product jsonb;
  existing_audit app.menu_catalog_audit_events%rowtype;
  current_version bigint;
  next_version bigint;
  published_at timestamptz;
  catalog_lock bigint;
  event_lock bigint;
begin
  if p_actor_id is null or p_restaurant_id is null or p_branch_id is null or p_event_id is null
    or p_idempotency_key is null or p_device_id is null or p_occurred_at is null or p_catalog_id is null
    or p_expected_version is null or p_expected_version < 0 or p_currency is null or p_currency !~ '^[A-Z]{3}$'
    or not app_private.jsonb_has_exact_keys(p_payload - 'sizePresets', array['categories','products','modifierGroups'])
    or (p_payload ? 'sizePresets' and (
      pg_catalog.jsonb_typeof(p_payload->'sizePresets') <> 'array'
      or pg_catalog.jsonb_array_length(p_payload->'sizePresets') > 24
    ))
    or pg_catalog.jsonb_typeof(p_payload->'categories') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload->'products') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload->'modifierGroups') <> 'array'
    or pg_catalog.jsonb_array_length(p_payload->'categories') > 200
    or pg_catalog.jsonb_array_length(p_payload->'products') > 2000
    or pg_catalog.jsonb_array_length(p_payload->'modifierGroups') > 2000
  then return query select 'conflict', null::jsonb; return; end if;

  if (p_payload ? 'sizePresets' and exists (
    select 1 from pg_catalog.jsonb_array_elements(p_payload->'sizePresets') as preset_entry(value)
    where not app_private.jsonb_has_exact_keys(
      preset_entry.value, array['id','name','displayOrder','active']
    )
    or pg_catalog.jsonb_typeof(preset_entry.value->'id') <> 'string'
    or not coalesce((preset_entry.value#>>'{id}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    or pg_catalog.jsonb_typeof(preset_entry.value->'name') <> 'string'
    or pg_catalog.char_length(pg_catalog.btrim(preset_entry.value->>'name')) not between 1 and 80
    or (preset_entry.value->>'name') ~ '[\u0000-\u001f\u007f-\u009f]'
    or pg_catalog.jsonb_typeof(preset_entry.value->'displayOrder') <> 'number'
    or (preset_entry.value->>'displayOrder')::integer < 0
    or pg_catalog.jsonb_typeof(preset_entry.value->'active') <> 'boolean'
  )) or (p_payload ? 'sizePresets' and (
    (select pg_catalog.count(distinct preset_entry.value->>'id')
     from pg_catalog.jsonb_array_elements(p_payload->'sizePresets') as preset_entry(value))
      <> pg_catalog.jsonb_array_length(p_payload->'sizePresets')
    or
    (select pg_catalog.count(distinct pg_catalog.lower(preset_entry.value->>'name'))
     from pg_catalog.jsonb_array_elements(p_payload->'sizePresets') as preset_entry(value))
      <> pg_catalog.jsonb_array_length(p_payload->'sizePresets')
  )) then return query select 'conflict', null::jsonb; return; end if;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_payload->'categories') as entry(value)
    where not app_private.jsonb_has_exact_keys(entry.value - 'color' - 'imagePath', array['categoryId','name','active','displayOrder'])
      or (entry.value ? 'color' and pg_catalog.jsonb_typeof(entry.value->'color') not in ('string', 'null'))
      or (entry.value ? 'imagePath' and pg_catalog.jsonb_typeof(entry.value->'imagePath') not in ('string', 'null'))
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_payload->'products') as entry(value)
    where not app_private.jsonb_has_exact_keys(
      entry.value - 'imagePath' - 'variants' - 'fraction' - 'modifierGroupIds'
        - 'pizzaMode' - 'freeIngredientCount' - 'baseGroupIds' - 'baseGroupId'
        - 'defaultIngredientOptionIds' - 'customizeAtOrder' - 'extraOptionIds' - 'extraGroupIds',
      array['productId','categoryId','name','sku','active','displayOrder','stationId','unit','unitPriceMinor','tax']
    ) or not app_private.menu_pizza_product_shape_valid(p_payload, entry.value)
      or (entry.value ? 'modifierGroupIds' and not (
      pg_catalog.jsonb_typeof(entry.value->'modifierGroupIds') = 'array'
      and pg_catalog.jsonb_array_length(entry.value->'modifierGroupIds') <= 200
      and not exists (
        select 1 from pg_catalog.jsonb_array_elements(entry.value->'modifierGroupIds') as group_ref(value)
        where pg_catalog.jsonb_typeof(group_ref.value) <> 'string'
      )
      and (select pg_catalog.count(distinct group_ref.value) from pg_catalog.jsonb_array_elements(entry.value->'modifierGroupIds') as group_ref(value))
        = pg_catalog.jsonb_array_length(entry.value->'modifierGroupIds')
    )) or (entry.value ? 'fraction' and entry.value->'fraction' <> 'null'::jsonb and not (
      app_private.jsonb_has_exact_keys(
        ((entry.value->'fraction') - 'lockedIngredientOptionIds'::text) - 'excludableIngredientIds'::text,
        array['enabled','flavorGroupId','extraGroupId']
      )
      and pg_catalog.jsonb_typeof(entry.value->'fraction'->'enabled') = 'boolean'
      and pg_catalog.jsonb_typeof(entry.value->'fraction'->'flavorGroupId') in ('string','null')
      and pg_catalog.jsonb_typeof(entry.value->'fraction'->'extraGroupId') in ('string','null')
      and (
        not (entry.value->'fraction' ? 'excludableIngredientIds') or (
          pg_catalog.jsonb_typeof(entry.value->'fraction'->'excludableIngredientIds') = 'array'
          and pg_catalog.jsonb_array_length(entry.value->'fraction'->'excludableIngredientIds') <= 40
          and not exists (
            select 1 from pg_catalog.jsonb_array_elements(entry.value->'fraction'->'excludableIngredientIds') as label(value)
            where pg_catalog.jsonb_typeof(label.value) <> 'string'
          )
        )
      )
      and (
        not (entry.value->'fraction' ? 'lockedIngredientOptionIds') or (
          pg_catalog.jsonb_typeof(entry.value->'fraction'->'lockedIngredientOptionIds') = 'array'
          and pg_catalog.jsonb_array_length(entry.value->'fraction'->'lockedIngredientOptionIds') <= 40
          and not exists (
            select 1 from pg_catalog.jsonb_array_elements(entry.value->'fraction'->'lockedIngredientOptionIds') as opt(value)
            where pg_catalog.jsonb_typeof(opt.value) <> 'string'
              or not coalesce((opt.value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)
          )
          and (
            select pg_catalog.count(distinct opt.value)
            from pg_catalog.jsonb_array_elements(entry.value->'fraction'->'lockedIngredientOptionIds') as opt(value)
          ) = pg_catalog.jsonb_array_length(entry.value->'fraction'->'lockedIngredientOptionIds')
        )
      )
    )) or (entry.value->'tax' <> 'null'::jsonb and not app_private.jsonb_has_exact_keys(
      entry.value->'tax', array['taxId','name','taxRuleVersion','rateNumerator','rateDenominator','inclusion']
    )) or (entry.value->'imagePath' <> 'null'::jsonb and pg_catalog.jsonb_typeof(entry.value->'imagePath') <> 'string')
      or (entry.value ? 'variants' and (case when pg_catalog.jsonb_typeof(entry.value->'variants') = 'array' then (
        pg_catalog.jsonb_array_length(entry.value->'variants') > 12 or exists (
          select 1 from pg_catalog.jsonb_array_elements(entry.value->'variants') as variant_entry(value)
          where not app_private.jsonb_has_exact_keys(
            variant_entry.value - 'fraction' - 'sizePresetId',
            array['variantId','name','unitPriceMinor','active','displayOrder','sku']
          ) or (
            variant_entry.value ? 'sizePresetId'
            and pg_catalog.jsonb_typeof(variant_entry.value->'sizePresetId') not in ('string', 'null')
          ) or (
            variant_entry.value ? 'sizePresetId'
            and pg_catalog.jsonb_typeof(variant_entry.value->'sizePresetId') = 'string'
            and not coalesce((variant_entry.value#>>'{sizePresetId}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
          ) or (variant_entry.value ? 'fraction' and variant_entry.value->'fraction' <> 'null'::jsonb and not (
            app_private.jsonb_has_exact_keys(
              ((variant_entry.value->'fraction') - 'lockedIngredientOptionIds'::text) - 'excludableIngredientIds'::text,
              array['enabled','flavorGroupId','extraGroupId']
            )
            and pg_catalog.jsonb_typeof(variant_entry.value->'fraction'->'enabled') = 'boolean'
            and pg_catalog.jsonb_typeof(variant_entry.value->'fraction'->'flavorGroupId') in ('string','null')
            and pg_catalog.jsonb_typeof(variant_entry.value->'fraction'->'extraGroupId') in ('string','null')
            and (
              not (variant_entry.value->'fraction' ? 'excludableIngredientIds') or (
                pg_catalog.jsonb_typeof(variant_entry.value->'fraction'->'excludableIngredientIds') = 'array'
                and pg_catalog.jsonb_array_length(variant_entry.value->'fraction'->'excludableIngredientIds') <= 40
                and not exists (
                  select 1 from pg_catalog.jsonb_array_elements(variant_entry.value->'fraction'->'excludableIngredientIds') as label(value)
                  where pg_catalog.jsonb_typeof(label.value) <> 'string'
                )
              )
            )
            and (
              not (variant_entry.value->'fraction' ? 'lockedIngredientOptionIds') or (
                pg_catalog.jsonb_typeof(variant_entry.value->'fraction'->'lockedIngredientOptionIds') = 'array'
                and pg_catalog.jsonb_array_length(variant_entry.value->'fraction'->'lockedIngredientOptionIds') <= 40
                and not exists (
                  select 1 from pg_catalog.jsonb_array_elements(variant_entry.value->'fraction'->'lockedIngredientOptionIds') as opt(value)
                  where pg_catalog.jsonb_typeof(opt.value) <> 'string'
                    or not coalesce((opt.value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)
                )
                and (
                  select pg_catalog.count(distinct opt.value)
                  from pg_catalog.jsonb_array_elements(variant_entry.value->'fraction'->'lockedIngredientOptionIds') as opt(value)
                ) = pg_catalog.jsonb_array_length(variant_entry.value->'fraction'->'lockedIngredientOptionIds')
              )
            )
          ))
        )
      ) else true end))
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_payload->'modifierGroups') as entry(value)
    where not app_private.jsonb_has_exact_keys(
      entry.value - 'productId', array['groupId','name','active','displayOrder','minimumQuantity','maximumQuantity','options']
    ) or (entry.value ? 'productId' and pg_catalog.jsonb_typeof(entry.value->'productId') not in ('string', 'null'))
      or pg_catalog.jsonb_typeof(entry.value->'options') <> 'array'
      or pg_catalog.jsonb_array_length(entry.value->'options') not between 1 and 200
      or exists (
        select 1 from pg_catalog.jsonb_array_elements(entry.value->'options') as option_entry(value)
        where not (app_private.jsonb_has_exact_keys(
          option_entry.value, array['optionId','name','unitPriceMinor','active','maximumQuantity','imagePath']
        ) or app_private.jsonb_has_exact_keys(
          option_entry.value, array['optionId','name','unitPriceMinor','active','maximumQuantity']
        )) or (option_entry.value->'imagePath' <> 'null'::jsonb and pg_catalog.jsonb_typeof(option_entry.value->'imagePath') <> 'string')
      )
  ) then return query select 'conflict', null::jsonb; return; end if;

  -- A legacy owner must list its own group and no other product may list it (sharing needs a null owner).
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_payload->'modifierGroups') as grp(value)
    where grp.value->>'productId' is not null and (
      not exists (
        select 1 from pg_catalog.jsonb_array_elements(p_payload->'products') as prod(value)
        where prod.value->>'productId' = grp.value->>'productId'
          and app_private.menu_product_group_ids(p_payload, prod.value) @> pg_catalog.jsonb_build_array(grp.value->'groupId')
      ) or exists (
        select 1 from pg_catalog.jsonb_array_elements(p_payload->'products') as prod(value)
        where prod.value->>'productId' <> grp.value->>'productId'
          and app_private.menu_product_group_ids(p_payload, prod.value) @> pg_catalog.jsonb_build_array(grp.value->'groupId')
      )
    )
  ) then return query select 'conflict', null::jsonb; return; end if;

  if not exists (
    select 1 from app.memberships as membership
    join app.membership_role_grants as role_grant
      on role_grant.membership_id = membership.id and role_grant.revoked_at is null
      and role_grant.role_code in ('owner','admin','manager')
    join app.restaurants as restaurant
      on restaurant.id = membership.restaurant_id and restaurant.disabled_at is null
    join app.branches as branch
      on branch.id = membership.branch_id and branch.restaurant_id = membership.restaurant_id and branch.disabled_at is null
    where membership.user_id = p_actor_id and membership.restaurant_id = p_restaurant_id
      and membership.branch_id = p_branch_id and membership.revoked_at is null
  ) then return query select 'forbidden', null::jsonb; return; end if;

  catalog_lock := pg_catalog.hashtextextended('menu-catalog:' || p_restaurant_id::text, 0);
  event_lock := pg_catalog.hashtextextended('menu-catalog-event:' || p_event_id::text, 0);
  if catalog_lock <= event_lock then
    perform pg_catalog.pg_advisory_xact_lock(catalog_lock);
    if catalog_lock <> event_lock then perform pg_catalog.pg_advisory_xact_lock(event_lock); end if;
  else
    perform pg_catalog.pg_advisory_xact_lock(event_lock);
    perform pg_catalog.pg_advisory_xact_lock(catalog_lock);
  end if;
  select audit.* into existing_audit from app.menu_catalog_audit_events as audit
  where audit.actor_id = p_actor_id and audit.restaurant_id = p_restaurant_id
    and audit.branch_id = p_branch_id and audit.idempotency_key = p_idempotency_key;
  if found then
    if existing_audit.event_id <> p_event_id or existing_audit.catalog_id <> p_catalog_id
      or existing_audit.device_id <> p_device_id or existing_audit.expected_version <> p_expected_version
      or existing_audit.currency <> p_currency or app_private.normalize_menu_catalog_payload(existing_audit.payload_snapshot)
      <> app_private.normalize_menu_catalog_payload(p_payload)
      or existing_audit.occurred_at <> p_occurred_at
    then return query select 'conflict', null::jsonb; return; end if;
    return query select 'replayed', app_private.build_menu_catalog_state(
      p_restaurant_id, p_branch_id, existing_audit.catalog_id, true
    );
    return;
  end if;
  if exists (select 1 from app.menu_catalog_audit_events as audit where audit.event_id = p_event_id)
  then return query select 'conflict', null::jsonb; return; end if;

  select head.version into current_version from app.menu_catalog_heads as head
  where head.restaurant_id = p_restaurant_id;
  if (current_version is null and p_expected_version <> 0)
    or (current_version is not null and current_version <> p_expected_version)
  then return query select 'conflict', null::jsonb; return; end if;
  next_version := p_expected_version + 1;
  published_at := pg_catalog.clock_timestamp();

  begin
    insert into app.menu_catalogs (id, restaurant_id, version, currency, published_at, published_by)
    values (p_catalog_id, p_restaurant_id, next_version, p_currency, published_at, p_actor_id);

    if p_payload ? 'sizePresets' and p_payload->'sizePresets' <> 'null'::jsonb then
      for preset in select value from pg_catalog.jsonb_array_elements(p_payload->'sizePresets') loop
        insert into app.menu_size_presets (restaurant_id, catalog_id, id, name, display_order, active)
        values (p_restaurant_id, p_catalog_id, (preset->>'id')::uuid, preset->>'name',
          (preset->>'displayOrder')::integer, (preset->>'active')::boolean);
      end loop;
    end if;

    for category in select value from pg_catalog.jsonb_array_elements(p_payload->'categories') loop
      insert into app.menu_categories (restaurant_id, catalog_id, id, name, active, display_order, color, image_path)
      values (p_restaurant_id, p_catalog_id, (category->>'categoryId')::uuid, category->>'name',
        (category->>'active')::boolean, (category->>'displayOrder')::integer,
        category->>'color', category->>'imagePath');
    end loop;

    for product in select value from pg_catalog.jsonb_array_elements(p_payload->'products') loop
      -- Canonical Pizza V2 fields: a legacy payload is rewritten to baseGroupIds/extraOptionIds before it is
      -- stored, so the round-trip never depends on the input form.
      canonical_product := app_private.normalize_menu_pizza_product(p_payload, product);
      insert into app.menu_products (
        restaurant_id, catalog_id, id, category_id, name, sku, active, display_order, station_id, unit,
        unit_price_minor, tax_id, tax_name, tax_rule_version, tax_rate_numerator, tax_rate_denominator, tax_inclusion,
        image_path, fraction_enabled, fraction_flavor_group_id, fraction_extra_group_id,
        fraction_excludable_ingredient_ids, fraction_locked_ingredient_option_ids,
        pizza_mode, free_ingredient_count, base_group_ids, default_ingredient_option_ids,
        customize_at_order, extra_option_ids
      ) values (
        p_restaurant_id, p_catalog_id, (product->>'productId')::uuid, (product->>'categoryId')::uuid,
        product->>'name', product->>'sku', (product->>'active')::boolean, (product->>'displayOrder')::integer,
        product->>'stationId', product->>'unit', (product->>'unitPriceMinor')::bigint,
        product->'tax'->>'taxId', product->'tax'->>'name', product->'tax'->>'taxRuleVersion',
        (product->'tax'->>'rateNumerator')::integer, (product->'tax'->>'rateDenominator')::integer,
        product->'tax'->>'inclusion', product->>'imagePath',
        coalesce((product->'fraction'->>'enabled')::boolean, false),
        (product->'fraction'->>'flavorGroupId')::uuid,
        (product->'fraction'->>'extraGroupId')::uuid,
        coalesce((
          select pg_catalog.array_agg(label.value order by label.ordinality)
          from pg_catalog.jsonb_array_elements_text(product->'fraction'->'excludableIngredientIds')
            with ordinality as label(value, ordinality)
        ), '{}'::text[]),
        coalesce((
          select pg_catalog.array_agg(opt_id.value::uuid order by opt_id.ordinality)
          from pg_catalog.jsonb_array_elements_text(product->'fraction'->'lockedIngredientOptionIds')
            with ordinality as opt_id(value, ordinality)
        ), '{}'::uuid[]),
        canonical_product->>'pizzaMode',
        coalesce((canonical_product->>'freeIngredientCount')::integer, 0),
        coalesce((
          select pg_catalog.array_agg(base_id.value::uuid order by base_id.ordinality)
          from pg_catalog.jsonb_array_elements_text(coalesce(canonical_product->'baseGroupIds', '[]'::jsonb))
            with ordinality as base_id(value, ordinality)
        ), '{}'::uuid[]),
        coalesce((
          select pg_catalog.array_agg(default_id.value::uuid order by default_id.ordinality)
          from pg_catalog.jsonb_array_elements_text(coalesce(canonical_product->'defaultIngredientOptionIds', '[]'::jsonb))
            with ordinality as default_id(value, ordinality)
        ), '{}'::uuid[]),
        coalesce((canonical_product->>'customizeAtOrder')::boolean, false),
        coalesce((
          select pg_catalog.array_agg(extra_id.value::uuid order by extra_id.ordinality)
          from pg_catalog.jsonb_array_elements_text(coalesce(canonical_product->'extraOptionIds', '[]'::jsonb))
            with ordinality as extra_id(value, ordinality)
        ), '{}'::uuid[])
      );
      if product ? 'variants' then
        for product_variant in select value from pg_catalog.jsonb_array_elements(product->'variants') loop
          insert into app.menu_product_variants (
            restaurant_id, catalog_id, product_id, id, name, sku, unit_price_minor, active, display_order,
            size_preset_id,
            fraction_enabled, fraction_flavor_group_id, fraction_extra_group_id, fraction_excludable_ingredient_ids, fraction_locked_ingredient_option_ids
          ) values (
            p_restaurant_id, p_catalog_id, (product->>'productId')::uuid, (product_variant->>'variantId')::uuid,
            coalesce(
              (select size_preset.name from app.menu_size_presets as size_preset
               where size_preset.restaurant_id = p_restaurant_id and size_preset.catalog_id = p_catalog_id
                 and size_preset.id = (product_variant->>'sizePresetId')::uuid),
              product_variant->>'name'
            ),
            product_variant->>'sku', (product_variant->>'unitPriceMinor')::bigint,
            (product_variant->>'active')::boolean, (product_variant->>'displayOrder')::integer,
            (product_variant->>'sizePresetId')::uuid,
            coalesce((product_variant->'fraction'->>'enabled')::boolean, false),
            (product_variant->'fraction'->>'flavorGroupId')::uuid,
            (product_variant->'fraction'->>'extraGroupId')::uuid,
            coalesce((
              select pg_catalog.array_agg(label.value order by label.ordinality)
              from pg_catalog.jsonb_array_elements_text(product_variant->'fraction'->'excludableIngredientIds')
                with ordinality as label(value, ordinality)
            ), '{}'::text[]),
            coalesce((
              select pg_catalog.array_agg(opt_id.value::uuid order by opt_id.ordinality)
              from pg_catalog.jsonb_array_elements_text(product_variant->'fraction'->'lockedIngredientOptionIds')
                with ordinality as opt_id(value, ordinality)
            ), '{}'::uuid[])
          );
        end loop;
      end if;
    end loop;

    for modifier_group in select value from pg_catalog.jsonb_array_elements(p_payload->'modifierGroups') loop
      insert into app.menu_modifier_groups (
        restaurant_id, catalog_id, id, product_id, name, active, display_order, minimum_quantity, maximum_quantity
      ) values (
        p_restaurant_id, p_catalog_id, (modifier_group->>'groupId')::uuid,
        (modifier_group->>'productId')::uuid, modifier_group->>'name', (modifier_group->>'active')::boolean,
        (modifier_group->>'displayOrder')::integer, (modifier_group->>'minimumQuantity')::integer,
        (modifier_group->>'maximumQuantity')::integer
      );
      for modifier_option in select value from pg_catalog.jsonb_array_elements(modifier_group->'options') loop
        insert into app.menu_modifier_options (
          restaurant_id, catalog_id, group_id, id, name, unit_price_minor, active, maximum_quantity, image_path
        ) values (
          p_restaurant_id, p_catalog_id, (modifier_group->>'groupId')::uuid,
          (modifier_option->>'optionId')::uuid, modifier_option->>'name',
          (modifier_option->>'unitPriceMinor')::bigint, (modifier_option->>'active')::boolean,
          (modifier_option->>'maximumQuantity')::integer, modifier_option->>'imagePath'
        );
      end loop;
    end loop;
    for product in select value from pg_catalog.jsonb_array_elements(p_payload->'products') loop
      insert into app.menu_product_modifier_groups (restaurant_id, catalog_id, product_id, group_id, display_order)
      select p_restaurant_id, p_catalog_id, (product->>'productId')::uuid, (group_ref.value #>> '{}')::uuid,
        (group_ref.ordinality - 1)::integer
      from pg_catalog.jsonb_array_elements(app_private.menu_product_group_ids(p_payload, product))
        with ordinality as group_ref(value, ordinality)
      on conflict (restaurant_id, catalog_id, product_id, group_id)
      do update set display_order = excluded.display_order;
    end loop;

    -- Backfill locked from legacy excludable ONLY when locked was omitted from the payload (old producer):
    update app.menu_products as product set
      fraction_locked_ingredient_option_ids = coalesce((
        select pg_catalog.array_agg(opt.id order by opt.id)
        from app.menu_modifier_options as opt
        where opt.restaurant_id = product.restaurant_id and opt.catalog_id = product.catalog_id
          and opt.group_id = product.fraction_extra_group_id
          and not exists (
            select 1 from pg_catalog.unnest(product.fraction_excludable_ingredient_ids) as ex(lbl)
            where pg_catalog.lower(pg_catalog.btrim(opt.name)) = pg_catalog.lower(pg_catalog.btrim(ex.lbl))
          )
      ), '{}'::uuid[])
    where product.restaurant_id = p_restaurant_id and product.catalog_id = p_catalog_id
      and product.fraction_extra_group_id is not null
      and exists (
        select 1 from pg_catalog.jsonb_array_elements(p_payload->'products') as prod(value)
        where (prod.value->>'productId')::uuid = product.id
          and prod.value ? 'fraction'
          and prod.value->'fraction' <> 'null'::jsonb
          and not (prod.value->'fraction' ? 'lockedIngredientOptionIds')
      );

    update app.menu_product_variants as variant set
      fraction_locked_ingredient_option_ids = coalesce((
        select pg_catalog.array_agg(opt.id order by opt.id)
        from app.menu_modifier_options as opt
        where opt.restaurant_id = variant.restaurant_id and opt.catalog_id = variant.catalog_id
          and opt.group_id = variant.fraction_extra_group_id
          and not exists (
            select 1 from pg_catalog.unnest(variant.fraction_excludable_ingredient_ids) as ex(lbl)
            where pg_catalog.lower(pg_catalog.btrim(opt.name)) = pg_catalog.lower(pg_catalog.btrim(ex.lbl))
          )
      ), '{}'::uuid[])
    where variant.restaurant_id = p_restaurant_id and variant.catalog_id = p_catalog_id
      and variant.fraction_extra_group_id is not null
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(p_payload->'products') as prod(value),
             pg_catalog.jsonb_array_elements(prod.value->'variants') as v(value)
        where (v.value->>'variantId')::uuid = variant.id
          and v.value ? 'fraction'
          and v.value->'fraction' <> 'null'::jsonb
          and not (v.value->'fraction' ? 'lockedIngredientOptionIds')
      );

    -- Presets check: no variant can reference an inactive preset.
    if exists (
      select 1 from app.menu_product_variants as variant
      join app.menu_size_presets as preset
        on preset.restaurant_id = variant.restaurant_id
       and preset.catalog_id = variant.catalog_id
       and preset.id = variant.size_preset_id
      where variant.restaurant_id = p_restaurant_id and variant.catalog_id = p_catalog_id
        and not preset.active
    ) then raise exception using errcode = '23514', message = 'MENU_SIZE_PRESET_INACTIVE'; end if;

    -- Half-and-half groups are modifier groups assigned to the very same product in this release.
    if exists (
      select 1 from app.menu_product_variants as variant
      where variant.restaurant_id = p_restaurant_id and variant.catalog_id = p_catalog_id
        and ((variant.fraction_flavor_group_id is not null and not exists (
            select 1 from app.menu_modifier_groups as fraction_group
            where fraction_group.restaurant_id = variant.restaurant_id and fraction_group.catalog_id = variant.catalog_id
              and fraction_group.id = variant.fraction_flavor_group_id and exists (
                select 1 from app.menu_product_modifier_groups as fraction_assignment
                where fraction_assignment.restaurant_id = fraction_group.restaurant_id
                  and fraction_assignment.catalog_id = fraction_group.catalog_id
                  and fraction_assignment.group_id = fraction_group.id
                  and fraction_assignment.product_id = variant.product_id)
          )) or (variant.fraction_extra_group_id is not null and not exists (
            select 1 from app.menu_modifier_groups as fraction_group
            where fraction_group.restaurant_id = variant.restaurant_id and fraction_group.catalog_id = variant.catalog_id
              and fraction_group.id = variant.fraction_extra_group_id and exists (
                select 1 from app.menu_product_modifier_groups as fraction_assignment
                where fraction_assignment.restaurant_id = fraction_group.restaurant_id
                  and fraction_assignment.catalog_id = fraction_group.catalog_id
                  and fraction_assignment.group_id = fraction_group.id
                  and fraction_assignment.product_id = variant.product_id)
          )))
    ) then raise exception using errcode = '23514', message = 'MENU_FRACTION_GROUP_FOREIGN'; end if;
    if exists (
      select 1 from app.menu_product_variants as variant
      where variant.restaurant_id = p_restaurant_id and variant.catalog_id = p_catalog_id
        and (select pg_catalog.count(distinct label.value) from pg_catalog.unnest(variant.fraction_excludable_ingredient_ids) as label(value))
          <> pg_catalog.cardinality(variant.fraction_excludable_ingredient_ids)
    ) then raise exception using errcode = '23514', message = 'MENU_FRACTION_LABEL_DUPLICATE'; end if;
    if exists (
      select 1 from app.menu_product_variants as variant
      where variant.restaurant_id = p_restaurant_id and variant.catalog_id = p_catalog_id
        and (select pg_catalog.count(distinct opt.value) from pg_catalog.unnest(variant.fraction_locked_ingredient_option_ids) as opt(value))
          <> pg_catalog.cardinality(variant.fraction_locked_ingredient_option_ids)
    ) then raise exception using errcode = '23514', message = 'MENU_FRACTION_LOCKED_OPTION_DUPLICATE'; end if;
    if exists (
      select 1 from app.menu_product_variants as variant
      cross join lateral pg_catalog.unnest(variant.fraction_locked_ingredient_option_ids) as opt(id)
      where variant.restaurant_id = p_restaurant_id and variant.catalog_id = p_catalog_id
        and (
          variant.fraction_extra_group_id is null
          or not exists (
            select 1 from app.menu_modifier_options as modifier_option
            where modifier_option.restaurant_id = variant.restaurant_id
              and modifier_option.catalog_id = variant.catalog_id
              and modifier_option.group_id = variant.fraction_extra_group_id
              and modifier_option.id = opt.id
          )
        )
    ) then raise exception using errcode = '23514', message = 'MENU_FRACTION_LOCKED_OPTION_FOREIGN'; end if;
    -- The same checks for the product-level setup, plus one source of truth: a product whose own
    -- setup is enabled cannot also have a size with an enabled legacy setup.
    if exists (
      select 1 from app.menu_products as product
      where product.restaurant_id = p_restaurant_id and product.catalog_id = p_catalog_id
        and ((product.fraction_flavor_group_id is not null and not exists (
            select 1 from app.menu_modifier_groups as fraction_group
            where fraction_group.restaurant_id = product.restaurant_id and fraction_group.catalog_id = product.catalog_id
              and fraction_group.id = product.fraction_flavor_group_id and exists (
                select 1 from app.menu_product_modifier_groups as fraction_assignment
                where fraction_assignment.restaurant_id = fraction_group.restaurant_id
                  and fraction_assignment.catalog_id = fraction_group.catalog_id
                  and fraction_assignment.group_id = fraction_group.id
                  and fraction_assignment.product_id = product.id)
          )) or (product.fraction_extra_group_id is not null and not exists (
            select 1 from app.menu_modifier_groups as fraction_group
            where fraction_group.restaurant_id = product.restaurant_id and fraction_group.catalog_id = product.catalog_id
              and fraction_group.id = product.fraction_extra_group_id and exists (
                select 1 from app.menu_product_modifier_groups as fraction_assignment
                where fraction_assignment.restaurant_id = fraction_group.restaurant_id
                  and fraction_assignment.catalog_id = fraction_group.catalog_id
                  and fraction_assignment.group_id = fraction_group.id
                  and fraction_assignment.product_id = product.id)
          )))
    ) then raise exception using errcode = '23514', message = 'MENU_FRACTION_GROUP_FOREIGN'; end if;
    if exists (
      select 1 from app.menu_products as product
      where product.restaurant_id = p_restaurant_id and product.catalog_id = p_catalog_id
        and (select pg_catalog.count(distinct label.value) from pg_catalog.unnest(product.fraction_excludable_ingredient_ids) as label(value))
          <> pg_catalog.cardinality(product.fraction_excludable_ingredient_ids)
    ) then raise exception using errcode = '23514', message = 'MENU_FRACTION_LABEL_DUPLICATE'; end if;
    if exists (
      select 1 from app.menu_products as product
      where product.restaurant_id = p_restaurant_id and product.catalog_id = p_catalog_id
        and (select pg_catalog.count(distinct opt.value) from pg_catalog.unnest(product.fraction_locked_ingredient_option_ids) as opt(value))
          <> pg_catalog.cardinality(product.fraction_locked_ingredient_option_ids)
    ) then raise exception using errcode = '23514', message = 'MENU_FRACTION_LOCKED_OPTION_DUPLICATE'; end if;
    if exists (
      select 1 from app.menu_products as product
      cross join lateral pg_catalog.unnest(product.fraction_locked_ingredient_option_ids) as opt(id)
      where product.restaurant_id = p_restaurant_id and product.catalog_id = p_catalog_id
        and (
          product.fraction_extra_group_id is null
          or not exists (
            select 1 from app.menu_modifier_options as modifier_option
            where modifier_option.restaurant_id = product.restaurant_id
              and modifier_option.catalog_id = product.catalog_id
              and modifier_option.group_id = product.fraction_extra_group_id
              and modifier_option.id = opt.id
          )
        )
    ) then raise exception using errcode = '23514', message = 'MENU_FRACTION_LOCKED_OPTION_FOREIGN'; end if;
    if exists (
      select 1 from app.menu_products as product
      join app.menu_product_variants as variant on variant.restaurant_id = product.restaurant_id
        and variant.catalog_id = product.catalog_id and variant.product_id = product.id
      where product.restaurant_id = p_restaurant_id and product.catalog_id = p_catalog_id
        and product.fraction_enabled and variant.fraction_enabled
    ) then raise exception using errcode = '23514', message = 'MENU_FRACTION_DUPLICATE_SOURCE'; end if;

    -- Pizza V2: every base group belongs to this restaurant and catalog release and is assigned to the
    -- very same product; every extra option is offered by a group assigned to the product; every recipe
    -- option belongs to any of the base groups; no option is both recipe and extra (table CHECK); V2 and
    -- the legacy half-and-half setup are mutually exclusive on a product (one source of truth).
    if exists (
      select 1 from app.menu_products as product
      cross join lateral pg_catalog.unnest(product.base_group_ids) as base_group(id)
      where product.restaurant_id = p_restaurant_id and product.catalog_id = p_catalog_id
        and not exists (
          select 1 from app.menu_modifier_groups as pizza_group
          join app.menu_product_modifier_groups as pizza_assignment
            on pizza_assignment.restaurant_id = pizza_group.restaurant_id
           and pizza_assignment.catalog_id = pizza_group.catalog_id
           and pizza_assignment.group_id = pizza_group.id
          where pizza_group.restaurant_id = product.restaurant_id and pizza_group.catalog_id = product.catalog_id
            and pizza_group.id = base_group.id and pizza_assignment.product_id = product.id)
    ) then raise exception using errcode = '23514', message = 'MENU_PIZZA_BASE_GROUP_FOREIGN'; end if;
    if exists (
      select 1 from app.menu_products as product
      cross join lateral pg_catalog.unnest(product.extra_option_ids) as extra_option(id)
      where product.restaurant_id = p_restaurant_id and product.catalog_id = p_catalog_id
        and not exists (
          select 1 from app.menu_modifier_options as extra_catalog_option
          join app.menu_product_modifier_groups as pizza_assignment
            on pizza_assignment.restaurant_id = extra_catalog_option.restaurant_id
           and pizza_assignment.catalog_id = extra_catalog_option.catalog_id
           and pizza_assignment.group_id = extra_catalog_option.group_id
          where extra_catalog_option.restaurant_id = product.restaurant_id
            and extra_catalog_option.catalog_id = product.catalog_id
            and extra_catalog_option.id = extra_option.id and pizza_assignment.product_id = product.id)
    ) then raise exception using errcode = '23514', message = 'MENU_PIZZA_EXTRA_OPTION_FOREIGN'; end if;
    if exists (
      select 1 from app.menu_products as product
      cross join lateral pg_catalog.unnest(product.default_ingredient_option_ids) as default_option(id)
      where product.restaurant_id = p_restaurant_id and product.catalog_id = p_catalog_id
        and not exists (
          select 1 from app.menu_modifier_options as recipe_catalog_option
          where recipe_catalog_option.restaurant_id = product.restaurant_id
            and recipe_catalog_option.catalog_id = product.catalog_id
            and recipe_catalog_option.group_id = any (product.base_group_ids)
            and recipe_catalog_option.id = default_option.id)
    ) then raise exception using errcode = '23514', message = 'MENU_PIZZA_DEFAULT_FOREIGN'; end if;
    if exists (
      select 1 from app.menu_products as product
      where product.restaurant_id = p_restaurant_id and product.catalog_id = p_catalog_id
        and product.pizza_mode is not null and (
          product.fraction_enabled or product.fraction_flavor_group_id is not null
          or product.fraction_extra_group_id is not null
          or exists (
            select 1 from app.menu_product_variants as variant
            where variant.restaurant_id = product.restaurant_id and variant.catalog_id = product.catalog_id
              and variant.product_id = product.id and (
                variant.fraction_enabled or variant.fraction_flavor_group_id is not null
                or variant.fraction_extra_group_id is not null)))
    ) then raise exception using errcode = '23514', message = 'MENU_PIZZA_FRACTION_CONFLICT'; end if;
  exception
    when check_violation or foreign_key_violation or unique_violation or not_null_violation
      or invalid_text_representation or numeric_value_out_of_range then
      return query select 'conflict', null::jsonb; return;
  end;

  insert into app.menu_catalog_heads (restaurant_id, catalog_id, version, updated_at, updated_by)
  values (p_restaurant_id, p_catalog_id, next_version, published_at, p_actor_id)
  on conflict (restaurant_id) do update set
    catalog_id = excluded.catalog_id, version = excluded.version,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  insert into app.menu_catalog_audit_events (
    event_id, idempotency_key, restaurant_id, branch_id, catalog_id, actor_id, device_id,
    expected_version, result_version, currency, payload_snapshot, occurred_at, result_updated_at
  ) values (
    p_event_id, p_idempotency_key, p_restaurant_id, p_branch_id, p_catalog_id, p_actor_id, p_device_id,
    p_expected_version, next_version, p_currency, p_payload, p_occurred_at, published_at
  );
  return query select 'saved', app_private.build_menu_catalog_state(p_restaurant_id, p_branch_id, p_catalog_id, false);
end $function$;

revoke all on function app_private.save_menu_catalog(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,uuid,text,jsonb)
  from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.save_menu_catalog(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,uuid,text,jsonb) to app_api;

-- A 'selection' plan may now be schemaVersion 2 (pizza lines); 'repeat' plans stay schemaVersion 1. Existing
-- rows are all schemaVersion 1, so the relaxed check holds for them. Without this the table CHECK
-- pinned from 20260928000100 rejected every V2 plan the function below accepts.
alter table app.capture_repeat_order_plans drop constraint capture_repeat_order_plans_payload_valid;
alter table app.capture_repeat_order_plans add constraint capture_repeat_order_plans_payload_valid check (
  case plan_kind
    when 'repeat' then
      customer_id is not null and source_order_id is not null
      and pg_catalog.jsonb_typeof(selection_plan)='object'
      and selection_plan->>'schemaVersion'='1'
      and selection_plan->>'customerId'=customer_id::text
      and selection_plan->>'sourceOrderId'=source_order_id::text
      and selection_plan->>'catalogVersion'=catalog_id::text
      and case when pg_catalog.jsonb_typeof(selection_plan->'lines')='array'
        then pg_catalog.jsonb_array_length(selection_plan->'lines') between 1 and 200 else false end
    when 'selection' then
      customer_id is null and source_order_id is null
      and pg_catalog.jsonb_typeof(selection_plan)='object'
      and selection_plan->>'schemaVersion' in ('1','2')
      and selection_plan->>'catalogVersion'=catalog_id::text
      and case when pg_catalog.jsonb_typeof(selection_plan->'lines')='array'
        then pg_catalog.jsonb_array_length(selection_plan->'lines') between 0 and 200 else false end
    else false
  end
);

create or replace function app_private.replace_capture_selection_plan(
  p_actor_id uuid,
  p_command jsonb,
  p_plan jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  restaurant uuid; branch uuid; capture uuid; catalog uuid; catalog_head_id uuid;
  event uuid; device uuid; lease uuid; member uuid;
  expected bigint; occurred timestamptz; observed timestamptz; fingerprint text;
  current_capture app.capture_drafts%rowtype; stored app.capture_command_events%rowtype;
  result_record jsonb;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_command,array[
      'schemaVersion','scope','captureDraftId','expectedVersion',
      'attentionLeaseId','eventId','idempotencyKey','deviceId','occurredAt'
    ]) -- keep in sync with parseReplaceCaptureSelectionPlanCommandV1's exact-key contract
    or not app_private.jsonb_has_exact_keys(p_command->'scope',array['restaurantId','branchId'])
    or p_command->'schemaVersion' is distinct from '1'::jsonb
    or not coalesce(p_command->>'expectedVersion' ~ '^[1-9][0-9]*$',false)
    or not coalesce(p_command->>'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
    or not app_private.jsonb_has_exact_keys(p_plan,array['schemaVersion','catalogVersion','lines'])
    or (p_plan->'schemaVersion' is distinct from '1'::jsonb and p_plan->'schemaVersion' is distinct from '2'::jsonb)
    or not coalesce(p_plan->>'catalogVersion' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
    or not (case when pg_catalog.jsonb_typeof(p_plan->'lines')='array'
      then pg_catalog.jsonb_array_length(p_plan->'lines') between 0 and 200 else false end)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  -- Explicit reasons (status stays 'rejected'): the legacy per-slot model cannot price two custom
  -- halves, and a pizza line must name the V2 rule version.
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    where pg_catalog.jsonb_typeof(line.value) = 'object'
      and pg_catalog.jsonb_typeof(line.value->'fraction'->'slots') = 'array'
      and pg_catalog.jsonb_array_length(line.value->'fraction'->'slots') = 2
      and line.value->'fraction'->'slots'->0->'flavorOptionId' = 'null'::jsonb
      and line.value->'fraction'->'slots'->1->'flavorOptionId' = 'null'::jsonb
  ) then return pg_catalog.jsonb_build_object('status','rejected','reason','fraction_both_custom'); end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    where pg_catalog.jsonb_typeof(line.value) = 'object' and pg_catalog.jsonb_typeof(line.value->'pizza') = 'object'
      and line.value->'pizza'->>'ruleVersion' = 'pizza-halves-v1'
  ) then return pg_catalog.jsonb_build_object('status','rejected','reason','rule_version_legacy'); end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    where pg_catalog.jsonb_typeof(line.value) = 'object' and pg_catalog.jsonb_typeof(line.value->'pizza') = 'object'
      and line.value->'pizza'->>'ruleVersion' is distinct from 'pizza-halves-v2'
  ) then return pg_catalog.jsonb_build_object('status','rejected','reason','rule_version_unknown'); end if;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    where not (app_private.jsonb_has_exact_keys(
        line.value,array['lineId','productId','variantId','quantity','modifierGroups','note']
      ) or app_private.jsonb_has_exact_keys(
        line.value,array['lineId','productId','variantId','quantity','modifierGroups','note','fraction']
      ) or (p_plan->'schemaVersion' = '2'::jsonb and app_private.jsonb_has_exact_keys(
        line.value,array['lineId','productId','variantId','quantity','modifierGroups','note','pizza']
      )))
      or (line.value ? 'pizza' and not app_private.pizza_selection_line_shape_valid(line.value))
      or (line.value ? 'fraction' and not (
        app_private.jsonb_has_exact_keys(line.value->'fraction',array['geometry','slots'])
        and line.value->'fraction'->>'geometry'='halves'
        and pg_catalog.jsonb_typeof(line.value->'fraction'->'slots')='array'
        and pg_catalog.jsonb_array_length(line.value->'fraction'->'slots')=2
        and not (line.value->'fraction'->'slots'->0->'flavorOptionId'='null'::jsonb
          and line.value->'fraction'->'slots'->1->'flavorOptionId'='null'::jsonb)
      ))
      or not coalesce(line.value->>'lineId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
      or not coalesce(line.value->>'productId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
      or not (
        pg_catalog.jsonb_typeof(line.value->'variantId')='null'
        or coalesce(line.value->>'variantId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
      )
      or not (case when coalesce(line.value->>'quantity' ~ '^[1-9][0-9]*$',false)
        then (line.value->>'quantity')::numeric<=1000 else false end)
      or not (case when pg_catalog.jsonb_typeof(line.value->'modifierGroups')='array'
        then pg_catalog.jsonb_array_length(line.value->'modifierGroups') between 0 and 50 else false end)
      or not (
        pg_catalog.jsonb_typeof(line.value->'note')='null'
        or (
          pg_catalog.jsonb_typeof(line.value->'note')='string'
          and pg_catalog.char_length(line.value->>'note') between 1 and 200
        )
      )
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    cross join lateral pg_catalog.jsonb_array_elements(line.value->'modifierGroups') modifier_group(value)
    where not app_private.jsonb_has_exact_keys(modifier_group.value,array['groupId','selections'])
      or not coalesce(modifier_group.value->>'groupId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
      or not (case when pg_catalog.jsonb_typeof(modifier_group.value->'selections')='array'
        then pg_catalog.jsonb_array_length(modifier_group.value->'selections') between 0 and 50 else false end)
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    cross join lateral pg_catalog.jsonb_array_elements(line.value->'modifierGroups') modifier_group(value)
    cross join lateral pg_catalog.jsonb_array_elements(modifier_group.value->'selections') selection(value)
    where not app_private.jsonb_has_exact_keys(selection.value,array['optionId','quantity'])
      or not coalesce(selection.value->>'optionId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
      or not (case when coalesce(selection.value->>'quantity' ~ '^[1-9][0-9]*$',false)
        then (selection.value->>'quantity')::numeric<=100 else false end)
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    cross join lateral pg_catalog.jsonb_array_elements(
      case when line.value ? 'fraction' then line.value->'fraction'->'slots' else '[]'::jsonb end
    ) with ordinality slot(value,ordinality)
    where not app_private.jsonb_has_exact_keys(
        slot.value,array['fraction','flavorOptionId','extraOptionIds','excludedIngredientIds']
      )
      or slot.value->>'fraction' is distinct from (case slot.ordinality when 1 then 'half-a' else 'half-b' end)
      or not (
        slot.value->'flavorOptionId'='null'::jsonb
        or coalesce(slot.value->>'flavorOptionId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
      )
      or pg_catalog.jsonb_typeof(slot.value->'extraOptionIds') is distinct from 'array'
      or pg_catalog.jsonb_typeof(slot.value->'excludedIngredientIds') is distinct from 'array'
      or pg_catalog.jsonb_array_length(slot.value->'extraOptionIds')>20
      or pg_catalog.jsonb_array_length(slot.value->'excludedIngredientIds')>40
      or exists (
        select 1 from pg_catalog.jsonb_array_elements(slot.value->'extraOptionIds') extra(value)
        where not coalesce(extra.value #>> '{}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
      )
      or exists (
        select 1 from pg_catalog.jsonb_array_elements(slot.value->'excludedIngredientIds') label(value)
        where pg_catalog.jsonb_typeof(label.value)<>'string'
          or pg_catalog.char_length(label.value #>> '{}') not between 1 and 80
          or (label.value #>> '{}') ~ '[[:cntrl:]]'
      )
  ) or exists (
    select line.value->>'lineId'
    from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    group by line.value->>'lineId' having pg_catalog.count(*)<>1
  ) or exists (
    select line.value->>'lineId',modifier_group.value->>'groupId'
    from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    cross join lateral pg_catalog.jsonb_array_elements(line.value->'modifierGroups') modifier_group(value)
    group by line.value->>'lineId',modifier_group.value->>'groupId' having pg_catalog.count(*)<>1
  ) or exists (
    select line.value->>'lineId',modifier_group.value->>'groupId',selection.value->>'optionId'
    from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    cross join lateral pg_catalog.jsonb_array_elements(line.value->'modifierGroups') modifier_group(value)
    cross join lateral pg_catalog.jsonb_array_elements(modifier_group.value->'selections') selection(value)
    group by line.value->>'lineId',modifier_group.value->>'groupId',selection.value->>'optionId'
    having pg_catalog.count(*)<>1
  ) then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  begin
    restaurant:=(p_command#>>'{scope,restaurantId}')::uuid;
    branch:=(p_command#>>'{scope,branchId}')::uuid;
    capture:=(p_command->>'captureDraftId')::uuid;
    catalog:=(p_plan->>'catalogVersion')::uuid;
    event:=(p_command->>'eventId')::uuid;
    device:=(p_command->>'deviceId')::uuid;
    lease:=(p_command->>'attentionLeaseId')::uuid;
    expected:=(p_command->>'expectedVersion')::bigint;
    occurred:=(p_command->>'occurredAt')::timestamptz;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or capture is null or catalog is null
    or event is null or device is null or lease is null
    or expected not between 1 and 9007199254740990 or occurred is null
    or p_command#>>'{scope,restaurantId}' is distinct from restaurant::text
    or p_command#>>'{scope,branchId}' is distinct from branch::text
    or p_command->>'occurredAt' is distinct from pg_catalog.to_char(occurred at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  select m.id into member
  from app.memberships m
  join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
  join app.restaurants r on r.id=m.restaurant_id
  join app.membership_role_grants g on g.membership_id=m.id
  where m.user_id=p_actor_id and m.restaurant_id=restaurant and m.branch_id=branch
    and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null and g.revoked_at is null
    and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
  order by g.role_code limit 1 for share of m,b,r,g;
  if member is null then return pg_catalog.jsonb_build_object('status','denied'); end if;

  fingerprint:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'capture.selection_replaced:'||p_command::text||':'||p_plan::text||':'||p_actor_id::text,'UTF8'
  )),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'capture-command:'||p_actor_id::text||':'||restaurant::text||':'||branch::text||':'||(p_command->>'idempotencyKey'),0
  ));
  select * into stored from app.capture_command_events
  where actor_id=p_actor_id and restaurant_id=restaurant and branch_id=branch
    and idempotency_key=p_command->>'idempotencyKey';
  if found then
    if stored.operation<>'capture.selection_replaced' or stored.command_fingerprint<>fingerprint then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;
    return pg_catalog.jsonb_build_object('status','replayed','record',stored.result_capture);
  end if;
  if exists (select 1 from app.capture_command_events where event_id=event) then
    return pg_catalog.jsonb_build_object('status','conflict');
  end if;

  select * into current_capture from app.capture_drafts
  where restaurant_id=restaurant and branch_id=branch and id=capture for update;
  observed:=greatest(pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp()),current_capture.updated_at);
  if not found or current_capture.version<>expected or current_capture.status<>'draft'
    or current_capture.attention_status<>'claimed' or current_capture.owner_membership_id is distinct from member
    or current_capture.attention_lease_id is distinct from lease or current_capture.attention_lease_expires_at<=observed
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  -- Read and lock the branch's currently published catalog head inside this transaction, the
  -- same way repeat_customer_order_into_capture/confirm_capture_draft_v3 do: if a catalog was
  -- republished between this read and now, or the plan targets anything other than the head
  -- that is actually in effect, fail closed with a typed conflict rather than durably storing a
  -- plan against a catalog version that is no longer (or was never) the published one.
  select head.catalog_id into catalog_head_id from app.menu_catalog_heads head
  where head.restaurant_id=restaurant for share;
  if catalog_head_id is distinct from catalog then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  -- Pizza lines honor the min/max of their groups, per half and per group, against the published release.
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    where line.value ? 'pizza' and not app_private.pizza_quantities_valid(restaurant,catalog,line.value)
  ) then return pg_catalog.jsonb_build_object('status','conflict','reason','pizza_quantity_invalid'); end if;

  select result_capture into result_record from app.capture_command_events
  where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture and result_version=expected;
  if not found then raise exception using errcode='55000',message='CAPTURE_JOURNAL_CURRENT_VERSION_MISSING'; end if;
  result_record:=pg_catalog.jsonb_set(result_record,'{detail}',(result_record->'detail')||pg_catalog.jsonb_build_object(
    'version',expected+1,
    'updatedAt',pg_catalog.to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ));

  -- A single row per capture makes the repeat/selection plans mutually
  -- exclusive by construction: replacing one with the other overwrites
  -- whatever was stored, and the audit event below is the record of it.
  -- Zero lines means "no plan": delete the row (still audited by the command
  -- event below) instead of persisting an empty selection that
  -- materializeCaptureSelectionOrder/read_capture_workspace_v4 would then
  -- have to special-case; confirm falls back to the no-lines order route.
  if pg_catalog.jsonb_array_length(p_plan->'lines')=0 then
    delete from app.capture_repeat_order_plans
    where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture;
  else
    insert into app.capture_repeat_order_plans(
      restaurant_id,branch_id,capture_draft_id,plan_kind,customer_id,source_order_id,catalog_id,
      applied_capture_version,selection_plan,updated_at,updated_by
    ) values (
      restaurant,branch,capture,'selection',null,null,catalog,expected+1,p_plan,observed,p_actor_id
    ) on conflict (restaurant_id,branch_id,capture_draft_id) do update set
      plan_kind='selection',customer_id=null,source_order_id=null,catalog_id=excluded.catalog_id,
      applied_capture_version=excluded.applied_capture_version,selection_plan=excluded.selection_plan,
      updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  end if;

  update app.capture_drafts set version=expected+1,updated_at=observed,updated_by=p_actor_id
  where restaurant_id=restaurant and branch_id=branch and id=capture and version=expected;
  if not found then raise exception using errcode='40001',message='CAPTURE_SELECTION_PLAN_LOST_UPDATE'; end if;
  insert into app.capture_command_events(
    event_id,restaurant_id,branch_id,capture_draft_id,actor_id,actor_membership_id,device_id,operation,
    idempotency_key,command_fingerprint,expected_version,result_version,result_capture,occurred_at,received_at
  ) values (
    event,restaurant,branch,capture,p_actor_id,member,device,'capture.selection_replaced',p_command->>'idempotencyKey',
    fingerprint,expected,expected+1,result_record,occurred,observed
  );
  return pg_catalog.jsonb_build_object('status','applied','record',result_record);
end
$function$;
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

  -- H10: a delivery capture can never confirm without a live, coverage-eligible quote. This is
  -- deliberately stricter than the staleness check above, which only guards against an
  -- address/snapshot mismatch; here we also require the frozen quote to still be in-date and
  -- actually cover the address. H14: expiry is judged against the server's own clock
  -- (clock_timestamp()), not the client-supplied occurredAt -- a client can't extend a quote's
  -- life by lying about when its command "occurred".
  if current_channel = 'delivery' then
    if frozen_quote is null then
      return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_quote_missing');
    end if;
    if frozen_quote->>'coverageStatus' = 'not_covered' then
      return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_quote_not_covered');
    elsif (frozen_quote->>'expiresAt')::timestamptz <= clock_timestamp() then
      return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_quote_expired');
    end if;
    -- H13: the Order's frozen delivery charge must be exactly the server's own frozen quote --
    -- never relaxed to "close enough", and never trusted from the client without this check. The
    -- API is expected to materialize it from this same quote, but a stale API read (the quote
    -- moved between the API's workspace read and this transaction) must surface as a conflict,
    -- not silently persist a mismatched charge.
    if p_order->'deliveryCharge' is null or pg_catalog.jsonb_typeof(p_order->'deliveryCharge')<>'object'
      or not app_private.jsonb_has_exact_keys(p_order->'deliveryCharge',array['amount','quoteId'])
      or pg_catalog.jsonb_typeof(p_order#>'{deliveryCharge,amount}')<>'object'
      or not app_private.jsonb_has_exact_keys(p_order#>'{deliveryCharge,amount}',array['amountMinor','currency'])
      or (p_order#>'{deliveryCharge,amount,amountMinor}')::text::numeric is distinct from (frozen_quote->>'feeMinor')::numeric
      or p_order#>>'{deliveryCharge,amount,currency}' is distinct from p_order->>'currency'
      or p_order#>>'{deliveryCharge,quoteId}' is distinct from frozen_quote->>'quoteId'
    then
      return pg_catalog.jsonb_build_object('status','conflict','reason','delivery_charge_mismatch');
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
    update app.order_fulfillment_snapshots
    set snapshot = snapshot || pg_catalog.jsonb_build_object(
      'schemaVersion', 2, 'deliveryQuote', frozen_quote, 'paymentIntent', frozen_intent
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

alter function app_private.normalize_menu_catalog_payload(jsonb) owner to postgres;
alter function app_private.build_menu_catalog_state(uuid,uuid,uuid,boolean) owner to postgres;
alter function app_private.save_menu_catalog(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,uuid,text,jsonb) owner to postgres;
alter function app_private.replace_capture_selection_plan(uuid,jsonb,jsonb) owner to postgres;
alter function app_private.confirm_capture_draft_v3(uuid,jsonb,jsonb,jsonb) owner to postgres;

commit;
