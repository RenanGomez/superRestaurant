-- Test-only fixtures run inside the verifier transaction and are always rolled back.
begin;
do $capture_customer_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant uuid := gen_random_uuid(); branch uuid := gen_random_uuid(); member uuid := gen_random_uuid();
  customer uuid := gen_random_uuid(); contact uuid := gen_random_uuid(); capture uuid := gen_random_uuid();
  creation jsonb; command jsonb; created jsonb; selected jsonb; replay jsonb; removed jsonb;
  snapshot uuid; snapshot_count bigint;
begin
  if actor is null then raise exception 'CAPTURE_CUSTOMER_TEST_ACTOR_REQUIRED'; end if;
  insert into app.restaurants(id,name,time_zone) values(restaurant,'rollback-only Capture Customer','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(branch,restaurant,'rollback-only Capture Customer');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values(member,actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values(member,'cashier',actor);
  insert into app.customers(id,restaurant_id,display_name,created_by,updated_by) values(customer,restaurant,'Original customer',actor,actor);
  insert into app.customer_phones(restaurant_id,customer_id,contact_id,label,display_value,normalized_value)
    values(restaurant,customer,contact,'Main','+52 12345678','+5212345678');
  creation := jsonb_build_object('schemaVersion',1,'scope',jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',capture::text,'expectedVersion',0,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'deviceId',gen_random_uuid()::text,'occurredAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceChannel','phone','fulfillmentChannel','pickup');
  execute 'set local role app_api';
  created := app_private.create_capture_draft(actor,creation);
  if created ->> 'status' <> 'applied' then raise exception 'CAPTURE_CUSTOMER_CREATE_REJECTED'; end if;
  command := (creation - array['sourceChannel','fulfillmentChannel']) || jsonb_build_object('expectedVersion',1,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'attentionLeaseId',created #>> '{record,detail,attentionLeaseId}',
    'customerId',customer::text,'contactId',contact::text,'expectedCustomerVersion',1);
  selected := app_private.set_capture_customer(actor,command);
  if selected ->> 'status' <> 'applied' or selected #>> '{record,detail,version}' <> '2'
    or selected #> '{record,detail,customerSnapshotRef}' = 'null'::jsonb
  then raise exception 'CAPTURE_CUSTOMER_SELECTION_REJECTED'; end if;
  replay := app_private.set_capture_customer(actor,command);
  if replay ->> 'status' <> 'replayed' or replay -> 'record' <> selected -> 'record'
    then raise exception 'CAPTURE_CUSTOMER_REPLAY_REJECTED'; end if;
  if app_private.set_capture_customer(actor,command || jsonb_build_object('contactId',gen_random_uuid()::text)) ->> 'status' <> 'conflict'
    then raise exception 'CAPTURE_CUSTOMER_DIVERGENCE_ACCEPTED'; end if;
  execute 'reset role';
  snapshot := (selected #>> '{record,detail,customerSnapshotRef}')::uuid;
  update app.customers set display_name='Changed customer',version=2,updated_at=clock_timestamp(),updated_by=actor
    where restaurant_id=restaurant and id=customer;
  if not exists(select 1 from app.customer_party_snapshots s where s.restaurant_id=restaurant and s.id=snapshot
    and s.display_name='Original customer' and s.phone_display_value='+52 12345678')
  then raise exception 'CAPTURE_CUSTOMER_SNAPSHOT_CHANGED'; end if;
  select count(*) into snapshot_count from app.customer_party_snapshots where restaurant_id=restaurant;
  command := command || jsonb_build_object('expectedVersion',2,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text);
  execute 'set local role app_api';
  if app_private.set_capture_customer(actor,command) ->> 'status' <> 'conflict'
    then raise exception 'CAPTURE_CUSTOMER_STALE_VERSION_ACCEPTED'; end if;
  -- A duplicate event fails after snapshot insertion: the subtransaction must undo all three writes.
  if app_private.set_capture_customer(actor,command || jsonb_build_object('expectedCustomerVersion',2,'eventId',creation ->> 'eventId')) ->> 'status' <> 'conflict'
    then raise exception 'CAPTURE_CUSTOMER_DUPLICATE_EVENT_ACCEPTED'; end if;
  removed := app_private.set_capture_customer(actor,command || jsonb_build_object('customerId',null,'contactId',null,'expectedCustomerVersion',null));
  if removed ->> 'status' <> 'applied' or removed #> '{record,detail,customerSnapshotRef}' <> 'null'::jsonb
    then raise exception 'CAPTURE_CUSTOMER_REMOVE_REJECTED'; end if;
  execute 'reset role';
  if (select count(*) from app.customer_party_snapshots where restaurant_id=restaurant) <> snapshot_count
    or (select version from app.capture_drafts where restaurant_id=restaurant and id=capture) <> 3
    or (select count(*) from app.capture_command_events where restaurant_id=restaurant) <> 3
  then raise exception 'CAPTURE_CUSTOMER_ATOMICITY_REJECTED'; end if;
end
$capture_customer_tests$;
commit;
