begin;

create table app.menu_catalogs (
  id uuid not null,
  restaurant_id uuid not null references app.restaurants (id) on delete restrict,
  version bigint not null,
  currency text not null,
  published_at timestamptz not null default pg_catalog.clock_timestamp(),
  published_by uuid not null references auth.users (id) on delete restrict,
  constraint menu_catalogs_pk primary key (restaurant_id, id),
  constraint menu_catalogs_restaurant_version_unique unique (restaurant_id, version),
  constraint menu_catalogs_restaurant_id_version_unique unique (restaurant_id, id, version),
  constraint menu_catalogs_version_positive check (version > 0),
  constraint menu_catalogs_currency_valid check (currency ~ '^[A-Z]{3}$')
);

create table app.menu_categories (
  restaurant_id uuid not null,
  catalog_id uuid not null,
  id uuid not null,
  name text not null,
  active boolean not null,
  display_order integer not null,
  constraint menu_categories_pk primary key (restaurant_id, catalog_id, id),
  constraint menu_categories_catalog_fk foreign key (restaurant_id, catalog_id)
    references app.menu_catalogs (restaurant_id, id) on delete restrict,
  constraint menu_categories_name_valid check (
    name = pg_catalog.btrim(name) and pg_catalog.char_length(name) between 1 and 80 and name !~ '[[:cntrl:]]'
  ),
  constraint menu_categories_display_order_valid check (display_order between 0 and 1000000)
);

create table app.menu_products (
  restaurant_id uuid not null,
  catalog_id uuid not null,
  id uuid not null,
  category_id uuid not null,
  name text not null,
  sku text,
  active boolean not null,
  display_order integer not null,
  station_id text not null,
  unit text not null,
  unit_price_minor bigint not null,
  tax_id text,
  tax_name text,
  tax_rule_version text,
  tax_rate_numerator integer,
  tax_rate_denominator integer,
  tax_inclusion text,
  constraint menu_products_pk primary key (restaurant_id, catalog_id, id),
  constraint menu_products_category_fk foreign key (restaurant_id, catalog_id, category_id)
    references app.menu_categories (restaurant_id, catalog_id, id) on delete restrict,
  constraint menu_products_sku_unique unique (restaurant_id, catalog_id, sku),
  constraint menu_products_name_valid check (
    name = pg_catalog.btrim(name) and pg_catalog.char_length(name) between 1 and 120 and name !~ '[[:cntrl:]]'
  ),
  constraint menu_products_sku_valid check (
    sku is null or (sku = pg_catalog.btrim(sku) and pg_catalog.char_length(sku) between 1 and 64 and sku !~ '[[:cntrl:]]')
  ),
  constraint menu_products_station_valid check (
    station_id = pg_catalog.btrim(station_id) and pg_catalog.char_length(station_id) between 1 and 64 and station_id !~ '[[:cntrl:]]'
  ),
  constraint menu_products_unit_valid check (
    unit = pg_catalog.btrim(unit) and pg_catalog.char_length(unit) between 1 and 32 and unit !~ '[[:cntrl:]]'
  ),
  constraint menu_products_display_order_valid check (display_order between 0 and 1000000),
  constraint menu_products_price_valid check (unit_price_minor between 0 and 9007199254740991),
  constraint menu_products_tax_valid check (
    (tax_id is null and tax_name is null and tax_rule_version is null and tax_rate_numerator is null
      and tax_rate_denominator is null and tax_inclusion is null)
    or
    (tax_id = pg_catalog.btrim(tax_id) and pg_catalog.char_length(tax_id) between 1 and 64 and tax_id !~ '[[:cntrl:]]'
      and tax_name = pg_catalog.btrim(tax_name) and pg_catalog.char_length(tax_name) between 1 and 80 and tax_name !~ '[[:cntrl:]]'
      and tax_rule_version = pg_catalog.btrim(tax_rule_version)
      and pg_catalog.char_length(tax_rule_version) between 1 and 64 and tax_rule_version !~ '[[:cntrl:]]'
      and tax_rate_numerator between 0 and 1000000 and tax_rate_denominator between 1 and 1000000
      and tax_inclusion in ('included', 'excluded'))
  )
);

create table app.menu_modifier_groups (
  restaurant_id uuid not null,
  catalog_id uuid not null,
  id uuid not null,
  product_id uuid not null,
  name text not null,
  active boolean not null,
  display_order integer not null,
  minimum_quantity integer not null,
  maximum_quantity integer not null,
  constraint menu_modifier_groups_pk primary key (restaurant_id, catalog_id, id),
  constraint menu_modifier_groups_product_fk foreign key (restaurant_id, catalog_id, product_id)
    references app.menu_products (restaurant_id, catalog_id, id) on delete restrict,
  constraint menu_modifier_groups_name_valid check (
    name = pg_catalog.btrim(name) and pg_catalog.char_length(name) between 1 and 80 and name !~ '[[:cntrl:]]'
  ),
  constraint menu_modifier_groups_display_order_valid check (display_order between 0 and 1000000),
  constraint menu_modifier_groups_bounds_valid check (
    minimum_quantity between 0 and 1000 and maximum_quantity between minimum_quantity and 1000
  )
);

create table app.menu_modifier_options (
  restaurant_id uuid not null,
  catalog_id uuid not null,
  group_id uuid not null,
  id uuid not null,
  name text not null,
  unit_price_minor bigint not null,
  active boolean not null,
  maximum_quantity integer,
  constraint menu_modifier_options_pk primary key (restaurant_id, catalog_id, group_id, id),
  constraint menu_modifier_options_group_fk foreign key (restaurant_id, catalog_id, group_id)
    references app.menu_modifier_groups (restaurant_id, catalog_id, id) on delete restrict,
  constraint menu_modifier_options_name_valid check (
    name = pg_catalog.btrim(name) and pg_catalog.char_length(name) between 1 and 80 and name !~ '[[:cntrl:]]'
  ),
  constraint menu_modifier_options_price_valid check (unit_price_minor between 0 and 9007199254740991),
  constraint menu_modifier_options_maximum_valid check (maximum_quantity is null or maximum_quantity between 1 and 1000)
);

create table app.menu_catalog_heads (
  restaurant_id uuid primary key references app.restaurants (id) on delete restrict,
  catalog_id uuid not null,
  version bigint not null,
  updated_at timestamptz not null,
  updated_by uuid not null references auth.users (id) on delete restrict,
  constraint menu_catalog_heads_release_fk foreign key (restaurant_id, catalog_id, version)
    references app.menu_catalogs (restaurant_id, id, version) on delete restrict,
  constraint menu_catalog_heads_version_positive check (version > 0)
);

create table app.menu_catalog_audit_events (
  event_id uuid primary key,
  idempotency_key uuid not null,
  restaurant_id uuid not null,
  branch_id uuid not null,
  catalog_id uuid not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  device_id uuid not null,
  expected_version bigint not null,
  result_version bigint not null,
  currency text not null,
  payload_snapshot jsonb not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default pg_catalog.clock_timestamp(),
  result_updated_at timestamptz not null,
  constraint menu_catalog_audit_branch_fk foreign key (restaurant_id, branch_id)
    references app.branches (restaurant_id, id) on delete restrict,
  constraint menu_catalog_audit_catalog_fk foreign key (restaurant_id, catalog_id)
    references app.menu_catalogs (restaurant_id, id) on delete restrict,
  constraint menu_catalog_audit_idempotency_unique unique (actor_id, restaurant_id, branch_id, idempotency_key),
  constraint menu_catalog_audit_version_valid check (expected_version >= 0 and result_version = expected_version + 1),
  constraint menu_catalog_audit_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint menu_catalog_audit_payload_valid check (pg_catalog.jsonb_typeof(payload_snapshot) = 'object')
);

create index menu_catalog_audit_scope_idx
  on app.menu_catalog_audit_events (restaurant_id, branch_id, received_at, event_id);

create function app_private.jsonb_has_exact_keys(p_value jsonb, p_keys text[])
returns boolean language sql immutable set search_path = '' as $function$
  select coalesce(
    pg_catalog.jsonb_typeof(p_value) = 'object'
    and not exists (
      select 1 from pg_catalog.jsonb_object_keys(p_value) as actual(key)
      where not (actual.key = any (p_keys))
    )
    and not exists (
      select 1 from pg_catalog.unnest(p_keys) as expected(key)
      where not (p_value ? expected.key)
    ),
    false
  )
$function$;

create function app_private.build_menu_catalog_state(
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
          'displayOrder', category.display_order
        ) order by category.display_order, category.id::text)
        from app.menu_categories as category
        where category.restaurant_id = catalog.restaurant_id and category.catalog_id = catalog.id
      ), '[]'::jsonb),
      'products', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'productId', product.id::text, 'categoryId', product.category_id::text, 'name', product.name,
          'sku', product.sku, 'active', product.active, 'displayOrder', product.display_order,
          'stationId', product.station_id, 'unit', product.unit, 'unitPriceMinor', product.unit_price_minor,
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
              'maximumQuantity', modifier_option.maximum_quantity
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

create function app_private.get_menu_catalog(p_actor_id uuid, p_restaurant_id uuid, p_branch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare current_catalog_id uuid;
begin
  if not exists (
    select 1 from app.memberships as membership
    join app.membership_role_grants as role_grant
      on role_grant.membership_id = membership.id and role_grant.revoked_at is null
      and role_grant.role_code in ('owner','admin','manager','supervisor','cashier','waiter','viewer','auditor')
    join app.restaurants as restaurant
      on restaurant.id = membership.restaurant_id and restaurant.disabled_at is null
    join app.branches as branch
      on branch.id = membership.branch_id and branch.restaurant_id = membership.restaurant_id and branch.disabled_at is null
    where membership.user_id = p_actor_id and membership.restaurant_id = p_restaurant_id
      and membership.branch_id = p_branch_id and membership.revoked_at is null
  ) then return null; end if;
  select head.catalog_id into current_catalog_id from app.menu_catalog_heads as head
  where head.restaurant_id = p_restaurant_id;
  return app_private.build_menu_catalog_state(p_restaurant_id, p_branch_id, current_catalog_id, false);
end $function$;

create function app_private.save_menu_catalog(
  p_actor_id uuid, p_restaurant_id uuid, p_branch_id uuid, p_event_id uuid, p_idempotency_key uuid,
  p_device_id uuid, p_occurred_at timestamptz, p_expected_version bigint, p_catalog_id uuid,
  p_currency text, p_payload jsonb
) returns table (status text, state jsonb)
language plpgsql volatile security definer set search_path = '' as $function$
declare
  category jsonb;
  product jsonb;
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
    where not app_private.jsonb_has_exact_keys(entry.value, array['categoryId','name','active','displayOrder'])
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_payload->'products') as entry(value)
    where not app_private.jsonb_has_exact_keys(
      entry.value, array['productId','categoryId','name','sku','active','displayOrder','stationId','unit','unitPriceMinor','tax']
    ) or (entry.value->'tax' <> 'null'::jsonb and not app_private.jsonb_has_exact_keys(
      entry.value->'tax', array['taxId','name','taxRuleVersion','rateNumerator','rateDenominator','inclusion']
    ))
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_payload->'modifierGroups') as entry(value)
    where not app_private.jsonb_has_exact_keys(
      entry.value, array['groupId','productId','name','active','displayOrder','minimumQuantity','maximumQuantity','options']
    ) or pg_catalog.jsonb_typeof(entry.value->'options') <> 'array'
      or pg_catalog.jsonb_array_length(entry.value->'options') not between 1 and 200
      or exists (
        select 1 from pg_catalog.jsonb_array_elements(entry.value->'options') as option_entry(value)
        where not app_private.jsonb_has_exact_keys(
          option_entry.value, array['optionId','name','unitPriceMinor','active','maximumQuantity']
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
      or existing_audit.currency <> p_currency or existing_audit.payload_snapshot <> p_payload
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
      insert into app.menu_categories (restaurant_id, catalog_id, id, name, active, display_order)
      values (p_restaurant_id, p_catalog_id, (category->>'categoryId')::uuid, category->>'name',
        (category->>'active')::boolean, (category->>'displayOrder')::integer);
    end loop;

    for product in select value from pg_catalog.jsonb_array_elements(p_payload->'products') loop
      insert into app.menu_products (
        restaurant_id, catalog_id, id, category_id, name, sku, active, display_order, station_id, unit,
        unit_price_minor, tax_id, tax_name, tax_rule_version, tax_rate_numerator, tax_rate_denominator, tax_inclusion
      ) values (
        p_restaurant_id, p_catalog_id, (product->>'productId')::uuid, (product->>'categoryId')::uuid,
        product->>'name', product->>'sku', (product->>'active')::boolean, (product->>'displayOrder')::integer,
        product->>'stationId', product->>'unit', (product->>'unitPriceMinor')::bigint,
        product->'tax'->>'taxId', product->'tax'->>'name', product->'tax'->>'taxRuleVersion',
        (product->'tax'->>'rateNumerator')::integer, (product->'tax'->>'rateDenominator')::integer,
        product->'tax'->>'inclusion'
      );
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
          restaurant_id, catalog_id, group_id, id, name, unit_price_minor, active, maximum_quantity
        ) values (
          p_restaurant_id, p_catalog_id, (modifier_group->>'groupId')::uuid,
          (modifier_option->>'optionId')::uuid, modifier_option->>'name',
          (modifier_option->>'unitPriceMinor')::bigint, (modifier_option->>'active')::boolean,
          (modifier_option->>'maximumQuantity')::integer
        );
      end loop;
    end loop;
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

do $security$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'postgres' and rolbypassrls)
  then raise exception 'SECURITY_DEFINER_OWNER_REJECTED'; end if;
end $security$;

alter function app_private.jsonb_has_exact_keys(jsonb,text[]) owner to postgres;
alter function app_private.build_menu_catalog_state(uuid,uuid,uuid,boolean) owner to postgres;
alter function app_private.get_menu_catalog(uuid,uuid,uuid) owner to postgres;
alter function app_private.save_menu_catalog(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,uuid,text,jsonb) owner to postgres;

revoke all on app.menu_catalogs, app.menu_categories, app.menu_products, app.menu_modifier_groups,
  app.menu_modifier_options, app.menu_catalog_heads, app.menu_catalog_audit_events
  from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.jsonb_has_exact_keys(jsonb,text[]) from public,anon,authenticated,service_role,app_api;
revoke all on function app_private.build_menu_catalog_state(uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role,app_api;
revoke all on function app_private.get_menu_catalog(uuid,uuid,uuid) from public,anon,authenticated,service_role,app_api;
revoke all on function app_private.save_menu_catalog(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,uuid,text,jsonb)
  from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.get_menu_catalog(uuid,uuid,uuid) to app_api;
grant execute on function app_private.save_menu_catalog(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,uuid,text,jsonb) to app_api;

alter table app.menu_catalogs enable row level security;
alter table app.menu_catalogs force row level security;
alter table app.menu_categories enable row level security;
alter table app.menu_categories force row level security;
alter table app.menu_products enable row level security;
alter table app.menu_products force row level security;
alter table app.menu_modifier_groups enable row level security;
alter table app.menu_modifier_groups force row level security;
alter table app.menu_modifier_options enable row level security;
alter table app.menu_modifier_options force row level security;
alter table app.menu_catalog_heads enable row level security;
alter table app.menu_catalog_heads force row level security;
alter table app.menu_catalog_audit_events enable row level security;
alter table app.menu_catalog_audit_events force row level security;

comment on table app.menu_catalogs is 'Immutable restaurant-owned menu releases with exact currency and publication metadata.';
comment on table app.menu_catalog_heads is 'Atomic pointer to each restaurant current menu release.';
comment on table app.menu_catalog_audit_events is 'Immutable branch-authorized and idempotent menu publication evidence.';

commit;
