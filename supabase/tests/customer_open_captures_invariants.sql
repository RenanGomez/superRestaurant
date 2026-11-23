begin;
do $test$
declare
  actor uuid := '00000000-0000-4000-8000-000000000001';
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  other_restaurant uuid := gen_random_uuid();
  foreign_branch uuid := gen_random_uuid();
  member uuid := gen_random_uuid();
  foreign_member uuid := gen_random_uuid();
  customer uuid := gen_random_uuid();
  foreign_customer uuid := gen_random_uuid();
  snapshot uuid := gen_random_uuid();
  foreign_snapshot uuid := gen_random_uuid();
  draft uuid := gen_random_uuid();
  expired_draft uuid := gen_random_uuid();
  foreign_draft uuid := gen_random_uuid();
  function_oid oid := pg_catalog.to_regprocedure('app_private.list_customer_open_captures(uuid,jsonb)');
  app_api_oid oid := (select oid from pg_catalog.pg_roles where rolname = 'app_api');
  request jsonb;
  foreign_scope_request jsonb;
  result jsonb;
begin
  -- Verify function security attributes and EXECUTE grants before running as app_api.
  if function_oid is null or app_api_oid is null then
    raise exception using errcode = '55000', message = 'OPEN_CAPTURES_REQUIRED_OBJECT_MISSING';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_roles owner on owner.oid = p.proowner
    where p.oid = function_oid and p.prosecdef and owner.rolname = 'postgres'
      and coalesce(pg_catalog.array_to_string(p.proconfig, ','), '') in ('search_path=', 'search_path=""')
  ) then
    raise exception using errcode = '55000', message = 'OPEN_CAPTURES_FUNCTION_SECURITY_REJECTED';
  end if;
  if not pg_catalog.has_function_privilege(app_api_oid, function_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('public', function_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', function_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', function_oid, 'EXECUTE')
    or exists (
      select 1 from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) acl
      where p.oid = function_oid and acl.privilege_type = 'EXECUTE'
        and acl.grantee not in (p.proowner, app_api_oid)
    )
  then
    raise exception using errcode = '55000', message = 'OPEN_CAPTURES_GRANTS_REJECTED';
  end if;

  insert into app.restaurants(id, name, time_zone) values
    (restaurant, 'open captures', 'America/Hermosillo'),
    (other_restaurant, 'other', 'America/Hermosillo');
  insert into app.branches(id, restaurant_id, name) values
    (branch, restaurant, 'one'),
    (other_branch, restaurant, 'two'),
    (foreign_branch, other_restaurant, 'foreign');
  insert into app.memberships(id, user_id, restaurant_id, branch_id, granted_by)
    values (member, actor, restaurant, branch, actor);
  insert into app.membership_role_grants(membership_id, role_code, granted_by)
    values (member, 'cashier', actor);
  insert into app.customers(id, restaurant_id, display_name, created_by, updated_by) values
    (customer, restaurant, 'customer', actor, actor),
    (foreign_customer, other_restaurant, 'foreign customer', actor, actor);
  insert into app.customer_party_snapshots(id, restaurant_id, customer_id, contact_id, display_name, phone_display_value, phone_normalized_value, created_by) values
    (snapshot, restaurant, customer, gen_random_uuid(), 'customer', '123', '123', actor),
    (foreign_snapshot, other_restaurant, foreign_customer, gen_random_uuid(), 'foreign customer', '456', '456', actor);
  insert into app.capture_drafts(id, restaurant_id, branch_id, folio, source_channel, fulfillment_channel, status, attention_status,
    recovery_expires_at, customer_id, customer_snapshot_id, created_at, created_by, updated_at, updated_by) values
    (draft, restaurant, branch, 'A', 'phone', 'pickup', 'draft', 'unclaimed', clock_timestamp() + interval '1 day', customer, snapshot, clock_timestamp(), actor, clock_timestamp(), actor),
    (gen_random_uuid(), restaurant, other_branch, 'B', 'phone', 'pickup', 'draft', 'unclaimed', clock_timestamp() + interval '1 day', customer, snapshot, clock_timestamp(), actor, clock_timestamp(), actor),
    (gen_random_uuid(), restaurant, branch, 'C', 'phone', 'pickup', 'no_sale', 'unclaimed', clock_timestamp() + interval '1 day', customer, snapshot, clock_timestamp(), actor, clock_timestamp(), actor),
    (expired_draft, restaurant, branch, 'D', 'phone', 'pickup', 'draft', 'unclaimed', clock_timestamp() - interval '1 minute', customer, snapshot, clock_timestamp() - interval '2 hours', actor, clock_timestamp() - interval '2 hours', actor),
    (foreign_draft, other_restaurant, foreign_branch, 'E', 'phone', 'pickup', 'draft', 'unclaimed', clock_timestamp() + interval '1 day', foreign_customer, foreign_snapshot, clock_timestamp(), actor, clock_timestamp(), actor);

  request := jsonb_build_object(
    'schemaVersion', 1,
    'scope', jsonb_build_object('restaurantId', restaurant, 'branchId', branch),
    'customerId', customer,
    'limit', 50
  );
  foreign_scope_request := jsonb_build_object(
    'schemaVersion', 1,
    'scope', jsonb_build_object('restaurantId', other_restaurant, 'branchId', foreign_branch),
    'customerId', foreign_customer,
    'limit', 50
  );

  execute 'set local role app_api';
  -- Only the active, non-expired draft in the authorized restaurant/branch is returned.
  result := app_private.list_customer_open_captures(actor, request);
  if jsonb_array_length(result->'items') <> 1 or result#>>'{items,0,captureDraftId}' <> draft::text then
    raise exception 'unexpected drafts (expired/other_branch/no_sale leak): %', result;
  end if;
  -- A customerId belonging to another tenant must never return drafts from that tenant.
  result := app_private.list_customer_open_captures(actor, jsonb_set(request, '{customerId}', to_jsonb(foreign_customer)));
  if jsonb_array_length(result->'items') <> 0 then
    raise exception 'foreign customerId leak: %', result;
  end if;
  -- Another branch in the same restaurant without membership is denied.
  result := app_private.list_customer_open_captures(actor, jsonb_set(request, '{scope,branchId}', to_jsonb(other_branch)));
  if result->>'status' is distinct from 'denied' then
    raise exception 'branch leak: %', result;
  end if;
  -- Another restaurant scope without membership is denied.
  result := app_private.list_customer_open_captures(actor, foreign_scope_request);
  if result->>'status' is distinct from 'denied' then
    raise exception 'restaurant leak: %', result;
  end if;
  -- Invalid payloads are rejected rather than failing with an unhandled error.
  result := app_private.list_customer_open_captures(actor, request || '{"extra":true}'::jsonb);
  if result->>'status' is distinct from 'rejected' then
    raise exception 'invalid payload accepted: %', result;
  end if;
  execute 'reset role';

  -- Even when the actor also holds a valid membership in the other restaurant, each scope stays strictly isolated.
  insert into app.memberships(id, user_id, restaurant_id, branch_id, granted_by)
    values (foreign_member, actor, other_restaurant, foreign_branch, actor);
  insert into app.membership_role_grants(membership_id, role_code, granted_by)
    values (foreign_member, 'cashier', actor);

  execute 'set local role app_api';
  result := app_private.list_customer_open_captures(actor, foreign_scope_request);
  if jsonb_array_length(result->'items') <> 1 or result#>>'{items,0,captureDraftId}' <> foreign_draft::text then
    raise exception 'foreign restaurant own draft missing: %', result;
  end if;
  result := app_private.list_customer_open_captures(actor, jsonb_set(request, '{customerId}', to_jsonb(foreign_customer)));
  if jsonb_array_length(result->'items') <> 0 then
    raise exception 'cross-restaurant draft leak with dual membership: %', result;
  end if;
  result := app_private.list_customer_open_captures(actor, jsonb_set(foreign_scope_request, '{customerId}', to_jsonb(customer)));
  if jsonb_array_length(result->'items') <> 0 then
    raise exception 'reverse cross-restaurant draft leak: %', result;
  end if;
  execute 'reset role';

  -- Revoked role grants must be denied.
  update app.membership_role_grants
    set revoked_at = clock_timestamp(), revoked_by = actor, revocation_reason = 'test'
    where membership_id = member;

  execute 'set local role app_api';
  result := app_private.list_customer_open_captures(actor, request);
  if result->>'status' is distinct from 'denied' then
    raise exception 'revoked grant allowed: %', result;
  end if;
  execute 'reset role';
end
$test$;
rollback;
