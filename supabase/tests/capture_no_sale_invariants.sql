-- Test-only, composed into the rollback verifier transaction. Never apply as a migration.
begin;
do $capture_no_sale_invariants$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  foreign_actor uuid := (select id from auth.users where deleted_at is null order by id offset 1 limit 1);
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  member uuid := gen_random_uuid();
  foreign_member uuid := gen_random_uuid();
  capture uuid := gen_random_uuid();
  confirmed_capture uuid := gen_random_uuid();
  confirmed_order uuid := gen_random_uuid();
  create_event uuid := gen_random_uuid();
  confirmed_create_event uuid := gen_random_uuid();
  now_at timestamptz := date_trunc('milliseconds',clock_timestamp());
  base_command jsonb;
  create_command jsonb;
  create_result jsonb;
  no_sale_command jsonb;
  no_sale_result jsonb;
  confirmed_create_result jsonb;
begin
  if actor is null or foreign_actor is null or actor=foreign_actor then
    raise exception using errcode='55000', message='CAPTURE_NO_SALE_TWO_ACTORS_REQUIRED';
  end if;
  insert into app.restaurants(id,name,time_zone)
    values(restaurant,'rollback-only capture no-sale','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (branch,restaurant,'rollback-only capture no-sale'),
    (other_branch,restaurant,'rollback-only capture no-sale other');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values
    (member,actor,restaurant,branch,actor),
    (foreign_member,foreign_actor,restaurant,other_branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values
    (member,'cashier',actor),(foreign_member,'cashier',actor);

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
  if create_result->>'status'<>'applied' or create_result#>>'{record,detail,version}'<>'1'
  then raise exception using errcode='55000', message='CAPTURE_NO_SALE_CREATE_REJECTED'; end if;

  no_sale_command := (base_command - 'eventId' - 'idempotencyKey') || jsonb_build_object(
    'expectedVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'attentionLeaseId',create_result#>>'{record,detail,attentionLeaseId}','reason','Cliente desistió antes de ordenar'
  );

  execute 'set local role app_api';
  -- fuga de scope: actor sin membership en esta sucursal
  if app_private.close_capture_no_sale(foreign_actor,no_sale_command)->>'status'<>'denied'
  then raise exception using errcode='55000', message='CAPTURE_NO_SALE_SCOPE_LEAK_ACCEPTED'; end if;
  -- motivo vacío
  if app_private.close_capture_no_sale(actor,no_sale_command || jsonb_build_object('reason',' '))->>'status'<>'rejected'
    or app_private.close_capture_no_sale(actor,no_sale_command - 'reason')->>'status'<>'rejected'
    or app_private.close_capture_no_sale(actor,no_sale_command || '{"unexpected":true}'::jsonb)->>'status'<>'rejected'
  then raise exception using errcode='55000', message='CAPTURE_NO_SALE_COMMAND_REJECTED'; end if;
  -- lease ajena
  if app_private.close_capture_no_sale(actor,
      no_sale_command || jsonb_build_object('attentionLeaseId',gen_random_uuid()::text))->>'status'<>'conflict'
  then raise exception using errcode='55000', message='CAPTURE_NO_SALE_FOREIGN_LEASE_ACCEPTED'; end if;
  -- CAS viejo
  if app_private.close_capture_no_sale(actor,
      (no_sale_command - 'eventId' - 'idempotencyKey') || jsonb_build_object(
        'expectedVersion',99,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text
      ))->>'status'<>'conflict'
  then raise exception using errcode='55000', message='CAPTURE_NO_SALE_STALE_CAS_ACCEPTED'; end if;

  -- transición válida
  no_sale_result := app_private.close_capture_no_sale(actor,no_sale_command);
  if no_sale_result->>'status'<>'applied'
    or no_sale_result#>>'{record,detail,status}'<>'no_sale'
    or no_sale_result#>>'{record,detail,version}'<>'2'
    or no_sale_result#>>'{record,detail,attentionStatus}'<>'unclaimed'
    or no_sale_result#>'{record,detail,ownerMembershipId}' is distinct from 'null'::jsonb
    or no_sale_result#>'{record,detail,attentionLeaseId}' is distinct from 'null'::jsonb
  then raise exception using errcode='55000', message='CAPTURE_NO_SALE_RESULT_REJECTED'; end if;

  -- replay determinista
  if app_private.close_capture_no_sale(actor,no_sale_command)
      is distinct from jsonb_build_object('status','replayed','record',no_sale_result->'record')
  then raise exception using errcode='55000', message='CAPTURE_NO_SALE_REPLAY_REJECTED'; end if;
  -- mismo idempotencyKey, comando distinto -> conflict
  if app_private.close_capture_no_sale(actor,
      no_sale_command || jsonb_build_object('reason','Motivo divergente'))->>'status'<>'conflict'
  then raise exception using errcode='55000', message='CAPTURE_NO_SALE_IDEMPOTENCY_FINGERPRINT_ACCEPTED'; end if;
  -- ya cerrada: repetir sobre el estado ya terminal con otra clave de idempotencia -> conflict
  if app_private.close_capture_no_sale(actor,
      (no_sale_command - 'eventId' - 'idempotencyKey') || jsonb_build_object(
        'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text
      ))->>'status'<>'conflict'
  then raise exception using errcode='55000', message='CAPTURE_NO_SALE_ALREADY_TERMINAL_ACCEPTED'; end if;
  execute 'reset role';

  if not exists(select 1 from app.capture_drafts where restaurant_id=restaurant and branch_id=branch and id=capture
      and status='no_sale' and version=2 and owner_membership_id is null and attention_lease_id is null
      and attention_lease_expires_at is null and attention_status='unclaimed')
  then raise exception using errcode='55000', message='CAPTURE_NO_SALE_DRAFT_STATE_REJECTED'; end if;
  if not exists(select 1 from app.capture_command_events where restaurant_id=restaurant and branch_id=branch
      and capture_draft_id=capture and operation='capture.no_sale' and result_version=2
      and reason='Cliente desistió antes de ordenar' and actor_membership_id=member)
  then raise exception using errcode='55000', message='CAPTURE_NO_SALE_AUDIT_REJECTED'; end if;

  -- La bandeja nunca lista capturas cerradas como no_sale.
  execute 'set local role app_api';
  if (app_private.list_capture_work_tray(actor,jsonb_build_object(
        'schemaVersion',1,'scope',jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),'limit',10
      ))->'items') @? ('$[*] ? (@.captureDraftId == "'||capture::text||'")')::jsonpath
  then raise exception using errcode='55000', message='CAPTURE_NO_SALE_TRAY_LEAK'; end if;
  execute 'reset role';

  -- captura ya confirmada -> conflict, nunca no_sale
  execute 'set local role app_api';
  confirmed_create_result := app_private.create_capture_draft(actor,jsonb_build_object(
    'schemaVersion',1,'scope',jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',confirmed_capture::text,'expectedVersion',0,'eventId',confirmed_create_event::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId',gen_random_uuid()::text,
    'occurredAt',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceChannel','phone','fulfillmentChannel',null
  ));
  execute 'reset role';
  insert into app.orders(id,restaurant_id,branch_id,channel,status,aggregate,version,created_by,updated_by)
    values(confirmed_order,restaurant,branch,'counter','draft',jsonb_build_object(
      'schemaVersion','1','orderId',confirmed_order::text,'restaurantId',restaurant::text,'branchId',branch::text,
      'channel','counter','status','draft','items','[]'::jsonb,
      'currency','MXN','timeZone','America/Hermosillo'
    ),1,actor,actor);
  update app.capture_drafts set status='confirmed',fulfillment_channel='counter',confirmed_order_id=confirmed_order,
    attention_status='unclaimed',owner_membership_id=null,attention_lease_id=null,attention_lease_expires_at=null
    where restaurant_id=restaurant and branch_id=branch and id=confirmed_capture;
  execute 'set local role app_api';
  if app_private.close_capture_no_sale(actor,jsonb_build_object(
      'schemaVersion',1,'scope',jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
      'captureDraftId',confirmed_capture::text,'expectedVersion',1,'eventId',gen_random_uuid()::text,
      'idempotencyKey',gen_random_uuid()::text,'deviceId',gen_random_uuid()::text,
      'occurredAt',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'attentionLeaseId',confirmed_create_result#>>'{record,detail,attentionLeaseId}','reason','No aplica'
    ))->>'status'<>'conflict'
  then raise exception using errcode='55000', message='CAPTURE_NO_SALE_TERMINAL_STATE_ACCEPTED'; end if;
  execute 'reset role';
end
$capture_no_sale_invariants$;
commit;
