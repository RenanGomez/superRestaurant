begin;

create table app.operational_shifts (
  id uuid not null,
  restaurant_id uuid not null,
  branch_id uuid not null,
  name text not null,
  status text not null,
  version bigint not null default 1,
  opened_at timestamptz not null,
  opened_by uuid not null references auth.users (id) on delete restrict,
  closed_at timestamptz,
  closed_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint operational_shifts_pk primary key (restaurant_id, branch_id, id),
  constraint operational_shifts_branch_fk foreign key (restaurant_id, branch_id)
    references app.branches (restaurant_id, id) on delete restrict,
  constraint operational_shifts_name_valid check (
    char_length(name) between 1 and 80 and name = btrim(name)
  ),
  constraint operational_shifts_status_valid check (status in ('open', 'closed')),
  constraint operational_shifts_version_valid check (version >= 1),
  constraint operational_shifts_lifecycle_valid check (
    (status = 'open' and closed_at is null and closed_by is null)
    or (status = 'closed' and closed_at is not null and closed_by is not null and closed_at >= opened_at)
  )
);

create unique index operational_shifts_one_open_per_branch_idx
  on app.operational_shifts (restaurant_id, branch_id)
  where status = 'open';

create index operational_shifts_branch_history_idx
  on app.operational_shifts (restaurant_id, branch_id, opened_at desc, id);

create function app_private.list_active_operational_shifts(
  actor_id uuid,
  target_restaurant_id uuid,
  target_branch_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  has_membership boolean;
  result jsonb;
begin
  if actor_id is null or target_restaurant_id is null or target_branch_id is null then
    return null;
  end if;

  select exists (
    select 1
    from app_private.find_active_branch_membership(actor_id, target_restaurant_id, target_branch_id)
  ) into has_membership;
  if not has_membership then return null; end if;

  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('branchId', target_branch_id, 'restaurantId', target_restaurant_id),
    'shifts', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'scope', pg_catalog.jsonb_build_object('branchId', shift.branch_id, 'restaurantId', shift.restaurant_id),
      'shiftId', shift.id,
      'name', shift.name,
      'status', shift.status,
      'openedAt', pg_catalog.to_char(shift.opened_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'openedBy', shift.opened_by,
      'version', shift.version
    ) order by shift.opened_at desc, shift.id), '[]'::jsonb)
  ) into result
  from app.operational_shifts as shift
  where shift.restaurant_id = target_restaurant_id
    and shift.branch_id = target_branch_id
    and shift.status = 'open';

  return result;
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
    where rolname = 'app_api' and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolinherit and not rolreplication and not rolbypassrls
  ) then
    raise exception using errcode = '55000', message = 'APP_API_ROLE_REJECTED';
  end if;
end
$owner$;

alter function app_private.list_active_operational_shifts(uuid,uuid,uuid) owner to postgres;

revoke all on app.operational_shifts from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.list_active_operational_shifts(uuid,uuid,uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.list_active_operational_shifts(uuid,uuid,uuid) to app_api;

alter table app.operational_shifts enable row level security;
alter table app.operational_shifts force row level security;

comment on table app.operational_shifts is
  'Branch service periods. They are distinct from employee attendance and cash-register sessions.';
comment on function app_private.list_active_operational_shifts(uuid,uuid,uuid) is
  'Server-only list of open service periods for one verified actor and exact branch scope.';

commit;
