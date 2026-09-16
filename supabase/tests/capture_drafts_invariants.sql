-- Test-only, composed into the rollback verifier transaction. Never apply as a migration.
begin;
do $capture_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant_a uuid := gen_random_uuid();
  restaurant_b uuid := gen_random_uuid();
  branch_a uuid := gen_random_uuid();
  branch_b uuid := gen_random_uuid();
  branch_other uuid := gen_random_uuid();
  member_a uuid := gen_random_uuid();
  member_b uuid := gen_random_uuid();
  member_other uuid := gen_random_uuid();
  capture_id uuid := gen_random_uuid();
  test_case record;
  actual_constraint text;
  now_at timestamptz := clock_timestamp();
  checks integer := 0;
  journal_id uuid := gen_random_uuid();
  journal_checks integer := 0;
  missing_capture uuid := gen_random_uuid();
  create_command jsonb;
  create_result jsonb;
  created_id uuid := gen_random_uuid();
  orphan_id uuid := gen_random_uuid();
  attention_command jsonb;
  hold_result jsonb;
  attention_result jsonb;
  preference_command jsonb;
  preference_result jsonb;
begin
  if actor is null then raise exception 'CAPTURE_TEST_ACTOR_REQUIRED'; end if;
  insert into app.restaurants (id, name, time_zone) values
    (restaurant_a, 'rollback-only capture fixture A', 'America/Hermosillo'),
    (restaurant_b, 'rollback-only capture fixture B', 'America/Hermosillo');
  insert into app.branches (id, restaurant_id, name) values
    (branch_a, restaurant_a, 'rollback-only capture fixture A'),
    (branch_b, restaurant_b, 'rollback-only capture fixture B'),
    (branch_other, restaurant_a, 'rollback-only capture fixture other branch');
  insert into app.memberships (id, user_id, restaurant_id, branch_id, granted_by) values
    (member_a, actor, restaurant_a, branch_a, actor),
    (member_b, actor, restaurant_b, branch_b, actor),
    (member_other, actor, restaurant_a, branch_other, actor);
  insert into app.capture_drafts (
    id, restaurant_id, branch_id, folio, source_channel, attention_status,
    owner_membership_id, attention_lease_id, attention_lease_expires_at,
    recovery_expires_at, created_at, updated_at, created_by, updated_by
  ) values (
    capture_id, restaurant_a, branch_a, 'rollback-capture', 'phone', 'claimed',
    member_a, gen_random_uuid(), now_at + interval '5 minutes',
    now_at + interval '1 month', now_at, now_at, actor, actor
  );

  for test_case in select * from (values
    ('attention_lease_id = null', 'capture_drafts_attention_evidence'),
    ('owner_membership_id = null', 'capture_drafts_attention_evidence'),
    ('attention_lease_expires_at = null', 'capture_drafts_attention_evidence'),
    ('attention_status = ''held''', 'capture_drafts_attention_evidence'),
    ('status = ''no_sale''', 'capture_drafts_terminal_attention'),
    ('status = ''confirmed'', attention_status = ''unclaimed'', owner_membership_id = null, attention_lease_id = null, attention_lease_expires_at = null', 'capture_drafts_confirmation_evidence'),
    ('version = 0', 'capture_drafts_version_valid'),
    ('version = 9007199254740992', 'capture_drafts_version_valid'),
    ('source_channel = ''unknown''', 'capture_drafts_source_valid'),
    ('fulfillment_channel = ''unknown''', 'capture_drafts_fulfillment_valid'),
    ('recovery_expires_at = created_at', 'capture_drafts_timestamp_order'),
    ('updated_at = created_at - interval ''1 second''', 'capture_drafts_timestamp_order'),
    ('folio = '' padded ''', 'capture_drafts_folio_valid'),
    (format('owner_membership_id = %L::uuid', member_b), 'capture_drafts_owner_scope_fk'),
    (format('owner_membership_id = %L::uuid', member_other), 'capture_drafts_owner_scope_fk'),
    (format('branch_id = %L::uuid, attention_status = ''unclaimed'', owner_membership_id = null, attention_lease_id = null, attention_lease_expires_at = null', branch_b), 'capture_drafts_branch_fk')
  ) as cases(assignment, expected_constraint) loop
    begin
      execute format('update app.capture_drafts set %s where restaurant_id = $1 and branch_id = $2 and id = $3', test_case.assignment)
        using restaurant_a, branch_a, capture_id;
      raise exception 'CAPTURE_TEST_INVALID_WRITE_ACCEPTED';
    exception when check_violation or foreign_key_violation then
      get stacked diagnostics actual_constraint = constraint_name;
      if actual_constraint <> test_case.expected_constraint then
        raise exception 'CAPTURE_TEST_WRONG_CONSTRAINT';
      end if;
      checks := checks + 1;
    end;
  end loop;
  if checks <> 16 then raise exception 'CAPTURE_TEST_CHECK_COUNT_REJECTED'; end if;

  insert into app.capture_command_events (
    event_id, restaurant_id, branch_id, capture_draft_id, actor_id, actor_membership_id,
    device_id, operation, idempotency_key, command_fingerprint, expected_version,
    result_version, occurred_at, result_capture
  ) values (
    journal_id, restaurant_a, branch_a, capture_id, actor, member_a,
    gen_random_uuid(), 'capture.created', 'rollback-capture-command', repeat('a', 64), 0,
    1, now_at, jsonb_build_object('schemaVersion', 1,
      'detail', jsonb_build_object('schemaVersion', 1, 'captureDraftId', capture_id,
        'scope', jsonb_build_object('restaurantId', restaurant_a, 'branchId', branch_a), 'version', 1),
      'recoveryPolicy', jsonb_build_object('schemaVersion', 1, 'autoRenewSelected', false,
        'recoveryExpiresAt', to_char(now_at + interval '1 month', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
  );
  for test_case in select * from (values
    ('idempotency_key = '' ''', 'capture_events_idempotency_valid'),
    ('command_fingerprint = ''invalid''', 'capture_events_fingerprint_valid'),
    ('operation = ''unknown''', 'capture_events_operation_valid'),
    ('expected_version = 1', 'capture_events_version_valid'),
    ('operation = ''capture.taken_over'', expected_version = 1, result_version = 2, result_capture = jsonb_set(result_capture, ''{detail,version}'', ''2''::jsonb)', 'capture_events_reason_valid'),
    ('result_capture = ''{}''::jsonb', 'capture_events_result_valid'),
    ('result_capture = result_capture || ''{"rawCustomerData":"forbidden"}''::jsonb', 'capture_events_result_valid'),
    (format('actor_membership_id = %L::uuid', member_other), 'capture_events_actor_scope_fk'),
    (format('actor_membership_id = %L::uuid', member_b), 'capture_events_actor_scope_fk'),
    (format('capture_draft_id = %L::uuid, result_capture = jsonb_set(result_capture, ''{detail,captureDraftId}'', to_jsonb(%L::text))', missing_capture, missing_capture), 'capture_events_capture_scope_fk')
  ) as cases(assignment, expected_constraint) loop
    begin
      execute format('update app.capture_command_events set %s where event_id = $1', test_case.assignment)
        using journal_id;
      raise exception 'CAPTURE_JOURNAL_INVALID_WRITE_ACCEPTED';
    exception when check_violation or foreign_key_violation then
      get stacked diagnostics actual_constraint = constraint_name;
      if actual_constraint <> test_case.expected_constraint then
        raise exception using message = 'CAPTURE_JOURNAL_WRONG_CONSTRAINT', detail = actual_constraint;
      end if;
      journal_checks := journal_checks + 1;
    end;
  end loop;
  if journal_checks <> 10 then raise exception 'CAPTURE_JOURNAL_CHECK_COUNT_REJECTED'; end if;
  begin
    insert into app.capture_command_events
      select (jsonb_populate_record(null::app.capture_command_events,
        to_jsonb(event) || jsonb_build_object('event_id', gen_random_uuid(), 'operation', 'capture.autosaved',
          'expected_version', 1, 'result_version', 2,
          'result_capture', jsonb_set(event.result_capture, '{detail,version}', '2'::jsonb)))).*
      from app.capture_command_events as event where event_id = journal_id;
    raise exception 'CAPTURE_JOURNAL_DUPLICATE_COMMAND_ACCEPTED';
  exception when unique_violation then
    get stacked diagnostics actual_constraint = constraint_name;
    if actual_constraint <> 'capture_events_idempotency_unique' then raise exception using message = 'CAPTURE_JOURNAL_WRONG_UNIQUE', detail = actual_constraint; end if;
  end;
  begin
    insert into app.capture_command_events
      select (jsonb_populate_record(null::app.capture_command_events,
        to_jsonb(event) || jsonb_build_object('event_id', gen_random_uuid(), 'idempotency_key', 'different-command'))).*
      from app.capture_command_events as event where event_id = journal_id;
    raise exception 'CAPTURE_JOURNAL_DUPLICATE_VERSION_ACCEPTED';
  exception when unique_violation then
    get stacked diagnostics actual_constraint = constraint_name;
    if actual_constraint <> 'capture_events_version_unique' then raise exception using message = 'CAPTURE_JOURNAL_WRONG_UNIQUE', detail = actual_constraint; end if;
  end;

  -- Positive hold and terminal paths must succeed; recovery opt-in is independent of ownership.
  update app.capture_drafts set attention_status = 'held', owner_membership_id = null,
    attention_lease_id = null, attention_lease_expires_at = null, auto_renew_selected = true
    where restaurant_id = restaurant_a and branch_id = branch_a and id = capture_id;
  update app.capture_drafts set status = 'no_sale', attention_status = 'unclaimed'
    where restaurant_id = restaurant_a and branch_id = branch_a and id = capture_id;
  if not exists (select 1 from app.capture_drafts where restaurant_id = restaurant_a
    and branch_id = branch_a and id = capture_id and status = 'no_sale' and auto_renew_selected)
  then raise exception 'CAPTURE_TEST_POSITIVE_PATH_REJECTED'; end if;

  insert into app.membership_role_grants (membership_id, role_code, granted_by)
    values (member_a, 'cashier', actor);
  create_command := jsonb_build_object('schemaVersion',1,'expectedVersion',0,
    'scope',jsonb_build_object('restaurantId',restaurant_a::text,'branchId',branch_a::text),
    'captureDraftId',created_id::text,'sourceChannel','phone','fulfillmentChannel',null,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',gen_random_uuid()::text,
    'occurredAt',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  create_result := app_private.create_capture_draft(actor, create_command);
  if create_result ->> 'status' is distinct from 'applied' or create_result #>> '{record,detail,status}' is distinct from 'draft'
    or create_result #>> '{record,detail,ownerMembershipId}' is distinct from member_a::text
    or create_result #>> '{record,recoveryPolicy,autoRenewSelected}' is distinct from 'false'
  then raise exception 'CAPTURE_CREATE_POSITIVE_PATH_REJECTED'; end if;
  if app_private.create_capture_draft(actor, create_command) is distinct from
    jsonb_build_object('status','replayed','record',create_result -> 'record')
  then raise exception 'CAPTURE_CREATE_REPLAY_REJECTED'; end if;
  if app_private.create_capture_draft(actor, create_command || '{"sourceChannel":"counter"}'::jsonb) ->> 'status' is distinct from 'conflict'
  then raise exception 'CAPTURE_CREATE_DIVERGENT_REPLAY_ACCEPTED'; end if;
  if app_private.create_capture_draft(actor, create_command || '{"actorId":"forbidden"}'::jsonb) ->> 'status' is distinct from 'rejected'
  then raise exception 'CAPTURE_CREATE_EXTRA_FIELD_ACCEPTED'; end if;
  if app_private.create_capture_draft(actor, create_command || '{"occurredAt":"infinity"}'::jsonb) ->> 'status' is distinct from 'rejected'
  then raise exception 'CAPTURE_CREATE_NONCANONICAL_TIME_ACCEPTED'; end if;
  if app_private.create_capture_draft(actor, jsonb_set(create_command, '{scope,branchId}', to_jsonb(branch_other::text))) ->> 'status' is distinct from 'denied'
  then raise exception 'CAPTURE_CREATE_WRONG_SCOPE_ACCEPTED'; end if;
  if app_private.create_capture_draft(actor, create_command || jsonb_build_object(
    'captureDraftId',orphan_id::text,'eventId',journal_id::text,'idempotencyKey',gen_random_uuid()::text)) ->> 'status' is distinct from 'conflict'
    or exists (select 1 from app.capture_drafts where restaurant_id = restaurant_a and branch_id = branch_a and id = orphan_id)
  then raise exception 'CAPTURE_CREATE_ORPHAN_AFTER_EVENT_COLLISION'; end if;
  if (select count(*) from app.capture_command_events where restaurant_id = restaurant_a
    and branch_id = branch_a and capture_draft_id = created_id) <> 1
  then raise exception 'CAPTURE_CREATE_REPLAY_DUPLICATED_AUDIT'; end if;
  attention_command := (create_command - array['sourceChannel','fulfillmentChannel']) || jsonb_build_object(
    'expectedVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'attentionLeaseId',create_result #>> '{record,detail,attentionLeaseId}');
  if app_private.mutate_capture_attention(actor,'capture.held',attention_command || '{"occurredAt":"infinity"}'::jsonb) ->> 'status' is distinct from 'rejected'
  then raise exception 'CAPTURE_ATTENTION_NONCANONICAL_TIME_ACCEPTED'; end if;
  if app_private.mutate_capture_attention(actor,'capture.held', attention_command || jsonb_build_object('attentionLeaseId',gen_random_uuid()::text)) ->> 'status' is distinct from 'conflict'
  then raise exception 'CAPTURE_HOLD_WRONG_LEASE_ACCEPTED'; end if;
  hold_result := app_private.mutate_capture_attention(actor,'capture.held',attention_command);
  if hold_result ->> 'status' is distinct from 'applied' or hold_result #>> '{record,detail,attentionStatus}' is distinct from 'held'
    or hold_result #> '{record,detail,ownerMembershipId}' is distinct from 'null'::jsonb
    or hold_result #> '{record,detail,attentionLeaseId}' is distinct from 'null'::jsonb
    or hold_result #>> '{record,detail,version}' is distinct from '2'
  then raise exception 'CAPTURE_HOLD_POSITIVE_PATH_REJECTED'; end if;
  if app_private.mutate_capture_attention(actor,'capture.held',attention_command) is distinct from
    jsonb_build_object('status','replayed','record',hold_result -> 'record')
  then raise exception 'CAPTURE_HOLD_REPLAY_REJECTED'; end if;
  attention_command := (attention_command - 'attentionLeaseId') || jsonb_build_object(
    'expectedVersion',2,'eventId',journal_id::text,'idempotencyKey',gen_random_uuid()::text);
  if app_private.mutate_capture_attention(actor,'capture.resumed',attention_command) ->> 'status' is distinct from 'conflict'
    or not exists (select 1 from app.capture_drafts where restaurant_id = restaurant_a and branch_id = branch_a
      and id = created_id and version = 2 and attention_status = 'held' and owner_membership_id is null)
  then raise exception 'CAPTURE_RESUME_EVENT_COLLISION_CHANGED_CAPTURE'; end if;
  attention_command := attention_command || jsonb_build_object('eventId',gen_random_uuid()::text);
  attention_result := app_private.mutate_capture_attention(actor,'capture.resumed',attention_command);
  if attention_result ->> 'status' is distinct from 'applied' or attention_result #>> '{record,detail,version}' is distinct from '3'
    or attention_result #>> '{record,detail,attentionStatus}' is distinct from 'claimed'
  then raise exception 'CAPTURE_RESUME_POSITIVE_PATH_REJECTED'; end if;
  attention_command := attention_command || jsonb_build_object('expectedVersion',3,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text);
  if app_private.mutate_capture_attention(actor,'capture.claimed',attention_command) ->> 'status' is distinct from 'conflict'
  then raise exception 'CAPTURE_CLAIM_ACTIVE_RESERVATION_ACCEPTED'; end if;
  update app.capture_drafts set attention_lease_expires_at = clock_timestamp() - interval '1 second'
    where restaurant_id = restaurant_a and branch_id = branch_a and id = created_id;
  if app_private.mutate_capture_attention(actor,'capture.resumed',attention_command) ->> 'status' is distinct from 'conflict'
  then raise exception 'CAPTURE_RESUME_NONHELD_ACCEPTED'; end if;
  attention_result := app_private.mutate_capture_attention(actor,'capture.claimed',attention_command);
  if attention_result ->> 'status' is distinct from 'applied' or attention_result #>> '{record,detail,version}' is distinct from '4'
    or attention_result #>> '{record,detail,attentionLeaseId}' = create_result #>> '{record,detail,attentionLeaseId}'
  then raise exception 'CAPTURE_CLAIM_EXPIRED_LEASE_REJECTED'; end if;
  if app_private.mutate_capture_attention(actor,'capture.claimed',attention_command || '{"expectedVersion":3,"idempotencyKey":"88d34b74-6afe-4a3c-acb9-9fc8ed902c91"}'::jsonb) ->> 'status' is distinct from 'conflict'
  then raise exception 'CAPTURE_CLAIM_STALE_VERSION_ACCEPTED'; end if;
  attention_command := attention_command || jsonb_build_object('expectedVersion',4,
    'attentionLeaseId',attention_result #>> '{record,detail,attentionLeaseId}',
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text);
  if app_private.mutate_capture_attention(actor,'capture.held',attention_command) ->> 'status' is distinct from 'applied'
  then raise exception 'CAPTURE_HOLD_RECLAIMED_LEASE_REJECTED'; end if;
  update app.capture_drafts set created_at = clock_timestamp() - interval '2 months',
    recovery_expires_at = clock_timestamp() - interval '1 second'
    where restaurant_id = restaurant_a and branch_id = branch_a and id = created_id;
  attention_command := (attention_command - 'attentionLeaseId') || jsonb_build_object('expectedVersion',5,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text);
  if app_private.mutate_capture_attention(actor,'capture.claimed',attention_command) ->> 'status' is distinct from 'conflict'
  then raise exception 'CAPTURE_RECOVERY_EXPIRED_OPTOUT_ACCEPTED'; end if;
  update app.capture_drafts set auto_renew_selected = true
    where restaurant_id = restaurant_a and branch_id = branch_a and id = created_id;
  attention_result := app_private.mutate_capture_attention(actor,'capture.claimed',attention_command);
  if attention_result ->> 'status' is distinct from 'applied'
    or attention_result #>> '{record,detail,version}' is distinct from '6'
    or attention_result #>> '{record,recoveryPolicy,autoRenewSelected}' is distinct from 'true'
    or not exists (select 1 from app.capture_drafts where restaurant_id = restaurant_a and branch_id = branch_a
      and id = created_id and recovery_expires_at > clock_timestamp())
  then raise exception 'CAPTURE_RECOVERY_EXPIRED_OPTIN_REJECTED'; end if;
  preference_command := attention_command || jsonb_build_object('expectedVersion',6,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'attentionLeaseId',attention_result #>> '{record,detail,attentionLeaseId}','autoRenewSelected',false);
  if app_private.mutate_capture_attention(actor,'capture.recovery_preference_changed',
    preference_command || '{"recoveryExpiresAt":"2099-01-01T00:00:00.000Z"}'::jsonb) ->> 'status' is distinct from 'rejected'
  then raise exception 'CAPTURE_PREFERENCE_CLIENT_DEADLINE_ACCEPTED'; end if;
  preference_result := app_private.mutate_capture_attention(actor,'capture.recovery_preference_changed',preference_command);
  if preference_result ->> 'status' is distinct from 'applied'
    or preference_result #>> '{record,detail,version}' is distinct from '7'
    or preference_result #>> '{record,recoveryPolicy,autoRenewSelected}' is distinct from 'false'
    or preference_result #>> '{record,recoveryPolicy,recoveryExpiresAt}' is distinct from attention_result #>> '{record,recoveryPolicy,recoveryExpiresAt}'
    or preference_result #>> '{record,detail,attentionLeaseExpiresAt}' is distinct from attention_result #>> '{record,detail,attentionLeaseExpiresAt}'
    or preference_result #>> '{record,detail,attentionLeaseId}' is distinct from attention_result #>> '{record,detail,attentionLeaseId}'
  then raise exception 'CAPTURE_PREFERENCE_CHANGED_DEADLINES_OR_LEASE'; end if;
  if app_private.mutate_capture_attention(actor,'capture.recovery_preference_changed',preference_command) is distinct from
    jsonb_build_object('status','replayed','record',preference_result -> 'record')
  then raise exception 'CAPTURE_PREFERENCE_REPLAY_REJECTED'; end if;
  if app_private.mutate_capture_attention(actor,'capture.recovery_preference_changed',
    preference_command || '{"autoRenewSelected":true}'::jsonb) ->> 'status' is distinct from 'conflict'
  then raise exception 'CAPTURE_PREFERENCE_DIVERGENT_REPLAY_ACCEPTED'; end if;
  preference_command := preference_command || jsonb_build_object('expectedVersion',7,'autoRenewSelected',true,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text);
  preference_result := app_private.mutate_capture_attention(actor,'capture.recovery_preference_changed',preference_command);
  if preference_result ->> 'status' is distinct from 'applied'
    or preference_result #>> '{record,recoveryPolicy,autoRenewSelected}' is distinct from 'true'
    or preference_result #>> '{record,recoveryPolicy,recoveryExpiresAt}' is distinct from attention_result #>> '{record,recoveryPolicy,recoveryExpiresAt}'
  then raise exception 'CAPTURE_PREFERENCE_OPTIN_REJECTED'; end if;
  update app.capture_drafts set attention_lease_expires_at = clock_timestamp() - interval '1 second'
    where restaurant_id = restaurant_a and branch_id = branch_a and id = created_id;
  if app_private.mutate_capture_attention(actor,'capture.recovery_preference_changed',
    preference_command || jsonb_build_object('expectedVersion',8,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text)) ->> 'status' is distinct from 'conflict'
  then raise exception 'CAPTURE_PREFERENCE_EXPIRED_LEASE_ACCEPTED'; end if;
  update app.membership_role_grants set revoked_at = clock_timestamp(), revoked_by = actor,
    revocation_reason = 'rollback-only fixture revocation' where membership_id = member_a and role_code = 'cashier';
  if app_private.create_capture_draft(actor, create_command) ->> 'status' is distinct from 'denied'
  then raise exception 'CAPTURE_CREATE_REVOKED_REPLAY_ACCEPTED'; end if;
end
$capture_tests$;
commit;
