-- Test-only, composed into the rollback verifier transaction. Never apply as a migration.
begin;
do $capture_assignment_invariants$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  target_actor uuid := (select id from auth.users where deleted_at is null order by id offset 1 limit 1);
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  member uuid := gen_random_uuid();
  target_member uuid := gen_random_uuid();
  foreign_member uuid := gen_random_uuid();
  capture uuid := gen_random_uuid();
  create_event uuid := gen_random_uuid();
  now_at timestamptz := date_trunc('milliseconds',clock_timestamp());
  base_command jsonb;
  create_command jsonb;
  create_result jsonb;
  transfer_command jsonb;
  transfer_result jsonb;
  takeover_command jsonb;
  takeover_result jsonb;
  collision_command jsonb;
  directory_request jsonb;
  directory_result jsonb;
begin
  if actor is null or target_actor is null or actor=target_actor then
    raise exception using errcode='55000', message='CAPTURE_ASSIGNMENT_TWO_ACTORS_REQUIRED';
  end if;
  insert into app.restaurants(id,name,time_zone)
    values(restaurant,'rollback-only capture assignment','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (branch,restaurant,'rollback-only capture assignment'),
    (other_branch,restaurant,'rollback-only capture assignment other');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values
    (member,actor,restaurant,branch,actor),
    (target_member,target_actor,restaurant,branch,actor),
    (foreign_member,target_actor,restaurant,other_branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values
    (member,'supervisor',actor),(target_member,'cashier',actor),(foreign_member,'cashier',actor);

  directory_request:=jsonb_build_object('schemaVersion',1,
    'scope',jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text));
  execute 'set local role app_api';
  directory_result:=app_private.list_capture_assignment_candidates(actor,directory_request);
  if pg_catalog.jsonb_array_length(directory_result->'candidates')<>1
    or directory_result#>>'{scope,restaurantId}'<>restaurant::text
    or directory_result#>>'{scope,branchId}'<>branch::text
    or directory_result#>>'{candidates,0,membershipId}'<>target_member::text
    or directory_result#>'{candidates,0,roles}' is distinct from '["cashier"]'::jsonb
    or char_length(directory_result#>>'{candidates,0,displayLabel}') not between 1 and 320
    or directory_result#>>'{candidates,0,displayLabel}' ~ '[[:cntrl:]]'
  then raise exception using errcode='55000', message='CAPTURE_ASSIGNMENT_DIRECTORY_SCOPE_REJECTED';end if;
  if app_private.list_capture_assignment_candidates(target_actor,directory_request)->>'status'<>'denied'
    or app_private.list_capture_assignment_candidates(actor,directory_request||'{"unexpected":true}'::jsonb)->>'status'<>'rejected'
  then raise exception using errcode='55000', message='CAPTURE_ASSIGNMENT_DIRECTORY_AUTHORIZATION_REJECTED';end if;
  execute 'reset role';

  base_command := jsonb_build_object(
    'schemaVersion',1,'scope',jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',capture::text,'eventId',create_event::text,'idempotencyKey',gen_random_uuid()::text,
    'deviceId',gen_random_uuid()::text,
    'occurredAt',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  create_command := base_command || jsonb_build_object(
    'expectedVersion',0,'sourceChannel','phone','fulfillmentChannel',null
  );
  execute 'set local role app_api';
  create_result := app_private.create_capture_draft(actor,create_command);
  execute 'reset role';
  if create_result->>'status'<>'applied'
    or create_result#>>'{record,detail,ownerMembershipId}'<>member::text
    or create_result#>>'{record,detail,version}'<>'1'
  then raise exception using errcode='55000', message='CAPTURE_ASSIGNMENT_CREATE_REJECTED'; end if;

  transfer_command := (base_command - 'eventId' - 'idempotencyKey') || jsonb_build_object(
    'expectedVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'attentionLeaseId',create_result#>>'{record,detail,attentionLeaseId}',
    'targetMembershipId',target_member::text
  );
  execute 'set local role app_api';
  if app_private.mutate_capture_assignment(actor,'capture.transferred',
      transfer_command || jsonb_build_object('attentionLeaseId',gen_random_uuid()::text))->>'status'<>'conflict'
    or app_private.mutate_capture_assignment(actor,'capture.transferred',
      transfer_command || jsonb_build_object('targetMembershipId',foreign_member::text))->>'status'<>'denied'
    or app_private.mutate_capture_assignment(actor,'capture.transferred',
      transfer_command || jsonb_build_object('targetMembershipId',member::text))->>'status'<>'denied'
    or app_private.mutate_capture_assignment(actor,'capture.transferred',
      transfer_command || '{"unexpected":true}'::jsonb)->>'status'<>'rejected'
  then raise exception using errcode='55000', message='CAPTURE_TRANSFER_GUARD_REJECTED'; end if;
  transfer_result := app_private.mutate_capture_assignment(actor,'capture.transferred',transfer_command);
  if transfer_result->>'status'<>'applied'
    or transfer_result#>>'{record,detail,ownerMembershipId}'<>target_member::text
    or transfer_result#>>'{record,detail,version}'<>'2'
    or transfer_result#>>'{record,detail,attentionLeaseId}'=create_result#>>'{record,detail,attentionLeaseId}'
    or app_private.mutate_capture_assignment(actor,'capture.transferred',transfer_command)
      is distinct from jsonb_build_object('status','replayed','record',transfer_result->'record')
    or app_private.mutate_capture_assignment(actor,'capture.transferred',
      transfer_command || jsonb_build_object('targetMembershipId',foreign_member::text))->>'status'<>'conflict'
  then raise exception using errcode='55000', message='CAPTURE_TRANSFER_RESULT_REJECTED'; end if;
  if app_private.mutate_capture_assignment(target_actor,'capture.taken_over',
    (base_command - 'eventId' - 'idempotencyKey') || jsonb_build_object(
      'expectedVersion',2,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'reason','forbidden'
    ))->>'status'<>'denied'
  then raise exception using errcode='55000', message='CAPTURE_TAKEOVER_UNPRIVILEGED_ACCEPTED'; end if;
  execute 'reset role';

  takeover_command := (base_command - 'eventId' - 'idempotencyKey') || jsonb_build_object(
    'expectedVersion',2,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'reason','Operador ausente durante el servicio'
  );
  execute 'set local role app_api';
  if app_private.mutate_capture_assignment(actor,'capture.taken_over',
      takeover_command || jsonb_build_object('reason',' '))->>'status'<>'rejected'
    or app_private.mutate_capture_assignment(actor,'capture.taken_over',
      takeover_command || jsonb_build_object('targetMembershipId',member::text))->>'status'<>'rejected'
  then raise exception using errcode='55000', message='CAPTURE_TAKEOVER_COMMAND_REJECTED'; end if;
  takeover_result := app_private.mutate_capture_assignment(actor,'capture.taken_over',takeover_command);
  if takeover_result->>'status'<>'applied'
    or takeover_result#>>'{record,detail,ownerMembershipId}'<>member::text
    or takeover_result#>>'{record,detail,version}'<>'3'
    or takeover_result#>>'{record,detail,attentionLeaseId}'=transfer_result#>>'{record,detail,attentionLeaseId}'
    or app_private.mutate_capture_assignment(actor,'capture.taken_over',takeover_command)
      is distinct from jsonb_build_object('status','replayed','record',takeover_result->'record')
    or app_private.mutate_capture_assignment(actor,'capture.taken_over',
      takeover_command || jsonb_build_object('reason','Motivo divergente'))->>'status'<>'conflict'
  then raise exception using errcode='55000', message='CAPTURE_TAKEOVER_RESULT_REJECTED'; end if;
  if app_private.mutate_capture_assignment(actor,'capture.taken_over',
    (takeover_command - 'eventId' - 'idempotencyKey') || jsonb_build_object(
      'expectedVersion',3,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text
    ))->>'status'<>'conflict'
  then raise exception using errcode='55000', message='CAPTURE_TAKEOVER_OWN_CAPTURE_ACCEPTED'; end if;

  collision_command := (transfer_command - 'eventId' - 'idempotencyKey' - 'attentionLeaseId') || jsonb_build_object(
    'expectedVersion',3,'eventId',create_event::text,'idempotencyKey',gen_random_uuid()::text,
    'attentionLeaseId',takeover_result#>>'{record,detail,attentionLeaseId}'
  );
  if app_private.mutate_capture_assignment(actor,'capture.transferred',collision_command)->>'status'<>'conflict'
  then raise exception using errcode='55000', message='CAPTURE_ASSIGNMENT_EVENT_COLLISION_ACCEPTED'; end if;
  execute 'reset role';

  if not exists(select 1 from app.capture_drafts where restaurant_id=restaurant and branch_id=branch and id=capture
      and version=3 and owner_membership_id=member
      and attention_lease_id=(takeover_result#>>'{record,detail,attentionLeaseId}')::uuid)
    or exists(select 1 from app.capture_command_events where restaurant_id=restaurant and branch_id=branch
      and capture_draft_id=capture and result_version=4)
  then raise exception using errcode='55000', message='CAPTURE_ASSIGNMENT_EVENT_COLLISION_PARTIAL_WRITE'; end if;
  if (select count(*) from app.capture_command_events where restaurant_id=restaurant and branch_id=branch
      and capture_draft_id=capture and operation='capture.transferred')<>1
    or not exists(select 1 from app.capture_command_events where restaurant_id=restaurant and branch_id=branch
      and capture_draft_id=capture and operation='capture.taken_over'
      and reason='Operador ausente durante el servicio' and actor_membership_id=member)
  then raise exception using errcode='55000', message='CAPTURE_ASSIGNMENT_AUDIT_REJECTED'; end if;
  update app.memberships set revoked_at=clock_timestamp(),revoked_by=actor,
    revocation_reason='rollback-only directory visibility check' where id=target_member;
  execute 'set local role app_api';
  directory_result:=app_private.list_capture_assignment_candidates(actor,directory_request);
  execute 'reset role';
  if pg_catalog.jsonb_array_length(directory_result->'candidates')<>0
  then raise exception using errcode='55000', message='CAPTURE_ASSIGNMENT_DIRECTORY_REVOKED_MEMBER_VISIBLE';end if;
end
$capture_assignment_invariants$;
commit;
