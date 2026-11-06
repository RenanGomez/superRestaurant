begin;

-- menu-size-presets: reusable size presets at catalog level.
--   * app.menu_size_presets carries reusable size presets per catalog release.
--   * app.menu_product_variants carries nullable size_preset_id with foreign key to app.menu_size_presets.
--   * save_menu_catalog accepts optional sizePresets, validates uniqueness of id and lower(name),
--     inserts presets before variants, synchronizes variant.name with preset.name, and enforces active preset references.
--   * build_menu_catalog_state emits sizePresets on catalog and sizePresetId on variants.
--   * normalize_menu_catalog_payload defaults missing sizePresets to [] and strips null sizePresetId for idempotent replay.

create table app.menu_size_presets (
  restaurant_id uuid not null,
  catalog_id uuid not null,
  id uuid not null,
  name text not null,
  display_order integer not null,
  active boolean not null default true,
  constraint menu_size_presets_pkey primary key (restaurant_id, catalog_id, id),
  constraint menu_size_presets_catalog_fkey foreign key (restaurant_id, catalog_id)
    references app.menu_catalogs (restaurant_id, id) on delete cascade,
  constraint menu_size_presets_name_valid check (
    pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 80
    and name !~ '[\u0000-\u001f\u007f-\u009f]'
  ),
  constraint menu_size_presets_display_order_nonnegative check (display_order >= 0)
);

create unique index menu_size_presets_catalog_lower_name_uidx
  on app.menu_size_presets (restaurant_id, catalog_id, pg_catalog.lower(name));

alter table app.menu_size_presets enable row level security;
alter table app.menu_size_presets force row level security;
revoke all on app.menu_size_presets from public, anon, authenticated, service_role, app_api;

alter table app.menu_product_variants
  add column size_preset_id uuid,
  add constraint menu_product_variants_size_preset_fkey
    foreign key (restaurant_id, catalog_id, size_preset_id)
    references app.menu_size_presets (restaurant_id, catalog_id, id)
    on delete restrict;

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
          (case
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
  preset jsonb;
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

commit;
