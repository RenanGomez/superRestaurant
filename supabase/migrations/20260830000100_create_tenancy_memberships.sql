begin;

create schema app;
create schema app_private;
create schema app_rls;

revoke all on schema app, app_private, app_rls from public, anon, authenticated, service_role;

do $role$
declare
  existing_role oid;
begin
  select oid into existing_role from pg_catalog.pg_roles where rolname = 'app_api';
  if existing_role is not null then
    raise exception using errcode = '55000', message = 'APP_API_ROLE_COLLISION';
  end if;

  create role app_api nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
end
$role$;

comment on role app_api is 'superRestaurant dedicated API capability role';

-- PostgreSQL 16+ grants the non-superuser CREATEROLE creator an unavoidable
-- ADMIN-only membership over each new role. Supabase records its internal
-- superuser as grantor. The catalog audits fail closed unless this is the sole
-- membership and both INHERIT and SET remain disabled.

create table app.roles (
  code text primary key,
  constraint roles_code_format check (code ~ '^[a-z][a-z_]{1,31}$')
);

insert into app.roles (code)
values
  ('owner'),
  ('admin'),
  ('manager'),
  ('supervisor'),
  ('cashier'),
  ('waiter'),
  ('kitchen'),
  ('viewer'),
  ('auditor');

create table app.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  disabled_at timestamptz,
  disabled_by uuid references auth.users (id) on delete restrict,
  disabled_reason text,
  constraint restaurants_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint restaurants_version_positive check (version > 0),
  constraint restaurants_timestamp_order check (updated_at >= created_at),
  constraint restaurants_disabled_order check (disabled_at is null or disabled_at >= created_at),
  constraint restaurants_disabled_evidence check (
    (disabled_at is null and disabled_by is null and disabled_reason is null)
    or
    (disabled_at is not null and disabled_by is not null and char_length(btrim(disabled_reason)) between 1 and 500)
  )
);

create table app.branches (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references app.restaurants (id) on delete restrict,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  disabled_at timestamptz,
  disabled_by uuid references auth.users (id) on delete restrict,
  disabled_reason text,
  constraint branches_restaurant_id_id_unique unique (restaurant_id, id),
  constraint branches_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint branches_version_positive check (version > 0),
  constraint branches_timestamp_order check (updated_at >= created_at),
  constraint branches_disabled_order check (disabled_at is null or disabled_at >= created_at),
  constraint branches_disabled_evidence check (
    (disabled_at is null and disabled_by is null and disabled_reason is null)
    or
    (disabled_at is not null and disabled_by is not null and char_length(btrim(disabled_reason)) between 1 and 500)
  )
);

create index branches_restaurant_id_idx on app.branches (restaurant_id);

create table app.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  restaurant_id uuid not null,
  branch_id uuid not null,
  granted_at timestamptz not null default now(),
  granted_by uuid not null references auth.users (id) on delete restrict,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete restrict,
  revocation_reason text,
  constraint memberships_branch_scope_fk
    foreign key (restaurant_id, branch_id)
    references app.branches (restaurant_id, id)
    on delete restrict,
  constraint memberships_revocation_order check (revoked_at is null or revoked_at >= granted_at),
  constraint memberships_revocation_evidence check (
    (revoked_at is null and revoked_by is null and revocation_reason is null)
    or
    (revoked_at is not null and revoked_by is not null and char_length(btrim(revocation_reason)) between 1 and 500)
  )
);

create unique index memberships_one_active_scope_idx
  on app.memberships (user_id, restaurant_id, branch_id)
  where revoked_at is null;

create index memberships_active_user_scope_idx
  on app.memberships (user_id, restaurant_id, branch_id, id)
  where revoked_at is null;

create table app.membership_role_grants (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references app.memberships (id) on delete restrict,
  role_code text not null references app.roles (code) on delete restrict,
  granted_at timestamptz not null default now(),
  granted_by uuid not null references auth.users (id) on delete restrict,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete restrict,
  revocation_reason text,
  constraint membership_role_grants_revocation_order check (revoked_at is null or revoked_at >= granted_at),
  constraint membership_role_grants_revocation_evidence check (
    (revoked_at is null and revoked_by is null and revocation_reason is null)
    or
    (revoked_at is not null and revoked_by is not null and char_length(btrim(revocation_reason)) between 1 and 500)
  )
);

create unique index membership_role_grants_one_active_role_idx
  on app.membership_role_grants (membership_id, role_code)
  where revoked_at is null;

create index membership_role_grants_active_membership_idx
  on app.membership_role_grants (membership_id, role_code)
  where revoked_at is null;

create or replace function app_rls.has_active_restaurant_membership(target_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null and exists (
    select 1
    from app.memberships as m
    join app.restaurants as r
      on r.id = m.restaurant_id
     and r.disabled_at is null
    join app.branches as b
      on b.id = m.branch_id
     and b.restaurant_id = m.restaurant_id
     and b.disabled_at is null
    join app.membership_role_grants as rg
      on rg.membership_id = m.id
     and rg.revoked_at is null
    where m.user_id = auth.uid()
      and m.restaurant_id = target_restaurant_id
      and m.revoked_at is null
  );
$function$;

create or replace function app_rls.has_active_branch_membership(target_restaurant_id uuid, target_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null and exists (
    select 1
    from app.memberships as m
    join app.restaurants as r
      on r.id = m.restaurant_id
     and r.disabled_at is null
    join app.branches as b
      on b.id = m.branch_id
     and b.restaurant_id = m.restaurant_id
     and b.disabled_at is null
    join app.membership_role_grants as rg
      on rg.membership_id = m.id
     and rg.revoked_at is null
    where m.user_id = auth.uid()
      and m.restaurant_id = target_restaurant_id
      and m.branch_id = target_branch_id
      and m.revoked_at is null
  );
$function$;

create or replace function app_rls.can_read_membership(target_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null and exists (
    select 1
    from app.memberships as m
    join app.restaurants as r
      on r.id = m.restaurant_id
     and r.disabled_at is null
    join app.branches as b
      on b.id = m.branch_id
     and b.restaurant_id = m.restaurant_id
     and b.disabled_at is null
    join app.membership_role_grants as rg
      on rg.membership_id = m.id
     and rg.revoked_at is null
    where m.id = target_membership_id
      and m.user_id = auth.uid()
      and m.revoked_at is null
  );
$function$;

create or replace function app_private.find_active_branch_membership(
  actor_id uuid,
  target_restaurant_id uuid,
  target_branch_id uuid
)
returns table (restaurant_id uuid, branch_id uuid, roles text[])
language sql
stable
security definer
set search_path = ''
as $function$
  select
    m.restaurant_id,
    m.branch_id,
    array_agg(distinct rg.role_code order by rg.role_code)::text[] as roles
  from app.memberships as m
  join app.membership_role_grants as rg
    on rg.membership_id = m.id
   and rg.revoked_at is null
  join app.restaurants as r
    on r.id = m.restaurant_id
   and r.disabled_at is null
  join app.branches as b
    on b.id = m.branch_id
   and b.restaurant_id = m.restaurant_id
   and b.disabled_at is null
  where m.user_id = actor_id
    and m.restaurant_id = target_restaurant_id
    and m.branch_id = target_branch_id
    and m.revoked_at is null
  group by m.id, m.restaurant_id, m.branch_id
  limit 1;
$function$;

do $owner$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'postgres' and rolbypassrls
  ) then
    raise exception using errcode = '55000', message = 'SECURITY_DEFINER_OWNER_REJECTED';
  end if;
end
$owner$;

alter function app_rls.has_active_restaurant_membership(uuid) owner to postgres;
alter function app_rls.has_active_branch_membership(uuid, uuid) owner to postgres;
alter function app_rls.can_read_membership(uuid) owner to postgres;
alter function app_private.find_active_branch_membership(uuid, uuid, uuid) owner to postgres;

revoke all on all functions in schema app_rls, app_private from public, anon, authenticated, service_role;
revoke all on all tables in schema app from public, anon, authenticated, service_role;

grant usage on schema app to authenticated;
grant select on app.roles, app.restaurants, app.branches, app.memberships, app.membership_role_grants to authenticated;
grant usage on schema app_rls to authenticated;
grant execute on function app_rls.has_active_restaurant_membership(uuid) to authenticated;
grant execute on function app_rls.has_active_branch_membership(uuid, uuid) to authenticated;
grant execute on function app_rls.can_read_membership(uuid) to authenticated;

grant usage on schema app_private to app_api;
grant execute on function app_private.find_active_branch_membership(uuid, uuid, uuid) to app_api;

alter table app.roles enable row level security;
alter table app.roles force row level security;
alter table app.restaurants enable row level security;
alter table app.restaurants force row level security;
alter table app.branches enable row level security;
alter table app.branches force row level security;
alter table app.memberships enable row level security;
alter table app.memberships force row level security;
alter table app.membership_role_grants enable row level security;
alter table app.membership_role_grants force row level security;

create policy roles_authenticated_read
  on app.roles
  for select
  to authenticated
  using (true);

create policy restaurants_active_member_read
  on app.restaurants
  for select
  to authenticated
  using (disabled_at is null and app_rls.has_active_restaurant_membership(id));

create policy branches_active_member_read
  on app.branches
  for select
  to authenticated
  using (disabled_at is null and app_rls.has_active_branch_membership(restaurant_id, id));

create policy memberships_self_active_read
  on app.memberships
  for select
  to authenticated
  using (user_id = auth.uid() and revoked_at is null and app_rls.can_read_membership(id));

create policy membership_role_grants_self_active_read
  on app.membership_role_grants
  for select
  to authenticated
  using (revoked_at is null and app_rls.can_read_membership(membership_id));

alter default privileges in schema app revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema app revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema app revoke all on functions from public, anon, authenticated, service_role;
alter default privileges in schema app_private revoke all on functions from public, anon, authenticated, service_role;
alter default privileges in schema app_rls revoke all on functions from public, anon, authenticated, service_role;

comment on schema app is 'Product tables exposed only for allowlisted RLS reads.';
comment on schema app_private is 'Server-only functions; never expose through the Data API.';
comment on schema app_rls is 'Caller-bound RLS helpers; never expose through the Data API.';
comment on function app_private.find_active_branch_membership(uuid, uuid, uuid) is
  'Returns one effective multi-role membership for a Supabase-verified actor and exact Restaurant/Branch scope.';

commit;
