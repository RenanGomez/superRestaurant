-- Test-only, composed into the rollback verifier transaction. Never apply as a migration.
begin;
do $delivery_zones_invariants$
declare
  manager_actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  waiter_actor uuid := (select id from auth.users where deleted_at is null order by id offset 1 limit 1);
  restaurant uuid := gen_random_uuid();
  other_restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  manager_member uuid := gen_random_uuid();
  waiter_member uuid := gen_random_uuid();
  zone_a uuid := gen_random_uuid();
  zone_b uuid := gen_random_uuid();
  create_event uuid := gen_random_uuid();
  now_at timestamptz := date_trunc('milliseconds', clock_timestamp());
  occurred_at_text text;
  scope jsonb;
  base_command jsonb;
  create_command jsonb;
  create_result jsonb;
  update_command jsonb;
  update_result jsonb;
  collision_command jsonb;
  collision_result jsonb;
  list_request jsonb;
  list_result jsonb;
  quote_result jsonb;
begin
  if manager_actor is null or waiter_actor is null or manager_actor = waiter_actor then
    raise exception using errcode = '55000', message = 'DELIVERY_ZONES_TWO_ACTORS_REQUIRED';
  end if;

  insert into app.restaurants (id, name, time_zone) values
    (restaurant, 'rollback-only delivery zones', 'America/Hermosillo'),
    (other_restaurant, 'rollback-only delivery zones other tenant', 'America/Hermosillo');
  insert into app.branches (id, restaurant_id, name) values
    (branch, restaurant, 'rollback-only delivery zones'),
    (other_branch, other_restaurant, 'rollback-only delivery zones other tenant');
  -- manager_actor deliberately has no membership at all in other_restaurant/other_branch, so a
  -- forged scope on either write or read must be denied for lack of authorization, not merely
  -- redirected to a different (legitimately owned) tenant.
  insert into app.memberships (id, user_id, restaurant_id, branch_id, granted_by) values
    (manager_member, manager_actor, restaurant, branch, manager_actor),
    (waiter_member, waiter_actor, restaurant, branch, manager_actor);
  insert into app.membership_role_grants (membership_id, role_code, granted_by) values
    (manager_member, 'manager', manager_actor),
    (waiter_member, 'waiter', manager_actor);

  occurred_at_text := to_char(now_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  scope := jsonb_build_object('restaurantId', restaurant::text, 'branchId', branch::text);
  base_command := jsonb_build_object(
    'schemaVersion', 1, 'scope', scope, 'zoneId', zone_a::text, 'eventId', create_event::text,
    'idempotencyKey', gen_random_uuid()::text, 'deviceId', gen_random_uuid()::text,
    'occurredAt', occurred_at_text
  );

  -- Waiter (captures.read, not manager-tier) is denied write access.
  create_command := base_command || jsonb_build_object(
    'expectedVersion', 0, 'name', 'Centro', 'postalCodes', jsonb_build_array('83000', '83100'),
    'localities', jsonb_build_array(), 'feeMinor', 3500, 'currency', 'MXN', 'active', true, 'reason', null
  );
  execute 'set local role app_api';
  if app_private.upsert_delivery_zone(waiter_actor, create_command) ->> 'status' <> 'denied'
  then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_WAITER_WRITE_ACCEPTED'; end if;

  -- Rejected shapes: negative-looking fee, bad currency, empty coverage, duplicate postal codes.
  if app_private.upsert_delivery_zone(manager_actor, create_command || jsonb_build_object('feeMinor', -1)) ->> 'status' <> 'rejected'
    or app_private.upsert_delivery_zone(manager_actor, create_command || jsonb_build_object('currency', 'mxn')) ->> 'status' <> 'rejected'
    or app_private.upsert_delivery_zone(manager_actor,
      create_command || jsonb_build_object('postalCodes', jsonb_build_array(), 'localities', jsonb_build_array())
    ) ->> 'status' <> 'rejected'
    or app_private.upsert_delivery_zone(manager_actor,
      create_command || jsonb_build_object('postalCodes', jsonb_build_array('83000', '83000'))
    ) ->> 'status' <> 'rejected'
    or app_private.upsert_delivery_zone(manager_actor, create_command || '{"unexpected":true}'::jsonb) ->> 'status' <> 'rejected'
  then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_CREATE_GUARD_REJECTED'; end if;

  -- Cross-tenant scope forgery is denied, not silently scoped.
  if app_private.upsert_delivery_zone(manager_actor,
    create_command || jsonb_build_object('scope', jsonb_build_object('restaurantId', other_restaurant::text, 'branchId', other_branch::text))
  ) ->> 'status' <> 'denied'
  then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_CROSS_TENANT_FORGERY_ACCEPTED'; end if;

  create_result := app_private.upsert_delivery_zone(manager_actor, create_command);
  if create_result ->> 'status' <> 'applied'
    or create_result #>> '{record,version}' <> '1'
    or create_result #>> '{record,name}' <> 'Centro'
    or create_result #> '{record,postalCodes}' is distinct from jsonb_build_array('83000', '83100')
    or create_result #>> '{record,feeMinor}' <> '3500'
    or create_result #>> '{record,active}' <> 'true'
  then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_CREATE_REJECTED'; end if;

  -- Idempotent replay of the exact same command.
  if app_private.upsert_delivery_zone(manager_actor, create_command)
    is distinct from jsonb_build_object('status', 'replayed', 'record', create_result -> 'record')
  then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_CREATE_REPLAY_REJECTED'; end if;

  -- Same idempotency key, different command body -> conflict (never silently applies a different result).
  if app_private.upsert_delivery_zone(manager_actor,
    create_command || jsonb_build_object('name', 'Centro alterado')
  ) ->> 'status' <> 'conflict'
  then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_IDEMPOTENCY_FINGERPRINT_REJECTED'; end if;

  -- A second zone attempting to claim an already-claimed postal code in the same Branch is rejected.
  collision_command := jsonb_build_object(
    'schemaVersion', 1, 'scope', scope, 'zoneId', zone_b::text, 'eventId', gen_random_uuid()::text,
    'idempotencyKey', gen_random_uuid()::text, 'deviceId', gen_random_uuid()::text,
    'occurredAt', occurred_at_text, 'expectedVersion', 0, 'name', 'Sur',
    'postalCodes', jsonb_build_array('83000'), 'localities', jsonb_build_array(),
    'feeMinor', 5000, 'currency', 'MXN', 'active', true, 'reason', null
  );
  collision_result := app_private.upsert_delivery_zone(manager_actor, collision_command);
  if collision_result ->> 'status' <> 'conflict'
  then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_POSTAL_CODE_COLLISION_ACCEPTED'; end if;
  if exists (select 1 from app.delivery_zones where restaurant_id = restaurant and branch_id = branch and id = zone_b)
  then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_POSTAL_CODE_COLLISION_PARTIAL_WRITE'; end if;

  -- CAS: stale expectedVersion is rejected; update without a reason is rejected (audited motive required).
  update_command := (base_command - 'eventId' - 'idempotencyKey') || jsonb_build_object(
    'eventId', gen_random_uuid()::text, 'idempotencyKey', gen_random_uuid()::text,
    'expectedVersion', 1, 'name', 'Centro', 'postalCodes', jsonb_build_array('83000', '83100', '83200'),
    'localities', jsonb_build_array(), 'feeMinor', 4000, 'currency', 'MXN', 'active', true,
    'reason', 'Ajuste de cobertura tras revisión operativa'
  );
  if app_private.upsert_delivery_zone(manager_actor, update_command || jsonb_build_object('expectedVersion', 0, 'reason', null))
      ->> 'status' <> 'conflict'
    or app_private.upsert_delivery_zone(manager_actor, update_command || jsonb_build_object('reason', null))
      ->> 'status' <> 'rejected'
  then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_UPDATE_GUARD_REJECTED'; end if;

  update_result := app_private.upsert_delivery_zone(manager_actor, update_command);
  if update_result ->> 'status' <> 'applied'
    or update_result #>> '{record,version}' <> '2'
    or update_result #>> '{record,feeMinor}' <> '4000'
    or update_result #> '{record,postalCodes}' is distinct from jsonb_build_array('83000', '83100', '83200')
  then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_UPDATE_REJECTED'; end if;
  if (select count(*) from app.delivery_zone_postal_codes where restaurant_id = restaurant and branch_id = branch and zone_id = zone_a) <> 3
  then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_POSTAL_MEMBERSHIP_OUT_OF_SYNC'; end if;

  -- Deactivating a zone frees its postal codes for another zone to claim (also audited).
  if app_private.upsert_delivery_zone(manager_actor, (update_command - 'eventId' - 'idempotencyKey') || jsonb_build_object(
      'eventId', gen_random_uuid()::text, 'idempotencyKey', gen_random_uuid()::text,
      'expectedVersion', 2, 'active', false, 'reason', 'Zona fuera de servicio temporalmente'
    )) ->> 'status' <> 'applied'
  then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_DEACTIVATE_REJECTED'; end if;
  if exists (select 1 from app.delivery_zone_postal_codes where restaurant_id = restaurant and branch_id = branch and zone_id = zone_a)
  then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_DEACTIVATE_MEMBERSHIP_NOT_RELEASED'; end if;
  if app_private.upsert_delivery_zone(manager_actor, collision_command) ->> 'status' <> 'applied'
  then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_POSTAL_CODE_NOT_RELEASED'; end if;
  execute 'reset role';

  -- Quote feed reflects only active, non-deleted zones and never leaks other tenants/branches.
  execute 'set local role app_api';
  quote_result := app_private.list_active_delivery_zones_for_quote(restaurant, branch);
  execute 'reset role';
  if pg_catalog.jsonb_array_length(quote_result -> 'zones') <> 1
    or quote_result #>> '{zones,0,zoneId}' <> zone_b::text
  then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_QUOTE_FEED_REJECTED'; end if;

  -- Management listing: manager and waiter (both captures.read) can read; includes inactive zones.
  list_request := jsonb_build_object('schemaVersion', 1, 'scope', scope);
  execute 'set local role app_api';
  list_result := app_private.list_delivery_zones(manager_actor, list_request);
  execute 'reset role';
  if pg_catalog.jsonb_array_length(list_result -> 'zones') <> 2 then
    raise exception using errcode = '55000', message = 'DELIVERY_ZONES_LIST_SCOPE_REJECTED';
  end if;
  execute 'set local role app_api';
  if app_private.list_delivery_zones(waiter_actor, list_request) -> 'zones' is distinct from list_result -> 'zones'
    or app_private.list_delivery_zones(manager_actor, list_request || '{"unexpected":true}'::jsonb) ->> 'status' <> 'rejected'
  then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_LIST_AUTHORIZATION_REJECTED'; end if;

  -- Cross-branch/tenant isolation: a manager of another Restaurant cannot list or write this Branch's zones.
  if app_private.list_delivery_zones(manager_actor,
      jsonb_build_object('schemaVersion', 1, 'scope', jsonb_build_object('restaurantId', other_restaurant::text, 'branchId', branch::text))
    ) ->> 'status' <> 'denied'
  then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_CROSS_TENANT_LIST_ACCEPTED'; end if;
  execute 'reset role';

  -- Audit trail: one event per accepted command, actor/branch/reason recorded, no update/delete allowed by RLS.
  if (select count(*) from app.delivery_zone_command_events where restaurant_id = restaurant and branch_id = branch and zone_id = zone_a) <> 3
    or not exists (
      select 1 from app.delivery_zone_command_events
      where restaurant_id = restaurant and branch_id = branch and zone_id = zone_a
        and operation = 'delivery_zone.updated' and result_version = 3
        and reason = 'Zona fuera de servicio temporalmente' and actor_membership_id = manager_member
    )
  then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_AUDIT_REJECTED'; end if;
end
$delivery_zones_invariants$;
commit;
