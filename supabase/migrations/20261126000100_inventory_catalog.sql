begin;

-- Inventory catalog: integer quantities in a declared base unit, restaurant-scoped items and
-- branch-scoped warehouses. Writes are server-only (future app_private SECURITY DEFINER functions);
-- authenticated may only read through the RLS policies below.
create table app.inventory_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references app.restaurants (id) on delete restrict,
  sku text,
  name text not null,
  unit_code text not null,
  purchase_unit_factor integer not null default 1,
  min_quantity integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  deleted_at timestamptz,
  constraint inventory_items_unit_code_valid check (unit_code in ('g', 'ml', 'piece')),
  constraint inventory_items_purchase_unit_factor_positive check (purchase_unit_factor > 0),
  constraint inventory_items_min_quantity_non_negative check (min_quantity >= 0),
  constraint inventory_items_name_valid check (pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 160)
);

create unique index inventory_items_active_sku_unique
  on app.inventory_items (restaurant_id, pg_catalog.lower(sku))
  where sku is not null and deleted_at is null;

create index inventory_items_restaurant_active_idx
  on app.inventory_items (restaurant_id, active, id)
  where deleted_at is null;

create table app.inventory_warehouses (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint inventory_warehouses_branch_scope_fk foreign key (restaurant_id, branch_id)
    references app.branches (restaurant_id, id) on delete restrict,
  constraint inventory_warehouses_scope_id_unique unique (restaurant_id, branch_id, id),
  constraint inventory_warehouses_name_valid check (pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 160)
);

create unique index inventory_warehouses_active_name_unique
  on app.inventory_warehouses (restaurant_id, branch_id, pg_catalog.lower(name))
  where active;

create index inventory_warehouses_branch_active_idx
  on app.inventory_warehouses (restaurant_id, branch_id, active, id);

revoke all on app.inventory_items, app.inventory_warehouses from public, anon, authenticated, service_role, app_api;
grant select on app.inventory_items, app.inventory_warehouses to authenticated;

alter table app.inventory_items enable row level security;
alter table app.inventory_items force row level security;
alter table app.inventory_warehouses enable row level security;
alter table app.inventory_warehouses force row level security;

create policy inventory_items_active_member_read
  on app.inventory_items
  for select
  to authenticated
  using (deleted_at is null and app_rls.has_active_restaurant_membership(restaurant_id));

create policy inventory_warehouses_active_branch_read
  on app.inventory_warehouses
  for select
  to authenticated
  using (app_rls.has_active_branch_membership(restaurant_id, branch_id));

comment on table app.inventory_items is 'Restaurant-scoped inventory items with integer quantities in a base unit; server-only writes.';
comment on column app.inventory_items.restaurant_id is 'Restaurant that owns the item; shared across its branches.';
comment on column app.inventory_items.sku is 'Optional case-insensitive SKU unique per restaurant while not deleted.';
comment on column app.inventory_items.name is 'Human-readable item name.';
comment on column app.inventory_items.unit_code is 'Base unit for every integer quantity: g, ml or piece.';
comment on column app.inventory_items.purchase_unit_factor is 'Integer factor converting a purchase presentation to the base unit.';
comment on column app.inventory_items.min_quantity is 'Stock alert threshold in base units.';
comment on column app.inventory_items.active is 'Whether the item may be used by new operations.';
comment on column app.inventory_items.deleted_at is 'Logical deletion timestamp; a deleted item frees its SKU.';
comment on table app.inventory_warehouses is 'Branch-scoped inventory warehouses; no global warehouse exists.';
comment on column app.inventory_warehouses.branch_id is 'Branch that owns the warehouse.';
comment on column app.inventory_warehouses.name is 'Warehouse name unique per branch while active.';
comment on column app.inventory_warehouses.active is 'Whether the warehouse may receive new movements.';

commit;
