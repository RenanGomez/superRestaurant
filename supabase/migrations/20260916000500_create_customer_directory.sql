begin;

-- Candidate only: no writer or client grant is introduced in this foundation.
create table app.customers (
  id uuid not null,
  restaurant_id uuid not null references app.restaurants (id) on delete restrict,
  display_name text not null,
  version bigint not null default 1,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by uuid not null references auth.users (id) on delete restrict,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_by uuid not null references auth.users (id) on delete restrict,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete restrict,
  constraint customers_pk primary key (restaurant_id, id),
  constraint customers_display_name_valid check (char_length(display_name) between 1 and 120 and display_name = btrim(display_name)),
  constraint customers_version_valid check (version between 1 and 9007199254740991),
  constraint customers_lifecycle_valid check (
    updated_at >= created_at and
    ((deleted_at is null and deleted_by is null) or (deleted_at = updated_at and deleted_by is not null))
  )
);

create table app.customer_phones (
  restaurant_id uuid not null,
  customer_id uuid not null,
  contact_id uuid not null,
  label text not null,
  display_value text not null,
  normalized_value text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  deleted_at timestamptz,
  constraint customer_phones_pk primary key (restaurant_id, customer_id, contact_id),
  constraint customer_phones_customer_fk foreign key (restaurant_id, customer_id)
    references app.customers (restaurant_id, id) on delete restrict,
  constraint customer_phones_label_valid check (char_length(label) between 1 and 40 and label = btrim(label)),
  constraint customer_phones_display_valid check (char_length(display_value) between 1 and 80 and display_value = btrim(display_value)),
  constraint customer_phones_normalized_valid check (normalized_value ~ '^\+?[0-9]{1,20}$'),
  constraint customer_phones_lifecycle_valid check (
    updated_at >= created_at and (deleted_at is null or deleted_at = updated_at)
  )
);
-- Deliberately not unique: shared household/business numbers remain separate candidates.
create index customer_phones_search_idx
  on app.customer_phones (restaurant_id, normalized_value, customer_id)
  where deleted_at is null;

create table app.customer_addresses (
  id uuid not null,
  restaurant_id uuid not null,
  customer_id uuid not null,
  label text not null,
  street_line text,
  unit text,
  neighborhood text,
  locality text,
  region text,
  country_code text,
  postal_code text,
  references_text text,
  instructions text,
  latitude_e6 integer,
  longitude_e6 integer,
  validation_branch_id uuid,
  validation_event_id uuid,
  validated_by uuid references auth.users (id) on delete restrict,
  validation_device_id uuid,
  validated_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by uuid not null references auth.users (id) on delete restrict,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_by uuid not null references auth.users (id) on delete restrict,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete restrict,
  constraint customer_addresses_pk primary key (restaurant_id, customer_id, id),
  constraint customer_addresses_customer_fk foreign key (restaurant_id, customer_id)
    references app.customers (restaurant_id, id) on delete restrict,
  constraint customer_addresses_validation_branch_fk foreign key (restaurant_id, validation_branch_id)
    references app.branches (restaurant_id, id) on delete restrict,
  constraint customer_addresses_label_valid check (char_length(label) between 1 and 40 and label = btrim(label)),
  constraint customer_addresses_text_valid check (
    (street_line is null or (char_length(street_line) between 1 and 200 and street_line = btrim(street_line))) and
    (unit is null or (char_length(unit) between 1 and 200 and unit = btrim(unit))) and
    (neighborhood is null or (char_length(neighborhood) between 1 and 200 and neighborhood = btrim(neighborhood))) and
    (locality is null or (char_length(locality) between 1 and 200 and locality = btrim(locality))) and
    (region is null or (char_length(region) between 1 and 200 and region = btrim(region))) and
    (postal_code is null or (char_length(postal_code) between 1 and 200 and postal_code = btrim(postal_code))) and
    (references_text is null or (char_length(references_text) between 1 and 500 and references_text = btrim(references_text))) and
    (instructions is null or (char_length(instructions) between 1 and 500 and instructions = btrim(instructions))) and
    (country_code is null or country_code ~ '^[A-Z]{2}$')
  ),
  constraint customer_addresses_coordinates_valid check (
    (latitude_e6 is null and longitude_e6 is null) or
    (latitude_e6 between -90000000 and 90000000 and longitude_e6 between -180000000 and 180000000)
  ),
  constraint customer_addresses_validation_valid check (
    (validation_branch_id is null and validation_event_id is null and validated_by is null and validation_device_id is null and validated_at is null) or
    (validation_branch_id is not null and validation_event_id is not null and validated_by is not null and validation_device_id is not null and
      validated_at is not null and street_line is not null and locality is not null and country_code is not null and
      validated_at between created_at and updated_at)
  ),
  constraint customer_addresses_version_valid check (version between 1 and 9007199254740991),
  constraint customer_addresses_lifecycle_valid check (
    updated_at >= created_at and
    ((deleted_at is null and deleted_by is null) or (deleted_at = updated_at and deleted_by is not null))
  )
);
create index customer_addresses_search_idx
  on app.customer_addresses (restaurant_id, locality, neighborhood, customer_id)
  where deleted_at is null;

create table app.customer_party_snapshots (
  id uuid not null,
  restaurant_id uuid not null,
  customer_id uuid not null,
  contact_id uuid not null,
  display_name text not null,
  phone_display_value text not null,
  phone_normalized_value text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by uuid not null references auth.users (id) on delete restrict,
  constraint customer_party_snapshots_pk primary key (restaurant_id, customer_id, id),
  constraint customer_party_snapshots_customer_fk foreign key (restaurant_id, customer_id)
    references app.customers (restaurant_id, id) on delete restrict,
  constraint customer_party_snapshots_values_valid check (
    char_length(display_name) between 1 and 120 and display_name = btrim(display_name) and
    char_length(phone_display_value) between 1 and 80 and phone_display_value = btrim(phone_display_value) and
    phone_normalized_value ~ '^\+?[0-9]{1,20}$'
  )
);

create table app.customer_fulfillment_snapshots (
  id uuid not null,
  restaurant_id uuid not null,
  branch_id uuid not null,
  customer_id uuid not null,
  address_id uuid not null,
  party_snapshot_id uuid not null,
  label text not null,
  street_line text not null,
  unit text,
  neighborhood text,
  locality text not null,
  region text,
  country_code text not null,
  postal_code text,
  references_text text,
  instructions text,
  latitude_e6 integer,
  longitude_e6 integer,
  validation_event_id uuid not null,
  validated_by uuid not null references auth.users (id) on delete restrict,
  validation_device_id uuid not null,
  validated_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by uuid not null references auth.users (id) on delete restrict,
  constraint customer_fulfillment_snapshots_pk primary key (restaurant_id, branch_id, id),
  constraint customer_fulfillment_snapshots_branch_fk foreign key (restaurant_id, branch_id)
    references app.branches (restaurant_id, id) on delete restrict,
  constraint customer_fulfillment_snapshots_address_fk foreign key (restaurant_id, customer_id, address_id)
    references app.customer_addresses (restaurant_id, customer_id, id) on delete restrict,
  constraint customer_fulfillment_snapshots_party_fk foreign key (restaurant_id, customer_id, party_snapshot_id)
    references app.customer_party_snapshots (restaurant_id, customer_id, id) on delete restrict,
  constraint customer_fulfillment_snapshots_values_valid check (
    char_length(label) between 1 and 40 and label = btrim(label) and
    char_length(street_line) between 1 and 200 and street_line = btrim(street_line) and
    char_length(locality) between 1 and 200 and locality = btrim(locality) and
    country_code ~ '^[A-Z]{2}$' and
    (unit is null or (char_length(unit) between 1 and 200 and unit = btrim(unit))) and
    (neighborhood is null or (char_length(neighborhood) between 1 and 200 and neighborhood = btrim(neighborhood))) and
    (region is null or (char_length(region) between 1 and 200 and region = btrim(region))) and
    (postal_code is null or (char_length(postal_code) between 1 and 200 and postal_code = btrim(postal_code))) and
    (references_text is null or (char_length(references_text) between 1 and 500 and references_text = btrim(references_text))) and
    (instructions is null or (char_length(instructions) between 1 and 500 and instructions = btrim(instructions)))
  ),
  constraint customer_fulfillment_snapshots_coordinates_valid check (
    (latitude_e6 is null and longitude_e6 is null) or
    (latitude_e6 between -90000000 and 90000000 and longitude_e6 between -180000000 and 180000000)
  ),
  constraint customer_fulfillment_snapshots_timestamp_valid check (validated_at <= created_at)
);

alter table app.customers enable row level security;
alter table app.customers force row level security;
alter table app.customer_phones enable row level security;
alter table app.customer_phones force row level security;
alter table app.customer_addresses enable row level security;
alter table app.customer_addresses force row level security;
alter table app.customer_party_snapshots enable row level security;
alter table app.customer_party_snapshots force row level security;
alter table app.customer_fulfillment_snapshots enable row level security;
alter table app.customer_fulfillment_snapshots force row level security;

revoke all on app.customers, app.customer_phones, app.customer_addresses,
  app.customer_party_snapshots, app.customer_fulfillment_snapshots
  from public, anon, authenticated, service_role, app_api;

comment on table app.customers is 'Restaurant-scoped operational directory. Similar phones never imply merge.';
comment on table app.customer_addresses is 'Editable addresses. Coordinates do not imply validation; any edit must clear validation evidence in the future private writer.';
comment on table app.customer_party_snapshots is 'Immutable historical party facts for capture/order linkage; private insert-only writer required.';
comment on table app.customer_fulfillment_snapshots is 'Immutable branch-validated fulfillment facts; private insert-only writer required.';

commit;
