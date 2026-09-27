begin;

-- S7.1b: manual delivery-coverage zones per Branch (decision 8.1.1: no geocoding/polygons).
-- Design decision (array vs. auxiliary table): postal_codes/localities stay as text[] on the
-- zone row (they are read wholesale by the pure domain matcher packages/domain/src/delivery-zone.ts
-- and never queried element-by-element by SQL), but the "one active zone per postal code in a
-- Branch" invariant is enforced with a separate app.delivery_zone_postal_codes membership table
-- instead of a partial index on the array column, for two reasons: (1) Postgres cannot express
-- "unique array element across rows" with a plain index (would need a GIN exclusion constraint
-- keyed on unnest, which loses the simple, auditable "for share"/upsert transaction shape used
-- elsewhere in this file), and (2) a partial index's predicate must be immutable and cannot look
-- at another table's active/deleted_at columns, so "active zones only" cannot be expressed as a
-- cross-table partial index at all. Instead, app_private.upsert_delivery_zone is the only writer
-- of both tables and keeps the membership table in lockstep: it inserts one row per postal code
-- while a zone is active and not soft-deleted, and removes those rows the moment the zone is
-- deactivated or soft-deleted. Because the membership table then only ever holds rows for
-- currently-active, non-deleted zones, a plain (unconditional) unique constraint on
-- (restaurant_id, branch_id, postal_code) is sufficient and correct -- there is nothing to filter.

-- Helper for the text-array CHECK constraints below: a Postgres CHECK constraint cannot itself
-- contain a subquery (even a correlated one over the row's own array column), so the unnest-based
-- validation is factored into an IMMUTABLE SQL function and called as a plain expression instead.
create function app_private.text_array_is_clean(p_values text[], p_min_length integer, p_max_length integer)
returns boolean language sql immutable set search_path = '' as $function$
  select not exists (
    select 1 from pg_catalog.unnest(p_values) as item(value)
    where value <> pg_catalog.btrim(value)
      or pg_catalog.char_length(value) not between p_min_length and p_max_length
      or value ~ '[[:cntrl:]]'
  )
  and pg_catalog.cardinality(p_values) = (
    select count(distinct value) from pg_catalog.unnest(p_values) as item(value)
  )
$function$;

revoke all on function app_private.text_array_is_clean(text[], integer, integer) from public, anon, authenticated, service_role, app_api;

comment on function app_private.text_array_is_clean(text[], integer, integer) is
  'Shared CHECK-constraint helper: every element is trimmed, control-character-free and within length bounds, with no duplicates. Factored out because CHECK constraints cannot contain subqueries directly.';

create table app.delivery_zones (
  id uuid not null,
  restaurant_id uuid not null,
  branch_id uuid not null,
  name text not null,
  postal_codes text[] not null default '{}',
  localities text[] not null default '{}',
  fee_minor bigint not null,
  currency_code text not null,
  active boolean not null default true,
  version bigint not null default 1,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by uuid not null references auth.users (id) on delete restrict,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_by uuid not null references auth.users (id) on delete restrict,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete restrict,
  constraint delivery_zones_pk primary key (restaurant_id, branch_id, id),
  constraint delivery_zones_branch_fk foreign key (restaurant_id, branch_id)
    references app.branches (restaurant_id, id) on delete restrict,
  constraint delivery_zones_restaurant_id_branch_id_id_unique unique (restaurant_id, branch_id, id),
  constraint delivery_zones_name_valid check (
    name = pg_catalog.btrim(name)
    and pg_catalog.char_length(name) between 1 and 80
    and name !~ '[[:cntrl:]]'
  ),
  -- Domain invariant (packages/domain/src/delivery-zone.ts createDeliveryZone): a zone with
  -- neither postal codes nor localities can never match and is rejected as misconfigured.
  constraint delivery_zones_coverage_nonempty check (
    pg_catalog.cardinality(postal_codes) > 0 or pg_catalog.cardinality(localities) > 0
  ),
  constraint delivery_zones_postal_codes_valid check (
    app_private.text_array_is_clean(postal_codes, 1, 20)
  ),
  constraint delivery_zones_localities_valid check (
    app_private.text_array_is_clean(localities, 1, 120)
  ),
  -- Money: minor units, integer, never negative; ISO 4217 currency code (repo convention is a
  -- checked `text` column rather than `char(3)`, matching app.payments/app.cash_movements).
  constraint delivery_zones_fee_valid check (fee_minor between 0 and 9007199254740991),
  constraint delivery_zones_currency_valid check (currency_code ~ '^[A-Z]{3}$'),
  constraint delivery_zones_version_valid check (version between 1 and 9007199254740991),
  constraint delivery_zones_timestamp_order check (updated_at >= created_at),
  constraint delivery_zones_deleted_evidence check (
    (deleted_at is null and deleted_by is null)
    or (deleted_at is not null and deleted_by is not null and deleted_at >= created_at)
  ),
  -- A soft-deleted zone can never be reported active (upsert_delivery_zone enforces this too;
  -- the check makes the invariant hold even against a future direct-SQL mistake).
  constraint delivery_zones_deleted_inactive check (deleted_at is null or active = false)
);

create index delivery_zones_scope_active_idx
  on app.delivery_zones (restaurant_id, branch_id, active, name, id)
  where deleted_at is null;

alter table app.delivery_zones enable row level security;
alter table app.delivery_zones force row level security;
revoke all on app.delivery_zones from public, anon, authenticated, service_role, app_api;

comment on table app.delivery_zones is
  'Server-only manual delivery coverage zones per Branch (postal codes/localities, frozen fee in minor units). No geocoding/polygons (decision 8.1.1). Access only through app_private SECURITY DEFINER functions.';

-- One row per (branch, postal code) currently claimed by an active, non-deleted zone. See the
-- design-decision comment above the app.delivery_zones table for why this membership table
-- exists instead of a partial index on the postal_codes array.
create table app.delivery_zone_postal_codes (
  restaurant_id uuid not null,
  branch_id uuid not null,
  zone_id uuid not null,
  postal_code text not null,
  constraint delivery_zone_postal_codes_pk primary key (restaurant_id, branch_id, zone_id, postal_code),
  constraint delivery_zone_postal_codes_zone_fk foreign key (restaurant_id, branch_id, zone_id)
    references app.delivery_zones (restaurant_id, branch_id, id) on delete cascade,
  constraint delivery_zone_postal_codes_unique unique (restaurant_id, branch_id, postal_code),
  constraint delivery_zone_postal_codes_valid check (
    postal_code = pg_catalog.btrim(postal_code)
    and pg_catalog.char_length(postal_code) between 1 and 20
    and postal_code !~ '[[:cntrl:]]'
  )
);

alter table app.delivery_zone_postal_codes enable row level security;
alter table app.delivery_zone_postal_codes force row level security;
revoke all on app.delivery_zone_postal_codes from public, anon, authenticated, service_role, app_api;

comment on table app.delivery_zone_postal_codes is
  'Server-only membership index: exactly the postal codes currently claimed by an active, non-deleted delivery zone in a Branch. Maintained only by app_private.upsert_delivery_zone; enforces one active zone per postal code per Branch.';

-- Append-only accepted-command journal and audit for zone upserts (mirrors
-- app.capture_command_events: one accepted command is also its own audit event).
create table app.delivery_zone_command_events (
  event_id uuid primary key,
  restaurant_id uuid not null,
  branch_id uuid not null,
  zone_id uuid not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  actor_membership_id uuid not null,
  device_id uuid not null,
  operation text not null,
  idempotency_key text not null,
  command_fingerprint text not null,
  expected_version bigint not null,
  result_version bigint not null,
  result_zone jsonb not null,
  reason text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint delivery_zone_events_actor_scope_fk foreign key (restaurant_id, branch_id, actor_membership_id, actor_id)
    references app.memberships (restaurant_id, branch_id, id, user_id) on delete restrict,
  constraint delivery_zone_events_zone_scope_fk foreign key (restaurant_id, branch_id, zone_id)
    references app.delivery_zones (restaurant_id, branch_id, id) on delete restrict,
  constraint delivery_zone_events_idempotency_unique unique (actor_id, restaurant_id, branch_id, idempotency_key),
  constraint delivery_zone_events_version_unique unique (restaurant_id, branch_id, zone_id, result_version),
  constraint delivery_zone_events_idempotency_valid check (
    char_length(idempotency_key) between 1 and 200 and idempotency_key = btrim(idempotency_key)
    and idempotency_key !~ '[[:cntrl:]]'
  ),
  constraint delivery_zone_events_fingerprint_valid check (command_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint delivery_zone_events_operation_valid check (operation in ('delivery_zone.created', 'delivery_zone.updated')),
  constraint delivery_zone_events_version_valid check (
    expected_version between 0 and 9007199254740990 and result_version = expected_version + 1
    and ((operation = 'delivery_zone.created') = (expected_version = 0))
  ),
  constraint delivery_zone_events_reason_valid check (
    reason is null or (char_length(btrim(reason)) between 1 and 500 and reason !~ '[[:cntrl:]]')
  ),
  -- result_zone stores exactly the DeliveryZoneV1 wire shape built by
  -- app_private.delivery_zone_to_jsonb; this is a cheap belt-and-suspenders shape check, not a
  -- substitute for the shared-types parser the API applies to the actual response.
  constraint delivery_zone_events_result_valid check (
    pg_catalog.jsonb_typeof(result_zone) = 'object'
    and result_zone ->> 'schemaVersion' = '1'
    and result_zone ->> 'zoneId' = zone_id::text
    -- Contract rule (parseUpsertDeliveryZoneCommandV1: "if (!active && reason === null) return
    -- undefined"): a reason is required exactly when the accepted command deactivated the zone.
    and (reason is not null or (result_zone ->> 'active')::boolean = true)
  )
);

alter table app.delivery_zone_command_events enable row level security;
alter table app.delivery_zone_command_events force row level security;
revoke all on app.delivery_zone_command_events from public, anon, authenticated, service_role, app_api;

comment on table app.delivery_zone_command_events is
  'Server-only append-only accepted-command journal and audit for delivery zone upserts. Fingerprint binds the complete canonical command, actor and scope; replay never re-derives a result.';

-- Roles granted app_private.jsonb_has_exact_keys already exists (menu catalog migration);
-- reused here unchanged.

-- Single source of truth for the wire shape of one zone: exactly the 12 keys
-- packages/shared-types/src/delivery-zones.ts DeliveryZoneV1/parseDeliveryZoneV1 require (an
-- `exactRecord` parse, so an extra or missing key rejects the whole response). Both
-- app_private.list_delivery_zones and app_private.upsert_delivery_zone must build a zone through
-- this one function so the two paths can never diverge in shape.
create function app_private.delivery_zone_to_jsonb(p_zone app.delivery_zones)
returns jsonb language sql immutable set search_path = '' as $function$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'zoneId', p_zone.id::text,
    'restaurantId', p_zone.restaurant_id::text,
    'branchId', p_zone.branch_id::text,
    'name', p_zone.name,
    'postalCodes', to_jsonb(p_zone.postal_codes),
    'localities', to_jsonb(p_zone.localities),
    'feeMinor', p_zone.fee_minor,
    'currency', p_zone.currency_code,
    'active', p_zone.active,
    'version', p_zone.version,
    'updatedAt', pg_catalog.to_char(p_zone.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
$function$;

revoke all on function app_private.delivery_zone_to_jsonb(app.delivery_zones) from public, anon, authenticated, service_role, app_api;

comment on function app_private.delivery_zone_to_jsonb(app.delivery_zones) is
  'Shared zone-row-to-wire-shape constructor: exactly the 12 keys DeliveryZoneV1/parseDeliveryZoneV1 in packages/shared-types/src/delivery-zones.ts require, in the order the codebase already uses. Used by both list_delivery_zones and upsert_delivery_zone so their zone shape can never diverge.';

-- Manager-tier roles allowed to write zones (owner/admin/manager), matching the tier already
-- used by app_private.create_dining_zone for Branch configuration writes.
create function app_private.list_delivery_zones(p_actor_id uuid, p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_restaurant uuid;
  v_branch uuid;
  v_zones jsonb;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_request, array['schemaVersion','scope'])
    or not app_private.jsonb_has_exact_keys(p_request -> 'scope', array['restaurantId','branchId'])
    or p_request -> 'schemaVersion' is distinct from '1'::jsonb
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;
  begin
    v_restaurant := (p_request #>> '{scope,restaurantId}')::uuid;
    v_branch := (p_request #>> '{scope,branchId}')::uuid;
  exception when invalid_text_representation then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if v_restaurant is null or v_branch is null then
    return pg_catalog.jsonb_build_object('status','rejected');
  end if;

  -- Listing for management/quoting: any operational role with captures.read (owner, admin,
  -- manager, supervisor, cashier, waiter) may read the zone catalog; only manager-tier may write.
  if not exists (
    select 1 from app.memberships m
    join app.branches b on b.restaurant_id = m.restaurant_id and b.id = m.branch_id
    join app.restaurants r on r.id = m.restaurant_id
    join app.membership_role_grants g on g.membership_id = m.id
    where m.user_id = p_actor_id and m.restaurant_id = v_restaurant and m.branch_id = v_branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null
      and g.revoked_at is null
      and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
  ) then return pg_catalog.jsonb_build_object('status','denied'); end if;

  select coalesce(pg_catalog.jsonb_agg(app_private.delivery_zone_to_jsonb(dz) order by dz.name, dz.id), '[]'::jsonb)
  into v_zones
  from app.delivery_zones dz
  where dz.restaurant_id = v_restaurant and dz.branch_id = v_branch and dz.deleted_at is null;

  return pg_catalog.jsonb_build_object('schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('restaurantId', v_restaurant::text, 'branchId', v_branch::text),
    'zones', v_zones);
end
$function$;

alter function app_private.list_delivery_zones(uuid,jsonb) owner to postgres;
revoke all on function app_private.list_delivery_zones(uuid,jsonb) from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.list_delivery_zones(uuid,jsonb) to app_api;

comment on function app_private.list_delivery_zones(uuid,jsonb) is
  'Server-only management listing of one Branch''s delivery zones (including inactive), for any operational role holding captures.read. Writes still require manager-tier via app_private.upsert_delivery_zone.';

create function app_private.list_active_delivery_zones_for_quote(p_restaurant_id uuid, p_branch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_zones jsonb;
begin
  if p_restaurant_id is null or p_branch_id is null then
    return pg_catalog.jsonb_build_object('status','rejected');
  end if;

  select coalesce(pg_catalog.jsonb_agg(z.row_json order by z.id), '[]'::jsonb)
  into v_zones
  from (
    select dz.id, pg_catalog.jsonb_build_object(
      'zoneId', dz.id::text,
      'restaurantId', dz.restaurant_id::text,
      'branchId', dz.branch_id::text,
      'name', dz.name,
      'postalCodes', to_jsonb(dz.postal_codes),
      'localities', to_jsonb(dz.localities),
      'feeMinor', dz.fee_minor,
      'currency', dz.currency_code
    ) as row_json
    from app.delivery_zones dz
    where dz.restaurant_id = p_restaurant_id and dz.branch_id = p_branch_id
      and dz.deleted_at is null and dz.active
  ) z;

  return pg_catalog.jsonb_build_object('schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('restaurantId', p_restaurant_id::text, 'branchId', p_branch_id::text),
    'zones', v_zones);
end
$function$;

alter function app_private.list_active_delivery_zones_for_quote(uuid,uuid) owner to postgres;
revoke all on function app_private.list_active_delivery_zones_for_quote(uuid,uuid) from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.list_active_delivery_zones_for_quote(uuid,uuid) to app_api;

comment on function app_private.list_active_delivery_zones_for_quote(uuid,uuid) is
  'Server-only, unauthenticated-by-design (Restaurant/Branch scope is asserted by the caller, which must itself have already authorized the actor) facts feed for apps/api quoteDelivery: active, non-deleted zones only, in a shape ready for packages/domain/src/delivery-zone.ts createDeliveryZone. Never confuse with an authorization boundary -- the API layer must authorize the actor before calling this.';

create function app_private.upsert_delivery_zone(p_actor_id uuid, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_restaurant uuid;
  v_branch uuid;
  v_zone uuid;
  v_event uuid;
  v_device uuid;
  v_member uuid;
  v_expected bigint;
  v_occurred timestamptz;
  v_observed timestamptz;
  v_fingerprint text;
  v_name text;
  v_postal_codes text[];
  v_localities text[];
  v_fee bigint;
  v_currency text;
  v_active boolean;
  v_reason text;
  v_operation text;
  v_stored app.delivery_zone_command_events%rowtype;
  v_current app.delivery_zones%rowtype;
  v_result jsonb;
  v_keys text[] := array[
    'schemaVersion','scope','zoneId','expectedVersion','eventId','idempotencyKey','deviceId',
    'occurredAt','name','postalCodes','localities','feeMinor','currency','active','reason'
  ];
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_command, v_keys)
    or not app_private.jsonb_has_exact_keys(p_command -> 'scope', array['restaurantId','branchId'])
    or p_command -> 'schemaVersion' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_command -> 'expectedVersion') is distinct from 'number'
    or not coalesce(p_command ->> 'expectedVersion' ~ '^(0|[1-9][0-9]*)$', false)
    or not coalesce(p_command ->> 'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    or pg_catalog.jsonb_typeof(p_command -> 'name') is distinct from 'string'
    or pg_catalog.char_length(pg_catalog.btrim(p_command ->> 'name')) not between 1 and 80
    or p_command ->> 'name' <> pg_catalog.btrim(p_command ->> 'name')
    or p_command ->> 'name' ~ '[[:cntrl:]]'
    or pg_catalog.jsonb_typeof(p_command -> 'postalCodes') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_command -> 'localities') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_command -> 'feeMinor') is distinct from 'number'
    or not coalesce(p_command ->> 'feeMinor' ~ '^(0|[1-9][0-9]*)$', false)
    or pg_catalog.jsonb_typeof(p_command -> 'currency') is distinct from 'string'
    or p_command ->> 'currency' !~ '^[A-Z]{3}$'
    or pg_catalog.jsonb_typeof(p_command -> 'active') is distinct from 'boolean'
    or (p_command -> 'reason' <> 'null'::jsonb and (
      pg_catalog.jsonb_typeof(p_command -> 'reason') is distinct from 'string'
      or pg_catalog.char_length(pg_catalog.btrim(p_command ->> 'reason')) not between 1 and 500
      or p_command ->> 'reason' ~ '[[:cntrl:]]'
    ))
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  begin
    v_restaurant := (p_command #>> '{scope,restaurantId}')::uuid;
    v_branch := (p_command #>> '{scope,branchId}')::uuid;
    v_zone := (p_command ->> 'zoneId')::uuid;
    v_event := (p_command ->> 'eventId')::uuid;
    v_device := (p_command ->> 'deviceId')::uuid;
    v_expected := (p_command ->> 'expectedVersion')::bigint;
    v_occurred := (p_command ->> 'occurredAt')::timestamptz;
    select array_agg(pg_catalog.btrim(value::text)) into v_postal_codes
      from pg_catalog.jsonb_array_elements_text(p_command -> 'postalCodes') as value;
    select array_agg(pg_catalog.btrim(value::text)) into v_localities
      from pg_catalog.jsonb_array_elements_text(p_command -> 'localities') as value;
    v_fee := (p_command ->> 'feeMinor')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range
    or datetime_field_overflow or invalid_datetime_format then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  v_currency := p_command ->> 'currency';
  v_active := (p_command ->> 'active')::boolean;
  v_reason := case when p_command -> 'reason' = 'null'::jsonb then null else pg_catalog.btrim(p_command ->> 'reason') end;
  v_name := pg_catalog.btrim(p_command ->> 'name');
  v_postal_codes := coalesce(v_postal_codes, '{}');
  v_localities := coalesce(v_localities, '{}');

  if v_restaurant is null or v_branch is null or v_zone is null or v_event is null or v_device is null
    or v_expected not between 0 and 9007199254740990 or v_occurred is null
    or p_command ->> 'occurredAt' is distinct from pg_catalog.to_char(v_occurred at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    or pg_catalog.cardinality(v_postal_codes) = 0 and pg_catalog.cardinality(v_localities) = 0
    or exists (select 1 from pg_catalog.unnest(v_postal_codes) v where v = '' or pg_catalog.char_length(v) > 20 or v ~ '[[:cntrl:]]')
    or exists (select 1 from pg_catalog.unnest(v_localities) v where v = '' or pg_catalog.char_length(v) > 120 or v ~ '[[:cntrl:]]')
    or pg_catalog.cardinality(v_postal_codes) <> (select count(distinct v) from pg_catalog.unnest(v_postal_codes) v)
    or pg_catalog.cardinality(v_localities) <> (select count(distinct v) from pg_catalog.unnest(v_localities) v)
    -- Contract rule (packages/shared-types/src/delivery-zones.ts parseUpsertDeliveryZoneCommandV1:
    -- "if (!active && reason === null) return undefined"): a reason is required exactly when the
    -- command deactivates a zone (active=false), on creation or update alike (decision 8.1.2
    -- pattern extended to zone maintenance). It is never required merely because the zone already
    -- existed; the actor and full command are audited in the journal either way.
    or (not v_active and v_reason is null)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  v_operation := case when v_expected = 0 then 'delivery_zone.created' else 'delivery_zone.updated' end;

  -- Manager-tier only (owner/admin/manager); matches app_private.create_dining_zone's tier for
  -- Branch configuration writes.
  select m.id into v_member from app.memberships m
    join app.branches b on b.id = m.branch_id and b.restaurant_id = m.restaurant_id
    join app.restaurants r on r.id = m.restaurant_id
    join app.membership_role_grants g on g.membership_id = m.id
    where m.user_id = p_actor_id and m.restaurant_id = v_restaurant and m.branch_id = v_branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null
      and g.revoked_at is null and g.role_code in ('owner','admin','manager')
    order by g.role_code limit 1 for share of m, b, r, g;
  if v_member is null then return pg_catalog.jsonb_build_object('status','denied'); end if;

  v_fingerprint := encode(pg_catalog.sha256(convert_to(
    v_operation || ':' || p_command::text || ':' || p_actor_id::text, 'UTF8')), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'delivery-zone-command:' || p_actor_id::text || ':' || v_restaurant::text || ':' || v_branch::text
      || ':' || (p_command ->> 'idempotencyKey'), 0));

  select * into v_stored from app.delivery_zone_command_events where actor_id = p_actor_id
    and restaurant_id = v_restaurant and branch_id = v_branch and idempotency_key = p_command ->> 'idempotencyKey';
  if found then
    if v_stored.operation <> v_operation or v_stored.command_fingerprint <> v_fingerprint then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;
    -- Success envelope matches UpsertDeliveryZoneResultV1 exactly (schemaVersion, zone, replayed):
    -- no 'status' key here, so the API's rejected/denied/conflict peek never matches a real
    -- success and the strict exactRecord parse in parseUpsertDeliveryZoneResultV1 succeeds.
    return pg_catalog.jsonb_build_object('schemaVersion', 1, 'zone', v_stored.result_zone, 'replayed', true);
  end if;

  if exists (select 1 from app.delivery_zone_command_events where event_id = v_event) then
    return pg_catalog.jsonb_build_object('status','conflict');
  end if;

  v_observed := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());

  if v_expected = 0 then
    -- Creation: the caller-chosen zoneId must not already exist in this scope.
    if exists (select 1 from app.delivery_zones where restaurant_id = v_restaurant and branch_id = v_branch and id = v_zone) then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;
    begin
      insert into app.delivery_zones (
        id, restaurant_id, branch_id, name, postal_codes, localities, fee_minor, currency_code,
        active, version, created_at, created_by, updated_at, updated_by
      ) values (
        v_zone, v_restaurant, v_branch, v_name, v_postal_codes, v_localities, v_fee, v_currency,
        v_active, 1, v_observed, p_actor_id, v_observed, p_actor_id
      );
      if v_active and pg_catalog.cardinality(v_postal_codes) > 0 then
        insert into app.delivery_zone_postal_codes (restaurant_id, branch_id, zone_id, postal_code)
        select v_restaurant, v_branch, v_zone, code from pg_catalog.unnest(v_postal_codes) code;
      end if;
    exception when unique_violation then
      return pg_catalog.jsonb_build_object('status','conflict');
    end;
    select * into v_current from app.delivery_zones where restaurant_id = v_restaurant and branch_id = v_branch and id = v_zone;
  else
    select * into v_current from app.delivery_zones
      where restaurant_id = v_restaurant and branch_id = v_branch and id = v_zone for update;
    if not found or v_current.version <> v_expected or v_current.deleted_at is not null then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;
    begin
      update app.delivery_zones set
        name = v_name, postal_codes = v_postal_codes, localities = v_localities, fee_minor = v_fee,
        currency_code = v_currency, active = v_active, version = v_expected + 1,
        updated_at = v_observed, updated_by = p_actor_id
        where restaurant_id = v_restaurant and branch_id = v_branch and id = v_zone;
      delete from app.delivery_zone_postal_codes where restaurant_id = v_restaurant and branch_id = v_branch and zone_id = v_zone;
      if v_active and pg_catalog.cardinality(v_postal_codes) > 0 then
        insert into app.delivery_zone_postal_codes (restaurant_id, branch_id, zone_id, postal_code)
        select v_restaurant, v_branch, v_zone, code from pg_catalog.unnest(v_postal_codes) code;
      end if;
    exception when unique_violation then
      -- Another active zone in this Branch already claims one of these postal codes.
      return pg_catalog.jsonb_build_object('status','conflict');
    end;
    select * into v_current from app.delivery_zones where restaurant_id = v_restaurant and branch_id = v_branch and id = v_zone;
  end if;

  -- Same constructor as list_delivery_zones (app_private.delivery_zone_to_jsonb), so the two read
  -- paths can never diverge in shape: exactly the 12 keys DeliveryZoneV1 requires.
  v_result := app_private.delivery_zone_to_jsonb(v_current);

  insert into app.delivery_zone_command_events (
    event_id, restaurant_id, branch_id, zone_id, actor_id, actor_membership_id, device_id,
    operation, idempotency_key, command_fingerprint, expected_version, result_version,
    result_zone, reason, occurred_at, received_at
  ) values (
    v_event, v_restaurant, v_branch, v_zone, p_actor_id, v_member, v_device, v_operation,
    p_command ->> 'idempotencyKey', v_fingerprint, v_expected, v_expected + 1, v_result, v_reason,
    v_occurred, v_observed
  );

  -- Success envelope matches UpsertDeliveryZoneResultV1 exactly (schemaVersion, zone, replayed).
  -- Error paths above ('rejected'/'denied'/'conflict') return a disjoint {status: ...} shape
  -- instead of raising: the API layer peeks `raw.status` first (as apps/api/src/captures.ts
  -- already does for capture/customer commands) and maps it to its own application errors
  -- (denied -> authorization, rejected -> request, conflict -> conflict) before attempting the
  -- strict parseUpsertDeliveryZoneResultV1 decode, which only ever sees a real success/replay.
  return pg_catalog.jsonb_build_object('schemaVersion', 1, 'zone', v_result, 'replayed', false);
end
$function$;

alter function app_private.upsert_delivery_zone(uuid,jsonb) owner to postgres;
revoke all on function app_private.upsert_delivery_zone(uuid,jsonb) from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.upsert_delivery_zone(uuid,jsonb) to app_api;

comment on function app_private.upsert_delivery_zone(uuid,jsonb) is
  'Privileged server-only create/update of one delivery zone. Manager-tier only (owner/admin/manager). CAS by expectedVersion; idempotent by (actor, scope, idempotencyKey) fingerprint like app_private.mutate_capture_assignment. Maintains app.delivery_zone_postal_codes so only one active zone can claim a postal code per Branch. A reason is required exactly when the command deactivates a zone (active=false). On success/replay returns exactly UpsertDeliveryZoneResultV1''s shape {schemaVersion, zone, replayed}; on rejection/denial/conflict returns a disjoint {status: "rejected"|"denied"|"conflict"} for the API layer to translate, matching the status-peek convention already used by apps/api/src/captures.ts.';

commit;
