begin;

-- menu-locked-ingredients (P2 of menu-modifier-model-v2): replace excludable ingredient string labels
-- with locked ingredient modifier option UUIDs.
--   * app.menu_products and app.menu_product_variants carry fraction_locked_ingredient_option_ids (uuid[], max 40, no nulls).
--   * Deterministic backfill: options of fraction_extra_group_id whose lower(trim(name)) does NOT match any label in
--     fraction_excludable_ingredient_ids are populated into fraction_locked_ingredient_option_ids. Unmapped labels are notified.
--   * save_menu_catalog validates fraction_locked_ingredient_option_ids (no duplicates, must belong to fraction_extra_group_id,
--     extraGroupId required if locked non-empty). Also populates bidirectional compatibility between locked and excludable.
--   * build_menu_catalog_state emits both lockedIngredientOptionIds and excludableIngredientIds.
--   * confirm_capture_draft_v3 supports dual-read: UUID option IDs are verified against extra group options and checked
--     not to be locked; non-UUID strings fall back to matching legacy excludable labels.

alter table app.menu_products
  add column fraction_locked_ingredient_option_ids uuid[] not null default '{}'::uuid[],
  add constraint menu_products_fraction_locked_valid check (
    pg_catalog.cardinality(fraction_locked_ingredient_option_ids) <= 40
    and pg_catalog.array_position(fraction_locked_ingredient_option_ids, null) is null
  );

alter table app.menu_product_variants
  add column fraction_locked_ingredient_option_ids uuid[] not null default '{}'::uuid[],
  add constraint menu_product_variants_fraction_locked_valid check (
    pg_catalog.cardinality(fraction_locked_ingredient_option_ids) <= 40
    and pg_catalog.array_position(fraction_locked_ingredient_option_ids, null) is null
  );

do $backfill$
declare
  rec record;
  label_val text;
  match_cnt integer;
  unmapped_count integer := 0;
  duplicate_count integer := 0;
begin
  -- 1. Product backfill
  for rec in
    select p.restaurant_id, p.catalog_id, p.id as product_id, p.fraction_extra_group_id, p.fraction_excludable_ingredient_ids
    from app.menu_products p
    where p.fraction_extra_group_id is not null
  loop
    for label_val in select pg_catalog.unnest(rec.fraction_excludable_ingredient_ids) loop
      select pg_catalog.count(*) into match_cnt
      from app.menu_modifier_options opt
      where opt.restaurant_id = rec.restaurant_id and opt.catalog_id = rec.catalog_id
        and opt.group_id = rec.fraction_extra_group_id
        and pg_catalog.lower(pg_catalog.btrim(opt.name)) = pg_catalog.lower(pg_catalog.btrim(label_val));
      if match_cnt = 0 then
        raise notice 'menu_locked_ingredients: product % has unmapped excludable label "%"', rec.product_id, label_val;
        unmapped_count := unmapped_count + 1;
      elsif match_cnt > 1 then
        raise notice 'menu_locked_ingredients: product % has ambiguous excludable label "%" (% matches)', rec.product_id, label_val, match_cnt;
        duplicate_count := duplicate_count + 1;
      end if;
    end loop;

    update app.menu_products p
    set fraction_locked_ingredient_option_ids = coalesce((
      select pg_catalog.array_agg(opt.id order by opt.id)
      from app.menu_modifier_options opt
      where opt.restaurant_id = rec.restaurant_id and opt.catalog_id = rec.catalog_id
        and opt.group_id = rec.fraction_extra_group_id
        and not exists (
          select 1 from pg_catalog.unnest(rec.fraction_excludable_ingredient_ids) as ex(lbl)
          where pg_catalog.lower(pg_catalog.btrim(opt.name)) = pg_catalog.lower(pg_catalog.btrim(ex.lbl))
        )
    ), '{}'::uuid[])
    where p.restaurant_id = rec.restaurant_id and p.catalog_id = rec.catalog_id and p.id = rec.product_id;
  end loop;

  -- 2. Variant backfill
  for rec in
    select v.restaurant_id, v.catalog_id, v.product_id, v.id as variant_id, v.fraction_extra_group_id, v.fraction_excludable_ingredient_ids
    from app.menu_product_variants v
    where v.fraction_extra_group_id is not null
  loop
    for label_val in select pg_catalog.unnest(rec.fraction_excludable_ingredient_ids) loop
      select pg_catalog.count(*) into match_cnt
      from app.menu_modifier_options opt
      where opt.restaurant_id = rec.restaurant_id and opt.catalog_id = rec.catalog_id
        and opt.group_id = rec.fraction_extra_group_id
        and pg_catalog.lower(pg_catalog.btrim(opt.name)) = pg_catalog.lower(pg_catalog.btrim(label_val));
      if match_cnt = 0 then
        raise notice 'menu_locked_ingredients: variant % has unmapped excludable label "%"', rec.variant_id, label_val;
        unmapped_count := unmapped_count + 1;
      elsif match_cnt > 1 then
        raise notice 'menu_locked_ingredients: variant % has ambiguous excludable label "%" (% matches)', rec.variant_id, label_val, match_cnt;
        duplicate_count := duplicate_count + 1;
      end if;
    end loop;

    update app.menu_product_variants v
    set fraction_locked_ingredient_option_ids = coalesce((
      select pg_catalog.array_agg(opt.id order by opt.id)
      from app.menu_modifier_options opt
      where opt.restaurant_id = rec.restaurant_id and opt.catalog_id = rec.catalog_id
        and opt.group_id = rec.fraction_extra_group_id
        and not exists (
          select 1 from pg_catalog.unnest(rec.fraction_excludable_ingredient_ids) as ex(lbl)
          where pg_catalog.lower(pg_catalog.btrim(opt.name)) = pg_catalog.lower(pg_catalog.btrim(ex.lbl))
        )
    ), '{}'::uuid[])
    where v.restaurant_id = rec.restaurant_id and v.catalog_id = rec.catalog_id and v.id = rec.variant_id;
  end loop;

  if unmapped_count > 0 or duplicate_count > 0 then
    raise notice 'menu_locked_ingredients backfill summary: % unmapped labels, % duplicate matches', unmapped_count, duplicate_count;
  end if;
end
$backfill$;

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
        ) order by product.display_order, product.id::text)
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
                when variant_entry.value->'fraction' = 'null'::jsonb then variant_entry.value - 'fraction'
                when variant_entry.value ? 'fraction' and variant_entry.value->'fraction' <> 'null'::jsonb then
                  pg_catalog.jsonb_set(
                    variant_entry.value,
                    '{fraction}',
                    variant_entry.value->'fraction'
                      || case when not (variant_entry.value->'fraction' ? 'lockedIngredientOptionIds')
                           then pg_catalog.jsonb_build_object('lockedIngredientOptionIds', '[]'::jsonb)
                           else '{}'::jsonb end
                      || case when not (variant_entry.value->'fraction' ? 'excludableIngredientIds')
                           then pg_catalog.jsonb_build_object('excludableIngredientIds', '[]'::jsonb)
                           else '{}'::jsonb end
                  )
                else variant_entry.value
              end
              order by variant_entry.ord)
            from pg_catalog.jsonb_array_elements(stripped.value->'variants') with ordinality as variant_entry(value, ord)
          ), '[]'::jsonb))
          else stripped.value end)
        || pg_catalog.jsonb_build_object('modifierGroupIds', app_private.menu_product_group_ids(p_payload, stripped.value))
        order by stripped.ord)
      from (
        select entry.ord,
          (case
            when entry.value ? 'fraction' and entry.value->'fraction' <> 'null'::jsonb then
              pg_catalog.jsonb_set(
                entry.value,
                '{fraction}',
                entry.value->'fraction'
                  || case when not (entry.value->'fraction' ? 'lockedIngredientOptionIds')
                       then pg_catalog.jsonb_build_object('lockedIngredientOptionIds', '[]'::jsonb)
                       else '{}'::jsonb end
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
        ), '{}'::text[]) as value
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
  modifier_group jsonb;
  modifier_option jsonb;
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
    or not app_private.jsonb_has_exact_keys(p_payload, array['categories','products','modifierGroups'])
    or pg_catalog.jsonb_typeof(p_payload->'categories') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload->'products') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload->'modifierGroups') <> 'array'
    or pg_catalog.jsonb_array_length(p_payload->'categories') > 200
    or pg_catalog.jsonb_array_length(p_payload->'products') > 2000
    or pg_catalog.jsonb_array_length(p_payload->'modifierGroups') > 2000
  then return query select 'conflict', null::jsonb; return; end if;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_payload->'categories') as entry(value)
    where not app_private.jsonb_has_exact_keys(entry.value - 'color' - 'imagePath', array['categoryId','name','active','displayOrder'])
      or (entry.value ? 'color' and pg_catalog.jsonb_typeof(entry.value->'color') not in ('string', 'null'))
      or (entry.value ? 'imagePath' and pg_catalog.jsonb_typeof(entry.value->'imagePath') not in ('string', 'null'))
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_payload->'products') as entry(value)
    where not app_private.jsonb_has_exact_keys(
      entry.value - 'imagePath' - 'variants' - 'fraction' - 'modifierGroupIds',
      array['productId','categoryId','name','sku','active','displayOrder','stationId','unit','unitPriceMinor','tax']
    ) or (entry.value ? 'modifierGroupIds' and not (
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
        entry.value->'fraction' - 'lockedIngredientOptionIds' - 'excludableIngredientIds',
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
          where not (app_private.jsonb_has_exact_keys(
            variant_entry.value, array['variantId','name','unitPriceMinor','active','displayOrder','sku']
          ) or app_private.jsonb_has_exact_keys(
            variant_entry.value, array['variantId','name','unitPriceMinor','active','displayOrder','sku','fraction']
          )) or (variant_entry.value ? 'fraction' and variant_entry.value->'fraction' <> 'null'::jsonb and not (
            app_private.jsonb_has_exact_keys(
              variant_entry.value->'fraction' - 'lockedIngredientOptionIds' - 'excludableIngredientIds',
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

    for category in select value from pg_catalog.jsonb_array_elements(p_payload->'categories') loop
      insert into app.menu_categories (restaurant_id, catalog_id, id, name, active, display_order, color, image_path)
      values (p_restaurant_id, p_catalog_id, (category->>'categoryId')::uuid, category->>'name',
        (category->>'active')::boolean, (category->>'displayOrder')::integer,
        category->>'color', category->>'imagePath');
    end loop;

    for product in select value from pg_catalog.jsonb_array_elements(p_payload->'products') loop
      insert into app.menu_products (
        restaurant_id, catalog_id, id, category_id, name, sku, active, display_order, station_id, unit,
        unit_price_minor, tax_id, tax_name, tax_rule_version, tax_rate_numerator, tax_rate_denominator, tax_inclusion,
        image_path, fraction_enabled, fraction_flavor_group_id, fraction_extra_group_id,
        fraction_excludable_ingredient_ids, fraction_locked_ingredient_option_ids
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
        ), '{}'::uuid[])
      );
      if product ? 'variants' then
        for product_variant in select value from pg_catalog.jsonb_array_elements(product->'variants') loop
          insert into app.menu_product_variants (
            restaurant_id, catalog_id, product_id, id, name, sku, unit_price_minor, active, display_order,
            fraction_enabled, fraction_flavor_group_id, fraction_extra_group_id, fraction_excludable_ingredient_ids, fraction_locked_ingredient_option_ids
          ) values (
            p_restaurant_id, p_catalog_id, (product->>'productId')::uuid, (product_variant->>'variantId')::uuid,
            product_variant->>'name', product_variant->>'sku', (product_variant->>'unitPriceMinor')::bigint,
            (product_variant->>'active')::boolean, (product_variant->>'displayOrder')::integer,
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
      and pg_catalog.cardinality(product.fraction_excludable_ingredient_ids) > 0
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
      and pg_catalog.cardinality(variant.fraction_excludable_ingredient_ids) > 0
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(p_payload->'products') as prod(value),
             pg_catalog.jsonb_array_elements(prod.value->'variants') as v(value)
        where (v.value->>'variantId')::uuid = variant.id
          and v.value ? 'fraction'
          and v.value->'fraction' <> 'null'::jsonb
          and not (v.value->'fraction' ? 'lockedIngredientOptionIds')
      );

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
          'amountMinor',case when line_fraction is not null then fraction_price
            else coalesce(variant_record.unit_price_minor,product.unit_price_minor) end,
          'currency',catalog_currency
        ),
        'modifiers',expected_modifiers||fraction_modifiers
      );
      if line_fraction is not null then
        expected_snapshot := expected_snapshot||pg_catalog.jsonb_build_object(
          'geometry','halves','fractionBreakdown',fraction_breakdown
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
alter function app_private.confirm_capture_draft_v3(uuid,jsonb,jsonb,jsonb) owner to postgres;

commit;
