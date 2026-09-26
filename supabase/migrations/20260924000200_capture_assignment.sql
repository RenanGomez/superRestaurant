begin;

create function app_private.list_capture_assignment_candidates(p_actor_id uuid,p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare restaurant uuid;branch uuid;member uuid;candidates jsonb;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_request,array['schemaVersion','scope'])
    or not app_private.jsonb_has_exact_keys(p_request->'scope',array['restaurantId','branchId'])
    or p_request->'schemaVersion' is distinct from '1'::jsonb
  then return jsonb_build_object('status','rejected');end if;
  begin
    restaurant:=(p_request#>>'{scope,restaurantId}')::uuid;
    branch:=(p_request#>>'{scope,branchId}')::uuid;
  exception when invalid_text_representation then return jsonb_build_object('status','rejected');end;
  if restaurant is null or branch is null then return jsonb_build_object('status','rejected');end if;

  select m.id into member from app.memberships m
    join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
    join app.restaurants r on r.id=m.restaurant_id
    join app.membership_role_grants g on g.membership_id=m.id
    where m.user_id=p_actor_id and m.restaurant_id=restaurant and m.branch_id=branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null
      and g.revoked_at is null and g.role_code in ('owner','admin','manager','supervisor')
    order by g.role_code limit 1;
  if member is null then return jsonb_build_object('status','denied');end if;

  select coalesce(jsonb_agg(candidate order by lower(display_label),membership_id),'[]'::jsonb) into candidates from (
    select listed.membership_id,listed.display_label,jsonb_build_object(
      'schemaVersion',1,
      'membershipId',listed.membership_id::text,
      'displayLabel',listed.display_label,
      'roles',listed.roles
    ) as candidate from (
      select m.id as membership_id,
        case when char_length(btrim(u.email)) between 1 and 320 and btrim(u.email) !~ '[[:cntrl:]]'
          then btrim(u.email) else 'Operador '||right(m.id::text,8) end as display_label,
        (select jsonb_agg(role_code order by case role_code
          when 'owner' then 1 when 'admin' then 2 when 'manager' then 3 when 'supervisor' then 4
          when 'cashier' then 5 when 'waiter' then 6 end)
          from (select distinct grants.role_code from app.membership_role_grants grants
            where grants.membership_id=m.id and grants.revoked_at is null
              and grants.role_code in ('owner','admin','manager','supervisor','cashier','waiter')) active_roles
        ) as roles
      from app.memberships m join auth.users u on u.id=m.user_id
      where m.restaurant_id=restaurant and m.branch_id=branch and m.revoked_at is null
        and m.user_id<>p_actor_id and exists(select 1 from app.membership_role_grants active
          where active.membership_id=m.id and active.revoked_at is null
            and active.role_code in ('owner','admin','manager','supervisor','cashier','waiter'))
      order by m.id limit 200
    ) listed
  ) response_rows;
  return jsonb_build_object('schemaVersion',1,
    'scope',jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'candidates',candidates);
end
$function$;

alter function app_private.list_capture_assignment_candidates(uuid,jsonb) owner to postgres;
revoke all on function app_private.list_capture_assignment_candidates(uuid,jsonb) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.list_capture_assignment_candidates(uuid,jsonb) to app_api;

comment on function app_private.list_capture_assignment_candidates(uuid,jsonb) is
  'Server-only bounded directory of active operational memberships in one authorized Branch. It excludes the acting user and returns no user identifier.';

create function app_private.mutate_capture_assignment(p_actor_id uuid, p_operation text, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  restaurant uuid;
  branch uuid;
  capture uuid;
  event uuid;
  device uuid;
  member uuid;
  target_member uuid;
  target_user uuid;
  requested_lease uuid;
  new_lease uuid;
  expected bigint;
  occurred timestamptz;
  observed timestamptz;
  fingerprint text;
  takeover_reason text;
  current_capture app.capture_drafts%rowtype;
  stored app.capture_command_events%rowtype;
  result_record jsonb;
  keys text[] := array[
    'schemaVersion','scope','captureDraftId','expectedVersion','eventId',
    'idempotencyKey','deviceId','occurredAt'
  ];
begin
  if p_operation = 'capture.transferred' then
    keys := keys || array['attentionLeaseId','targetMembershipId'];
  elsif p_operation = 'capture.taken_over' then
    keys := keys || array['reason'];
  end if;
  if p_actor_id is null
    or p_operation is null
    or p_operation not in ('capture.transferred','capture.taken_over')
    or not app_private.jsonb_has_exact_keys(p_command,keys)
    or not app_private.jsonb_has_exact_keys(p_command->'scope',array['restaurantId','branchId'])
    or p_command->'schemaVersion' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_command->'expectedVersion') is distinct from 'number'
    or not coalesce(p_command->>'expectedVersion' ~ '^[1-9][0-9]*$',false)
    or not coalesce(p_command->>'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
    or (p_operation = 'capture.taken_over' and (
      pg_catalog.jsonb_typeof(p_command->'reason') is distinct from 'string'
      or char_length(btrim(p_command->>'reason')) not between 1 and 500
      or p_command->>'reason' ~ '[[:cntrl:]]'
    ))
  then return jsonb_build_object('status','rejected'); end if;
  begin
    restaurant := (p_command#>>'{scope,restaurantId}')::uuid;
    branch := (p_command#>>'{scope,branchId}')::uuid;
    capture := (p_command->>'captureDraftId')::uuid;
    event := (p_command->>'eventId')::uuid;
    device := (p_command->>'deviceId')::uuid;
    expected := (p_command->>'expectedVersion')::bigint;
    occurred := (p_command->>'occurredAt')::timestamptz;
    if p_operation = 'capture.transferred' then
      requested_lease := (p_command->>'attentionLeaseId')::uuid;
      target_member := (p_command->>'targetMembershipId')::uuid;
    else
      takeover_reason := btrim(p_command->>'reason');
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    return jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or capture is null or event is null or device is null
    or expected not between 1 and 9007199254740990 or occurred is null
    or p_command->>'occurredAt' is distinct from to_char(occurred at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    or (p_operation = 'capture.transferred' and (requested_lease is null or target_member is null))
  then return jsonb_build_object('status','rejected'); end if;

  select m.id into member from app.memberships as m
    join app.branches as b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
    join app.restaurants as r on r.id=m.restaurant_id
    join app.membership_role_grants as g on g.membership_id=m.id
    where m.user_id=p_actor_id and m.restaurant_id=restaurant and m.branch_id=branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null
      and g.revoked_at is null and g.role_code in ('owner','admin','manager','supervisor')
    order by g.role_code limit 1 for share of m,b,r,g;
  if member is null then return jsonb_build_object('status','denied'); end if;

  fingerprint := encode(pg_catalog.sha256(convert_to(
    p_operation || ':' || p_command::text || ':' || p_actor_id::text,'UTF8')), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'capture-command:' || p_actor_id::text || ':' || restaurant::text || ':' || branch::text || ':' || (p_command->>'idempotencyKey'),0));
  select * into stored from app.capture_command_events where actor_id=p_actor_id
    and restaurant_id=restaurant and branch_id=branch and idempotency_key=p_command->>'idempotencyKey';
  if found then
    if stored.operation<>p_operation or stored.command_fingerprint<>fingerprint
      then return jsonb_build_object('status','conflict'); end if;
    return jsonb_build_object('status','replayed','record',stored.result_capture);
  end if;

  if p_operation = 'capture.transferred' then
    select m.user_id into target_user from app.memberships as m
      join app.membership_role_grants as g on g.membership_id=m.id
      where m.id=target_member and m.restaurant_id=restaurant and m.branch_id=branch
        and m.revoked_at is null and g.revoked_at is null
        and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
      order by g.role_code limit 1 for share of m,g;
    if target_user is null or target_user=p_actor_id then return jsonb_build_object('status','denied'); end if;
  end if;

  select * into current_capture from app.capture_drafts
    where restaurant_id=restaurant and branch_id=branch and id=capture for update;
  if not found or current_capture.version<>expected or current_capture.status<>'draft'
    then return jsonb_build_object('status','conflict'); end if;
  observed := greatest(date_trunc('milliseconds',clock_timestamp()),current_capture.updated_at);
  if current_capture.attention_status<>'claimed'
    or current_capture.owner_membership_id is null
    or current_capture.attention_lease_id is null
    or current_capture.attention_lease_expires_at<=observed
  then return jsonb_build_object('status','conflict'); end if;
  if p_operation = 'capture.transferred' then
    if current_capture.owner_membership_id is distinct from member
      or current_capture.attention_lease_id is distinct from requested_lease
      or target_member=current_capture.owner_membership_id
    then return jsonb_build_object('status','conflict'); end if;
  elsif current_capture.owner_membership_id=member then
    return jsonb_build_object('status','conflict');
  else
    target_member := member;
  end if;

  select result_capture into result_record from app.capture_command_events
    where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture and result_version=expected;
  if not found then raise exception using errcode='55000', message='CAPTURE_JOURNAL_CURRENT_VERSION_MISSING'; end if;
  new_lease := gen_random_uuid();
  result_record := jsonb_build_object('schemaVersion',1,
    'detail',(result_record->'detail') || jsonb_build_object(
      'version',expected+1,
      'updatedAt',to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'attentionStatus','claimed',
      'ownerMembershipId',target_member::text,
      'attentionLeaseId',new_lease::text,
      'attentionLeaseExpiresAt',to_char((observed+interval '5 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'recoveryPolicy',result_record->'recoveryPolicy');
  begin
    update app.capture_drafts set version=expected+1,updated_at=observed,updated_by=p_actor_id,
      owner_membership_id=target_member,attention_status='claimed',attention_lease_id=new_lease,
      attention_lease_expires_at=observed+interval '5 minutes'
      where restaurant_id=restaurant and branch_id=branch and id=capture;
    insert into app.capture_command_events(event_id,restaurant_id,branch_id,capture_draft_id,actor_id,
      actor_membership_id,device_id,operation,idempotency_key,command_fingerprint,
      expected_version,result_version,result_capture,reason,occurred_at,received_at)
    values(event,restaurant,branch,capture,p_actor_id,member,device,p_operation,p_command->>'idempotencyKey',
      fingerprint,expected,expected+1,result_record,takeover_reason,occurred,observed);
  exception when unique_violation then return jsonb_build_object('status','conflict');
  end;
  return jsonb_build_object('status','applied','record',result_record);
end
$function$;

alter function app_private.mutate_capture_assignment(uuid,text,jsonb) owner to postgres;
revoke all on function app_private.mutate_capture_assignment(uuid,text,jsonb) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.mutate_capture_assignment(uuid,text,jsonb) to app_api;

comment on function app_private.mutate_capture_assignment(uuid,text,jsonb) is
  'Privileged server-only Capture transfer/takeover. Transfer requires current lease ownership; takeover requires another active owner and an audited reason. Both rotate the lease and persist CAS result plus event atomically.';

commit;
