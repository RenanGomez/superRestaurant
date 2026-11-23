-- Test-only fixtures. The pizza-model-v2 schema verifier executes this body inside its rollback transaction.
-- Exercises 20261120000200_capture_selection_plan_probe_v2.sql (needs ALL migrations applied).
begin;
-- Probe v2 (20261120000200): plan schemaVersion 2 with lines[].pizza. The probe never reads the
-- catalog, so no catalog fixtures are needed; only membership for the scope. Rollback-only.
do $capture_selection_plan_probe_v2_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_restaurant uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  catalog uuid := gen_random_uuid();
  product_a uuid := gen_random_uuid();
  product_b uuid := gen_random_uuid();
  option_x uuid := gen_random_uuid();
  now_at timestamptz := pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp());
  command jsonb;
  other_command jsonb;
  v1_plan jsonb;
  v2_plan jsonb;
  bad jsonb;
  result jsonb;
  half_a jsonb;
  half_b jsonb;
  pizza_line jsonb;
begin
  if actor is null then raise exception 'CAPTURE_SELECTION_PLAN_PROBE_V2_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone)
    values(restaurant,'rollback-only probe v2','America/Hermosillo'),
          (other_restaurant,'rollback-only probe v2 foreign','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name)
    values(branch,restaurant,'rollback-only probe v2 branch'),
          (other_branch,other_restaurant,'rollback-only probe v2 foreign branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values(gen_random_uuid(),actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by)
    select id,'cashier',actor from app.memberships where restaurant_id=restaurant and branch_id=branch;

  command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',gen_random_uuid()::text,'expectedVersion',1,
    'attentionLeaseId',gen_random_uuid()::text,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'deviceId',gen_random_uuid()::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  half_a := pg_catalog.jsonb_build_object(
    'fraction','half-a','productId',product_a::text,'variantId',null,
    'ingredientOptionIds',pg_catalog.jsonb_build_array(option_x::text),
    'extraOptionIds','[]'::jsonb,'removedIngredientOptionIds','[]'::jsonb
  );
  half_b := pg_catalog.jsonb_build_object(
    'fraction','half-b','productId',product_b::text,'variantId',null,
    'ingredientOptionIds',pg_catalog.jsonb_build_array(option_x::text),
    'extraOptionIds','[]'::jsonb,'removedIngredientOptionIds','[]'::jsonb
  );
  pizza_line := pg_catalog.jsonb_build_object(
    'lineId',gen_random_uuid()::text,'productId',product_a::text,'variantId',null,'quantity',1,
    'note',null,'modifierGroups','[]'::jsonb,
    'pizza',pg_catalog.jsonb_build_object(
      'ruleVersion','pizza-halves-v2','halves',pg_catalog.jsonb_build_array(half_a,half_b)
    )
  );
  v2_plan := pg_catalog.jsonb_build_object(
    'schemaVersion',2,'catalogVersion',catalog::text,'lines',pg_catalog.jsonb_build_array(pizza_line)
  );
  v1_plan := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'catalogVersion',catalog::text,'lines',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'lineId',gen_random_uuid()::text,'productId',product_a::text,'variantId',null,'quantity',1,
        'note',null,'modifierGroups','[]'::jsonb
      )
    )
  );

  execute 'set local role app_api';

  -- v1 intact: a plain schemaVersion 1 plan still answers 'pending'.
  result := app_private.probe_capture_selection_plan_replace(actor,command,v1_plan);
  if result->>'status'<>'pending' then raise exception 'CAPTURE_SELECTION_PLAN_PROBE_V2_V1_PLAN_CHANGED'; end if;

  -- v2 valid: two custom halves, same ingredient in both, accepted as 'pending'.
  result := app_private.probe_capture_selection_plan_replace(actor,command,v2_plan);
  if result->>'status'<>'pending' then raise exception 'CAPTURE_SELECTION_PLAN_PROBE_V2_VALID_REJECTED'; end if;

  -- v2 plan without pizza lines is also accepted.
  result := app_private.probe_capture_selection_plan_replace(actor,command,
    pg_catalog.jsonb_set(v1_plan,'{schemaVersion}','2'::jsonb));
  if result->>'status'<>'pending' then raise exception 'CAPTURE_SELECTION_PLAN_PROBE_V2_PLAIN_REJECTED'; end if;

  -- Unknown plan schemaVersion fails closed.
  result := app_private.probe_capture_selection_plan_replace(actor,command,
    pg_catalog.jsonb_set(v2_plan,'{schemaVersion}','3'::jsonb));
  if result->>'status'<>'rejected' then raise exception 'CAPTURE_SELECTION_PLAN_PROBE_V2_VERSION_3_ACCEPTED'; end if;

  -- v1 plan carrying a pizza line is rejected (the write rejects it too).
  result := app_private.probe_capture_selection_plan_replace(actor,command,
    pg_catalog.jsonb_set(v2_plan,'{schemaVersion}','1'::jsonb));
  if result->>'status'<>'rejected' then raise exception 'CAPTURE_SELECTION_PLAN_PROBE_V2_V1_PIZZA_ACCEPTED'; end if;

  -- v2 invalid: legacy and unknown ruleVersion carry typed reasons.
  bad := pg_catalog.jsonb_set(v2_plan,'{lines,0,pizza,ruleVersion}','"pizza-halves-v1"'::jsonb);
  result := app_private.probe_capture_selection_plan_replace(actor,command,bad);
  if result->>'status'<>'rejected' or result->>'reason'<>'rule_version_legacy' then
    raise exception 'CAPTURE_SELECTION_PLAN_PROBE_V2_RULE_LEGACY_ACCEPTED';
  end if;
  bad := pg_catalog.jsonb_set(v2_plan,'{lines,0,pizza,ruleVersion}','"pizza-halves-v9"'::jsonb);
  result := app_private.probe_capture_selection_plan_replace(actor,command,bad);
  if result->>'status'<>'rejected' or result->>'reason'<>'rule_version_unknown' then
    raise exception 'CAPTURE_SELECTION_PLAN_PROBE_V2_RULE_UNKNOWN_ACCEPTED';
  end if;

  -- v2 invalid: exactly two halves.
  bad := pg_catalog.jsonb_set(v2_plan,'{lines,0,pizza,halves}',pg_catalog.jsonb_build_array(half_a));
  result := app_private.probe_capture_selection_plan_replace(actor,command,bad);
  if result->>'status'<>'rejected' then raise exception 'CAPTURE_SELECTION_PLAN_PROBE_V2_ONE_HALF_ACCEPTED'; end if;

  -- v2 invalid: both halves with the same fraction.
  bad := pg_catalog.jsonb_set(v2_plan,'{lines,0,pizza,halves}',
    pg_catalog.jsonb_build_array(half_a,pg_catalog.jsonb_set(half_b,'{fraction}','"half-a"'::jsonb)));
  result := app_private.probe_capture_selection_plan_replace(actor,command,bad);
  if result->>'status'<>'rejected' then raise exception 'CAPTURE_SELECTION_PLAN_PROBE_V2_SAME_FRACTION_ACCEPTED'; end if;

  -- v2 invalid: a non-uuid id inside a half.
  bad := pg_catalog.jsonb_set(v2_plan,'{lines,0,pizza,halves,1,ingredientOptionIds}','["not-a-uuid"]'::jsonb);
  result := app_private.probe_capture_selection_plan_replace(actor,command,bad);
  if result->>'status'<>'rejected' then raise exception 'CAPTURE_SELECTION_PLAN_PROBE_V2_BAD_ID_ACCEPTED'; end if;

  -- v2 invalid: the line must name half-a's product.
  bad := pg_catalog.jsonb_set(v2_plan,'{lines,0,productId}',pg_catalog.to_jsonb(product_b::text));
  result := app_private.probe_capture_selection_plan_replace(actor,command,bad);
  if result->>'status'<>'rejected' then raise exception 'CAPTURE_SELECTION_PLAN_PROBE_V2_LINE_PRODUCT_MISMATCH_ACCEPTED'; end if;

  -- v2 invalid: pizza together with the legacy fraction key (extra key) or an extra half key.
  bad := pg_catalog.jsonb_set(v2_plan,'{lines,0,fraction}','{"geometry":"halves","slots":[]}'::jsonb);
  result := app_private.probe_capture_selection_plan_replace(actor,command,bad);
  if result->>'status'<>'rejected' then raise exception 'CAPTURE_SELECTION_PLAN_PROBE_V2_PIZZA_AND_FRACTION_ACCEPTED'; end if;
  bad := pg_catalog.jsonb_set(v2_plan,'{lines,0,pizza,halves,0,price}','1'::jsonb);
  result := app_private.probe_capture_selection_plan_replace(actor,command,bad);
  if result->>'status'<>'rejected' then raise exception 'CAPTURE_SELECTION_PLAN_PROBE_V2_EXTRA_HALF_KEY_ACCEPTED'; end if;

  -- v2 invalid: a non-object line.
  bad := pg_catalog.jsonb_set(v2_plan,'{lines}','["x"]'::jsonb);
  result := app_private.probe_capture_selection_plan_replace(actor,command,bad);
  if result->>'status'<>'rejected' then raise exception 'CAPTURE_SELECTION_PLAN_PROBE_V2_NON_OBJECT_LINE_ACCEPTED'; end if;

  -- Tenant isolation: a scope the actor has no membership in is denied, never pending/replayed.
  other_command := pg_catalog.jsonb_set(command,'{scope}',pg_catalog.jsonb_build_object(
    'restaurantId',other_restaurant::text,'branchId',other_branch::text));
  result := app_private.probe_capture_selection_plan_replace(actor,other_command,v2_plan);
  if result->>'status'<>'denied' then raise exception 'CAPTURE_SELECTION_PLAN_PROBE_V2_FOREIGN_SCOPE_NOT_DENIED'; end if;

  execute 'reset role';
end
$capture_selection_plan_probe_v2_tests$;
commit;
