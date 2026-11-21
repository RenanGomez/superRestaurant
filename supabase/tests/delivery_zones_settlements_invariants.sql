-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises 20261121000100_delivery_zones_settlements.sql (Z2):
--   1. app.settlements: global (no restaurant_id), deterministic ids, normalization, unique
--      (postal_code, normalized_name, settlement_type), RLS+FORCE and zero grants.
--   2. Zone <-> settlement membership: one active zone per settlement, release/reassign on
--      deactivate, other tenant/branch reuse, out-of-scope city rejection, legacy CP conflict.
--   3. Addresses/snapshots: settlement must belong to the Branch catalog; outside-catalog needs
--      text and forbids settlement_id/postal_code; the writer fills derived fields server-side.
--   4. Manual fee: role matrix, resolved-and-not-covered requirement, reason/amount, CAS,
--      idempotent replay, same key with new payload, audit journal, revocation on channel change.
--   5. Confirmation: not_covered without authorization, stale authorization, effective-fee
--      mismatch, covered address with an unauthorized override.
--   6. Backfill: exact/accented/ambiguous/CP-mismatch/unknown, idempotent re-run, snapshots and
--      orders untouched.
begin;

create function pg_temp.expect(p_ok boolean, p_message text) returns void language plpgsql as $f$
begin
  if not p_ok then raise exception using errcode='55000', message=p_message; end if;
end $f$;

do $delivery_zones_settlements_tests$
declare
  manager_actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  supervisor_actor uuid := (select id from auth.users where deleted_at is null order by id offset 1 limit 1);
  cashier_actor uuid := (select id from auth.users where deleted_at is null order by id offset 2 limit 1);
  outsider_actor uuid := (select id from auth.users where deleted_at is null order by id offset 3 limit 1);
  restaurant uuid := gen_random_uuid();
  other_restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  manager_member uuid := gen_random_uuid();
  manager_other_member uuid := gen_random_uuid();
  supervisor_member uuid := gen_random_uuid();
  cashier_member uuid := gen_random_uuid();
  zone_a uuid := gen_random_uuid();
  zone_b uuid := gen_random_uuid();
  zone_c uuid := gen_random_uuid();
  zone_d uuid := gen_random_uuid();
  zone_other uuid := gen_random_uuid();
  now_at timestamptz := date_trunc('milliseconds', clock_timestamp());
  occurred_text text;
  scope jsonb;
  other_scope jsonb;
  command jsonb;
  result jsonb;
  s1 uuid;
  s2 uuid;
  s2_cp text;
  s2_name text;
  bf_accented uuid := gen_random_uuid();
  s_other_city uuid;
  s_amb_a uuid;
  s_amb_b uuid;
  v_cp text;
  customer uuid := gen_random_uuid();
  address_exact uuid := gen_random_uuid();
  address_outside uuid := gen_random_uuid();
  address_bad uuid := gen_random_uuid();
  address_id uuid := gen_random_uuid();
  bf_customer uuid := gen_random_uuid();
  bf_cp_mismatch uuid := gen_random_uuid();
  bf_unknown uuid := gen_random_uuid();
  bf_ambiguous uuid := gen_random_uuid();
  bf_exact uuid := gen_random_uuid();
  draft uuid := gen_random_uuid();
  draft_confirm uuid := gen_random_uuid();
  party uuid := gen_random_uuid();
  party_confirm uuid := gen_random_uuid();
  fulfillment uuid := gen_random_uuid();
  fulfillment_confirm uuid := gen_random_uuid();
  address_for_draft uuid := gen_random_uuid();
  address_for_confirm uuid := gen_random_uuid();
  lease uuid := gen_random_uuid();
  lease_confirm uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  quote_id text := gen_random_uuid()::text;
  order_id uuid := gen_random_uuid();
  shift_id uuid := gen_random_uuid();
  confirm_event uuid := gen_random_uuid();
  confirm_key uuid := gen_random_uuid();
  fee_command jsonb;
  fee_result jsonb;
  fee_event uuid;
  fee_key uuid;
  v_fee app.capture_delivery_manual_fees%rowtype;
  override jsonb;
  quote jsonb;
  confirm_command jsonb;
  confirm_order jsonb;
  confirm_audits jsonb;
  confirm_result jsonb;
  snapshot_count bigint;
  order_count bigint;
  v_resolved bigint;
begin
  if manager_actor is null or supervisor_actor is null or cashier_actor is null or outsider_actor is null
    or manager_actor in (supervisor_actor, cashier_actor, outsider_actor)
    or supervisor_actor in (cashier_actor, outsider_actor) or cashier_actor = outsider_actor
  then raise exception using errcode='55000', message='DELIVERY_ZONES_SETTLEMENTS_FOUR_ACTORS_REQUIRED'; end if;

  -- ---------------------------------------------------------------- catalog invariants
  perform pg_temp.expect((select count(*) from app.settlements)=568, 'SETTLEMENTS_SEED_COUNT');
  perform pg_temp.expect(not exists (
    select 1 from information_schema.columns
    where table_schema='app' and table_name='settlements' and column_name='restaurant_id'
  ), 'SETTLEMENTS_MUST_NOT_BE_TENANT_SCOPED');
  perform pg_temp.expect(exists (
    select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='app' and c.relname='settlements' and c.relrowsecurity and c.relforcerowsecurity
  ), 'SETTLEMENTS_RLS_FORCED');
  perform pg_temp.expect(not pg_catalog.has_table_privilege('app_api','app.settlements','SELECT,INSERT,UPDATE,DELETE')
    and not pg_catalog.has_table_privilege('anon','app.settlements','SELECT,INSERT,UPDATE,DELETE')
    and not pg_catalog.has_table_privilege('authenticated','app.settlements','SELECT,INSERT,UPDATE,DELETE')
    and not pg_catalog.has_table_privilege('service_role','app.settlements','SELECT,INSERT,UPDATE,DELETE'),
    'SETTLEMENTS_DIRECT_GRANTS_FORBIDDEN');
  perform pg_temp.expect(not exists (
    select 1 from app.settlements s where s.normalized_name <> app_private.normalize_settlement_name(s.name)
  ), 'SETTLEMENTS_NORMALIZATION_DRIFT');
  perform pg_temp.expect(not exists (
    select 1 from app.settlements where postal_code !~ '^[0-9]{5}$'
  ), 'SETTLEMENTS_POSTAL_CODE_INVALID');
  perform pg_temp.expect(not exists (
    select 1 from app.settlements
    group by postal_code, normalized_name, settlement_type having count(*)>1
  ), 'SETTLEMENTS_UNIQUENESS');
  perform pg_temp.expect((
    select app_private.settlement_id(s.postal_code,s.normalized_name,s.settlement_type)
    from app.settlements s order by s.postal_code,s.normalized_name,s.settlement_type limit 1
  ) = (select id from app.settlements order by postal_code,normalized_name,settlement_type limit 1),
    'SETTLEMENT_ID_NOT_DETERMINISTIC');

  select id into s1 from app.settlements order by postal_code, normalized_name, settlement_type limit 1;
  select id into s2 from app.settlements order by postal_code desc, normalized_name desc, settlement_type desc limit 1;
  select postal_code, name into v_cp, s2_name from app.settlements where id=s2;
  s2_cp := v_cp;

  insert into app.settlements (id,postal_code,name,normalized_name,settlement_type,municipality,state,country_code,catalog_version)
  values
    (app_private.settlement_id('99999','colonia ajena','Colonia'),'99999','Colonia Ajena',
      app_private.normalize_settlement_name('Colonia Ajena'),'Colonia','Hermosillo','Sonora','MX','test-z2'),
    (app_private.settlement_id('85300','colonia ambigua','Colonia'),'85300','Colonia Ambigua',
      app_private.normalize_settlement_name('Colonia Ambigua'),'Colonia','Navojoa','Sonora','MX','test-z2'),
    (app_private.settlement_id('85301','colonia ambigua','Colonia'),'85301','Colonia Ambigua',
      app_private.normalize_settlement_name('Colonia Ambigua'),'Colonia','Navojoa','Sonora','MX','test-z2');
  select id into s_other_city from app.settlements where postal_code='99999';
  select id into s_amb_a from app.settlements where postal_code='85300';
  select id into s_amb_b from app.settlements where postal_code='85301';

  -- ---------------------------------------------------------------- tenants and roles
  insert into app.restaurants (id,name,time_zone) values
    (restaurant,'rollback-only z2 settlements','America/Hermosillo'),
    (other_restaurant,'rollback-only z2 settlements other','America/Hermosillo');
  insert into app.branches (id,restaurant_id,name) values
    (branch,restaurant,'rollback-only z2 branch'),
    (other_branch,other_restaurant,'rollback-only z2 other branch');
  insert into app.memberships (id,user_id,restaurant_id,branch_id,granted_by) values
    (manager_member,manager_actor,restaurant,branch,manager_actor),
    (manager_other_member,manager_actor,other_restaurant,other_branch,manager_actor),
    (supervisor_member,supervisor_actor,restaurant,branch,manager_actor),
    (cashier_member,cashier_actor,restaurant,branch,manager_actor);
  insert into app.membership_role_grants (membership_id,role_code,granted_by) values
    (manager_member,'manager',manager_actor),
    (manager_other_member,'manager',manager_actor),
    (supervisor_member,'supervisor',manager_actor),
    (cashier_member,'cashier',manager_actor);

  occurred_text := to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  scope := jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text);
  other_scope := jsonb_build_object('restaurantId',other_restaurant::text,'branchId',other_branch::text);

  -- ---------------------------------------------------------------- search (catalog scope)
  execute 'set local role app_api';
  result := app_private.search_settlements(manager_actor, jsonb_build_object(
    'schemaVersion',1,'scope',scope,'query','benito','postalCode',null,'limit',20));
  perform pg_temp.expect(result->>'status' is null and jsonb_array_length(result->'settlements')>0,
    'SEARCH_PREFIX_FOUND_NOTHING');
  perform pg_temp.expect((result->'settlements'->0->>'postalCode') ~ '^[0-9]{5}$',
    'SEARCH_MISSING_POSTAL_CODE');
  result := app_private.search_settlements(manager_actor, jsonb_build_object(
    'schemaVersion',1,'scope',scope,'query',null,'postalCode',v_cp,'limit',50));
  perform pg_temp.expect(jsonb_array_length(result->'settlements')>0,'SEARCH_POSTAL_CODE_FOUND_NOTHING');
  perform pg_temp.expect(app_private.search_settlements(outsider_actor, jsonb_build_object(
    'schemaVersion',1,'scope',scope,'query','benito','postalCode',null,'limit',20))->>'status'='denied',
    'SEARCH_OUTSIDER_ACCEPTED');
  reset role;

  -- ---------------------------------------------------------------- zone membership
  command := jsonb_build_object(
    'schemaVersion',1,'scope',scope,'zoneId',zone_a::text,'expectedVersion',0,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'deviceId',gen_random_uuid()::text,'occurredAt',occurred_text,
    'name','Centro Z2','postalCodes','[]'::jsonb,'localities','[]'::jsonb,
    'settlementIds',to_jsonb(array[s1]::uuid[]),'feeMinor',2500,'currency','MXN','active',true,'reason',null);
  execute 'set local role app_api';
  result := app_private.upsert_delivery_zone(manager_actor, command);
  perform pg_temp.expect(result->>'status' is null and result->'zone'->'settlementIds' @> to_jsonb(array[s1::text]),
    'ZONE_CREATE_WITH_SETTLEMENT_REJECTED');

  -- Same settlement in a second active zone of the same Branch: unique conflict.
  result := app_private.upsert_delivery_zone(manager_actor, command || jsonb_build_object(
    'zoneId',zone_b::text,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text));
  perform pg_temp.expect(result->>'status'='conflict','ZONE_DUPLICATE_SETTLEMENT_ACCEPTED');

  -- Deactivating releases the settlement; another zone can then claim it.
  result := app_private.upsert_delivery_zone(manager_actor, command || jsonb_build_object(
    'expectedVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'active',false,'reason','release for reassignment'));
  perform pg_temp.expect(result->>'status' is null,'ZONE_DEACTIVATE_REJECTED');
  execute 'reset role';
  perform pg_temp.expect(not exists (select 1 from app.delivery_zone_settlements where zone_id=zone_a),
    'ZONE_DEACTIVATE_KEPT_SETTLEMENT');
  execute 'set local role app_api';
  result := app_private.upsert_delivery_zone(manager_actor, command || jsonb_build_object(
    'zoneId',zone_b::text,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text));
  perform pg_temp.expect(result->>'status' is null,'ZONE_REASSIGN_AFTER_RELEASE_REJECTED');

  -- Another tenant may claim the same global settlement.
  result := app_private.upsert_delivery_zone(manager_actor, command || jsonb_build_object(
    'scope',other_scope,'zoneId',zone_other::text,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text));
  perform pg_temp.expect(result->>'status' is null,'ZONE_OTHER_TENANT_SETTLEMENT_REJECTED');

  -- A settlement outside the Branch catalog (city/state) is rejected.
  result := app_private.upsert_delivery_zone(manager_actor, command || jsonb_build_object(
    'zoneId',gen_random_uuid()::text,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'settlementIds',to_jsonb(array[s_other_city]::uuid[])));
  perform pg_temp.expect(result->>'status'='rejected','ZONE_FOREIGN_CITY_SETTLEMENT_ACCEPTED');

  -- Legacy postal-code coverage keeps its own uniqueness.
  result := app_private.upsert_delivery_zone(manager_actor, command || jsonb_build_object(
    'zoneId',zone_c::text,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'settlementIds','[]'::jsonb,'postalCodes',to_jsonb(array[v_cp]),'reason',null));
  perform pg_temp.expect(result->>'status' is null,'ZONE_POSTAL_CODE_CREATE_REJECTED');
  result := app_private.upsert_delivery_zone(manager_actor, command || jsonb_build_object(
    'zoneId',zone_d::text,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'settlementIds','[]'::jsonb,'postalCodes',to_jsonb(array[v_cp]),'reason',null));
  perform pg_temp.expect(result->>'status'='conflict','ZONE_DUPLICATE_POSTAL_CODE_ACCEPTED');
  reset role;

  -- ---------------------------------------------------------------- addresses
  insert into app.customers (id,restaurant_id,display_name,created_by,updated_by)
  values (customer,restaurant,'Cliente Z2',manager_actor,manager_actor);

  -- The catalog writer fills neighborhood/postal code/city/state/country from the settlement.
  result := app_private.mutate_customer_directory(manager_actor,'customer.address_saved',jsonb_build_object(
    'schemaVersion',1,'scope',scope,'customerId',customer::text,'expectedVersion',0,
    'eventId',gen_random_uuid()::text,'deviceId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'occurredAt',occurred_text,'addressId',address_id::text,
    'address',jsonb_build_object('label','Casa','streetLine','Calle 1','unit',null,'neighborhood',null,
      'locality',null,'region',null,'countryCode',null,'postalCode',null,'references',null,
      'instructions',null,'coordinates',null,'settlementId',s1::text,'settlementOutsideCatalog',false)));
  perform pg_temp.expect(result->>'status'='applied','ADDRESS_SETTLEMENT_SAVE_REJECTED');
  perform pg_temp.expect(exists (
    select 1 from app.customer_addresses a join app.settlements s on s.id=a.settlement_id
    where a.restaurant_id=restaurant and a.customer_id=customer and a.id=address_id
      and a.neighborhood=s.name and a.postal_code=s.postal_code and a.locality=s.municipality
      and a.region=s.state and a.country_code=s.country_code and not a.settlement_outside_catalog
  ),'ADDRESS_SETTLEMENT_NOT_FILLED');
  -- A client-supplied postal code that contradicts the catalog is rejected.
  result := app_private.mutate_customer_directory(manager_actor,'customer.address_saved',jsonb_build_object(
    'schemaVersion',1,'scope',scope,'customerId',customer::text,'expectedVersion',0,
    'eventId',gen_random_uuid()::text,'deviceId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'occurredAt',occurred_text,'addressId',address_bad::text,
    'address',jsonb_build_object('label','Mala','streetLine','Calle 2','unit',null,'neighborhood',null,
      'locality',null,'region',null,'countryCode',null,'postalCode','00000','references',null,
      'instructions',null,'coordinates',null,'settlementId',s1::text,'settlementOutsideCatalog',false)));
  perform pg_temp.expect(result->>'status'='rejected','ADDRESS_FORGED_POSTAL_CODE_ACCEPTED');
  -- Outside-catalog: text is required, the postal code is not invented, and the Branch fills the city.
  result := app_private.mutate_customer_directory(manager_actor,'customer.address_saved',jsonb_build_object(
    'schemaVersion',1,'scope',scope,'customerId',customer::text,'expectedVersion',0,
    'eventId',gen_random_uuid()::text,'deviceId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'occurredAt',occurred_text,'addressId',address_outside::text,
    'address',jsonb_build_object('label','Fuera','streetLine','Calle 3','unit',null,'neighborhood','Colonia Fuera',
      'locality',null,'region',null,'countryCode',null,'postalCode',null,'references',null,
      'instructions',null,'coordinates',null,'settlementId',null,'settlementOutsideCatalog',true)));
  perform pg_temp.expect(result->>'status'='applied','ADDRESS_OUTSIDE_SAVE_REJECTED');
  perform pg_temp.expect(exists (
    select 1 from app.customer_addresses a join app.branches b on b.id=branch and b.restaurant_id=restaurant
    where a.restaurant_id=restaurant and a.customer_id=customer and a.id=address_outside
      and a.settlement_id is null and a.settlement_outside_catalog and a.neighborhood='Colonia Fuera'
      and a.postal_code is null and a.locality=b.locality and a.region=b.region and a.country_code=b.country_code
  ),'ADDRESS_OUTSIDE_NOT_FILLED');
  -- CHECK constraints close the direct-write hole too.
  begin
    insert into app.customer_addresses (id,restaurant_id,customer_id,label,neighborhood,postal_code,
      settlement_id,settlement_outside_catalog,created_by,updated_by)
    values (gen_random_uuid(),restaurant,customer,'Inválida','Colonia',null,s1,true,manager_actor,manager_actor);
    raise exception using errcode='55000', message='ADDRESS_OUTSIDE_WITH_SETTLEMENT_ACCEPTED';
  exception when check_violation then null;
  end;
  begin
    insert into app.customer_addresses (id,restaurant_id,customer_id,label,neighborhood,postal_code,
      settlement_id,settlement_outside_catalog,created_by,updated_by)
    values (gen_random_uuid(),restaurant,customer,'Inválida 2',null,null,null,true,manager_actor,manager_actor);
    raise exception using errcode='55000', message='ADDRESS_OUTSIDE_WITHOUT_TEXT_ACCEPTED';
  exception when check_violation then null;
  end;
  begin
    insert into app.customer_addresses (id,restaurant_id,customer_id,label,neighborhood,postal_code,
      settlement_id,settlement_outside_catalog,created_by,updated_by)
    values (gen_random_uuid(),restaurant,customer,'Inválida 3','Equivocada','00000',s1,false,manager_actor,manager_actor);
    raise exception using errcode='55000', message='ADDRESS_POSTAL_CODE_MISMATCH_ACCEPTED';
  exception when check_violation then null;
  end;

  -- ---------------------------------------------------------------- manual fee fixtures
  insert into app.customer_party_snapshots (id,restaurant_id,customer_id,contact_id,display_name,
    phone_display_value,phone_normalized_value,created_at,created_by)
  values (party,restaurant,customer,gen_random_uuid(),'Cliente Z2','6441234567','6441234567',now_at,manager_actor),
         (party_confirm,restaurant,customer,gen_random_uuid(),'Cliente Z2','6441234567','6441234567',now_at,manager_actor);
  insert into app.customer_addresses (id,restaurant_id,customer_id,label,street_line,neighborhood,
    locality,region,country_code,postal_code,settlement_id,version,created_at,updated_at,created_by,updated_by)
  values (address_for_draft,restaurant,customer,'Casa','Calle 9',s2_name,'Navojoa','Sonora','MX',s2_cp,s2,1,now_at,now_at,manager_actor,manager_actor),
         (address_for_confirm,restaurant,customer,'Confirm','Calle 10',s2_name,'Navojoa','Sonora','MX',s2_cp,s2,1,now_at,now_at,manager_actor,manager_actor);
  insert into app.customer_fulfillment_snapshots (id,restaurant_id,branch_id,customer_id,address_id,party_snapshot_id,
    label,street_line,neighborhood,locality,region,country_code,postal_code,settlement_id,settlement_outside_catalog,
    validation_event_id,validated_by,validation_device_id,validated_at,created_at,created_by)
  values (fulfillment,restaurant,branch,customer,address_for_draft,party,'Casa','Calle 9',s2_name,'Navojoa','Sonora','MX',s2_cp,s2,false,
      gen_random_uuid(),manager_actor,device,now_at,now_at,manager_actor),
         (fulfillment_confirm,restaurant,branch,customer,address_for_confirm,party_confirm,'Confirm','Calle 10',s2_name,'Navojoa','Sonora','MX',s2_cp,s2,false,
      gen_random_uuid(),manager_actor,device,now_at,now_at,manager_actor);
  insert into app.capture_drafts (id,restaurant_id,branch_id,folio,source_channel,fulfillment_channel,status,
    attention_status,owner_membership_id,attention_lease_id,attention_lease_expires_at,recovery_expires_at,
    customer_id,customer_snapshot_id,fulfillment_snapshot_id,version,created_at,created_by,updated_at,updated_by)
  values (draft,restaurant,branch,'Z2-1','phone','delivery','draft','claimed',manager_member,lease,now_at+interval '30 minutes',
      now_at+interval '1 day',customer,party,fulfillment,1,now_at,manager_actor,now_at,manager_actor),
         (draft_confirm,restaurant,branch,'Z2-2','phone','delivery','draft','claimed',manager_member,lease_confirm,now_at+interval '30 minutes',
      now_at+interval '1 day',customer,party_confirm,fulfillment_confirm,1,now_at,manager_actor,now_at,manager_actor);

  fee_event := gen_random_uuid();
  fee_key := gen_random_uuid();
  fee_command := jsonb_build_object('schemaVersion',1,'scope',scope,'captureDraftId',draft::text,
    'addressSnapshotRef',fulfillment::text,'expectedVersion',0,'feeMinor',2500,'currency','MXN',
    'reason','Fuera de zona autorizada','eventId',fee_event::text,'idempotencyKey',fee_key::text,
    'deviceId',gen_random_uuid()::text,'occurredAt',occurred_text);

  execute 'set local role app_api';
  perform pg_temp.expect(app_private.set_capture_delivery_manual_fee(cashier_actor,fee_command)->>'status'='denied',
    'MANUAL_FEE_CASHIER_ACCEPTED');
  perform pg_temp.expect(app_private.set_capture_delivery_manual_fee(outsider_actor,fee_command)->>'status'='denied',
    'MANUAL_FEE_OUTSIDER_ACCEPTED');
  fee_result := app_private.set_capture_delivery_manual_fee(supervisor_actor,fee_command);
  perform pg_temp.expect(fee_result->>'status'='applied','MANUAL_FEE_SUPERVISOR_REJECTED');
  perform pg_temp.expect((fee_result#>>'{manualFee,version}')::bigint=1 and (fee_result#>>'{manualFee,feeMinor}')::bigint=2500,
    'MANUAL_FEE_RESULT_SHAPE');
  perform pg_temp.expect(app_private.set_capture_delivery_manual_fee(supervisor_actor,fee_command)->>'replayed'='true',
    'MANUAL_FEE_REPLAY_NOT_REPLAYED');
  perform pg_temp.expect(app_private.set_capture_delivery_manual_fee(supervisor_actor,fee_command||jsonb_build_object('feeMinor',3000))->>'status'='conflict',
    'MANUAL_FEE_SAME_KEY_NEW_PAYLOAD_ACCEPTED');
  fee_result := app_private.set_capture_delivery_manual_fee(supervisor_actor,fee_command||jsonb_build_object(
    'expectedVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'feeMinor',3000));
  perform pg_temp.expect((fee_result#>>'{manualFee,version}')::bigint=2,'MANUAL_FEE_UPDATE_REJECTED');
  reset role;
  perform pg_temp.expect((select count(*) from app.capture_delivery_manual_fee_events where capture_draft_id=draft and operation in ('manual_fee.authorized','manual_fee.updated'))=2,
    'MANUAL_FEE_JOURNAL_INCOMPLETE');
  perform pg_temp.expect(not pg_catalog.has_table_privilege('app_api','app.capture_delivery_manual_fee_events','SELECT,INSERT,UPDATE,DELETE'),
    'MANUAL_FEE_JOURNAL_DIRECT_GRANT');

  -- Changing the channel revokes the current authorization and journals the revocation.
  update app.capture_drafts set fulfillment_channel='pickup',updated_at=now_at,updated_by=manager_actor
  where restaurant_id=restaurant and branch_id=branch and id=draft;
  perform pg_temp.expect(not exists (select 1 from app.capture_delivery_manual_fees where capture_draft_id=draft),
    'MANUAL_FEE_NOT_REVOKED');
  perform pg_temp.expect(exists (select 1 from app.capture_delivery_manual_fee_events where capture_draft_id=draft and operation='manual_fee.revoked'),
    'MANUAL_FEE_REVOCATION_NOT_JOURNALED');

  -- ---------------------------------------------------------------- confirmation
  -- A not-covered quote without an authorization can never confirm.
  quote := jsonb_build_object('schemaVersion',1,'quoteId',quote_id,'restaurantId',restaurant::text,
    'branchId',branch::text,'captureDraftId',draft_confirm::text,'addressSnapshotRef',fulfillment_confirm::text,
    'address',jsonb_build_object('settlementId',s2::text,'neighborhood',s2_name,'postalCode',s2_cp),
    'currency','MXN','timeZone','America/Hermosillo','quotedAt',occurred_text,'scheduledFor',null,
    'version',1,'coverageStatus','not_covered','zoneId',null,'feeMinor',0,
    'promiseStart',occurred_text,'promiseEnd',to_char((now_at+interval '45 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt',to_char((now_at+interval '10 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'override',null);
  insert into app.capture_delivery_quotes (restaurant_id,branch_id,capture_draft_id,quote,applied_capture_version,
    idempotency_key,command_fingerprint,actor_id,actor_membership_id,device_id,occurred_at,received_at)
  values (restaurant,branch,draft_confirm,quote,1,gen_random_uuid()::text,repeat('a',64),supervisor_actor,
    supervisor_member,device,now_at,now_at);
  confirm_command := jsonb_build_object('schemaVersion',2,'scope',scope,'captureDraftId',draft_confirm::text,
    'expectedVersion',1,'eventId',confirm_event::text,'idempotencyKey',confirm_key::text,'deviceId',device::text,
    'occurredAt',occurred_text,'attentionLeaseId',lease_confirm::text,'orderId',order_id::text,
    'shiftId',shift_id::text,'tableId',null,'currency','MXN','timeZone','America/Hermosillo');
  confirm_order := jsonb_build_object('schemaVersion',1,'orderId',order_id::text,'restaurantId',restaurant::text,
    'branchId',branch::text,'channel','delivery','currency','MXN','timeZone','America/Hermosillo','status','draft',
    'items','[]'::jsonb,'deliveryCharge',jsonb_build_object('amount',jsonb_build_object('amountMinor',0,'currency','MXN'),'quoteId',quote_id));
  confirm_audits := jsonb_build_array(jsonb_build_object('operation','order.created'));
  confirm_result := app_private.confirm_capture_draft_v3(manager_actor,confirm_command,confirm_order,confirm_audits);
  perform pg_temp.expect(confirm_result->>'status'='conflict' and confirm_result->>'reason'='delivery_quote_not_covered',
    'CONFIRM_NOT_COVERED_WITHOUT_AUTHORIZATION_ACCEPTED');

  -- Authorize the manual fee, then prove stale authorization, amount mismatch and the accepted path
  -- (the accepted path stops at the missing operational shift, after the delivery validations).
  fee_result := app_private.set_capture_delivery_manual_fee(supervisor_actor,jsonb_build_object(
    'schemaVersion',1,'scope',scope,'captureDraftId',draft_confirm::text,'addressSnapshotRef',fulfillment_confirm::text,
    'expectedVersion',0,'feeMinor',3200,'currency','MXN','reason','Colonia fuera de catalogo',
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'deviceId',gen_random_uuid()::text,'occurredAt',occurred_text));
  perform pg_temp.expect(fee_result->>'status'='applied','CONFIRM_MANUAL_FEE_SETUP_REJECTED');
  select * into v_fee from app.capture_delivery_manual_fees
  where restaurant_id=restaurant and branch_id=branch and capture_draft_id=draft_confirm;
  override := jsonb_build_object('kind','manual_fee','eventId',v_fee.authorization_event_id::text,
    'actorId',v_fee.actor_id::text,'role',v_fee.role_code,'reason',v_fee.reason,'feeMinor',v_fee.fee_minor,
    'promiseStart',occurred_text,'promiseEnd',to_char((now_at+interval '45 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'overriddenAt',to_char(v_fee.authorized_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

  -- Authorizing the fee cleared the draft quote; freeze a new one carrying the live override.
  quote := quote || jsonb_build_object('override',override);
  insert into app.capture_delivery_quotes (restaurant_id,branch_id,capture_draft_id,quote,applied_capture_version,
    idempotency_key,command_fingerprint,actor_id,actor_membership_id,device_id,occurred_at,received_at)
  values (restaurant,branch,draft_confirm,quote,1,gen_random_uuid()::text,repeat('b',64),supervisor_actor,
    supervisor_member,device,now_at,now_at);

  -- Stale override (fee no longer matches the live authorization).
  update app.capture_delivery_quotes q set quote=q.quote||jsonb_build_object('override',override||jsonb_build_object('feeMinor',9999))
  where restaurant_id=restaurant and branch_id=branch and capture_draft_id=draft_confirm;
  confirm_result := app_private.confirm_capture_draft_v3(manager_actor,confirm_command,confirm_order,confirm_audits);
  perform pg_temp.expect(confirm_result->>'reason'='delivery_manual_fee_stale','CONFIRM_STALE_AUTHORIZATION_ACCEPTED');

  -- Frozen charge must equal the effective fee, not the base zone fee.
  update app.capture_delivery_quotes q set quote=q.quote||jsonb_build_object('override',override)
  where restaurant_id=restaurant and branch_id=branch and capture_draft_id=draft_confirm;
  confirm_result := app_private.confirm_capture_draft_v3(manager_actor,confirm_command,confirm_order,confirm_audits);
  perform pg_temp.expect(confirm_result->>'reason'='delivery_charge_mismatch','CONFIRM_WRONG_EFFECTIVE_FEE_ACCEPTED');

  update app.capture_delivery_quotes q set quote=q.quote||jsonb_build_object('override',override)
  where restaurant_id=restaurant and branch_id=branch and capture_draft_id=draft_confirm;
  confirm_order := jsonb_build_object('schemaVersion',1,'orderId',order_id::text,'restaurantId',restaurant::text,
    'branchId',branch::text,'channel','delivery','currency','MXN','timeZone','America/Hermosillo','status','draft',
    'items','[]'::jsonb,'deliveryCharge',jsonb_build_object(
      'amount',jsonb_build_object('amountMinor',v_fee.fee_minor,'currency','MXN'),'quoteId',quote_id));
  confirm_result := app_private.confirm_capture_draft_v3(manager_actor,confirm_command,confirm_order,confirm_audits);
  perform pg_temp.expect(confirm_result->>'reason'='delivery_manual_fee_stale','CONFIRM_MISSING_MANUAL_FEE_SNAPSHOT_ACCEPTED');

  -- A covered address with an override is not a manual-fee case.
  update app.capture_delivery_quotes q set quote=jsonb_set(jsonb_set(jsonb_set(q.quote,
    '{coverageStatus}',to_jsonb('covered'::text)),'{zoneId}',to_jsonb(zone_b::text)),'{feeMinor}',to_jsonb(500))
  where restaurant_id=restaurant and branch_id=branch and capture_draft_id=draft_confirm;
  confirm_result := app_private.confirm_capture_draft_v3(manager_actor,confirm_command,confirm_order,confirm_audits);
  perform pg_temp.expect(confirm_result->>'reason'='delivery_quote_override_not_authorized',
    'CONFIRM_COVERED_OVERRIDE_ACCEPTED');

  -- ---------------------------------------------------------------- isolation
  execute 'set local role app_api';
  perform pg_temp.expect(app_private.upsert_delivery_zone(outsider_actor,command||jsonb_build_object(
    'zoneId',gen_random_uuid()::text,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text))->>'status'='denied','ZONE_FOREIGN_ACTOR_ACCEPTED');
  perform pg_temp.expect(app_private.read_capture_delivery_manual_fee(outsider_actor,jsonb_build_object(
    'schemaVersion',1,'scope',scope,'captureDraftId',draft_confirm::text,
    'addressSnapshotRef',fulfillment_confirm::text))->>'status'='denied','MANUAL_FEE_FOREIGN_READ_ACCEPTED');
  reset role;

  -- ---------------------------------------------------------------- backfill
  insert into app.customers (id,restaurant_id,display_name,created_by,updated_by)
  values (bf_customer,restaurant,'Cliente backfill Z2',manager_actor,manager_actor);
  insert into app.customer_addresses (id,restaurant_id,customer_id,label,neighborhood,postal_code,
    version,created_at,updated_at,created_by,updated_by)
  values
    (bf_exact,restaurant,bf_customer,'Exacta',(select name from app.settlements where id=s1),null,1,now_at,now_at,manager_actor,manager_actor),
    (bf_cp_mismatch,restaurant,bf_customer,'CP distinto',(select name from app.settlements where id=s1),'00000',1,now_at,now_at,manager_actor,manager_actor),
    (bf_unknown,restaurant,bf_customer,'Desconocida','Colonia Inexistente Z2',null,1,now_at,now_at,manager_actor,manager_actor),
    (bf_ambiguous,restaurant,bf_customer,'Ambigua','Colonia Ambigua',null,1,now_at,now_at,manager_actor,manager_actor),
    (bf_accented,restaurant,bf_customer,'Acentuada',upper((select name from app.settlements where id=s1)),null,1,now_at,now_at,manager_actor,manager_actor);
  select count(*) into snapshot_count from app.order_fulfillment_snapshots;
  select count(*) into order_count from app.orders;

  result := app_private.backfill_customer_address_settlements();
  v_resolved := (result->>'resolved')::bigint;
  perform pg_temp.expect(v_resolved>=2,'BACKFILL_DID_NOT_RESOLVE_EXACT');
  perform pg_temp.expect((result->>'ambiguous')::bigint>=1,'BACKFILL_DID_NOT_REPORT_AMBIGUOUS');
  perform pg_temp.expect((result->>'unknown')::bigint>=1,'BACKFILL_DID_NOT_REPORT_UNKNOWN');
  perform pg_temp.expect((result->>'postalCodeMismatch')::bigint>=1,'BACKFILL_DID_NOT_REPORT_POSTAL_MISMATCH');
  perform pg_temp.expect((select settlement_id from app.customer_addresses where id=bf_exact)=s1,
    'BACKFILL_EXACT_NOT_LINKED');
  perform pg_temp.expect((select settlement_id from app.customer_addresses where id=bf_accented)=s1,
    'BACKFILL_ACCENTED_NOT_LINKED');
  perform pg_temp.expect((select settlement_id from app.customer_addresses where id=bf_ambiguous) is null,
    'BACKFILL_AMBIGUOUS_LINKED');
  perform pg_temp.expect((select settlement_id from app.customer_addresses where id=bf_unknown) is null,
    'BACKFILL_UNKNOWN_LINKED');
  perform pg_temp.expect((select settlement_id from app.customer_addresses where id=bf_cp_mismatch) is null,
    'BACKFILL_POSTAL_MISMATCH_LINKED');
  perform pg_temp.expect((app_private.backfill_customer_address_settlements()->>'resolved')::bigint=0,
    'BACKFILL_NOT_IDEMPOTENT');
  perform pg_temp.expect((select count(*) from app.order_fulfillment_snapshots)=snapshot_count
    and (select count(*) from app.orders)=order_count,'BACKFILL_TOUCHED_ORDERS_OR_SNAPSHOTS');
end
$delivery_zones_settlements_tests$;

commit;
