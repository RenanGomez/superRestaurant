begin;

-- Category appearance: a pastel colour token and an optional image for menu categories.
-- Both columns are nullable with no backfill; the catalog payload keeps them optional so
-- older producers (and old audit snapshots) replay unchanged. CHECK constraints are the
-- authority for the closed palette and the per-restaurant, per-category Storage path.

alter table app.menu_categories add column color text null;
alter table app.menu_categories add column image_path text null;

alter table app.menu_categories add constraint menu_categories_color_valid check (
  color is null or color in ('rose', 'peach', 'sand', 'mint', 'sky', 'lilac', 'butter', 'sage')
);
alter table app.menu_categories add constraint menu_categories_image_path_valid check (
  image_path is null or (
    image_path ~ '^[0-9a-f-]{36}/categories/[0-9a-f-]{36}/[0-9a-f-]{32}\.(jpg|png|webp)$'
    and split_part(image_path, '/', 1) = restaurant_id::text
    and split_part(image_path, '/', 3) = id::text
  )
);

comment on column app.menu_categories.color is
  'Closed pastel palette token (never a hex value), or null for the automatic colour.';
comment on column app.menu_categories.image_path is
  'Stable Storage object path under the catalog-images bucket, or null. Written only by the API.';

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
          'fraction', case when product.fraction_enabled or product.fraction_flavor_group_id is not null
            or product.fraction_extra_group_id is not null
            or pg_catalog.cardinality(product.fraction_excludable_ingredient_ids) > 0
          then pg_catalog.jsonb_build_object(
            'enabled', product.fraction_enabled,
            'flavorGroupId', product.fraction_flavor_group_id::text,
            'extraGroupId', product.fraction_extra_group_id::text,
            'excludableIngredientIds', pg_catalog.to_jsonb(product.fraction_excludable_ingredient_ids)
          ) else null end,
          'variants', coalesce((
            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
              'variantId', variant.id::text, 'name', variant.name, 'unitPriceMinor', variant.unit_price_minor,
              'active', variant.active, 'displayOrder', variant.display_order, 'sku', variant.sku,
              'fraction', case when variant.fraction_enabled or variant.fraction_flavor_group_id is not null
                or variant.fraction_extra_group_id is not null
                or pg_catalog.cardinality(variant.fraction_excludable_ingredient_ids) > 0
              then pg_catalog.jsonb_build_object(
                'enabled', variant.fraction_enabled,
                'flavorGroupId', variant.fraction_flavor_group_id::text,
                'extraGroupId', variant.fraction_extra_group_id::text,
                'excludableIngredientIds', pg_catalog.to_jsonb(variant.fraction_excludable_ingredient_ids)
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
        ) order by modifier_group.product_id::text, modifier_group.display_order, modifier_group.id::text)
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
        case when pg_catalog.jsonb_typeof(stripped.value->'variants') = 'array'
          then pg_catalog.jsonb_set(stripped.value, '{variants}', coalesce((
            select pg_catalog.jsonb_agg(
              case when variant_entry.value->'fraction' = 'null'::jsonb then variant_entry.value - 'fraction' else variant_entry.value end
              order by variant_entry.ord)
            from pg_catalog.jsonb_array_elements(stripped.value->'variants') with ordinality as variant_entry(value, ord)
          ), '[]'::jsonb))
          else stripped.value end
        order by stripped.ord)
      from (
        select entry.ord, entry.value - coalesce((
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
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_set(grp.value, '{options}', coalesce((
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
      entry.value - 'imagePath' - 'variants' - 'fraction',
      array['productId','categoryId','name','sku','active','displayOrder','stationId','unit','unitPriceMinor','tax']
    ) or (entry.value ? 'fraction' and entry.value->'fraction' <> 'null'::jsonb and not (
      app_private.jsonb_has_exact_keys(
        entry.value->'fraction', array['enabled','flavorGroupId','extraGroupId','excludableIngredientIds']
      )
      and pg_catalog.jsonb_typeof(entry.value->'fraction'->'enabled') = 'boolean'
      and pg_catalog.jsonb_typeof(entry.value->'fraction'->'flavorGroupId') in ('string','null')
      and pg_catalog.jsonb_typeof(entry.value->'fraction'->'extraGroupId') in ('string','null')
      and pg_catalog.jsonb_typeof(entry.value->'fraction'->'excludableIngredientIds') = 'array'
      and pg_catalog.jsonb_array_length(entry.value->'fraction'->'excludableIngredientIds') <= 40
      and not exists (
        select 1 from pg_catalog.jsonb_array_elements(entry.value->'fraction'->'excludableIngredientIds') as label(value)
        where pg_catalog.jsonb_typeof(label.value) <> 'string'
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
              variant_entry.value->'fraction', array['enabled','flavorGroupId','extraGroupId','excludableIngredientIds']
            )
            and pg_catalog.jsonb_typeof(variant_entry.value->'fraction'->'enabled') = 'boolean'
            and pg_catalog.jsonb_typeof(variant_entry.value->'fraction'->'flavorGroupId') in ('string','null')
            and pg_catalog.jsonb_typeof(variant_entry.value->'fraction'->'extraGroupId') in ('string','null')
            and pg_catalog.jsonb_typeof(variant_entry.value->'fraction'->'excludableIngredientIds') = 'array'
            and pg_catalog.jsonb_array_length(variant_entry.value->'fraction'->'excludableIngredientIds') <= 40
            and not exists (
              select 1 from pg_catalog.jsonb_array_elements(variant_entry.value->'fraction'->'excludableIngredientIds') as label(value)
              where pg_catalog.jsonb_typeof(label.value) <> 'string'
            )
          ))
        )
      ) else true end))
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_payload->'modifierGroups') as entry(value)
    where not app_private.jsonb_has_exact_keys(
      entry.value, array['groupId','productId','name','active','displayOrder','minimumQuantity','maximumQuantity','options']
    ) or pg_catalog.jsonb_typeof(entry.value->'options') <> 'array'
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
        fraction_excludable_ingredient_ids
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
        ), '{}'::text[])
      );
      if product ? 'variants' then
        for product_variant in select value from pg_catalog.jsonb_array_elements(product->'variants') loop
          insert into app.menu_product_variants (
            restaurant_id, catalog_id, product_id, id, name, sku, unit_price_minor, active, display_order,
            fraction_enabled, fraction_flavor_group_id, fraction_extra_group_id, fraction_excludable_ingredient_ids
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
            ), '{}'::text[])
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
    -- Half-and-half groups are plain modifier groups of the very same product in this release.
    if exists (
      select 1 from app.menu_product_variants as variant
      where variant.restaurant_id = p_restaurant_id and variant.catalog_id = p_catalog_id
        and ((variant.fraction_flavor_group_id is not null and not exists (
            select 1 from app.menu_modifier_groups as fraction_group
            where fraction_group.restaurant_id = variant.restaurant_id and fraction_group.catalog_id = variant.catalog_id
              and fraction_group.id = variant.fraction_flavor_group_id and fraction_group.product_id = variant.product_id
          )) or (variant.fraction_extra_group_id is not null and not exists (
            select 1 from app.menu_modifier_groups as fraction_group
            where fraction_group.restaurant_id = variant.restaurant_id and fraction_group.catalog_id = variant.catalog_id
              and fraction_group.id = variant.fraction_extra_group_id and fraction_group.product_id = variant.product_id
          )))
    ) then raise exception using errcode = '23514', message = 'MENU_FRACTION_GROUP_FOREIGN'; end if;
    if exists (
      select 1 from app.menu_product_variants as variant
      where variant.restaurant_id = p_restaurant_id and variant.catalog_id = p_catalog_id
        and (select pg_catalog.count(distinct label.value) from pg_catalog.unnest(variant.fraction_excludable_ingredient_ids) as label(value))
          <> pg_catalog.cardinality(variant.fraction_excludable_ingredient_ids)
    ) then raise exception using errcode = '23514', message = 'MENU_FRACTION_LABEL_DUPLICATE'; end if;
    -- The same checks for the product-level setup, plus one source of truth: a product whose own
    -- setup is enabled cannot also have a size with an enabled legacy setup.
    if exists (
      select 1 from app.menu_products as product
      where product.restaurant_id = p_restaurant_id and product.catalog_id = p_catalog_id
        and ((product.fraction_flavor_group_id is not null and not exists (
            select 1 from app.menu_modifier_groups as fraction_group
            where fraction_group.restaurant_id = product.restaurant_id and fraction_group.catalog_id = product.catalog_id
              and fraction_group.id = product.fraction_flavor_group_id and fraction_group.product_id = product.id
          )) or (product.fraction_extra_group_id is not null and not exists (
            select 1 from app.menu_modifier_groups as fraction_group
            where fraction_group.restaurant_id = product.restaurant_id and fraction_group.catalog_id = product.catalog_id
              and fraction_group.id = product.fraction_extra_group_id and fraction_group.product_id = product.id
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

alter function app_private.build_menu_catalog_state(uuid,uuid,uuid,boolean) owner to postgres;
alter function app_private.normalize_menu_catalog_payload(jsonb) owner to postgres;
alter function app_private.save_menu_catalog(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,uuid,text,jsonb) owner to postgres;

commit;
