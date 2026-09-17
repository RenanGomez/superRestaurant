begin;

alter table app.capture_drafts
  add column customer_id uuid,
  add column customer_snapshot_id uuid,
  add constraint capture_customer_snapshot_scope_fk foreign key (restaurant_id, customer_id, customer_snapshot_id)
    references app.customer_party_snapshots (restaurant_id, customer_id, id) on delete restrict,
  add constraint capture_customer_snapshot_pair_valid check ((customer_id is null) = (customer_snapshot_id is null));

alter table app.capture_command_events drop constraint capture_events_operation_valid;
alter table app.capture_command_events add constraint capture_events_operation_valid check (operation in (
  'capture.created','capture.autosaved','capture.held','capture.claimed','capture.resumed',
  'capture.transferred','capture.confirmed','capture.no_sale',
  'capture.recovery_preference_changed','capture.taken_over','capture.customer_changed'
));

create function app_private.set_capture_customer(p_actor_id uuid, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  restaurant uuid; branch uuid; capture uuid; event uuid; device uuid; member uuid;
  requested_lease uuid; customer uuid; contact uuid; snapshot uuid;
  expected bigint; customer_version bigint; occurred timestamptz; observed timestamptz;
  fingerprint text; result_record jsonb; field_name text;
  current_capture app.capture_drafts%rowtype;
  current_customer app.customers%rowtype;
  current_phone app.customer_phones%rowtype;
  stored app.capture_command_events%rowtype;
begin
  if p_actor_id is null or not app_private.jsonb_has_exact_keys(p_command,array[
      'schemaVersion','scope','captureDraftId','expectedVersion','eventId','idempotencyKey','deviceId','occurredAt',
      'attentionLeaseId','customerId','contactId','expectedCustomerVersion'])
    or not app_private.jsonb_has_exact_keys(p_command -> 'scope',array['restaurantId','branchId'])
    or p_command -> 'schemaVersion' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_command -> 'expectedVersion') is distinct from 'number'
    or not coalesce(p_command ->> 'expectedVersion' ~ '^[1-9][0-9]*$',false)
    or not coalesce(p_command ->> 'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
  then return jsonb_build_object('status','rejected'); end if;
  if not ((p_command -> 'customerId' = 'null'::jsonb and p_command -> 'contactId' = 'null'::jsonb
      and p_command -> 'expectedCustomerVersion' = 'null'::jsonb)
    or (pg_catalog.jsonb_typeof(p_command -> 'customerId') = 'string'
      and pg_catalog.jsonb_typeof(p_command -> 'contactId') = 'string'
      and pg_catalog.jsonb_typeof(p_command -> 'expectedCustomerVersion') = 'number'
      and coalesce(p_command ->> 'expectedCustomerVersion' ~ '^[1-9][0-9]*$',false)))
  then return jsonb_build_object('status','rejected'); end if;
  -- All IDs use the same canonical transport representation as the shared parser.
  foreach field_name in array array['captureDraftId','eventId','deviceId','attentionLeaseId'] loop
    if pg_catalog.jsonb_typeof(p_command -> field_name) is distinct from 'string'
      or not coalesce(p_command ->> field_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
    then return jsonb_build_object('status','rejected'); end if;
  end loop;
  begin
    restaurant := (p_command #>> '{scope,restaurantId}')::uuid;
    branch := (p_command #>> '{scope,branchId}')::uuid;
    capture := (p_command ->> 'captureDraftId')::uuid;
    event := (p_command ->> 'eventId')::uuid;
    device := (p_command ->> 'deviceId')::uuid;
    requested_lease := (p_command ->> 'attentionLeaseId')::uuid;
    customer := (p_command ->> 'customerId')::uuid;
    contact := (p_command ->> 'contactId')::uuid;
    expected := (p_command ->> 'expectedVersion')::bigint;
    customer_version := (p_command ->> 'expectedCustomerVersion')::bigint;
    occurred := (p_command ->> 'occurredAt')::timestamptz;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    return jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or expected not between 1 and 9007199254740990 or occurred is null
    or p_command #>> '{scope,restaurantId}' is distinct from restaurant::text
    or p_command #>> '{scope,branchId}' is distinct from branch::text
    or p_command ->> 'occurredAt' is distinct from to_char(occurred at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    or (customer is not null and (customer_version not between 1 and 9007199254740991
      or p_command ->> 'customerId' is distinct from customer::text or p_command ->> 'contactId' is distinct from contact::text))
  then return jsonb_build_object('status','rejected'); end if;

  select m.id into member from app.memberships m
    join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
    join app.restaurants r on r.id=m.restaurant_id
    join app.membership_role_grants g on g.membership_id=m.id
    where m.user_id=p_actor_id and m.restaurant_id=restaurant and m.branch_id=branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null
      and g.revoked_at is null and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
    order by g.role_code limit 1 for share of m,b,r,g;
  if member is null then return jsonb_build_object('status','denied'); end if;
  fingerprint := encode(pg_catalog.sha256(convert_to('capture.customer_changed:' || p_command::text || ':' || p_actor_id::text,'UTF8')),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'capture-command:' || p_actor_id::text || ':' || restaurant::text || ':' || branch::text || ':' || (p_command ->> 'idempotencyKey'),0));
  select * into stored from app.capture_command_events where actor_id=p_actor_id
    and restaurant_id=restaurant and branch_id=branch and idempotency_key=p_command ->> 'idempotencyKey';
  if found then
    if stored.operation <> 'capture.customer_changed' or stored.command_fingerprint <> fingerprint
      then return jsonb_build_object('status','conflict'); end if;
    return jsonb_build_object('status','replayed','record',stored.result_capture);
  end if;
  select * into current_capture from app.capture_drafts
    where restaurant_id=restaurant and branch_id=branch and id=capture for update;
  if not found or current_capture.version <> expected or current_capture.status <> 'draft'
    then return jsonb_build_object('status','conflict'); end if;
  if customer is not null then
    -- The directory writer takes this parent lock before changing any phone.
    select * into current_customer from app.customers
      where restaurant_id=restaurant and id=customer and deleted_at is null for share;
    if not found or current_customer.version <> customer_version then return jsonb_build_object('status','conflict'); end if;
    select * into current_phone from app.customer_phones
      where restaurant_id=restaurant and customer_id=customer and contact_id=contact and deleted_at is null for share;
    if not found then return jsonb_build_object('status','conflict'); end if;
  end if;
  observed := greatest(date_trunc('milliseconds',clock_timestamp()),current_capture.updated_at);
  if current_capture.attention_status <> 'claimed' or current_capture.owner_membership_id is distinct from member
    or current_capture.attention_lease_id is distinct from requested_lease or current_capture.attention_lease_expires_at <= observed
    then return jsonb_build_object('status','conflict'); end if;
  select result_capture into result_record from app.capture_command_events
    where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture and result_version=expected;
  if not found then raise exception using errcode='55000',message='CAPTURE_JOURNAL_CURRENT_VERSION_MISSING'; end if;
  snapshot := case when customer is null then null else gen_random_uuid() end;
  result_record := jsonb_set(result_record,'{detail}',(result_record -> 'detail') || jsonb_build_object(
    'version',expected+1,'updatedAt',to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'customerSnapshotRef',snapshot::text,'fulfillmentSnapshotRef',null));
  begin
    if customer is not null then
      insert into app.customer_party_snapshots(id,restaurant_id,customer_id,contact_id,display_name,
        phone_display_value,phone_normalized_value,created_at,created_by)
      values(snapshot,restaurant,customer,contact,current_customer.display_name,
        current_phone.display_value,current_phone.normalized_value,observed,p_actor_id);
    end if;
    update app.capture_drafts set customer_id=customer,customer_snapshot_id=snapshot,version=expected+1,
      updated_at=observed,updated_by=p_actor_id where restaurant_id=restaurant and branch_id=branch and id=capture;
    insert into app.capture_command_events(event_id,restaurant_id,branch_id,capture_draft_id,actor_id,
      actor_membership_id,device_id,operation,idempotency_key,command_fingerprint,
      expected_version,result_version,result_capture,occurred_at,received_at)
    values(event,restaurant,branch,capture,p_actor_id,member,device,'capture.customer_changed',
      p_command ->> 'idempotencyKey',fingerprint,expected,expected+1,result_record,occurred,observed);
  exception when unique_violation then return jsonb_build_object('status','conflict');
  end;
  return jsonb_build_object('status','applied','record',result_record);
end
$function$;

alter function app_private.set_capture_customer(uuid,jsonb) owner to postgres;
revoke all on function app_private.set_capture_customer(uuid,jsonb) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.set_capture_customer(uuid,jsonb) to app_api;

comment on column app.capture_drafts.customer_snapshot_id is
  'Opaque immutable historical party reference. Only the private atomic writer derives facts from scoped current Customer/contact; clients never submit snapshot facts or references.';

commit;
