begin;

create function app_private.close_capture_no_sale(p_actor_id uuid, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  restaurant uuid;
  branch uuid;
  capture uuid;
  event uuid;
  device uuid;
  member uuid;
  requested_lease uuid;
  expected bigint;
  occurred timestamptz;
  observed timestamptz;
  fingerprint text;
  reason text;
  current_capture app.capture_drafts%rowtype;
  stored app.capture_command_events%rowtype;
  result_record jsonb;
  keys text[] := array[
    'schemaVersion','scope','captureDraftId','expectedVersion','eventId',
    'idempotencyKey','deviceId','occurredAt','attentionLeaseId','reason'
  ];
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_command, keys)
    or not app_private.jsonb_has_exact_keys(p_command -> 'scope', array['restaurantId','branchId'])
    or p_command -> 'schemaVersion' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_command -> 'expectedVersion') is distinct from 'number'
    or not coalesce(p_command ->> 'expectedVersion' ~ '^[1-9][0-9]*$', false)
    or not coalesce(p_command ->> 'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    or pg_catalog.jsonb_typeof(p_command -> 'reason') is distinct from 'string'
    or char_length(btrim(p_command ->> 'reason')) not between 1 and 500
    or p_command ->> 'reason' ~ '[[:cntrl:]]'
  then return jsonb_build_object('status','rejected'); end if;
  begin
    restaurant := (p_command #>> '{scope,restaurantId}')::uuid;
    branch := (p_command #>> '{scope,branchId}')::uuid;
    capture := (p_command ->> 'captureDraftId')::uuid;
    event := (p_command ->> 'eventId')::uuid;
    device := (p_command ->> 'deviceId')::uuid;
    expected := (p_command ->> 'expectedVersion')::bigint;
    occurred := (p_command ->> 'occurredAt')::timestamptz;
    requested_lease := (p_command ->> 'attentionLeaseId')::uuid;
    reason := btrim(p_command ->> 'reason');
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    return jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or capture is null or event is null or device is null
    or expected not between 1 and 9007199254740990 or occurred is null or requested_lease is null
    or p_command ->> 'occurredAt' is distinct from to_char(occurred at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  then return jsonb_build_object('status','rejected'); end if;

  select m.id into member from app.memberships as m
    join app.branches as b on b.id = m.branch_id and b.restaurant_id = m.restaurant_id
    join app.restaurants as r on r.id = m.restaurant_id
    join app.membership_role_grants as g on g.membership_id = m.id
    where m.user_id = p_actor_id and m.restaurant_id = restaurant and m.branch_id = branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null
      and g.revoked_at is null and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
    order by g.role_code limit 1 for share of m,b,r,g;
  if member is null then return jsonb_build_object('status','denied'); end if;

  fingerprint := encode(pg_catalog.sha256(convert_to(
    'capture.no_sale:' || p_command::text || ':' || p_actor_id::text,'UTF8')), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'capture-command:' || p_actor_id::text || ':' || restaurant::text || ':' || branch::text || ':' || (p_command ->> 'idempotencyKey'), 0));
  select * into stored from app.capture_command_events where actor_id = p_actor_id
    and restaurant_id = restaurant and branch_id = branch and idempotency_key = p_command ->> 'idempotencyKey';
  if found then
    if stored.operation <> 'capture.no_sale' or stored.command_fingerprint <> fingerprint
      then return jsonb_build_object('status','conflict'); end if;
    return jsonb_build_object('status','replayed','record',stored.result_capture);
  end if;

  select * into current_capture from app.capture_drafts
    where restaurant_id = restaurant and branch_id = branch and id = capture for update;
  if not found or current_capture.version <> expected or current_capture.status <> 'draft'
    then return jsonb_build_object('status','conflict'); end if;
  observed := greatest(date_trunc('milliseconds',clock_timestamp()),current_capture.updated_at);
  if current_capture.attention_status <> 'claimed' or current_capture.owner_membership_id is distinct from member
    or current_capture.attention_lease_id is distinct from requested_lease
    or current_capture.attention_lease_expires_at <= observed
  then return jsonb_build_object('status','conflict'); end if;

  select result_capture into result_record from app.capture_command_events
    where restaurant_id = restaurant and branch_id = branch and capture_draft_id = capture and result_version = expected;
  if not found then raise exception using errcode = '55000', message = 'CAPTURE_JOURNAL_CURRENT_VERSION_MISSING'; end if;
  result_record := jsonb_build_object('schemaVersion',1,
    'detail',(result_record -> 'detail') || jsonb_build_object(
      'status','no_sale','version',expected + 1,'updatedAt',to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'attentionStatus','unclaimed','ownerMembershipId',null,'attentionLeaseId',null,'attentionLeaseExpiresAt',null),
    'recoveryPolicy',result_record -> 'recoveryPolicy');
  begin
    update app.capture_drafts set status = 'no_sale', version = expected + 1, updated_at = observed, updated_by = p_actor_id,
      attention_status = 'unclaimed', owner_membership_id = null, attention_lease_id = null, attention_lease_expires_at = null
      where restaurant_id = restaurant and branch_id = branch and id = capture and version = expected;
    if not found then raise exception using errcode = '40001', message = 'CAPTURE_NO_SALE_LOST_UPDATE'; end if;
    insert into app.capture_command_events (event_id,restaurant_id,branch_id,capture_draft_id,actor_id,
      actor_membership_id,device_id,operation,idempotency_key,command_fingerprint,
      expected_version,result_version,result_capture,reason,occurred_at,received_at)
    values (event,restaurant,branch,capture,p_actor_id,member,device,'capture.no_sale',p_command ->> 'idempotencyKey',
      fingerprint,expected,expected + 1,result_record,reason,occurred,observed);
  exception when unique_violation then return jsonb_build_object('status','conflict');
  end;
  return jsonb_build_object('status','applied','record',result_record);
end
$function$;

alter function app_private.close_capture_no_sale(uuid,jsonb) owner to postgres;
revoke all on function app_private.close_capture_no_sale(uuid,jsonb) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.close_capture_no_sale(uuid,jsonb) to app_api;

comment on function app_private.close_capture_no_sale(uuid,jsonb) is
  'Terminal, audited close of a draft Capture as no-sale with a mandatory reason. Requires the current lease/owner, CAS by expectedVersion, releases attention, and leaves the draft in history (never deletes it). The existing leave-draft trigger clears any repeat/selection plan.';

commit;
