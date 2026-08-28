-- ADR-010 option B only. This schema is intentionally isolated from any future
-- product schema and may be dropped with the isolated Supabase spike project.
-- `adr010_b` is the only Data API-exposed schema and contains RLS-protected
-- reads. SECURITY DEFINER/admin functions live in the non-exposed private schema.
create schema if not exists adr010_b;
create schema if not exists adr010_b_private;
create extension if not exists pgcrypto;

revoke all on schema adr010_b from public;
revoke all on schema adr010_b_private from public;
revoke all on schema adr010_b_private from anon, authenticated, service_role;
grant usage on schema adr010_b to anon, authenticated;

-- Supabase's modern secret API key assumes the PostgREST `service_role` at the
-- database boundary. The Data API role receives no generic table write or
-- private-function execution grant; critical mutation uses PostgreSQL directly.
alter default privileges for role postgres in schema adr010_b revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema adr010_b revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema adr010_b revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema adr010_b_private revoke execute on functions from public, anon, authenticated, service_role;

create table if not exists adr010_b.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  created_at timestamptz not null default now()
);

create table if not exists adr010_b.branches (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references adr010_b.restaurants(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 160),
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, name)
);

create table if not exists adr010_b.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  restaurant_id uuid not null references adr010_b.restaurants(id) on delete restrict,
  branch_id uuid not null,
  role text not null check (role in ('owner', 'manager', 'cashier', 'kds')),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, restaurant_id, branch_id),
  foreign key (restaurant_id, branch_id) references adr010_b.branches(restaurant_id, id) on delete restrict
);

-- Only this disposable spike bootstrap marker cascades from auth.users. All
-- business/audit identity references below remain RESTRICT. Keeping the marker
-- until Admin API deletion makes a failed cleanup safely retryable.
create table if not exists adr010_b.bootstrap_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  fixture_key text not null check (fixture_key in ('amber', 'cobalt')),
  bootstrap_run_id uuid not null,
  created_at timestamptz not null default now(),
  unique (bootstrap_run_id, fixture_key)
);

create table if not exists adr010_b.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  -- Canonical normalized request used to reject a reused key whose actor,
  -- scope or lines differ from the original logical operation.
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
  status text not null default 'OPEN' check (status = 'OPEN'),
  created_at timestamptz not null default now(),
  unique (restaurant_id, branch_id, id),
  unique (restaurant_id, branch_id, idempotency_key),
  foreign key (restaurant_id, branch_id) references adr010_b.branches(restaurant_id, id) on delete restrict
);

create table if not exists adr010_b.order_lines (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid not null,
  order_id uuid not null,
  menu_item_id text not null check (char_length(menu_item_id) between 1 and 200),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (restaurant_id, branch_id, id),
  foreign key (restaurant_id, branch_id, order_id) references adr010_b.orders(restaurant_id, branch_id, id) on delete restrict
);

create table if not exists adr010_b.order_line_snapshots (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid not null,
  line_id uuid not null,
  name text not null check (char_length(name) between 1 and 240),
  unit_amount_minor bigint not null check (unit_amount_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  unique (restaurant_id, branch_id, line_id),
  foreign key (restaurant_id, branch_id, line_id) references adr010_b.order_lines(restaurant_id, branch_id, id) on delete restrict
);

create table if not exists adr010_b.order_idempotency (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid not null,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  order_id uuid not null,
  created_at timestamptz not null default now(),
  unique (restaurant_id, branch_id, idempotency_key),
  foreign key (restaurant_id, branch_id, order_id) references adr010_b.orders(restaurant_id, branch_id, id) on delete restrict
);

create table if not exists adr010_b.audit_log (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid not null,
  order_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action = 'ORDER_CREATED'),
  reason text,
  created_at timestamptz not null default now(),
  foreign key (restaurant_id, branch_id, order_id) references adr010_b.orders(restaurant_id, branch_id, id) on delete restrict
);

create table if not exists adr010_b.kds_events (
  cursor bigint generated always as identity primary key,
  id uuid not null unique default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid not null,
  order_id uuid not null,
  event_type text not null check (event_type = 'ORDER_CREATED'),
  created_at timestamptz not null default now(),
  foreign key (restaurant_id, branch_id, order_id) references adr010_b.orders(restaurant_id, branch_id, id) on delete restrict
);

create index if not exists kds_events_scope_cursor_idx on adr010_b.kds_events (restaurant_id, branch_id, cursor);
create index if not exists orders_scope_created_at_idx on adr010_b.orders (restaurant_id, branch_id, created_at);

-- Authenticated users may only read objects belonging to an active scoped membership.
-- No table receives INSERT/UPDATE/DELETE policy: direct client critical writes stay denied.
alter table adr010_b.restaurants enable row level security;
alter table adr010_b.branches enable row level security;
alter table adr010_b.memberships enable row level security;
alter table adr010_b.orders enable row level security;
alter table adr010_b.order_lines enable row level security;
alter table adr010_b.order_line_snapshots enable row level security;
alter table adr010_b.order_idempotency enable row level security;
alter table adr010_b.audit_log enable row level security;
alter table adr010_b.kds_events enable row level security;
alter table adr010_b.restaurants force row level security;
alter table adr010_b.branches force row level security;
alter table adr010_b.memberships force row level security;
alter table adr010_b.orders force row level security;
alter table adr010_b.order_lines force row level security;
alter table adr010_b.order_line_snapshots force row level security;
alter table adr010_b.order_idempotency force row level security;
alter table adr010_b.audit_log force row level security;
alter table adr010_b.kds_events force row level security;

drop policy if exists restaurants_select_scoped on adr010_b.restaurants;
drop policy if exists branches_select_scoped on adr010_b.branches;
drop policy if exists memberships_select_self_scoped on adr010_b.memberships;
drop policy if exists orders_select_scoped on adr010_b.orders;
drop policy if exists order_lines_select_scoped on adr010_b.order_lines;
drop policy if exists snapshots_select_scoped on adr010_b.order_line_snapshots;
drop policy if exists idempotency_select_scoped on adr010_b.order_idempotency;
drop policy if exists audit_select_scoped on adr010_b.audit_log;
drop policy if exists kds_select_scoped on adr010_b.kds_events;
create policy restaurants_select_scoped on adr010_b.restaurants for select to authenticated
  using (exists (select 1 from adr010_b.memberships m where m.user_id = auth.uid() and m.restaurant_id = restaurants.id and m.revoked_at is null));
create policy branches_select_scoped on adr010_b.branches for select to authenticated
  using (exists (select 1 from adr010_b.memberships m where m.user_id = auth.uid() and m.restaurant_id = branches.restaurant_id and m.branch_id = branches.id and m.revoked_at is null));
create policy memberships_select_self_scoped on adr010_b.memberships for select to authenticated
  using (user_id = auth.uid() and revoked_at is null);
create policy orders_select_scoped on adr010_b.orders for select to authenticated
  using (exists (select 1 from adr010_b.memberships m where m.user_id = auth.uid() and m.restaurant_id = orders.restaurant_id and m.branch_id = orders.branch_id and m.revoked_at is null));
create policy order_lines_select_scoped on adr010_b.order_lines for select to authenticated
  using (exists (select 1 from adr010_b.memberships m where m.user_id = auth.uid() and m.restaurant_id = order_lines.restaurant_id and m.branch_id = order_lines.branch_id and m.revoked_at is null));
create policy snapshots_select_scoped on adr010_b.order_line_snapshots for select to authenticated
  using (exists (select 1 from adr010_b.memberships m where m.user_id = auth.uid() and m.restaurant_id = order_line_snapshots.restaurant_id and m.branch_id = order_line_snapshots.branch_id and m.revoked_at is null));
create policy idempotency_select_scoped on adr010_b.order_idempotency for select to authenticated
  using (exists (select 1 from adr010_b.memberships m where m.user_id = auth.uid() and m.restaurant_id = order_idempotency.restaurant_id and m.branch_id = order_idempotency.branch_id and m.revoked_at is null));
create policy audit_select_scoped on adr010_b.audit_log for select to authenticated
  using (exists (select 1 from adr010_b.memberships m where m.user_id = auth.uid() and m.restaurant_id = audit_log.restaurant_id and m.branch_id = audit_log.branch_id and m.revoked_at is null));
create policy kds_select_scoped on adr010_b.kds_events for select to authenticated
  using (exists (select 1 from adr010_b.memberships m where m.user_id = auth.uid() and m.restaurant_id = kds_events.restaurant_id and m.branch_id = kds_events.branch_id and m.revoked_at is null));

revoke all on all tables in schema adr010_b from anon, authenticated, service_role;
revoke all on all sequences in schema adr010_b from anon, authenticated, service_role;
grant select on table
  adr010_b.restaurants,
  adr010_b.branches,
  adr010_b.memberships,
  adr010_b.orders,
  adr010_b.order_lines,
  adr010_b.order_line_snapshots,
  adr010_b.order_idempotency,
  adr010_b.audit_log,
  adr010_b.kds_events
to authenticated;

-- This RPC is intentionally narrower than generic membership CRUD. It accepts
-- exactly the two dynamic Auth IDs created by the server-only Admin API, then
-- maps them to the fixed restaurants/branches in the structural fixture.
create or replace function adr010_b_private.adr010_b_bootstrap_auth_memberships(p_users jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amber_user_id uuid;
  v_cobalt_user_id uuid;
  v_bootstrap_run_id uuid;
begin
  if jsonb_typeof(p_users) is distinct from 'array' or jsonb_array_length(p_users) <> 2 then
    raise exception 'ADR010_INVALID_AUTH_BOOTSTRAP_INPUT';
  end if;

  select input.user_id into v_amber_user_id
  from jsonb_to_recordset(p_users) as input(fixture_key text, user_id uuid, bootstrap_run_id uuid)
  where input.fixture_key = 'amber';
  select input.user_id into v_cobalt_user_id
  from jsonb_to_recordset(p_users) as input(fixture_key text, user_id uuid, bootstrap_run_id uuid)
  where input.fixture_key = 'cobalt';
  if v_amber_user_id is null or v_cobalt_user_id is null or v_amber_user_id = v_cobalt_user_id then
    raise exception 'ADR010_INVALID_AUTH_BOOTSTRAP_INPUT';
  end if;
  select input.bootstrap_run_id into v_bootstrap_run_id
  from jsonb_to_recordset(p_users) as input(fixture_key text, user_id uuid, bootstrap_run_id uuid)
  limit 1;
  if v_bootstrap_run_id is null or exists (
    select 1 from jsonb_to_recordset(p_users) as input(fixture_key text, user_id uuid, bootstrap_run_id uuid)
    where input.bootstrap_run_id is distinct from v_bootstrap_run_id
  ) then
    raise exception 'ADR010_INVALID_AUTH_BOOTSTRAP_INPUT';
  end if;
  if (select count(*) from jsonb_to_recordset(p_users) as input(fixture_key text, user_id uuid, bootstrap_run_id uuid)
      where input.fixture_key in ('amber', 'cobalt')) <> 2 then
    raise exception 'ADR010_INVALID_AUTH_BOOTSTRAP_INPUT';
  end if;

  insert into adr010_b.bootstrap_users (user_id, fixture_key, bootstrap_run_id)
  values (v_amber_user_id, 'amber', v_bootstrap_run_id), (v_cobalt_user_id, 'cobalt', v_bootstrap_run_id);

  insert into adr010_b.memberships (user_id, restaurant_id, branch_id, role)
  values
    (v_amber_user_id, '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', 'cashier'),
    (v_amber_user_id, '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a3', 'cashier'),
    (v_cobalt_user_id, '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2', 'cashier'),
    (v_cobalt_user_id, '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b3', 'cashier');
end;
$$;

-- Remote RLS probes may revoke only one membership belonging to a tracked
-- disposable user. This administrative operation is private and server-only.
create or replace function adr010_b_private.adr010_b_revoke_bootstrap_membership(p_user_id uuid, p_branch_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update adr010_b.memberships membership
  set revoked_at = pg_catalog.now()
  from adr010_b.bootstrap_users bootstrap_user
  where membership.user_id = bootstrap_user.user_id
    and membership.user_id = p_user_id
    and membership.branch_id = p_branch_id
    and membership.revoked_at is null;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

-- Delete only artifacts linked to the explicitly supplied tracked disposable users. The marker
-- remains until the Admin API deletes auth.users; its cascade then completes
-- cleanup. This order satisfies all historical ON DELETE RESTRICT FKs.
create or replace function adr010_b_private.adr010_b_cleanup_auth_bootstrap(p_user_ids jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_ids jsonb;
begin
  if jsonb_typeof(p_user_ids) is distinct from 'array' then
    raise exception 'ADR010_INVALID_AUTH_BOOTSTRAP_INPUT';
  end if;
  select coalesce(jsonb_agg(user_id order by fixture_key), '[]'::jsonb)
  into v_user_ids
  from adr010_b.bootstrap_users
  where user_id in (select value::uuid from jsonb_array_elements_text(p_user_ids));

  delete from adr010_b.kds_events event
  using adr010_b.orders "order", adr010_b.bootstrap_users bootstrap_user
  where event.order_id = "order".id and "order".actor_id = bootstrap_user.user_id
    and bootstrap_user.user_id in (select value::uuid from jsonb_array_elements_text(p_user_ids));
  delete from adr010_b.audit_log audit
  using adr010_b.orders "order", adr010_b.bootstrap_users bootstrap_user
  where audit.order_id = "order".id and "order".actor_id = bootstrap_user.user_id
    and bootstrap_user.user_id in (select value::uuid from jsonb_array_elements_text(p_user_ids));
  delete from adr010_b.order_line_snapshots snapshot
  using adr010_b.order_lines line, adr010_b.orders "order", adr010_b.bootstrap_users bootstrap_user
  where snapshot.line_id = line.id and line.order_id = "order".id and "order".actor_id = bootstrap_user.user_id
    and bootstrap_user.user_id in (select value::uuid from jsonb_array_elements_text(p_user_ids));
  delete from adr010_b.order_lines line
  using adr010_b.orders "order", adr010_b.bootstrap_users bootstrap_user
  where line.order_id = "order".id and "order".actor_id = bootstrap_user.user_id
    and bootstrap_user.user_id in (select value::uuid from jsonb_array_elements_text(p_user_ids));
  delete from adr010_b.order_idempotency idempotency
  using adr010_b.orders "order", adr010_b.bootstrap_users bootstrap_user
  where idempotency.order_id = "order".id and "order".actor_id = bootstrap_user.user_id
    and bootstrap_user.user_id in (select value::uuid from jsonb_array_elements_text(p_user_ids));
  delete from adr010_b.orders "order"
  using adr010_b.bootstrap_users bootstrap_user
  where "order".actor_id = bootstrap_user.user_id
    and bootstrap_user.user_id in (select value::uuid from jsonb_array_elements_text(p_user_ids));
  delete from adr010_b.memberships membership
  using adr010_b.bootstrap_users bootstrap_user
  where membership.user_id = bootstrap_user.user_id
    and bootstrap_user.user_id in (select value::uuid from jsonb_array_elements_text(p_user_ids));

  return v_user_ids;
end;
$$;

revoke all on function adr010_b_private.adr010_b_bootstrap_auth_memberships(jsonb) from public, anon, authenticated, service_role;
revoke all on function adr010_b_private.adr010_b_revoke_bootstrap_membership(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function adr010_b_private.adr010_b_cleanup_auth_bootstrap(jsonb) from public, anon, authenticated, service_role;

-- The only critical order mutation. Its forced failure hook raises inside this
-- function, so PostgreSQL rolls back the order, children, audit and KDS event.
create or replace function adr010_b_private.adr010_b_create_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (p_payload ->> 'actorId')::uuid;
  v_restaurant_id uuid := (p_payload ->> 'restaurantId')::uuid;
  v_branch_id uuid := (p_payload ->> 'branchId')::uuid;
  v_idempotency_key text := p_payload ->> 'idempotencyKey';
  v_request_payload jsonb;
  v_order adr010_b.orders;
  v_line jsonb;
  v_line_id uuid;
  v_created boolean := false;
begin
  if v_actor_id is null or v_restaurant_id is null or v_branch_id is null or coalesce(v_idempotency_key, '') = '' then
    raise exception 'ADR010_INVALID_ORDER_INPUT';
  end if;
  if jsonb_typeof(p_payload -> 'lines') is distinct from 'array' or jsonb_array_length(p_payload -> 'lines') = 0 then
    raise exception 'ADR010_ORDER_REQUIRES_LINES';
  end if;
  v_request_payload := jsonb_build_object(
    'actorId', v_actor_id,
    'restaurantId', v_restaurant_id,
    'branchId', v_branch_id,
    'lines', p_payload -> 'lines'
  );
  -- This rechecks active membership immediately at the critical mutation.
  if not exists (
    select 1 from adr010_b.memberships membership
    where membership.user_id = v_actor_id
      and membership.restaurant_id = v_restaurant_id
      and membership.branch_id = v_branch_id
      and membership.revoked_at is null
  ) then
    raise exception 'ADR010_MEMBERSHIP_NOT_ACTIVE';
  end if;

  insert into adr010_b.orders (restaurant_id, branch_id, actor_id, idempotency_key, request_payload)
  values (v_restaurant_id, v_branch_id, v_actor_id, v_idempotency_key, v_request_payload)
  on conflict (restaurant_id, branch_id, idempotency_key) do nothing
  returning * into v_order;
  v_created := found;
  if not v_created then
    select * into v_order
    from adr010_b.orders
    where restaurant_id = v_restaurant_id and branch_id = v_branch_id and idempotency_key = v_idempotency_key
    for key share;
    if v_order.request_payload is distinct from v_request_payload then
      raise exception 'ADR010_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST';
    end if;
    return jsonb_build_object(
      'id', v_order.id,
      'idempotencyKey', v_order.idempotency_key,
      'scope', jsonb_build_object('restaurantId', v_order.restaurant_id, 'branchId', v_order.branch_id),
      'lines', coalesce((select jsonb_agg(jsonb_build_object('menuItemId', line.menu_item_id, 'quantity', line.quantity, 'snapshot', jsonb_build_object('name', snapshot.name, 'unitAmountMinor', snapshot.unit_amount_minor, 'currency', snapshot.currency)) order by line.created_at)
        from adr010_b.order_lines line join adr010_b.order_line_snapshots snapshot on snapshot.line_id = line.id and snapshot.restaurant_id = line.restaurant_id and snapshot.branch_id = line.branch_id
        where line.order_id = v_order.id), '[]'::jsonb),
      'audit', jsonb_build_object('actorId', v_order.actor_id, 'branchId', v_order.branch_id, 'action', 'ORDER_CREATED')
    );
  end if;

  insert into adr010_b.order_idempotency (restaurant_id, branch_id, idempotency_key, order_id)
  values (v_restaurant_id, v_branch_id, v_idempotency_key, v_order.id);

  for v_line in select value from jsonb_array_elements(p_payload -> 'lines') loop
    insert into adr010_b.order_lines (restaurant_id, branch_id, order_id, menu_item_id, quantity)
    values (v_restaurant_id, v_branch_id, v_order.id, v_line ->> 'menuItemId', (v_line ->> 'quantity')::integer)
    returning id into v_line_id;
    insert into adr010_b.order_line_snapshots (restaurant_id, branch_id, line_id, name, unit_amount_minor, currency)
    values (v_restaurant_id, v_branch_id, v_line_id, v_line -> 'snapshot' ->> 'name', (v_line -> 'snapshot' ->> 'unitAmountMinor')::bigint, v_line -> 'snapshot' ->> 'currency');
  end loop;

  insert into adr010_b.audit_log (restaurant_id, branch_id, order_id, actor_id, action)
  values (v_restaurant_id, v_branch_id, v_order.id, v_actor_id, 'ORDER_CREATED');
  insert into adr010_b.kds_events (restaurant_id, branch_id, order_id, event_type)
  values (v_restaurant_id, v_branch_id, v_order.id, 'ORDER_CREATED');

  if coalesce((p_payload ->> 'induceFailureAfterOrder')::boolean, false) then
    raise exception 'ADR010_INDUCED_FAILURE_AFTER_ORDER';
  end if;

  return jsonb_build_object(
    'id', v_order.id,
    'idempotencyKey', v_order.idempotency_key,
    'scope', jsonb_build_object('restaurantId', v_order.restaurant_id, 'branchId', v_order.branch_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('menuItemId', line.menu_item_id, 'quantity', line.quantity, 'snapshot', jsonb_build_object('name', snapshot.name, 'unitAmountMinor', snapshot.unit_amount_minor, 'currency', snapshot.currency)) order by line.created_at)
      from adr010_b.order_lines line join adr010_b.order_line_snapshots snapshot on snapshot.line_id = line.id and snapshot.restaurant_id = line.restaurant_id and snapshot.branch_id = line.branch_id
      where line.order_id = v_order.id), '[]'::jsonb),
    'audit', jsonb_build_object('actorId', v_order.actor_id, 'branchId', v_order.branch_id, 'action', 'ORDER_CREATED')
  );
end;
$$;

revoke all on function adr010_b_private.adr010_b_create_order(jsonb) from public, anon, authenticated, service_role;
