begin;
do $test$
declare
  actor uuid := '00000000-0000-4000-8000-000000000001';
  restaurant uuid := gen_random_uuid(); branch uuid := gen_random_uuid(); member uuid := gen_random_uuid();
  capture uuid := gen_random_uuid(); delivery uuid := gen_random_uuid(); device uuid := gen_random_uuid();
  shift uuid := gen_random_uuid(); now_at timestamptz := date_trunc('milliseconds',clock_timestamp());
  scope jsonb; created jsonb; command jsonb; saved jsonb; workspace jsonb; result jsonb;
begin
  insert into app.restaurants(id,name,time_zone) values(restaurant,'pickup test','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(branch,restaurant,'pickup branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values(member,actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values(member,'cashier',actor);
  scope := jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text);
  command := jsonb_build_object('schemaVersion',1,'scope',scope,'captureDraftId',capture::text,'expectedVersion',0,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceChannel','phone','fulfillmentChannel','pickup');
  created := app_private.create_capture_draft(actor,command);
  if created->>'status' <> 'applied' then raise exception 'PICKUP_CREATE_FAILED: %',created; end if;
  command := command || jsonb_build_object('expectedVersion',1,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'attentionLeaseId',created#>>'{record,detail,attentionLeaseId}',
    'customerSnapshotRef',null,'fulfillmentSnapshotRef',null,'pickupContact',jsonb_build_object('name','Ana','phone','6621002000'));
  saved := app_private.autosave_capture_draft(actor,command);
  if saved->>'status' <> 'applied' then raise exception 'PICKUP_SAVE_FAILED: %',saved; end if;
  if app_private.autosave_capture_draft(actor,command)->>'status' <> 'replayed' then raise exception 'PICKUP_REPLAY_FAILED'; end if;
  if app_private.autosave_capture_draft(actor,jsonb_set(command,'{pickupContact,name}','"Other"'))->>'status' <> 'conflict' then
    raise exception 'PICKUP_IDEMPOTENCY_FAILED'; end if;
  workspace := app_private.read_capture_workspace_v2(actor,jsonb_build_object('schemaVersion',2,'scope',scope,'captureDraftId',capture::text));
  if workspace#>>'{detail,pickupContact,name}' <> 'Ana' or workspace#>>'{detail,pickupContact,phone}' <> '6621002000'
    or workspace->'customerSnapshot' <> 'null'::jsonb then raise exception 'PICKUP_READ_FAILED: %',workspace; end if;
  command := (command - 'attentionLeaseId' - 'customerSnapshotRef' - 'fulfillmentSnapshotRef' - 'pickupContact') ||
    jsonb_build_object('captureDraftId',delivery::text,'expectedVersion',0,'eventId',gen_random_uuid()::text,
      'idempotencyKey',gen_random_uuid()::text,'fulfillmentChannel','delivery');
  created := app_private.create_capture_draft(actor,command);
  command := jsonb_build_object('schemaVersion',2,'scope',scope,'captureDraftId',delivery::text,'expectedVersion',1,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,
    'occurredAt',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'attentionLeaseId',created#>>'{record,detail,attentionLeaseId}','orderId',gen_random_uuid()::text,
    'shiftId',shift::text,'tableId',null,'currency','MXN','timeZone','America/Hermosillo');
  result := app_private.confirm_capture_draft(actor,command,'{}'::jsonb,'{}'::jsonb);
  if result <> '{"status":"conflict","reason":"delivery_customer_required"}'::jsonb then
    raise exception 'DELIVERY_CUSTOMER_REQUIRED_FAILED: %',result; end if;
end
$test$;
rollback;
