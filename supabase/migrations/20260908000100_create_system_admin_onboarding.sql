begin;

create table app.system_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  granted_at timestamptz not null default statement_timestamp(),
  granted_by uuid references auth.users (id) on delete restrict,
  grant_reason text not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete restrict,
  revocation_reason text,
  constraint system_admins_user_unique unique (user_id),
  constraint system_admins_grant_reason_valid check (char_length(btrim(grant_reason)) between 1 and 500),
  constraint system_admins_revocation_evidence check (
    (revoked_at is null and revoked_by is null and revocation_reason is null)
    or (revoked_at is not null and revoked_by is not null and char_length(btrim(revocation_reason)) between 1 and 500)
  ),
  constraint system_admins_revocation_order check (revoked_at is null or revoked_at >= granted_at)
);

create unique index system_admins_one_active_user_idx on app.system_admins (user_id) where revoked_at is null;

create table app.system_onboarding_operations (
  operation_id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  actor_id uuid not null references auth.users (id) on delete restrict,
  request_hash text not null,
  status text not null,
  result jsonb,
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  constraint system_onboarding_request_hash_valid check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint system_onboarding_status_valid check (status in ('in_progress', 'invitation_pending', 'failed_compensated')),
  constraint system_onboarding_result_valid check (result is null or pg_catalog.jsonb_typeof(result) = 'object')
);

create index system_onboarding_actor_created_idx on app.system_onboarding_operations (actor_id, created_at desc);

create function app_private.is_system_admin(p_actor_id uuid)
returns boolean language sql stable security definer set search_path = '' as $function$
  select p_actor_id is not null and exists (
    select 1 from app.system_admins as admin
    where admin.user_id = p_actor_id and admin.revoked_at is null
  );
$function$;

create function app_private.provision_system_restaurant(
  p_actor_id uuid,
  p_manager_user_id uuid,
  p_manager_email text,
  p_idempotency_key uuid,
  p_request_hash text,
  p_restaurant_name text,
  p_time_zone text,
  p_currency text,
  p_branch_name text,
  p_seed_profile text
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  existing app.system_onboarding_operations%rowtype;
  operation uuid;
  restaurant uuid;
  branch uuid;
  membership uuid;
  shift uuid;
  zone uuid;
  catalog uuid;
  category uuid;
  product uuid;
  v_result jsonb;
begin
  if not app_private.is_system_admin(p_actor_id) then
    return pg_catalog.jsonb_build_object('status', 'forbidden');
  end if;
  if p_manager_user_id is null or p_idempotency_key is null or p_request_hash is null
    or p_request_hash !~ '^[0-9a-f]{64}$' or p_manager_email is null
    or p_manager_email <> pg_catalog.lower(pg_catalog.btrim(p_manager_email))
    or p_manager_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_restaurant_name is null or p_restaurant_name <> pg_catalog.btrim(p_restaurant_name)
    or pg_catalog.char_length(p_restaurant_name) not between 1 and 120
    or p_branch_name is null or p_branch_name <> pg_catalog.btrim(p_branch_name)
    or pg_catalog.char_length(p_branch_name) not between 1 and 120
    or p_time_zone is null or p_time_zone <> pg_catalog.btrim(p_time_zone)
    or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_time_zone)
    or p_currency is null or p_currency !~ '^[A-Z]{3}$'
    or p_seed_profile <> 'development_minimal_v1'
  then return pg_catalog.jsonb_build_object('status', 'invalid_request'); end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('system-onboarding:' || p_idempotency_key::text, 0));
  select * into existing from app.system_onboarding_operations where idempotency_key = p_idempotency_key;
  if found then
    if existing.request_hash <> p_request_hash then
      return pg_catalog.jsonb_build_object('status', 'idempotency_conflict');
    end if;
    return coalesce(existing.result, pg_catalog.jsonb_build_object('status', existing.status, 'operationId', existing.operation_id));
  end if;

  if exists (select 1 from app.restaurants where lower(name) = lower(p_restaurant_name))
    or exists (select 1 from auth.users where id = p_manager_user_id and lower(coalesce(email, '')) <> p_manager_email)
  then return pg_catalog.jsonb_build_object('status', 'duplicate'); end if;

  operation := gen_random_uuid();
  insert into app.system_onboarding_operations(operation_id, idempotency_key, actor_id, request_hash, status)
    values (operation, p_idempotency_key, p_actor_id, p_request_hash, 'in_progress');

  restaurant := gen_random_uuid();
  branch := gen_random_uuid();
  membership := gen_random_uuid();
  shift := gen_random_uuid();
  zone := gen_random_uuid();
  catalog := gen_random_uuid();
  category := gen_random_uuid();
  product := gen_random_uuid();

  insert into app.restaurants(id, name, time_zone) values (restaurant, p_restaurant_name, p_time_zone);
  insert into app.branches(id, restaurant_id, name) values (branch, restaurant, p_branch_name);
  insert into app.memberships(id, user_id, restaurant_id, branch_id, granted_by)
    values (membership, p_manager_user_id, restaurant, branch, p_actor_id);
  insert into app.membership_role_grants(membership_id, role_code, granted_by)
    values (membership, 'manager', p_actor_id);
  insert into app.operational_shifts(id, restaurant_id, branch_id, name, status, opened_at, opened_by)
    values (shift, restaurant, branch, 'Turno inicial', 'open', statement_timestamp(), p_actor_id);
  insert into app.dining_zones(id, restaurant_id, branch_id, name, created_by)
    values (zone, restaurant, branch, 'Salón principal', p_actor_id);
  insert into app.dining_tables(id, restaurant_id, branch_id, zone_id, name, capacity, shape, layout_x, layout_y, layout_width, layout_height, created_by, updated_by)
    values
      (gen_random_uuid(), restaurant, branch, zone, 'Mesa 1', 4, 'square', 1, 1, 4, 4, p_actor_id, p_actor_id),
      (gen_random_uuid(), restaurant, branch, zone, 'Mesa 2', 4, 'round', 7, 1, 4, 4, p_actor_id, p_actor_id);
  insert into app.menu_catalogs(id, restaurant_id, version, currency, published_by)
    values (catalog, restaurant, 1, p_currency, p_actor_id);
  insert into app.menu_categories(restaurant_id, catalog_id, id, name, active, display_order)
    values (restaurant, catalog, category, 'Pizza', true, 0);
  insert into app.menu_products(restaurant_id, catalog_id, id, category_id, name, sku, active, display_order, station_id, unit, unit_price_minor)
    values (restaurant, catalog, product, category, 'Pizza de prueba', 'DEV-PIZZA-001', true, 0, 'general', 'piece', 0);
  insert into app.menu_catalog_heads(restaurant_id, catalog_id, version, updated_at, updated_by)
    values (restaurant, catalog, 1, statement_timestamp(), p_actor_id);

  v_result := pg_catalog.jsonb_build_object(
    'status', 'invitation_pending', 'operationId', operation, 'restaurantId', restaurant,
    'branchId', branch, 'managerUserId', p_manager_user_id, 'managerEmail', p_manager_email,
    'seedProfile', p_seed_profile
  );
  update app.system_onboarding_operations
    set status = 'invitation_pending', result = v_result, completed_at = statement_timestamp()
    where operation_id = operation;
  return v_result;
exception when others then
  raise;
end
$function$;

create function app_private.preflight_system_restaurant(p_actor_id uuid, p_idempotency_key uuid, p_request_hash text, p_restaurant_name text)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare existing app.system_onboarding_operations%rowtype;
begin
  if not app_private.is_system_admin(p_actor_id) then return pg_catalog.jsonb_build_object('status','forbidden'); end if;
  select * into existing from app.system_onboarding_operations where idempotency_key = p_idempotency_key;
  if found then return pg_catalog.jsonb_build_object('status', case when existing.request_hash = p_request_hash then 'replay' else 'idempotency_conflict' end, 'operationId', existing.operation_id); end if;
  if exists (select 1 from app.restaurants where lower(name) = lower(p_restaurant_name)) then return pg_catalog.jsonb_build_object('status','duplicate'); end if;
  return pg_catalog.jsonb_build_object('status','ready');
end;
$function$;

create function app_private.read_system_onboarding_operation(p_actor_id uuid, p_operation_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $function$
  select case when app_private.is_system_admin(p_actor_id) then
    (select pg_catalog.jsonb_build_object('operationId', operation_id, 'status', status, 'result', result, 'createdAt', created_at, 'completedAt', completed_at)
     from app.system_onboarding_operations where operation_id = p_operation_id)
  else null end;
$function$;

create function app_private.list_system_restaurants(p_actor_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $function$
  select case when app_private.is_system_admin(p_actor_id) then
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', id, 'name', name, 'timeZone', time_zone, 'disabledAt', disabled_at) order by name, id) from app.restaurants), '[]'::jsonb)
  else null end;
$function$;

create function app_private.disable_system_restaurant(p_actor_id uuid, p_restaurant_id uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
begin
  if not app_private.is_system_admin(p_actor_id) then return pg_catalog.jsonb_build_object('status', 'forbidden'); end if;
  if p_restaurant_id is null or p_reason is null or p_reason <> pg_catalog.btrim(p_reason) or pg_catalog.char_length(p_reason) not between 1 and 500 then
    return pg_catalog.jsonb_build_object('status', 'invalid_request');
  end if;
  update app.restaurants set disabled_at = statement_timestamp(), disabled_by = p_actor_id, disabled_reason = p_reason, version = version + 1, updated_at = statement_timestamp()
    where id = p_restaurant_id and disabled_at is null;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_found'); end if;
  return pg_catalog.jsonb_build_object('status', 'disabled', 'restaurantId', p_restaurant_id, 'reason', p_reason);
end;
$function$;

do $security$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'postgres' and rolbypassrls) then
    raise exception 'SECURITY_DEFINER_OWNER_REJECTED';
  end if;
end
$security$;

alter function app_private.is_system_admin(uuid) owner to postgres;
alter function app_private.provision_system_restaurant(uuid,uuid,text,uuid,text,text,text,text,text,text) owner to postgres;
alter function app_private.preflight_system_restaurant(uuid,uuid,text,text) owner to postgres;
alter function app_private.read_system_onboarding_operation(uuid,uuid) owner to postgres;
alter function app_private.list_system_restaurants(uuid) owner to postgres;
alter function app_private.disable_system_restaurant(uuid,uuid,text) owner to postgres;
revoke all on app.system_admins, app.system_onboarding_operations from public, anon, authenticated, service_role, app_api;
revoke all on function app_private.is_system_admin(uuid), app_private.provision_system_restaurant(uuid,uuid,text,uuid,text,text,text,text,text,text), app_private.preflight_system_restaurant(uuid,uuid,text,text), app_private.read_system_onboarding_operation(uuid,uuid), app_private.list_system_restaurants(uuid), app_private.disable_system_restaurant(uuid,uuid,text) from public, anon, authenticated, service_role;
grant usage on schema app_private to app_api;
grant execute on function app_private.is_system_admin(uuid), app_private.provision_system_restaurant(uuid,uuid,text,uuid,text,text,text,text,text,text), app_private.preflight_system_restaurant(uuid,uuid,text,text), app_private.read_system_onboarding_operation(uuid,uuid), app_private.list_system_restaurants(uuid), app_private.disable_system_restaurant(uuid,uuid,text) to app_api;
alter table app.system_admins enable row level security;
alter table app.system_admins force row level security;
alter table app.system_onboarding_operations enable row level security;
alter table app.system_onboarding_operations force row level security;

comment on table app.system_admins is 'Auditable global administrator grants and revocations; never writable through Data API.';
comment on table app.system_onboarding_operations is 'Idempotent server-side restaurant onboarding operations and audit evidence.';
comment on function app_private.provision_system_restaurant(uuid,uuid,text,uuid,text,text,text,text,text,text) is 'Server-only atomic provisioning of a restaurant development seed after external Auth invitation.';

commit;
