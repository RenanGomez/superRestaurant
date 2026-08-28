-- ADR-010 option A only. This isolated schema is not a product migration.
-- The runner may drop only adr010_a in an explicitly opted-in disposable database.
create extension if not exists pgcrypto;
create schema if not exists adr010_a;

create table if not exists adr010_a.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default clock_timestamp()
);

create table if not exists adr010_a.restaurants (
  id text primary key
);

create table if not exists adr010_a.branches (
  restaurant_id text not null references adr010_a.restaurants(id),
  id text not null,
  primary key (restaurant_id, id)
);

create table if not exists adr010_a.sessions (
  id text primary key,
  actor_id text not null,
  restaurant_id text not null,
  branch_id text not null,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (restaurant_id, branch_id) references adr010_a.branches(restaurant_id, id)
);

create table if not exists adr010_a.orders (
  id uuid primary key,
  restaurant_id text not null,
  branch_id text not null,
  actor_id text not null,
  idempotency_key text not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (restaurant_id, branch_id) references adr010_a.branches(restaurant_id, id),
  unique (restaurant_id, branch_id, idempotency_key)
);

create table if not exists adr010_a.order_lines (
  id uuid primary key,
  order_id uuid not null references adr010_a.orders(id) on delete cascade,
  menu_item_id text not null,
  quantity integer not null check (quantity > 0)
);

create table if not exists adr010_a.line_snapshots (
  id uuid primary key,
  order_line_id uuid not null unique references adr010_a.order_lines(id) on delete cascade,
  name text not null,
  unit_amount_minor bigint not null,
  currency text not null
);

create table if not exists adr010_a.audit_log (
  id uuid primary key,
  order_id uuid not null references adr010_a.orders(id) on delete cascade,
  actor_id text not null,
  branch_id text not null,
  action text not null check (action = 'ORDER_CREATED')
);

create table if not exists adr010_a.kds_events (
  cursor bigint generated always as identity primary key,
  order_id uuid not null references adr010_a.orders(id) on delete cascade,
  restaurant_id text not null,
  branch_id text not null,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists kds_events_scope_cursor_idx on adr010_a.kds_events (restaurant_id, branch_id, cursor);

insert into adr010_a.restaurants (id) values ('restaurant-amber'), ('restaurant-cobalt') on conflict do nothing;
insert into adr010_a.branches (restaurant_id, id) values
  ('restaurant-amber', 'branch-amber-north'),
  ('restaurant-amber', 'branch-amber-south'),
  ('restaurant-cobalt', 'branch-cobalt-north'),
  ('restaurant-cobalt', 'branch-cobalt-south')
on conflict do nothing;

create or replace function adr010_a.create_order(
  p_session_id text,
  p_restaurant_id text,
  p_branch_id text,
  p_idempotency_key text,
  p_lines jsonb,
  p_induce_failure boolean default false
) returns table(order_id uuid, actor_id text)
language plpgsql
set search_path = adr010_a, pg_catalog
as $$
declare
  v_session adr010_a.sessions%rowtype;
  v_order_id uuid;
  v_line record;
  v_line_id uuid;
begin
  -- This check occurs in the write transaction immediately before mutation.
  select * into v_session from adr010_a.sessions where id = p_session_id for update;
  if not found or v_session.revoked_at is not null
    or v_session.restaurant_id <> p_restaurant_id or v_session.branch_id <> p_branch_id then
    raise exception 'UNAUTHORIZED_SCOPE' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'INVALID_LINES' using errcode = '22023';
  end if;

  insert into adr010_a.orders (id, restaurant_id, branch_id, actor_id, idempotency_key)
  values (gen_random_uuid(), p_restaurant_id, p_branch_id, v_session.actor_id, p_idempotency_key)
  on conflict (restaurant_id, branch_id, idempotency_key) do nothing
  returning id into v_order_id;

  if v_order_id is null then
    select id into v_order_id from adr010_a.orders
      where restaurant_id = p_restaurant_id and branch_id = p_branch_id and idempotency_key = p_idempotency_key;
    return query select v_order_id, v_session.actor_id;
    return;
  end if;

  if p_induce_failure then
    raise exception 'INDUCED_WRITE_FAILURE' using errcode = 'P0001';
  end if;

  for v_line in select * from jsonb_to_recordset(p_lines) as x(menu_item_id text, quantity integer, snapshot jsonb)
  loop
    if v_line.menu_item_id is null or v_line.quantity is null or v_line.quantity <= 0
      or v_line.snapshot is null or coalesce(v_line.snapshot->>'name', '') = ''
      or coalesce(v_line.snapshot->>'currency', '') = '' or (v_line.snapshot->>'unitAmountMinor') is null then
      raise exception 'INVALID_LINE' using errcode = '22023';
    end if;
    insert into adr010_a.order_lines (id, order_id, menu_item_id, quantity)
    values (gen_random_uuid(), v_order_id, v_line.menu_item_id, v_line.quantity)
    returning id into v_line_id;
    insert into adr010_a.line_snapshots (id, order_line_id, name, unit_amount_minor, currency)
    values (gen_random_uuid(), v_line_id, v_line.snapshot->>'name', (v_line.snapshot->>'unitAmountMinor')::bigint, v_line.snapshot->>'currency');
  end loop;

  insert into adr010_a.audit_log (id, order_id, actor_id, branch_id, action)
  values (gen_random_uuid(), v_order_id, v_session.actor_id, p_branch_id, 'ORDER_CREATED');
  insert into adr010_a.kds_events (order_id, restaurant_id, branch_id)
  values (v_order_id, p_restaurant_id, p_branch_id);
  return query select v_order_id, v_session.actor_id;
end;
$$;

insert into adr010_a.schema_migrations (version) values ('0001_adr010_a_thin_slice') on conflict do nothing;
