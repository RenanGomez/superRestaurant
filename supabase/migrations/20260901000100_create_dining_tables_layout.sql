begin;

create table app.dining_tables (
  id uuid primary key,
  restaurant_id uuid not null,
  branch_id uuid not null,
  zone_id uuid not null,
  name text not null,
  name_key text generated always as (pg_catalog.lower(pg_catalog.btrim(name))) stored,
  capacity integer not null,
  shape text not null,
  layout_x integer not null,
  layout_y integer not null,
  layout_width integer not null,
  layout_height integer not null,
  version bigint not null default 1,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by uuid not null references auth.users (id) on delete restrict,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_by uuid not null references auth.users (id) on delete restrict,
  deleted_at timestamptz,
  constraint dining_tables_zone_scope_fk foreign key (restaurant_id, branch_id, zone_id)
    references app.dining_zones (restaurant_id, branch_id, id) on delete restrict,
  constraint dining_tables_scope_id_unique unique (restaurant_id, branch_id, id),
  constraint dining_tables_scope_name_unique unique (restaurant_id, branch_id, name_key),
  constraint dining_tables_name_valid check (name = pg_catalog.btrim(name) and pg_catalog.char_length(name) between 1 and 40 and name !~ '[[:cntrl:]]'),
  constraint dining_tables_capacity_valid check (capacity between 1 and 50),
  constraint dining_tables_shape_valid check (shape in ('round', 'square', 'rectangle')),
  constraint dining_tables_geometry_valid check (
    layout_x between 0 and 23 and layout_y between 0 and 99
    and layout_width between 2 and 8 and layout_height between 2 and 8
    and layout_x + layout_width <= 24 and layout_y + layout_height <= 100
  ),
  constraint dining_tables_version_positive check (version > 0)
);

create index dining_tables_zone_order_idx on app.dining_tables (restaurant_id, branch_id, zone_id, name_key, id) where deleted_at is null;

create table app.dining_table_audit_events (
  event_id uuid primary key,
  idempotency_key uuid not null,
  restaurant_id uuid not null,
  branch_id uuid not null,
  table_id uuid not null,
  zone_id uuid not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  device_id uuid not null,
  operation text not null,
  expected_version bigint,
  result_version bigint not null,
  result_updated_at timestamptz not null,
  name_snapshot text not null,
  capacity_snapshot integer not null,
  shape_snapshot text not null,
  layout_x_snapshot integer not null,
  layout_y_snapshot integer not null,
  layout_width_snapshot integer not null,
  layout_height_snapshot integer not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint dining_table_audit_table_scope_fk foreign key (restaurant_id, branch_id, table_id)
    references app.dining_tables (restaurant_id, branch_id, id) on delete restrict,
  constraint dining_table_audit_zone_scope_fk foreign key (restaurant_id, branch_id, zone_id)
    references app.dining_zones (restaurant_id, branch_id, id) on delete restrict,
  constraint dining_table_audit_idempotency_unique unique (actor_id, restaurant_id, branch_id, idempotency_key),
  constraint dining_table_audit_operation_valid check (
    (operation = 'created' and expected_version is null and result_version = 1)
    or (operation = 'layout_updated' and expected_version is not null and result_version = expected_version + 1)
  )
);

create index dining_table_audit_table_idx on app.dining_table_audit_events (restaurant_id, branch_id, table_id, received_at, event_id);

create function app_private.list_dining_layout(p_actor_id uuid, p_restaurant_id uuid, p_branch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare result jsonb;
begin
  if not exists (
    select 1 from app.memberships m
    join app.membership_role_grants rg on rg.membership_id = m.id and rg.revoked_at is null
      and rg.role_code in ('owner','admin','manager','supervisor','cashier','waiter','viewer','auditor')
    join app.restaurants r on r.id = m.restaurant_id and r.disabled_at is null
    join app.branches b on b.id = m.branch_id and b.restaurant_id = m.restaurant_id and b.disabled_at is null
    where m.user_id = p_actor_id and m.restaurant_id = p_restaurant_id and m.branch_id = p_branch_id and m.revoked_at is null
  ) then return null; end if;

  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('restaurantId', p_restaurant_id::text, 'branchId', p_branch_id::text),
    'zones', coalesce(pg_catalog.jsonb_agg(zone_payload order by zone_id::text), '[]'::jsonb)
  ) into result
  from (
    select z.id as zone_id, pg_catalog.jsonb_build_object(
      'zoneId', z.id::text, 'name', z.name, 'version', z.version,
      'tables', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'schemaVersion', 1,
          'scope', pg_catalog.jsonb_build_object('restaurantId', t.restaurant_id::text, 'branchId', t.branch_id::text),
          'tableId', t.id::text, 'zoneId', t.zone_id::text, 'name', t.name, 'capacity', t.capacity,
          'shape', t.shape, 'layout', pg_catalog.jsonb_build_object('x', t.layout_x, 'y', t.layout_y, 'width', t.layout_width, 'height', t.layout_height),
          'version', t.version, 'updatedAt', pg_catalog.to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'updatedBy', t.updated_by::text, 'replayed', false
        ) order by t.id::text)
        from app.dining_tables t
        where t.restaurant_id = z.restaurant_id and t.branch_id = z.branch_id and t.zone_id = z.id and t.deleted_at is null
      ), '[]'::jsonb)
    ) as zone_payload
    from app.dining_zones z where z.restaurant_id = p_restaurant_id and z.branch_id = p_branch_id
  ) zones;
  return result;
end $function$;

create function app_private.create_dining_table(
  p_actor_id uuid, p_restaurant_id uuid, p_branch_id uuid, p_table_id uuid, p_zone_id uuid,
  p_event_id uuid, p_idempotency_key uuid, p_device_id uuid, p_occurred_at timestamptz,
  p_name text, p_capacity integer, p_shape text, p_x integer, p_y integer, p_width integer, p_height integer
) returns table (
  status text, schema_version integer, restaurant_id uuid, branch_id uuid, table_id uuid, zone_id uuid,
  table_name text, capacity integer, shape text, layout_x integer, layout_y integer, layout_width integer,
  layout_height integer, table_version bigint, updated_at timestamptz, updated_by uuid
) language plpgsql volatile security definer set search_path = '' as $function$
declare existing_audit app.dining_table_audit_events%rowtype; current_table app.dining_tables%rowtype;
begin
  if p_actor_id is null or p_restaurant_id is null or p_branch_id is null or p_table_id is null or p_zone_id is null
    or p_event_id is null or p_idempotency_key is null or p_device_id is null or p_occurred_at is null
    or p_name is null or p_name <> pg_catalog.btrim(p_name) or pg_catalog.char_length(p_name) not between 1 and 40 or p_name ~ '[[:cntrl:]]'
    or p_capacity not between 1 and 50 or p_shape not in ('round','square','rectangle')
    or p_x not between 0 and 23 or p_y not between 0 and 99 or p_width not between 2 and 8 or p_height not between 2 and 8
    or p_x + p_width > 24 or p_y + p_height > 100
  then return query select 'conflict', null::integer, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::integer, null::text, null::integer, null::integer, null::integer, null::integer, null::bigint, null::timestamptz, null::uuid; return; end if;
  if not exists (
    select 1 from app.memberships m join app.membership_role_grants rg on rg.membership_id=m.id and rg.revoked_at is null and rg.role_code in ('owner','admin','manager')
    join app.restaurants r on r.id=m.restaurant_id and r.disabled_at is null
    join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id and b.disabled_at is null
    where m.user_id=p_actor_id and m.restaurant_id=p_restaurant_id and m.branch_id=p_branch_id and m.revoked_at is null
  ) then return query select 'forbidden', null::integer, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::integer, null::text, null::integer, null::integer, null::integer, null::integer, null::bigint, null::timestamptz, null::uuid; return; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dining-table:' || p_table_id::text, 0));
  select * into existing_audit from app.dining_table_audit_events where actor_id=p_actor_id and restaurant_id=p_restaurant_id and branch_id=p_branch_id and idempotency_key=p_idempotency_key;
  if found then
    if existing_audit.event_id<>p_event_id or existing_audit.table_id<>p_table_id or existing_audit.zone_id<>p_zone_id or existing_audit.device_id<>p_device_id
      or existing_audit.operation<>'created' or existing_audit.occurred_at<>p_occurred_at or existing_audit.name_snapshot<>p_name
      or existing_audit.capacity_snapshot<>p_capacity or existing_audit.shape_snapshot<>p_shape or existing_audit.layout_x_snapshot<>p_x
      or existing_audit.layout_y_snapshot<>p_y or existing_audit.layout_width_snapshot<>p_width or existing_audit.layout_height_snapshot<>p_height
    then return query select 'conflict', null::integer, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::integer, null::text, null::integer, null::integer, null::integer, null::integer, null::bigint, null::timestamptz, null::uuid; return; end if;
    select * into strict current_table from app.dining_tables where restaurant_id=p_restaurant_id and branch_id=p_branch_id and id=p_table_id;
    return query select 'replayed',1,current_table.restaurant_id,current_table.branch_id,current_table.id,existing_audit.zone_id,existing_audit.name_snapshot,existing_audit.capacity_snapshot,existing_audit.shape_snapshot,existing_audit.layout_x_snapshot,existing_audit.layout_y_snapshot,existing_audit.layout_width_snapshot,existing_audit.layout_height_snapshot,existing_audit.result_version,existing_audit.result_updated_at,existing_audit.actor_id; return;
  end if;
  if exists(select 1 from app.dining_table_audit_events where event_id=p_event_id) then return query select 'conflict', null::integer, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::integer, null::text, null::integer, null::integer, null::integer, null::integer, null::bigint, null::timestamptz, null::uuid; return; end if;

  insert into app.dining_tables(id,restaurant_id,branch_id,zone_id,name,capacity,shape,layout_x,layout_y,layout_width,layout_height,created_by,updated_by)
    values(p_table_id,p_restaurant_id,p_branch_id,p_zone_id,p_name,p_capacity,p_shape,p_x,p_y,p_width,p_height,p_actor_id,p_actor_id)
    on conflict do nothing returning * into current_table;
  if not found then return query select 'conflict', null::integer, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::integer, null::text, null::integer, null::integer, null::integer, null::integer, null::bigint, null::timestamptz, null::uuid; return; end if;
  insert into app.dining_table_audit_events(event_id,idempotency_key,restaurant_id,branch_id,table_id,zone_id,actor_id,device_id,operation,expected_version,result_version,result_updated_at,name_snapshot,capacity_snapshot,shape_snapshot,layout_x_snapshot,layout_y_snapshot,layout_width_snapshot,layout_height_snapshot,occurred_at)
    values(p_event_id,p_idempotency_key,p_restaurant_id,p_branch_id,p_table_id,p_zone_id,p_actor_id,p_device_id,'created',null,1,current_table.updated_at,p_name,p_capacity,p_shape,p_x,p_y,p_width,p_height,p_occurred_at);
  return query select 'created',1,current_table.restaurant_id,current_table.branch_id,current_table.id,current_table.zone_id,current_table.name,current_table.capacity,current_table.shape,current_table.layout_x,current_table.layout_y,current_table.layout_width,current_table.layout_height,current_table.version,current_table.updated_at,current_table.updated_by;
end $function$;

create function app_private.update_dining_table_layout(
  p_actor_id uuid, p_restaurant_id uuid, p_branch_id uuid, p_table_id uuid, p_event_id uuid,
  p_idempotency_key uuid, p_device_id uuid, p_occurred_at timestamptz, p_expected_version bigint,
  p_x integer, p_y integer, p_width integer, p_height integer
) returns table (
  status text, schema_version integer, restaurant_id uuid, branch_id uuid, table_id uuid, zone_id uuid,
  table_name text, capacity integer, shape text, layout_x integer, layout_y integer, layout_width integer,
  layout_height integer, table_version bigint, updated_at timestamptz, updated_by uuid
) language plpgsql volatile security definer set search_path = '' as $function$
declare existing_audit app.dining_table_audit_events%rowtype; current_table app.dining_tables%rowtype;
begin
  if p_actor_id is null or p_restaurant_id is null or p_branch_id is null or p_table_id is null
    or p_event_id is null or p_idempotency_key is null or p_device_id is null or p_occurred_at is null
    or p_expected_version is null or p_expected_version < 1
    or p_x not between 0 and 23 or p_y not between 0 and 99 or p_width not between 2 and 8 or p_height not between 2 and 8
    or p_x + p_width > 24 or p_y + p_height > 100
  then return query select 'conflict', null::integer, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::integer, null::text, null::integer, null::integer, null::integer, null::integer, null::bigint, null::timestamptz, null::uuid; return; end if;
  if not exists (
    select 1 from app.memberships m join app.membership_role_grants rg on rg.membership_id=m.id and rg.revoked_at is null and rg.role_code in ('owner','admin','manager')
    join app.restaurants r on r.id=m.restaurant_id and r.disabled_at is null
    join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id and b.disabled_at is null
    where m.user_id=p_actor_id and m.restaurant_id=p_restaurant_id and m.branch_id=p_branch_id and m.revoked_at is null
  ) then return query select 'forbidden', null::integer, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::integer, null::text, null::integer, null::integer, null::integer, null::integer, null::bigint, null::timestamptz, null::uuid; return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dining-table:' || p_table_id::text, 0));
  select * into existing_audit from app.dining_table_audit_events where actor_id=p_actor_id and restaurant_id=p_restaurant_id and branch_id=p_branch_id and idempotency_key=p_idempotency_key;
  if found then
    if existing_audit.event_id<>p_event_id or existing_audit.table_id<>p_table_id or existing_audit.device_id<>p_device_id or existing_audit.operation<>'layout_updated'
      or existing_audit.occurred_at<>p_occurred_at or existing_audit.expected_version<>p_expected_version or existing_audit.layout_x_snapshot<>p_x
      or existing_audit.layout_y_snapshot<>p_y or existing_audit.layout_width_snapshot<>p_width or existing_audit.layout_height_snapshot<>p_height
    then return query select 'conflict', null::integer, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::integer, null::text, null::integer, null::integer, null::integer, null::integer, null::bigint, null::timestamptz, null::uuid; return; end if;
    return query select 'replayed',1,existing_audit.restaurant_id,existing_audit.branch_id,existing_audit.table_id,existing_audit.zone_id,existing_audit.name_snapshot,existing_audit.capacity_snapshot,existing_audit.shape_snapshot,existing_audit.layout_x_snapshot,existing_audit.layout_y_snapshot,existing_audit.layout_width_snapshot,existing_audit.layout_height_snapshot,existing_audit.result_version,existing_audit.result_updated_at,existing_audit.actor_id; return;
  end if;
  if exists(select 1 from app.dining_table_audit_events where event_id=p_event_id) then return query select 'conflict', null::integer, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::integer, null::text, null::integer, null::integer, null::integer, null::integer, null::bigint, null::timestamptz, null::uuid; return; end if;
  update app.dining_tables set layout_x=p_x,layout_y=p_y,layout_width=p_width,layout_height=p_height,version=version+1,updated_at=pg_catalog.clock_timestamp(),updated_by=p_actor_id
    where restaurant_id=p_restaurant_id and branch_id=p_branch_id and id=p_table_id and version=p_expected_version and deleted_at is null returning * into current_table;
  if not found then return query select 'conflict', null::integer, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::integer, null::text, null::integer, null::integer, null::integer, null::integer, null::bigint, null::timestamptz, null::uuid; return; end if;
  insert into app.dining_table_audit_events(event_id,idempotency_key,restaurant_id,branch_id,table_id,zone_id,actor_id,device_id,operation,expected_version,result_version,result_updated_at,name_snapshot,capacity_snapshot,shape_snapshot,layout_x_snapshot,layout_y_snapshot,layout_width_snapshot,layout_height_snapshot,occurred_at)
    values(p_event_id,p_idempotency_key,p_restaurant_id,p_branch_id,p_table_id,current_table.zone_id,p_actor_id,p_device_id,'layout_updated',p_expected_version,current_table.version,current_table.updated_at,current_table.name,current_table.capacity,current_table.shape,p_x,p_y,p_width,p_height,p_occurred_at);
  return query select 'updated',1,current_table.restaurant_id,current_table.branch_id,current_table.id,current_table.zone_id,current_table.name,current_table.capacity,current_table.shape,current_table.layout_x,current_table.layout_y,current_table.layout_width,current_table.layout_height,current_table.version,current_table.updated_at,current_table.updated_by;
end $function$;

do $security$
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname='postgres' and rolbypassrls) then raise exception 'SECURITY_DEFINER_OWNER_REJECTED'; end if;
end $security$;

alter function app_private.list_dining_layout(uuid,uuid,uuid) owner to postgres;
alter function app_private.create_dining_table(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text,integer,integer,integer,integer) owner to postgres;
alter function app_private.update_dining_table_layout(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,integer,integer,integer,integer) owner to postgres;
revoke all on app.dining_tables, app.dining_table_audit_events from public,anon,authenticated,service_role,app_api;
revoke all on function app_private.list_dining_layout(uuid,uuid,uuid) from public,anon,authenticated,service_role,app_api;
revoke all on function app_private.create_dining_table(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text,integer,integer,integer,integer) from public,anon,authenticated,service_role,app_api;
revoke all on function app_private.update_dining_table_layout(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,integer,integer,integer,integer) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.list_dining_layout(uuid,uuid,uuid) to app_api;
grant execute on function app_private.create_dining_table(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text,integer,integer,integer,integer) to app_api;
grant execute on function app_private.update_dining_table_layout(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,integer,integer,integer,integer) to app_api;
alter table app.dining_tables enable row level security;
alter table app.dining_tables force row level security;
alter table app.dining_table_audit_events enable row level security;
alter table app.dining_table_audit_events force row level security;
comment on table app.dining_tables is 'Restaurant/Branch-scoped table configuration and grid layout; server-only writes.';
comment on table app.dining_table_audit_events is 'Immutable idempotency and layout change evidence for dining tables.';

commit;
