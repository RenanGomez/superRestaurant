-- capture-selection-plan-probe-v2 (P3-6): the read-only idempotency probe of replace_capture_selection_plan
-- learns plan schemaVersion 2 (lines[].pizza, ruleVersion pizza-halves-v2).
--
-- Why: 20261120000100_pizza_model_v2 made replace_capture_selection_plan accept plan schemaVersion 2, but
-- the probe (last defined in 20260928000100_capture_selection_plan.sql) still rejects anything but
-- schemaVersion 1. A retry of a stored V2 plan would be answered 'rejected' instead of 'replayed'.
--
-- Contract kept from the original probe:
--   * it is purely actor + scope + idempotencyKey + fingerprint; it NEVER reads the catalog, so a catalog
--     change since the original apply cannot turn a legitimate replay into a rejection. Catalog and tenant
--     facts (products, sizes, options belong to the same restaurant/catalog) are revalidated by
--     replace_capture_selection_plan / confirm_capture_draft_v3 against the release, not here. The
--     tenant boundary of the probe is the membership check and the (actor, restaurant, branch, key) lookup.
--   * plan schemaVersion 1 behaves exactly as before for every plan the write could ever have stored.
--     The only addition for v1 is that a line carrying `pizza` is rejected, which replace already rejects
--     (exact-key check), so no stored v1 plan can contain it.
--   * no new prices are computed and no tables are read besides the existing membership/command-event ones.
--
-- V2 additions, fail-closed with the same typed reasons as replace_capture_selection_plan:
--   * schemaVersion 1 or 2 only;
--   * every line of a v2 plan must be a JSON object;
--   * a `pizza` line must have exactly the keys lineId, productId, variantId, quantity, modifierGroups, note,
--     pizza, must not also carry `fraction`, and must pass app_private.pizza_selection_line_shape_valid
--     (ruleVersion pizza-halves-v2, exactly two halves half-a/half-b, uuid ids, bounded arrays, line names
--     half-a's product/variant);
--   * ruleVersion pizza-halves-v1 -> reason rule_version_legacy; any other ruleVersion -> rule_version_unknown.
--
-- Rollback: this migration only redefines one function. To roll back, create a NEW migration that does
-- `create or replace` of app_private.probe_capture_selection_plan_replace(uuid,jsonb,jsonb) with the body
-- from 20260928000100_capture_selection_plan.sql (schemaVersion 1 only). No data is touched.

create or replace function app_private.probe_capture_selection_plan_replace(
  p_actor_id uuid,
  p_command jsonb,
  p_plan jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  restaurant uuid; branch uuid; capture uuid; catalog uuid;
  event uuid; device uuid; lease uuid;
  expected bigint; occurred timestamptz; fingerprint text;
  stored app.capture_command_events%rowtype;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_command,array[
      'schemaVersion','scope','captureDraftId','expectedVersion',
      'attentionLeaseId','eventId','idempotencyKey','deviceId','occurredAt'
    ])
    or not app_private.jsonb_has_exact_keys(p_command->'scope',array['restaurantId','branchId'])
    or p_command->'schemaVersion' is distinct from '1'::jsonb
    or not coalesce(p_command->>'expectedVersion' ~ '^[1-9][0-9]*$',false)
    or not coalesce(p_command->>'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
    or not app_private.jsonb_has_exact_keys(p_plan,array['schemaVersion','catalogVersion','lines'])
    or (p_plan->'schemaVersion' is distinct from '1'::jsonb and p_plan->'schemaVersion' is distinct from '2'::jsonb)
    or not coalesce(p_plan->>'catalogVersion' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
    or not (case when pg_catalog.jsonb_typeof(p_plan->'lines')='array'
      then pg_catalog.jsonb_array_length(p_plan->'lines') between 0 and 200 else false end)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  -- Pizza lines (plan schemaVersion 2 only). Same reasons and order as replace_capture_selection_plan.
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    where pg_catalog.jsonb_typeof(line.value) = 'object' and pg_catalog.jsonb_typeof(line.value->'pizza') = 'object'
      and line.value->'pizza'->>'ruleVersion' = 'pizza-halves-v1'
  ) then return pg_catalog.jsonb_build_object('status','rejected','reason','rule_version_legacy'); end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    where pg_catalog.jsonb_typeof(line.value) = 'object' and pg_catalog.jsonb_typeof(line.value->'pizza') = 'object'
      and line.value->'pizza'->>'ruleVersion' is distinct from 'pizza-halves-v2'
  ) then return pg_catalog.jsonb_build_object('status','rejected','reason','rule_version_unknown'); end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    where (p_plan->'schemaVersion' = '2'::jsonb and pg_catalog.jsonb_typeof(line.value) <> 'object')
      or (pg_catalog.jsonb_typeof(line.value) = 'object' and line.value ? 'pizza' and (
        p_plan->'schemaVersion' is distinct from '2'::jsonb
        or not app_private.jsonb_has_exact_keys(
          line.value,array['lineId','productId','variantId','quantity','modifierGroups','note','pizza']
        )
        or not app_private.pizza_selection_line_shape_valid(line.value)
      ))
  ) then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  begin
    restaurant:=(p_command#>>'{scope,restaurantId}')::uuid;
    branch:=(p_command#>>'{scope,branchId}')::uuid;
    capture:=(p_command->>'captureDraftId')::uuid;
    catalog:=(p_plan->>'catalogVersion')::uuid;
    event:=(p_command->>'eventId')::uuid;
    device:=(p_command->>'deviceId')::uuid;
    lease:=(p_command->>'attentionLeaseId')::uuid;
    expected:=(p_command->>'expectedVersion')::bigint;
    occurred:=(p_command->>'occurredAt')::timestamptz;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or capture is null or catalog is null
    or event is null or device is null or lease is null
    or expected not between 1 and 9007199254740990 or occurred is null
    or p_command#>>'{scope,restaurantId}' is distinct from restaurant::text
    or p_command#>>'{scope,branchId}' is distinct from branch::text
    or p_command->>'occurredAt' is distinct from pg_catalog.to_char(occurred at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  if not exists (
    select 1
    from app.memberships m
    join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
    join app.restaurants r on r.id=m.restaurant_id
    join app.membership_role_grants g on g.membership_id=m.id
    where m.user_id=p_actor_id and m.restaurant_id=restaurant and m.branch_id=branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null and g.revoked_at is null
      and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
  ) then return pg_catalog.jsonb_build_object('status','denied'); end if;

  fingerprint:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'capture.selection_replaced:'||p_command::text||':'||p_plan::text||':'||p_actor_id::text,'UTF8'
  )),'hex');
  select * into stored from app.capture_command_events
  where actor_id=p_actor_id and restaurant_id=restaurant and branch_id=branch
    and idempotency_key=p_command->>'idempotencyKey';
  if found then
    if stored.operation<>'capture.selection_replaced' or stored.command_fingerprint<>fingerprint then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;
    return pg_catalog.jsonb_build_object('status','replayed','record',stored.result_capture);
  end if;
  return pg_catalog.jsonb_build_object('status','pending');
end
$function$;

alter function app_private.probe_capture_selection_plan_replace(uuid,jsonb,jsonb) owner to postgres;
revoke all on function app_private.probe_capture_selection_plan_replace(uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.probe_capture_selection_plan_replace(uuid,jsonb,jsonb) to app_api;

comment on function app_private.probe_capture_selection_plan_replace(uuid,jsonb,jsonb) is
  'Read-only idempotency probe for replace_capture_selection_plan (plan schemaVersion 1 and 2): recognizes a replay purely from actor+scope+idempotencyKey+fingerprint, never reads the catalog; V2 pizza lines are shape-validated fail-closed with the same reasons as the write.';
