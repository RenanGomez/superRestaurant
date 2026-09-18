begin;

alter table app.customer_fulfillment_snapshots add constraint customer_fulfillment_capture_scope_unique
  unique (restaurant_id,branch_id,customer_id,party_snapshot_id,id);
alter table app.capture_drafts add column fulfillment_snapshot_id uuid;
alter table app.capture_drafts add constraint capture_fulfillment_snapshot_scope_fk
  foreign key (restaurant_id,branch_id,customer_id,customer_snapshot_id,fulfillment_snapshot_id)
  references app.customer_fulfillment_snapshots (restaurant_id,branch_id,customer_id,party_snapshot_id,id) on delete restrict;
alter table app.capture_drafts add constraint capture_fulfillment_snapshot_pair_valid check (
  fulfillment_snapshot_id is null or (customer_id is not null and customer_snapshot_id is not null));

alter table app.capture_command_events drop constraint capture_events_operation_valid;
alter table app.capture_command_events add constraint capture_events_operation_valid check (operation in (
  'capture.created','capture.autosaved','capture.held','capture.claimed','capture.resumed','capture.transferred',
  'capture.confirmed','capture.no_sale','capture.recovery_preference_changed','capture.taken_over',
  'capture.customer_changed','capture.fulfillment_changed'));

-- Replacing/removing the party invalidates fulfillment in the same atomic write.
create or replace function app_private.set_capture_customer(p_actor_id uuid,p_command jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  restaurant uuid;branch uuid;capture uuid;event uuid;device uuid;member uuid;requested_lease uuid;
  customer uuid;contact uuid;snapshot uuid;expected bigint;customer_version bigint;occurred timestamptz;observed timestamptz;
  fingerprint text;result_record jsonb;field_name text;current_capture app.capture_drafts%rowtype;
  current_customer app.customers%rowtype;current_phone app.customer_phones%rowtype;stored app.capture_command_events%rowtype;
begin
  if p_actor_id is null or not app_private.jsonb_has_exact_keys(p_command,array['schemaVersion','scope','captureDraftId','expectedVersion','eventId','idempotencyKey','deviceId','occurredAt','attentionLeaseId','customerId','contactId','expectedCustomerVersion'])
    or not app_private.jsonb_has_exact_keys(p_command->'scope',array['restaurantId','branchId']) or p_command->'schemaVersion' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_command->'expectedVersion') is distinct from 'number' or not coalesce(p_command->>'expectedVersion'~'^[1-9][0-9]*$',false)
    or not coalesce(p_command->>'idempotencyKey'~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
  then return jsonb_build_object('status','rejected');end if;
  if not ((p_command->'customerId'='null'::jsonb and p_command->'contactId'='null'::jsonb and p_command->'expectedCustomerVersion'='null'::jsonb)
    or (jsonb_typeof(p_command->'customerId')='string' and jsonb_typeof(p_command->'contactId')='string' and jsonb_typeof(p_command->'expectedCustomerVersion')='number'
      and coalesce(p_command->>'expectedCustomerVersion'~'^[1-9][0-9]*$',false))) then return jsonb_build_object('status','rejected');end if;
  foreach field_name in array array['captureDraftId','eventId','deviceId','attentionLeaseId'] loop
    if jsonb_typeof(p_command->field_name) is distinct from 'string' or not coalesce(p_command->>field_name~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
    then return jsonb_build_object('status','rejected');end if;end loop;
  begin
    restaurant:=(p_command#>>'{scope,restaurantId}')::uuid;branch:=(p_command#>>'{scope,branchId}')::uuid;capture:=(p_command->>'captureDraftId')::uuid;
    event:=(p_command->>'eventId')::uuid;device:=(p_command->>'deviceId')::uuid;requested_lease:=(p_command->>'attentionLeaseId')::uuid;
    customer:=(p_command->>'customerId')::uuid;contact:=(p_command->>'contactId')::uuid;expected:=(p_command->>'expectedVersion')::bigint;
    customer_version:=(p_command->>'expectedCustomerVersion')::bigint;occurred:=(p_command->>'occurredAt')::timestamptz;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then return jsonb_build_object('status','rejected');end;
  if restaurant is null or branch is null or expected not between 1 and 9007199254740990 or occurred is null
    or p_command#>>'{scope,restaurantId}' is distinct from restaurant::text or p_command#>>'{scope,branchId}' is distinct from branch::text
    or p_command->>'occurredAt' is distinct from to_char(occurred at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    or (customer is not null and (customer_version not between 1 and 9007199254740991 or p_command->>'customerId' is distinct from customer::text or p_command->>'contactId' is distinct from contact::text))
  then return jsonb_build_object('status','rejected');end if;
  select m.id into member from app.memberships m join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
    join app.restaurants r on r.id=m.restaurant_id join app.membership_role_grants g on g.membership_id=m.id
    where m.user_id=p_actor_id and m.restaurant_id=restaurant and m.branch_id=branch and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null
      and g.revoked_at is null and g.role_code in('owner','admin','manager','supervisor','cashier','waiter') order by g.role_code limit 1 for share of m,b,r,g;
  if member is null then return jsonb_build_object('status','denied');end if;
  fingerprint:=encode(sha256(convert_to('capture.customer_changed:'||p_command::text||':'||p_actor_id::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('capture-command:'||p_actor_id::text||':'||restaurant::text||':'||branch::text||':'||(p_command->>'idempotencyKey'),0));
  select * into stored from app.capture_command_events where actor_id=p_actor_id and restaurant_id=restaurant and branch_id=branch and idempotency_key=p_command->>'idempotencyKey';
  if found then if stored.operation<>'capture.customer_changed' or stored.command_fingerprint<>fingerprint then return jsonb_build_object('status','conflict');end if;return jsonb_build_object('status','replayed','record',stored.result_capture);end if;
  select * into current_capture from app.capture_drafts where restaurant_id=restaurant and branch_id=branch and id=capture for update;
  if not found or current_capture.version<>expected or current_capture.status<>'draft' then return jsonb_build_object('status','conflict');end if;
  if customer is not null then select * into current_customer from app.customers where restaurant_id=restaurant and id=customer and deleted_at is null for share;
    if not found or current_customer.version<>customer_version then return jsonb_build_object('status','conflict');end if;
    select * into current_phone from app.customer_phones where restaurant_id=restaurant and customer_id=customer and contact_id=contact and deleted_at is null for share;
    if not found then return jsonb_build_object('status','conflict');end if;end if;
  observed:=greatest(date_trunc('milliseconds',clock_timestamp()),current_capture.updated_at);
  if current_capture.attention_status<>'claimed' or current_capture.owner_membership_id is distinct from member or current_capture.attention_lease_id is distinct from requested_lease or current_capture.attention_lease_expires_at<=observed
    then return jsonb_build_object('status','conflict');end if;
  select result_capture into result_record from app.capture_command_events where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture and result_version=expected;
  if not found then raise exception using errcode='55000',message='CAPTURE_JOURNAL_CURRENT_VERSION_MISSING';end if;
  snapshot:=case when customer is null then null else gen_random_uuid() end;
  result_record:=jsonb_set(result_record,'{detail}',(result_record->'detail')||jsonb_build_object('version',expected+1,'updatedAt',to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'customerSnapshotRef',snapshot::text,'fulfillmentSnapshotRef',null));
  begin
    if customer is not null then insert into app.customer_party_snapshots(id,restaurant_id,customer_id,contact_id,display_name,phone_display_value,phone_normalized_value,created_at,created_by)
      values(snapshot,restaurant,customer,contact,current_customer.display_name,current_phone.display_value,current_phone.normalized_value,observed,p_actor_id);end if;
    update app.capture_drafts set customer_id=customer,customer_snapshot_id=snapshot,fulfillment_snapshot_id=null,version=expected+1,updated_at=observed,updated_by=p_actor_id where restaurant_id=restaurant and branch_id=branch and id=capture;
    insert into app.capture_command_events(event_id,restaurant_id,branch_id,capture_draft_id,actor_id,actor_membership_id,device_id,operation,idempotency_key,command_fingerprint,expected_version,result_version,result_capture,occurred_at,received_at)
      values(event,restaurant,branch,capture,p_actor_id,member,device,'capture.customer_changed',p_command->>'idempotencyKey',fingerprint,expected,expected+1,result_record,occurred,observed);
  exception when unique_violation then return jsonb_build_object('status','conflict');end;
  return jsonb_build_object('status','applied','record',result_record);
end $function$;

create function app_private.set_capture_fulfillment(p_actor_id uuid,p_command jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  restaurant uuid;branch uuid;capture uuid;event uuid;device uuid;member uuid;lease uuid;party uuid;address uuid;snapshot uuid;
  expected bigint;address_version bigint;occurred timestamptz;observed timestamptz;fingerprint text;result_record jsonb;
  current_capture app.capture_drafts%rowtype;current_address app.customer_addresses%rowtype;stored app.capture_command_events%rowtype;
begin
  if p_actor_id is null or not app_private.jsonb_has_exact_keys(p_command,array['schemaVersion','scope','captureDraftId','expectedVersion','eventId','idempotencyKey','deviceId','occurredAt','attentionLeaseId','customerSnapshotRef','addressId','expectedAddressVersion'])
    or not app_private.jsonb_has_exact_keys(p_command->'scope',array['restaurantId','branchId']) or p_command->'schemaVersion' is distinct from '1'::jsonb
    or not coalesce(p_command->>'expectedVersion'~'^[1-9][0-9]*$',false) or not coalesce(p_command->>'idempotencyKey'~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
    or not ((p_command->'addressId'='null'::jsonb and p_command->'expectedAddressVersion'='null'::jsonb) or (jsonb_typeof(p_command->'addressId')='string' and jsonb_typeof(p_command->'expectedAddressVersion')='number' and coalesce(p_command->>'expectedAddressVersion'~'^[1-9][0-9]*$',false)))
  then return jsonb_build_object('status','rejected');end if;
  begin
    restaurant:=(p_command#>>'{scope,restaurantId}')::uuid;branch:=(p_command#>>'{scope,branchId}')::uuid;capture:=(p_command->>'captureDraftId')::uuid;
    event:=(p_command->>'eventId')::uuid;device:=(p_command->>'deviceId')::uuid;lease:=(p_command->>'attentionLeaseId')::uuid;party:=(p_command->>'customerSnapshotRef')::uuid;
    address:=(p_command->>'addressId')::uuid;expected:=(p_command->>'expectedVersion')::bigint;address_version:=(p_command->>'expectedAddressVersion')::bigint;occurred:=(p_command->>'occurredAt')::timestamptz;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then return jsonb_build_object('status','rejected');end;
  if restaurant is null or branch is null or capture is null or event is null or device is null or lease is null or party is null or expected not between 1 and 9007199254740990 or occurred is null
    or p_command#>>'{scope,restaurantId}' is distinct from restaurant::text or p_command#>>'{scope,branchId}' is distinct from branch::text
    or p_command->>'occurredAt' is distinct from to_char(occurred at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    or (address is not null and address_version not between 1 and 9007199254740991) then return jsonb_build_object('status','rejected');end if;
  select m.id into member from app.memberships m join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id join app.restaurants r on r.id=m.restaurant_id
    join app.membership_role_grants g on g.membership_id=m.id where m.user_id=p_actor_id and m.restaurant_id=restaurant and m.branch_id=branch and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null
      and g.revoked_at is null and g.role_code in('owner','admin','manager','supervisor','cashier','waiter') order by g.role_code limit 1 for share of m,b,r,g;
  if member is null then return jsonb_build_object('status','denied');end if;
  fingerprint:=encode(sha256(convert_to('capture.fulfillment_changed:'||p_command::text||':'||p_actor_id::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('capture-command:'||p_actor_id::text||':'||restaurant::text||':'||branch::text||':'||(p_command->>'idempotencyKey'),0));
  select * into stored from app.capture_command_events where actor_id=p_actor_id and restaurant_id=restaurant and branch_id=branch and idempotency_key=p_command->>'idempotencyKey';
  if found then if stored.operation<>'capture.fulfillment_changed' or stored.command_fingerprint<>fingerprint then return jsonb_build_object('status','conflict');end if;return jsonb_build_object('status','replayed','record',stored.result_capture);end if;
  select * into current_capture from app.capture_drafts where restaurant_id=restaurant and branch_id=branch and id=capture for update;
  if not found or current_capture.version<>expected or current_capture.status<>'draft' or current_capture.customer_snapshot_id is distinct from party or current_capture.customer_id is null
    then return jsonb_build_object('status','conflict');end if;
  if address is not null then select * into current_address from app.customer_addresses where restaurant_id=restaurant and customer_id=current_capture.customer_id and id=address and deleted_at is null for share;
    if not found or current_address.version<>address_version or current_address.validation_branch_id is distinct from branch or current_address.validated_at is null
      or current_address.street_line is null or current_address.locality is null or current_address.country_code is null then return jsonb_build_object('status','conflict');end if;end if;
  observed:=greatest(date_trunc('milliseconds',clock_timestamp()),current_capture.updated_at);
  if current_capture.attention_status<>'claimed' or current_capture.owner_membership_id is distinct from member or current_capture.attention_lease_id is distinct from lease or current_capture.attention_lease_expires_at<=observed
    then return jsonb_build_object('status','conflict');end if;
  select result_capture into result_record from app.capture_command_events where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture and result_version=expected;
  if not found then raise exception using errcode='55000',message='CAPTURE_JOURNAL_CURRENT_VERSION_MISSING';end if;
  snapshot:=case when address is null then null else gen_random_uuid() end;
  result_record:=jsonb_set(result_record,'{detail}',(result_record->'detail')||jsonb_build_object('version',expected+1,'updatedAt',to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'fulfillmentSnapshotRef',snapshot::text));
  begin
    if address is not null then insert into app.customer_fulfillment_snapshots(id,restaurant_id,branch_id,customer_id,address_id,party_snapshot_id,label,street_line,unit,neighborhood,locality,region,country_code,postal_code,references_text,instructions,latitude_e6,longitude_e6,validation_event_id,validated_by,validation_device_id,validated_at,created_at,created_by)
      values(snapshot,restaurant,branch,current_capture.customer_id,address,party,current_address.label,current_address.street_line,current_address.unit,current_address.neighborhood,current_address.locality,current_address.region,current_address.country_code,current_address.postal_code,current_address.references_text,current_address.instructions,current_address.latitude_e6,current_address.longitude_e6,current_address.validation_event_id,current_address.validated_by,current_address.validation_device_id,current_address.validated_at,observed,p_actor_id);end if;
    update app.capture_drafts set fulfillment_snapshot_id=snapshot,version=expected+1,updated_at=observed,updated_by=p_actor_id where restaurant_id=restaurant and branch_id=branch and id=capture;
    insert into app.capture_command_events(event_id,restaurant_id,branch_id,capture_draft_id,actor_id,actor_membership_id,device_id,operation,idempotency_key,command_fingerprint,expected_version,result_version,result_capture,occurred_at,received_at)
      values(event,restaurant,branch,capture,p_actor_id,member,device,'capture.fulfillment_changed',p_command->>'idempotencyKey',fingerprint,expected,expected+1,result_record,occurred,observed);
  exception when unique_violation then return jsonb_build_object('status','conflict');end;
  return jsonb_build_object('status','applied','record',result_record);
end $function$;

alter function app_private.set_capture_fulfillment(uuid,jsonb) owner to postgres;
revoke all on function app_private.set_capture_fulfillment(uuid,jsonb) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.set_capture_fulfillment(uuid,jsonb) to app_api;
alter function app_private.set_capture_customer(uuid,jsonb) owner to postgres;
revoke all on function app_private.set_capture_customer(uuid,jsonb) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.set_capture_customer(uuid,jsonb) to app_api;

commit;
