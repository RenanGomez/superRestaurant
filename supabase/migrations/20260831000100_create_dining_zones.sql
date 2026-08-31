begin;

create table app.dining_zones (
  id uuid primary key,
  restaurant_id uuid not null,
  branch_id uuid not null,
  name text not null,
  name_key text generated always as (pg_catalog.lower(pg_catalog.btrim(name))) stored,
  version bigint not null default 1,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by uuid not null references auth.users (id) on delete restrict,
  constraint dining_zones_branch_scope_fk
    foreign key (restaurant_id, branch_id)
    references app.branches (restaurant_id, id)
    on delete restrict,
  constraint dining_zones_restaurant_id_branch_id_id_unique
    unique (restaurant_id, branch_id, id),
  constraint dining_zones_scope_name_key_unique
    unique (restaurant_id, branch_id, name_key),
  constraint dining_zones_name_valid check (
    name = pg_catalog.btrim(name)
    and pg_catalog.char_length(name) between 1 and 80
    and name !~ '[[:cntrl:]]'
  ),
  constraint dining_zones_version_positive check (version > 0)
);

create index dining_zones_scope_order_idx
  on app.dining_zones (restaurant_id, branch_id, name_key, id);

create table app.dining_zone_audit_events (
  event_id uuid primary key,
  idempotency_key uuid not null,
  restaurant_id uuid not null,
  branch_id uuid not null,
  zone_id uuid not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  device_id uuid not null,
  operation text not null,
  name_snapshot text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint dining_zone_audit_zone_scope_fk
    foreign key (restaurant_id, branch_id, zone_id)
    references app.dining_zones (restaurant_id, branch_id, id)
    on delete restrict,
  constraint dining_zone_audit_idempotency_unique
    unique (actor_id, restaurant_id, branch_id, idempotency_key),
  constraint dining_zone_audit_operation_check check (operation = 'created'),
  constraint dining_zone_audit_name_valid check (
    name_snapshot = pg_catalog.btrim(name_snapshot)
    and pg_catalog.char_length(name_snapshot) between 1 and 80
    and name_snapshot !~ '[[:cntrl:]]'
  )
);

create index dining_zone_audit_zone_idx
  on app.dining_zone_audit_events (restaurant_id, branch_id, zone_id, received_at, event_id);

create function app_private.create_dining_zone(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_zone_id uuid,
  p_event_id uuid,
  p_idempotency_key uuid,
  p_device_id uuid,
  p_occurred_at timestamptz,
  p_name text
)
returns table (
  status text,
  schema_version integer,
  restaurant_id uuid,
  branch_id uuid,
  zone_id uuid,
  zone_name text,
  zone_version bigint,
  created_at timestamptz,
  created_by uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  existing_audit app.dining_zone_audit_events%rowtype;
  existing_zone app.dining_zones%rowtype;
  event_lock bigint;
  idempotency_lock bigint;
begin
  if p_actor_id is null
    or p_restaurant_id is null
    or p_branch_id is null
    or p_zone_id is null
    or p_event_id is null
    or p_idempotency_key is null
    or p_device_id is null
    or p_occurred_at is null
    or p_name is null
    or p_name <> pg_catalog.btrim(p_name)
    or pg_catalog.char_length(p_name) not between 1 and 80
    or p_name ~ '[[:cntrl:]]'
  then
    return query select 'conflict', null::integer, null::uuid, null::uuid, null::uuid,
      null::text, null::bigint, null::timestamptz, null::uuid;
    return;
  end if;

  if not exists (
    select 1
    from app.memberships as m
    join app.membership_role_grants as rg
      on rg.membership_id = m.id
     and rg.revoked_at is null
     and rg.role_code in ('owner', 'admin', 'manager')
    join app.restaurants as r
      on r.id = m.restaurant_id
     and r.disabled_at is null
    join app.branches as b
      on b.id = m.branch_id
     and b.restaurant_id = m.restaurant_id
     and b.disabled_at is null
    where m.user_id = p_actor_id
      and m.restaurant_id = p_restaurant_id
      and m.branch_id = p_branch_id
      and m.revoked_at is null
  ) then
    return query select 'forbidden', null::integer, null::uuid, null::uuid, null::uuid,
      null::text, null::bigint, null::timestamptz, null::uuid;
    return;
  end if;

  event_lock := pg_catalog.hashtextextended('dining-zone-event:' || p_event_id::text, 0);
  idempotency_lock := pg_catalog.hashtextextended(
    'dining-zone-idempotency:' || p_actor_id::text || ':' || p_restaurant_id::text || ':'
      || p_branch_id::text || ':' || p_idempotency_key::text,
    0
  );
  if event_lock <= idempotency_lock then
    perform pg_catalog.pg_advisory_xact_lock(event_lock);
    if event_lock <> idempotency_lock then
      perform pg_catalog.pg_advisory_xact_lock(idempotency_lock);
    end if;
  else
    perform pg_catalog.pg_advisory_xact_lock(idempotency_lock);
    perform pg_catalog.pg_advisory_xact_lock(event_lock);
  end if;

  select audit.* into existing_audit
  from app.dining_zone_audit_events as audit
  where audit.actor_id = p_actor_id
    and audit.restaurant_id = p_restaurant_id
    and audit.branch_id = p_branch_id
    and audit.idempotency_key = p_idempotency_key;

  if found then
    if existing_audit.event_id <> p_event_id
      or existing_audit.zone_id <> p_zone_id
      or existing_audit.device_id <> p_device_id
      or existing_audit.occurred_at <> p_occurred_at
      or existing_audit.name_snapshot <> p_name
    then
      return query select 'conflict', null::integer, null::uuid, null::uuid, null::uuid,
        null::text, null::bigint, null::timestamptz, null::uuid;
      return;
    end if;

    select zone.* into strict existing_zone
    from app.dining_zones as zone
    where zone.restaurant_id = p_restaurant_id
      and zone.branch_id = p_branch_id
      and zone.id = p_zone_id;
    return query select
      'replayed', 1, existing_zone.restaurant_id, existing_zone.branch_id, existing_zone.id,
      existing_zone.name, existing_zone.version, existing_zone.created_at, existing_zone.created_by;
    return;
  end if;

  if exists (
    select 1 from app.dining_zone_audit_events as audit where audit.event_id = p_event_id
  ) then
    return query select 'conflict', null::integer, null::uuid, null::uuid, null::uuid,
      null::text, null::bigint, null::timestamptz, null::uuid;
    return;
  end if;

  insert into app.dining_zones (
    id, restaurant_id, branch_id, name, created_by
  ) values (
    p_zone_id, p_restaurant_id, p_branch_id, p_name, p_actor_id
  )
  on conflict do nothing
  returning * into existing_zone;

  if not found then
    return query select 'conflict', null::integer, null::uuid, null::uuid, null::uuid,
      null::text, null::bigint, null::timestamptz, null::uuid;
    return;
  end if;

  insert into app.dining_zone_audit_events (
    event_id,
    idempotency_key,
    restaurant_id,
    branch_id,
    zone_id,
    actor_id,
    device_id,
    operation,
    name_snapshot,
    occurred_at
  ) values (
    p_event_id,
    p_idempotency_key,
    p_restaurant_id,
    p_branch_id,
    p_zone_id,
    p_actor_id,
    p_device_id,
    'created',
    p_name,
    p_occurred_at
  );

  return query select
    'created', 1, existing_zone.restaurant_id, existing_zone.branch_id, existing_zone.id,
    existing_zone.name, existing_zone.version, existing_zone.created_at, existing_zone.created_by;
end
$function$;

do $owner$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'postgres' and rolbypassrls
  ) then
    raise exception using errcode = '55000', message = 'SECURITY_DEFINER_OWNER_REJECTED';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'app_api'
      and not rolsuper
      and not rolcreatedb
      and not rolcreaterole
      and not rolinherit
      and not rolreplication
      and not rolbypassrls
  ) then
    raise exception using errcode = '55000', message = 'APP_API_ROLE_REJECTED';
  end if;
end
$owner$;

alter function app_private.create_dining_zone(uuid, uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, text)
  owner to postgres;

revoke all on app.dining_zones, app.dining_zone_audit_events
  from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.create_dining_zone(uuid, uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, text)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.create_dining_zone(uuid, uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, text)
  to app_api;

alter table app.dining_zones enable row level security;
alter table app.dining_zones force row level security;
alter table app.dining_zone_audit_events enable row level security;
alter table app.dining_zone_audit_events force row level security;

comment on table app.dining_zones is
  'Restaurant/Branch-scoped dining zones; writes are server-only.';
comment on table app.dining_zone_audit_events is
  'Immutable creation evidence and idempotency binding for dining zones.';
comment on function app_private.create_dining_zone(uuid, uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, text) is
  'Creates one dining zone atomically after exact membership and tables.manage role revalidation.';

commit;
