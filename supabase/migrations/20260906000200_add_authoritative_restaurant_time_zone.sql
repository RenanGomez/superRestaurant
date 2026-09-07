begin;

alter table app.restaurants add column time_zone text;

-- The initial deployment is explicitly scoped to America/Hermosillo. The
-- default is not retained: every future restaurant must choose its IANA zone.
update app.restaurants set time_zone = 'America/Hermosillo';

alter table app.restaurants
  alter column time_zone set not null,
  add constraint restaurants_time_zone_shape check (
    time_zone = btrim(time_zone)
    and char_length(time_zone) between 1 and 100
    and time_zone !~ '[[:cntrl:]]'
  );

create function app_private.enforce_restaurant_time_zone()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names as time_zone
    where time_zone.name = new.time_zone
  ) then
    raise check_violation using
      constraint = 'restaurants_time_zone_iana',
      message = 'RESTAURANT_TIME_ZONE_INVALID';
  end if;
  return new;
end
$function$;

alter function app_private.enforce_restaurant_time_zone() owner to postgres;
revoke all on function app_private.enforce_restaurant_time_zone()
  from public, anon, authenticated, service_role, app_api;

create trigger restaurants_time_zone_iana
before insert or update of time_zone on app.restaurants
for each row execute function app_private.enforce_restaurant_time_zone();

create function app_private.enforce_order_restaurant_time_zone()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authoritative_time_zone text;
begin
  select restaurant.time_zone
  into authoritative_time_zone
  from app.restaurants as restaurant
  where restaurant.id = new.restaurant_id;

  if authoritative_time_zone is null
    or new.aggregate ->> 'timeZone' is distinct from authoritative_time_zone
  then
    raise check_violation using
      constraint = 'orders_restaurant_time_zone',
      message = 'ORDER_RESTAURANT_TIME_ZONE_MISMATCH';
  end if;
  return new;
end
$function$;

alter function app_private.enforce_order_restaurant_time_zone() owner to postgres;
revoke all on function app_private.enforce_order_restaurant_time_zone()
  from public, anon, authenticated, service_role, app_api;

create trigger orders_restaurant_time_zone
before insert on app.orders
for each row execute function app_private.enforce_order_restaurant_time_zone();

create function app_private.read_branch_operational_context(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'roles', pg_catalog.array_agg(distinct role_grant.role_code order by role_grant.role_code)::text[],
    'schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object(
      'branchId', branch.id,
      'restaurantId', restaurant.id
    ),
    'timeZone', restaurant.time_zone
  )
  from app.memberships as membership
  join app.restaurants as restaurant
    on restaurant.id = membership.restaurant_id
   and restaurant.disabled_at is null
  join app.branches as branch
    on branch.id = membership.branch_id
   and branch.restaurant_id = membership.restaurant_id
   and branch.disabled_at is null
  join app.membership_role_grants as role_grant
    on role_grant.membership_id = membership.id
   and role_grant.revoked_at is null
  where membership.user_id = p_actor_id
    and membership.restaurant_id = p_restaurant_id
    and membership.branch_id = p_branch_id
    and membership.revoked_at is null
  group by branch.id, restaurant.id, restaurant.time_zone;
$function$;

alter function app_private.read_branch_operational_context(uuid, uuid, uuid) owner to postgres;
revoke all on function app_private.read_branch_operational_context(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.read_branch_operational_context(uuid, uuid, uuid) to app_api;

do $validation$
begin
  if exists (
    select 1
    from app.restaurants as restaurant
    where not exists (
      select 1
      from pg_catalog.pg_timezone_names as time_zone
      where time_zone.name = restaurant.time_zone
    )
  ) then
    raise check_violation using
      constraint = 'restaurants_time_zone_iana',
      message = 'EXISTING_RESTAURANT_TIME_ZONE_INVALID';
  end if;
end
$validation$;

comment on column app.restaurants.time_zone is
  'Authoritative IANA time zone for new operational records in this Restaurant.';
comment on function app_private.enforce_restaurant_time_zone() is
  'Rejects restaurant time zones not present in PostgreSQL pg_timezone_names.';
comment on function app_private.enforce_order_restaurant_time_zone() is
  'Rejects a new Order whose immutable time-zone snapshot differs from its Restaurant.';
comment on function app_private.read_branch_operational_context(uuid, uuid, uuid) is
  'Returns roles and authoritative IANA time zone for one active actor/Restaurant/Branch membership.';

commit;
