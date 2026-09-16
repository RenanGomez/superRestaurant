-- Test-only behavior checks, composed into the rollback verifier transaction.
begin;
do $directory_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant_a uuid := gen_random_uuid();
  restaurant_b uuid := gen_random_uuid();
  branch_a uuid := gen_random_uuid();
  branch_b uuid := gen_random_uuid();
  member_a uuid := gen_random_uuid();
  customer_a uuid := gen_random_uuid();
  customer_shared uuid := gen_random_uuid();
  customer_b uuid := gen_random_uuid();
  contact_a uuid := gen_random_uuid();
  contact_shared uuid := gen_random_uuid();
  address_a uuid := gen_random_uuid();
  party_snapshot uuid := gen_random_uuid();
  now_at timestamptz := date_trunc('milliseconds', clock_timestamp());
  actual_constraint text;
  writer_customer uuid := gen_random_uuid();
  writer_contact uuid := gen_random_uuid();
  writer_address uuid := gen_random_uuid();
  profile_command jsonb;
  profile_result jsonb;
  address_command jsonb;
  address_result jsonb;
  validate_command jsonb;
  validate_result jsonb;
  search_query jsonb;
  search_result jsonb;
  first_search_customer text;
begin
  if actor is null then raise exception 'CUSTOMER_DIRECTORY_TEST_ACTOR_REQUIRED'; end if;
  insert into app.restaurants (id, name, time_zone) values
    (restaurant_a, 'rollback-only directory A', 'America/Hermosillo'),
    (restaurant_b, 'rollback-only directory B', 'America/Hermosillo');
  insert into app.branches (id, restaurant_id, name) values
    (branch_a, restaurant_a, 'rollback-only directory A'),
    (branch_b, restaurant_b, 'rollback-only directory B');
  insert into app.memberships (id,user_id,restaurant_id,branch_id,granted_by)
    values (member_a,actor,restaurant_a,branch_a,actor);
  insert into app.membership_role_grants (membership_id,role_code,granted_by)
    values (member_a,'cashier',actor);
  insert into app.customers (id, restaurant_id, display_name, created_at, updated_at, created_by, updated_by) values
    (customer_a, restaurant_a, 'Ana', now_at, now_at, actor, actor),
    (customer_shared, restaurant_a, 'Casa compartida', now_at, now_at, actor, actor),
    (customer_b, restaurant_b, 'Otro tenant', now_at, now_at, actor, actor);

  -- Same normalized number is a candidate list, never an implicit merge or uniqueness conflict.
  insert into app.customer_phones (restaurant_id, customer_id, contact_id, label, display_value, normalized_value, created_at, updated_at) values
    (restaurant_a, customer_a, contact_a, 'Casa', '+52 (642) 123-4567', '+526421234567', now_at, now_at),
    (restaurant_a, customer_shared, contact_shared, 'Casa', '+52 642 123 4567', '+526421234567', now_at, now_at);
  if (select count(*) from app.customer_phones where restaurant_id = restaurant_a and normalized_value = '+526421234567') <> 2
  then raise exception 'CUSTOMER_SHARED_PHONE_REJECTED'; end if;

  begin
    insert into app.customer_phones (restaurant_id, customer_id, contact_id, label, display_value, normalized_value)
      values (restaurant_a, customer_b, gen_random_uuid(), 'Ajeno', '123', '123');
    raise exception 'CUSTOMER_PHONE_CROSS_TENANT_ACCEPTED';
  exception when foreign_key_violation then
    get stacked diagnostics actual_constraint = constraint_name;
    if actual_constraint <> 'customer_phones_customer_fk' then raise exception 'CUSTOMER_PHONE_WRONG_CONSTRAINT'; end if;
  end;

  insert into app.customer_addresses (
    id, restaurant_id, customer_id, label, street_line, locality, country_code,
    latitude_e6, longitude_e6, validation_branch_id, validation_event_id, validated_by,
    validation_device_id, validated_at, created_at, updated_at, created_by, updated_by
  ) values (
    address_a, restaurant_a, customer_a, 'Casa', 'Uno 10', 'Navojoa', 'MX',
    27000000, -109000000, branch_a, gen_random_uuid(), actor, gen_random_uuid(),
    now_at, now_at, now_at, actor, actor
  );
  begin
    update app.customer_addresses set validation_branch_id = branch_b
      where restaurant_id = restaurant_a and customer_id = customer_a and id = address_a;
    raise exception 'CUSTOMER_ADDRESS_CROSS_TENANT_BRANCH_ACCEPTED';
  exception when foreign_key_violation then
    get stacked diagnostics actual_constraint = constraint_name;
    if actual_constraint <> 'customer_addresses_validation_branch_fk' then raise exception 'CUSTOMER_ADDRESS_BRANCH_WRONG_CONSTRAINT'; end if;
  end;
  begin
    update app.customer_addresses set validated_by = null
      where restaurant_id = restaurant_a and customer_id = customer_a and id = address_a;
    raise exception 'CUSTOMER_ADDRESS_PARTIAL_VALIDATION_ACCEPTED';
  exception when check_violation then
    get stacked diagnostics actual_constraint = constraint_name;
    if actual_constraint <> 'customer_addresses_validation_valid' then raise exception 'CUSTOMER_ADDRESS_VALIDATION_WRONG_CONSTRAINT'; end if;
  end;
  begin
    update app.customer_addresses set latitude_e6 = 90000001
      where restaurant_id = restaurant_a and customer_id = customer_a and id = address_a;
    raise exception 'CUSTOMER_ADDRESS_INVALID_COORDINATES_ACCEPTED';
  exception when check_violation then
    get stacked diagnostics actual_constraint = constraint_name;
    if actual_constraint <> 'customer_addresses_coordinates_valid' then raise exception 'CUSTOMER_ADDRESS_COORDINATES_WRONG_CONSTRAINT'; end if;
  end;

  insert into app.customer_party_snapshots (
    id, restaurant_id, customer_id, contact_id, display_name, phone_display_value,
    phone_normalized_value, created_at, created_by
  ) values (party_snapshot, restaurant_a, customer_a, contact_a, 'Ana', '+52 (642) 123-4567', '+526421234567', now_at, actor);
  insert into app.customer_fulfillment_snapshots (
    id, restaurant_id, branch_id, customer_id, address_id, party_snapshot_id,
    label, street_line, locality, country_code, latitude_e6, longitude_e6,
    validation_event_id, validated_by, validation_device_id, validated_at, created_at, created_by
  ) select gen_random_uuid(), restaurant_id, validation_branch_id, customer_id, id, party_snapshot,
    label, street_line, locality, country_code, latitude_e6, longitude_e6,
    validation_event_id, validated_by, validation_device_id, validated_at, now_at, actor
    from app.customer_addresses where restaurant_id = restaurant_a and customer_id = customer_a and id = address_a;
  if (select count(*) from app.customer_fulfillment_snapshots where restaurant_id = restaurant_a and branch_id = branch_a) <> 1
  then raise exception 'CUSTOMER_FULFILLMENT_SNAPSHOT_REJECTED'; end if;

  begin
    insert into app.customer_fulfillment_snapshots (
      id, restaurant_id, branch_id, customer_id, address_id, party_snapshot_id,
      label, street_line, locality, country_code, validation_event_id, validated_by,
      validation_device_id, validated_at, created_at, created_by
    ) values (
      gen_random_uuid(), restaurant_a, branch_a, customer_shared, address_a, party_snapshot,
      'Casa', 'Uno 10', 'Navojoa', 'MX', gen_random_uuid(), actor,
      gen_random_uuid(), now_at, now_at, actor
    );
    raise exception 'CUSTOMER_FULFILLMENT_MIXED_CUSTOMER_ACCEPTED';
  exception when foreign_key_violation then
    get stacked diagnostics actual_constraint = constraint_name;
    if actual_constraint not in ('customer_fulfillment_snapshots_address_fk','customer_fulfillment_snapshots_party_fk')
    then raise exception 'CUSTOMER_FULFILLMENT_WRONG_CONSTRAINT'; end if;
  end;

  profile_command := pg_catalog.jsonb_build_object('schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
    'restaurantId',restaurant_a::text,'branchId',branch_a::text),'customerId',writer_customer::text,'expectedVersion',0,
    'eventId',gen_random_uuid()::text,'deviceId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'displayName','Writer fixture','phones',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'contactId',writer_contact::text,'label','Casa','displayValue','+52 (642) 123-4567')));
  profile_result := app_private.mutate_customer_directory(actor,'customer.profile_saved',profile_command);
  if profile_result ->> 'status' is distinct from 'applied'
    or profile_result #>> '{record,version}' is distinct from '1'
    or profile_result #>> '{record,phones,0,normalizedValue}' is distinct from '+526421234567'
  then raise exception 'CUSTOMER_PROFILE_CREATE_REJECTED'; end if;
  if app_private.mutate_customer_directory(actor,'customer.profile_saved',profile_command) is distinct from
    pg_catalog.jsonb_build_object('status','replayed','record',profile_result -> 'record')
  then raise exception 'CUSTOMER_PROFILE_REPLAY_REJECTED'; end if;
  if app_private.mutate_customer_directory(actor,'customer.profile_saved',profile_command || '{"displayName":"Divergent"}'::jsonb) ->> 'status' is distinct from 'conflict'
  then raise exception 'CUSTOMER_PROFILE_DIVERGENT_REPLAY_ACCEPTED'; end if;
  if app_private.mutate_customer_directory(actor,'customer.profile_saved',profile_command || pg_catalog.jsonb_build_object(
    'expectedVersion',1,'idempotencyKey',gen_random_uuid()::text)) ->> 'status' is distinct from 'conflict'
  then raise exception 'CUSTOMER_PROFILE_EVENT_COLLISION_ACCEPTED'; end if;
  if (select version from app.customers where restaurant_id=restaurant_a and id=writer_customer) <> 1
  then raise exception 'CUSTOMER_PROFILE_EVENT_COLLISION_CHANGED_STATE'; end if;
  profile_command := profile_command || pg_catalog.jsonb_build_object('expectedVersion',1,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'displayName','Writer edited','phones','[]'::jsonb);
  profile_result := app_private.mutate_customer_directory(actor,'customer.profile_saved',profile_command);
  if profile_result ->> 'status' is distinct from 'applied' or profile_result #>> '{record,version}' is distinct from '2'
    or pg_catalog.jsonb_array_length(profile_result #> '{record,phones}') <> 0
    or (select deleted_at is null from app.customer_phones where restaurant_id=restaurant_a and customer_id=writer_customer and contact_id=writer_contact)
  then raise exception 'CUSTOMER_PROFILE_UPDATE_REJECTED'; end if;

  address_command := pg_catalog.jsonb_build_object('schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
    'restaurantId',restaurant_a::text,'branchId',branch_a::text),'customerId',writer_customer::text,'addressId',writer_address::text,
    'expectedVersion',0,'eventId',gen_random_uuid()::text,'deviceId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'address',pg_catalog.jsonb_build_object(
      'label','Casa','streetLine','Uno 10','unit',null,'neighborhood',null,'locality','Navojoa','region','Sonora',
      'countryCode','MX','postalCode',null,'references',null,'instructions',null,
      'coordinates',pg_catalog.jsonb_build_object('latitudeE6',27000000,'longitudeE6',-109000000)));
  address_result := app_private.mutate_customer_directory(actor,'customer.address_saved',address_command);
  if address_result ->> 'status' is distinct from 'applied' or address_result #>> '{record,version}' is distinct from '1'
    or address_result #> '{record,validation}' is distinct from 'null'::jsonb
  then raise exception 'CUSTOMER_ADDRESS_CREATE_COMMAND_REJECTED'; end if;
  address_command := address_command || pg_catalog.jsonb_build_object('expectedVersion',1,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'address',(address_command -> 'address') || '{"label":"Casa editada"}'::jsonb);
  address_result := app_private.mutate_customer_directory(actor,'customer.address_saved',address_command);
  if address_result ->> 'status' is distinct from 'applied' or address_result #>> '{record,version}' is distinct from '2'
    or address_result #>> '{record,address,label}' is distinct from 'Casa editada'
  then raise exception 'CUSTOMER_ADDRESS_UPDATE_COMMAND_REJECTED'; end if;
  validate_command := (address_command - 'address') || pg_catalog.jsonb_build_object('expectedVersion',2,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text);
  validate_result := app_private.mutate_customer_directory(actor,'customer.address_validated',validate_command);
  if validate_result ->> 'status' is distinct from 'applied' or validate_result #>> '{record,version}' is distinct from '3'
    or validate_result #>> '{record,validation,branchId}' is distinct from branch_a::text
    or validate_result #>> '{record,validation,actorId}' is distinct from actor::text
    or validate_result #>> '{record,validation,eventId}' is distinct from validate_command ->> 'eventId'
    or validate_result #>> '{record,validation,deviceId}' is distinct from validate_command ->> 'deviceId'
  then raise exception 'CUSTOMER_ADDRESS_VALIDATE_COMMAND_REJECTED'; end if;
  if app_private.mutate_customer_directory(actor,'customer.address_validated',validate_command) is distinct from
    pg_catalog.jsonb_build_object('status','replayed','record',validate_result -> 'record')
  then raise exception 'CUSTOMER_ADDRESS_VALIDATE_REPLAY_REJECTED'; end if;
  search_query := pg_catalog.jsonb_build_object('schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
    'restaurantId',restaurant_a::text,'branchId',branch_a::text),'mode','phone','query','+52 (642) 123-4567',
    'limit',1,'cursor',null);
  search_result := app_private.search_customer_directory(actor,search_query);
  if search_result ->> 'status' is distinct from 'ok'
    or pg_catalog.jsonb_array_length(search_result #> '{result,candidates}') <> 1
    or search_result #> '{result,nextCursor}' is null or search_result #> '{result,nextCursor}' = 'null'::jsonb
    or search_result #>> '{result,candidates,0,phones,0,displayValue}' not in ('+52 (642) 123-4567','+52 642 123 4567')
  then raise exception 'CUSTOMER_SEARCH_FIRST_PAGE_REJECTED'; end if;
  first_search_customer := search_result #>> '{result,candidates,0,customerId}';
  search_query := pg_catalog.jsonb_set(search_query,'{cursor}',search_result #> '{result,nextCursor}');
  search_result := app_private.search_customer_directory(actor,search_query);
  if search_result ->> 'status' is distinct from 'ok'
    or pg_catalog.jsonb_array_length(search_result #> '{result,candidates}') <> 1
    or search_result #> '{result,nextCursor}' is distinct from 'null'::jsonb
    or search_result #>> '{result,candidates,0,customerId}' = first_search_customer
  then raise exception 'CUSTOMER_SEARCH_SECOND_PAGE_REJECTED'; end if;
  search_query := search_query || pg_catalog.jsonb_build_object('mode','name','query','Writer edited','limit',20,'cursor',null);
  search_result := app_private.search_customer_directory(actor,search_query);
  if search_result ->> 'status' is distinct from 'ok'
    or search_result #>> '{result,candidates,0,customerId}' is distinct from writer_customer::text
  then raise exception 'CUSTOMER_SEARCH_NAME_REJECTED'; end if;
  if app_private.search_customer_directory(actor,search_query || '{"actorId":"client"}'::jsonb) ->> 'status' is distinct from 'rejected'
  then raise exception 'CUSTOMER_SEARCH_AUTHORITY_FIELD_ACCEPTED'; end if;
  update app.membership_role_grants set revoked_at=pg_catalog.clock_timestamp(),revoked_by=actor,
    revocation_reason='rollback-only directory fixture revocation' where membership_id=member_a and role_code='cashier';
  if app_private.mutate_customer_directory(actor,'customer.address_validated',validate_command) ->> 'status' is distinct from 'denied'
  then raise exception 'CUSTOMER_DIRECTORY_REVOKED_REPLAY_ACCEPTED'; end if;
  if app_private.search_customer_directory(actor,search_query) ->> 'status' is distinct from 'denied'
  then raise exception 'CUSTOMER_SEARCH_REVOKED_ACCESS_ACCEPTED'; end if;
end
$directory_tests$;
commit;
