begin;

create table app.order_fulfillment_snapshots (
  restaurant_id uuid not null,
  branch_id uuid not null,
  order_id uuid not null,
  capture_draft_id uuid not null,
  capture_version bigint not null,
  customer_id uuid,
  fulfillment_channel text not null,
  delivery_instructions text,
  snapshot jsonb not null,
  confirmed_at timestamptz not null,
  confirmed_by uuid not null references auth.users (id) on delete restrict,
  constraint order_fulfillment_snapshots_pk primary key (restaurant_id,branch_id,order_id),
  constraint order_fulfillment_snapshots_order_fk foreign key (restaurant_id,branch_id,order_id)
    references app.orders (restaurant_id,branch_id,id) on delete restrict,
  constraint order_fulfillment_snapshots_capture_fk foreign key (restaurant_id,branch_id,capture_draft_id)
    references app.capture_drafts (restaurant_id,branch_id,id) on delete restrict,
  constraint order_fulfillment_snapshots_customer_fk foreign key (restaurant_id,customer_id)
    references app.customers (restaurant_id,id) on delete restrict,
  constraint order_fulfillment_snapshots_capture_unique unique (restaurant_id,branch_id,capture_draft_id),
  constraint order_fulfillment_snapshots_version_valid check (capture_version between 1 and 9007199254740990),
  constraint order_fulfillment_snapshots_channel_valid check (fulfillment_channel in ('dine_in','counter','pickup','delivery')),
  constraint order_fulfillment_snapshots_instructions_valid check (
    delivery_instructions is null
    or (
      fulfillment_channel='delivery'
      and delivery_instructions=pg_catalog.btrim(delivery_instructions)
      and pg_catalog.char_length(delivery_instructions) between 1 and 500
      and delivery_instructions !~ '[[:cntrl:]]'
    )
  ),
  constraint order_fulfillment_snapshots_payload_valid check (
    pg_catalog.jsonb_typeof(snapshot)='object'
    and snapshot->>'schemaVersion'='1'
    and snapshot->>'orderId'=order_id::text
    and snapshot->>'captureDraftId'=capture_draft_id::text
    and snapshot->>'captureVersion'=capture_version::text
    and snapshot->>'fulfillmentChannel'=fulfillment_channel
    and snapshot->'deliveryInstructions' is not distinct from pg_catalog.coalesce(
      pg_catalog.to_jsonb(delivery_instructions),'null'::jsonb
    )
  )
);

create index order_fulfillment_instruction_history_idx
  on app.order_fulfillment_snapshots (restaurant_id,branch_id,customer_id,confirmed_at desc,order_id)
  where customer_id is not null and delivery_instructions is not null;

alter table app.order_fulfillment_snapshots enable row level security;
alter table app.order_fulfillment_snapshots force row level security;
revoke all on app.order_fulfillment_snapshots from public,anon,authenticated,service_role,app_api;

create function app_private.confirm_capture_draft(
  p_actor_id uuid,
  p_command jsonb,
  p_order jsonb,
  p_order_audit jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  restaurant uuid; branch uuid; capture uuid; event uuid; device uuid; lease uuid; order_id uuid; shift_id uuid; table_id uuid;
  member uuid; expected bigint; occurred timestamptz; observed timestamptz; fingerprint text; order_channel text;
  current_capture app.capture_drafts%rowtype; stored app.capture_command_events%rowtype;
  result_record jsonb; order_result jsonb; party jsonb; fulfillment jsonb; frozen_snapshot jsonb;
begin
  if p_actor_id is null
    or pg_catalog.jsonb_typeof(p_order)<>'object' or pg_catalog.jsonb_typeof(p_order_audit)<>'object'
    or not app_private.jsonb_has_exact_keys(p_command,array[
      'schemaVersion','scope','captureDraftId','expectedVersion','eventId','idempotencyKey','deviceId','occurredAt',
      'attentionLeaseId','orderId','shiftId','tableId','currency','timeZone'
    ])
    or not app_private.jsonb_has_exact_keys(p_command->'scope',array['restaurantId','branchId'])
    or p_command->'schemaVersion' is distinct from '2'::jsonb
    or not coalesce(p_command->>'expectedVersion' ~ '^[1-9][0-9]*$',false)
    or not coalesce(p_command->>'currency' ~ '^[A-Z]{3}$',false)
    or pg_catalog.char_length(p_command->>'timeZone') not between 1 and 100
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;
  begin
    restaurant:=(p_command#>>'{scope,restaurantId}')::uuid;
    branch:=(p_command#>>'{scope,branchId}')::uuid;
    capture:=(p_command->>'captureDraftId')::uuid;
    event:=(p_command->>'eventId')::uuid;
    device:=(p_command->>'deviceId')::uuid;
    lease:=(p_command->>'attentionLeaseId')::uuid;
    order_id:=(p_command->>'orderId')::uuid;
    shift_id:=(p_command->>'shiftId')::uuid;
    table_id:=(p_command->>'tableId')::uuid;
    expected:=(p_command->>'expectedVersion')::bigint;
    occurred:=(p_command->>'occurredAt')::timestamptz;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or capture is null or event is null or device is null or lease is null
    or order_id is null or shift_id is null or expected not between 1 and 9007199254740990 or occurred is null
    or p_command#>>'{scope,restaurantId}' is distinct from restaurant::text
    or p_command#>>'{scope,branchId}' is distinct from branch::text
    or p_command->>'occurredAt' is distinct from pg_catalog.to_char(occurred at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  select m.id into member from app.memberships m
  join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
  join app.restaurants r on r.id=m.restaurant_id
  join app.membership_role_grants g on g.membership_id=m.id
  where m.user_id=p_actor_id and m.restaurant_id=restaurant and m.branch_id=branch and m.revoked_at is null
    and b.disabled_at is null and r.disabled_at is null and g.revoked_at is null
    and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
  order by g.role_code limit 1 for share of m,b,r,g;
  if member is null then return pg_catalog.jsonb_build_object('status','denied'); end if;

  fingerprint:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'capture.confirmed:'||p_command::text||':'||p_order::text||':'||p_order_audit::text||':'||p_actor_id::text,'UTF8'
  )),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'capture-command:'||p_actor_id::text||':'||restaurant::text||':'||branch::text||':'||(p_command->>'idempotencyKey'),0
  ));
  select * into stored from app.capture_command_events where actor_id=p_actor_id and restaurant_id=restaurant
    and branch_id=branch and idempotency_key=p_command->>'idempotencyKey';
  if found then
    if stored.operation<>'capture.confirmed' or stored.command_fingerprint<>fingerprint
      or not exists (
        select 1 from app.order_audit_events audit
        join app.order_operational_shifts link on link.restaurant_id=audit.restaurant_id and link.branch_id=audit.branch_id
          and link.order_id=audit.order_id and link.shift_id=shift_id
        join app.order_fulfillment_snapshots frozen on frozen.restaurant_id=audit.restaurant_id
          and frozen.branch_id=audit.branch_id and frozen.order_id=audit.order_id and frozen.capture_draft_id=capture
        where audit.event_id=event and audit.actor_id=p_actor_id and audit.restaurant_id=restaurant
          and audit.branch_id=branch and audit.order_id=order_id and audit.expected_order_version=0
          and audit.result_order_version=1 and audit.event_payload=p_order_audit and audit.result_order=p_order
      )
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    return pg_catalog.jsonb_build_object('status','replayed','record',stored.result_capture);
  end if;

  select * into current_capture from app.capture_drafts
  where restaurant_id=restaurant and branch_id=branch and id=capture for update;
  observed:=pg_catalog.greatest(pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp()),current_capture.updated_at);
  if not found or current_capture.version<>expected or current_capture.status<>'draft'
    or current_capture.fulfillment_channel is null
    or current_capture.attention_status<>'claimed' or current_capture.owner_membership_id is distinct from member
    or current_capture.attention_lease_id is distinct from lease or current_capture.attention_lease_expires_at<=observed
    or (current_capture.fulfillment_channel='dine_in') is distinct from (table_id is not null)
    or (current_capture.fulfillment_channel='delivery' and (
      current_capture.customer_snapshot_id is null or current_capture.fulfillment_snapshot_id is null
    ))
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  order_channel:=case current_capture.fulfillment_channel
    when 'dine_in' then 'table' when 'pickup' then 'takeout'
    when 'counter' then 'counter' when 'delivery' then 'delivery' end;
  if p_order->>'schemaVersion'<>'1' or p_order->>'restaurantId' is distinct from restaurant::text
    or p_order->>'branchId' is distinct from branch::text or p_order->>'orderId' is distinct from order_id::text
    or p_order->>'channel' is distinct from order_channel or (p_order->>'tableId') is distinct from table_id::text
    or p_order->>'currency' is distinct from p_command->>'currency'
    or p_order->>'timeZone' is distinct from p_command->>'timeZone'
    or p_order->>'status'<>'draft' or pg_catalog.jsonb_typeof(p_order->'items')<>'array'
    or pg_catalog.jsonb_array_length(p_order->'items')<>0
    or p_order_audit->>'schemaVersion'<>'1' or p_order_audit->>'operation'<>'order.created'
    or p_order_audit->>'actorId' is distinct from p_actor_id::text
    or p_order_audit->>'restaurantId' is distinct from restaurant::text
    or p_order_audit->>'branchId' is distinct from branch::text
    or p_order_audit->>'orderId' is distinct from order_id::text
    or p_order_audit->>'entityId' is distinct from order_id::text
    or p_order_audit->>'eventId' is distinct from event::text
    or p_order_audit->>'deviceId' is distinct from device::text
    or p_order_audit->>'idempotencyKey' is distinct from p_command->>'idempotencyKey'
    or p_order_audit->>'occurredAt' is distinct from p_command->>'occurredAt'
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  select result_capture into result_record from app.capture_command_events
  where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture and result_version=expected;
  if not found then raise exception using errcode='55000',message='CAPTURE_JOURNAL_CURRENT_VERSION_MISSING'; end if;
  if current_capture.customer_snapshot_id is not null then
    select pg_catalog.jsonb_build_object('schemaVersion',1,'snapshotRef',s.id::text,'customerId',s.customer_id::text,
      'contactId',s.contact_id::text,'displayName',s.display_name,'phoneDisplayValue',s.phone_display_value,
      'phoneNormalizedValue',s.phone_normalized_value) into party
    from app.customer_party_snapshots s where s.restaurant_id=restaurant and s.customer_id=current_capture.customer_id
      and s.id=current_capture.customer_snapshot_id;
    if not found then raise exception using errcode='55000',message='CAPTURE_PARTY_SNAPSHOT_MISSING'; end if;
  end if;
  if current_capture.fulfillment_snapshot_id is not null then
    select pg_catalog.jsonb_build_object('schemaVersion',1,'snapshotRef',s.id::text,'customerSnapshotRef',s.party_snapshot_id::text,
      'customerId',s.customer_id::text,'addressId',s.address_id::text,'label',s.label,'streetLine',s.street_line,
      'unit',s.unit,'neighborhood',s.neighborhood,'locality',s.locality,'region',s.region,'countryCode',s.country_code,
      'postalCode',s.postal_code,'referencesText',s.references_text,'legacyAddressInstructions',s.instructions,
      'latitudeE6',s.latitude_e6,'longitudeE6',s.longitude_e6,
      'validatedAt',pg_catalog.to_char(s.validated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) into fulfillment
    from app.customer_fulfillment_snapshots s where s.restaurant_id=restaurant and s.branch_id=branch
      and s.customer_id=current_capture.customer_id and s.party_snapshot_id=current_capture.customer_snapshot_id
      and s.id=current_capture.fulfillment_snapshot_id;
    if not found then raise exception using errcode='55000',message='CAPTURE_FULFILLMENT_SNAPSHOT_MISSING'; end if;
  end if;
  frozen_snapshot:=pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',order_id::text,'captureDraftId',capture::text,'captureVersion',expected,
    'fulfillmentChannel',current_capture.fulfillment_channel,'tableId',table_id::text,
    'partySnapshot',party,'fulfillmentSnapshot',fulfillment,
    'deliveryInstructions',current_capture.delivery_instructions,
    'frozenAt',pg_catalog.to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

  order_result:=app_private.create_operational_order(p_actor_id,shift_id,p_order,p_order_audit);
  if order_result->>'status'='forbidden' then return pg_catalog.jsonb_build_object('status','denied'); end if;
  if order_result->>'status'<>'saved' then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  insert into app.order_fulfillment_snapshots(
    restaurant_id,branch_id,order_id,capture_draft_id,capture_version,customer_id,fulfillment_channel,
    delivery_instructions,snapshot,confirmed_at,confirmed_by
  ) values (
    restaurant,branch,order_id,capture,expected,current_capture.customer_id,current_capture.fulfillment_channel,
    current_capture.delivery_instructions,frozen_snapshot,observed,p_actor_id
  );
  update app.capture_drafts set status='confirmed',attention_status='unclaimed',owner_membership_id=null,
    attention_lease_id=null,attention_lease_expires_at=null,confirmed_order_id=order_id,version=expected+1,
    updated_at=observed,updated_by=p_actor_id
  where restaurant_id=restaurant and branch_id=branch and id=capture and version=expected;
  if not found then raise exception using errcode='40001',message='CAPTURE_CONFIRMATION_LOST_UPDATE'; end if;
  result_record:=pg_catalog.jsonb_set(result_record,'{detail}',(result_record->'detail')||pg_catalog.jsonb_build_object(
    'status','confirmed','attentionStatus','unclaimed','ownerMembershipId',null,'attentionLeaseId',null,
    'attentionLeaseExpiresAt',null,'confirmedOrderId',order_id::text,'version',expected+1,
    'updatedAt',pg_catalog.to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ));
  insert into app.capture_command_events(
    event_id,restaurant_id,branch_id,capture_draft_id,actor_id,actor_membership_id,device_id,operation,
    idempotency_key,command_fingerprint,expected_version,result_version,result_capture,occurred_at,received_at
  ) values (
    event,restaurant,branch,capture,p_actor_id,member,device,'capture.confirmed',p_command->>'idempotencyKey',
    fingerprint,expected,expected+1,result_record,occurred,observed
  );
  return pg_catalog.jsonb_build_object('status','applied','record',result_record);
end
$function$;

alter function app_private.confirm_capture_draft(uuid,jsonb,jsonb,jsonb) owner to postgres;
revoke all on function app_private.confirm_capture_draft(uuid,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.confirm_capture_draft(uuid,jsonb,jsonb,jsonb) to app_api;

comment on table app.order_fulfillment_snapshots is
  'Immutable Order-owned Capture snapshot. Legacy Address instructions remain labeled history; only Capture delivery_instructions is frozen as active.';

commit;
