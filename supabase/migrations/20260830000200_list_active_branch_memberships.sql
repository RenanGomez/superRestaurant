begin;

do $owner$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'postgres' and rolbypassrls
  ) then
    raise exception using errcode = '55000', message = 'SECURITY_DEFINER_OWNER_REJECTED';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles
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

create function app_private.list_active_branch_memberships(actor_id uuid)
returns table (
  restaurant_id uuid,
  restaurant_name text,
  branch_id uuid,
  branch_name text,
  roles text[]
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    m.restaurant_id,
    pg_catalog.btrim(r.name) as restaurant_name,
    m.branch_id,
    pg_catalog.btrim(b.name) as branch_name,
    array_agg(distinct rg.role_code order by rg.role_code)::text[] as roles
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
  where m.user_id = actor_id
    and m.revoked_at is null
  group by
    m.id,
    m.restaurant_id,
    r.name,
    m.branch_id,
    b.name
  order by m.restaurant_id, m.branch_id
  limit 501;
$function$;

alter function app_private.list_active_branch_memberships(uuid) owner to postgres;

revoke all on function app_private.list_active_branch_memberships(uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.list_active_branch_memberships(uuid) to app_api;

comment on function app_private.list_active_branch_memberships(uuid) is
  'Server-only active branch membership directory for one verified Auth actor.';

commit;
