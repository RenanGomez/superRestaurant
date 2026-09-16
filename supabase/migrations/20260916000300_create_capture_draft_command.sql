begin;

create function app_private.create_capture_draft(p_actor_id uuid, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  restaurant uuid;
  branch uuid;
  capture uuid;
  event uuid;
  device uuid;
  member uuid;
  fingerprint text;
  occurred timestamptz;
  observed timestamptz;
  recovery timestamptz;
  lease uuid;
  stored app.capture_command_events%rowtype;
  result_record jsonb;
begin
  if p_actor_id is null or not app_private.jsonb_has_exact_keys(p_command, array[
    'schemaVersion','scope','captureDraftId','expectedVersion','sourceChannel','fulfillmentChannel',
    'eventId','idempotencyKey','deviceId','occurredAt'
  ]) or not app_private.jsonb_has_exact_keys(p_command -> 'scope', array['restaurantId','branchId'])
    or p_command -> 'schemaVersion' is distinct from '1'::jsonb
    or p_command -> 'expectedVersion' is distinct from '0'::jsonb
    or not coalesce(p_command ->> 'sourceChannel' in ('phone','whatsapp_manual','counter','table','self_service','integration'), false)
    or not coalesce(p_command -> 'fulfillmentChannel' = 'null'::jsonb
      or p_command ->> 'fulfillmentChannel' in ('dine_in','counter','pickup','delivery'), false)
    or pg_catalog.jsonb_typeof(p_command -> 'idempotencyKey') is distinct from 'string'
    or not coalesce(p_command ->> 'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    or char_length(p_command ->> 'idempotencyKey') not between 1 and 200
    or p_command ->> 'idempotencyKey' <> btrim(p_command ->> 'idempotencyKey')
    or p_command ->> 'idempotencyKey' ~ '[[:cntrl:]]'
  then return jsonb_build_object('status','rejected'); end if;
  begin
    restaurant := (p_command #>> '{scope,restaurantId}')::uuid;
    branch := (p_command #>> '{scope,branchId}')::uuid;
    capture := (p_command ->> 'captureDraftId')::uuid;
    event := (p_command ->> 'eventId')::uuid;
    device := (p_command ->> 'deviceId')::uuid;
    occurred := (p_command ->> 'occurredAt')::timestamptz;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
    return jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or capture is null or event is null or device is null
    or occurred is null or p_command ->> 'occurredAt' is distinct from to_char(occurred at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  then return jsonb_build_object('status','rejected'); end if;

  -- Lock active authorization rows for the transaction, including replay. Revocation cannot race acceptance.
  select m.id into member from app.memberships as m
    join app.branches as b on b.id = m.branch_id and b.restaurant_id = m.restaurant_id
    join app.restaurants as r on r.id = m.restaurant_id
    join app.membership_role_grants as g on g.membership_id = m.id
    where m.user_id = p_actor_id and m.restaurant_id = restaurant and m.branch_id = branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null
      and g.revoked_at is null and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
    order by g.role_code limit 1 for share of m, b, r, g;
  if member is null then return jsonb_build_object('status','denied'); end if;

  fingerprint := encode(pg_catalog.sha256(convert_to(p_command::text || ':' || p_actor_id::text, 'UTF8')), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'capture-command:' || p_actor_id::text || ':' || restaurant::text || ':' || branch::text || ':' || (p_command ->> 'idempotencyKey'), 0));
  select * into stored from app.capture_command_events
    where actor_id = p_actor_id and restaurant_id = restaurant and branch_id = branch
      and idempotency_key = p_command ->> 'idempotencyKey';
  if found then
    if stored.operation <> 'capture.created' or stored.command_fingerprint <> fingerprint
      then return jsonb_build_object('status','conflict'); end if;
    return jsonb_build_object('status','replayed','record',stored.result_capture);
  end if;
  observed := date_trunc('milliseconds', clock_timestamp());
  recovery := ((observed at time zone 'UTC') + interval '1 month') at time zone 'UTC';
  lease := gen_random_uuid();
  result_record := jsonb_build_object('schemaVersion',1,
    'detail',jsonb_build_object('schemaVersion',1,
      'scope',jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
      'captureDraftId',capture::text,'folio','C-' || capture::text,
      'sourceChannel',p_command ->> 'sourceChannel','fulfillmentChannel',p_command -> 'fulfillmentChannel',
      'status','draft','attentionStatus','claimed','ownerMembershipId',member::text,'version',1,
      'updatedAt',to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'attentionLeaseId',lease::text,
      'attentionLeaseExpiresAt',to_char((observed + interval '5 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'confirmedOrderId',null,'customerSnapshotRef',null,'fulfillmentSnapshotRef',null),
    'recoveryPolicy',jsonb_build_object('schemaVersion',1,'autoRenewSelected',false,
      'recoveryExpiresAt',to_char(recovery at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  begin
    insert into app.capture_drafts (id,restaurant_id,branch_id,folio,source_channel,fulfillment_channel,
      attention_status,owner_membership_id,attention_lease_id,attention_lease_expires_at,
      recovery_expires_at,created_at,updated_at,created_by,updated_by)
    values (capture,restaurant,branch,'C-' || capture::text,p_command ->> 'sourceChannel',p_command ->> 'fulfillmentChannel',
      'claimed',member,lease,observed + interval '5 minutes',recovery,observed,observed,p_actor_id,p_actor_id);
    insert into app.capture_command_events (event_id,restaurant_id,branch_id,capture_draft_id,actor_id,
      actor_membership_id,device_id,operation,idempotency_key,command_fingerprint,
      expected_version,result_version,result_capture,occurred_at,received_at)
    values (event,restaurant,branch,capture,p_actor_id,member,device,'capture.created',p_command ->> 'idempotencyKey',
      fingerprint,0,1,result_record,occurred,observed);
  exception when unique_violation then
    -- Subtransaction discards both inserts, including capture if the event ID collided elsewhere.
    return jsonb_build_object('status','conflict');
  end;
  return jsonb_build_object('status','applied','record',result_record);
end
$function$;

alter function app_private.create_capture_draft(uuid,jsonb) owner to postgres;
revoke all on function app_private.create_capture_draft(uuid,jsonb) from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.create_capture_draft(uuid,jsonb) to app_api;

commit;
