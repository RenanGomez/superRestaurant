-- Test-only, composed into the rollback verifier transaction. Never apply as a migration.
-- Exercises app_private.list_capture_work_tray_v2 (customer snapshot, no lease id leak, scope
-- isolation) and app_private.renew_capture_lease (renewal, idempotency, taken, not_active,
-- scope isolation, no version bump).
begin;
do $capture_tray_lease_invariants$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  foreign_actor uuid := (select id from auth.users where deleted_at is null order by id offset 1 limit 1);
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  member uuid := gen_random_uuid();
  other_member uuid := gen_random_uuid();
  foreign_member uuid := gen_random_uuid();
  customer uuid := gen_random_uuid();
  contact uuid := gen_random_uuid();
  capture uuid := gen_random_uuid();
  scope jsonb;
  creation jsonb;
  created jsonb;
  selected jsonb;
  lease uuid;
  command jsonb;
  tray jsonb;
  tray_item jsonb;
  before_row app.capture_drafts%rowtype;
  after_row app.capture_drafts%rowtype;
  first_renewal jsonb;
  second_renewal jsonb;
begin
  if actor is null or foreign_actor is null or actor=foreign_actor then
    raise exception using errcode='55000', message='CAPTURE_TRAY_LEASE_TWO_ACTORS_REQUIRED';
  end if;
  insert into app.restaurants(id,name,time_zone) values(restaurant,'rollback-only tray lease','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (branch,restaurant,'rollback-only tray lease'),(other_branch,restaurant,'rollback-only tray lease other');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values
    (member,actor,restaurant,branch,actor),
    (other_member,foreign_actor,restaurant,branch,actor),
    (foreign_member,foreign_actor,restaurant,other_branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values
    (member,'cashier',actor),(other_member,'cashier',actor),(foreign_member,'cashier',actor);
  insert into app.customers(id,restaurant_id,display_name,created_by,updated_by)
    values(customer,restaurant,'Ana Perez',actor,actor);
  insert into app.customer_phones(restaurant_id,customer_id,contact_id,label,display_value,normalized_value)
    values(restaurant,customer,contact,'Main','+52 662 123 4567','+526621234567');

  scope := jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text);
  creation := jsonb_build_object('schemaVersion',1,'scope',scope,'captureDraftId',capture::text,'expectedVersion',0,
    'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',gen_random_uuid()::text,
    'occurredAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceChannel','phone','fulfillmentChannel','pickup');
  execute 'set local role app_api';
  created := app_private.create_capture_draft(actor,creation);
  if created->>'status'<>'applied' then raise exception using errcode='55000', message='CAPTURE_TRAY_LEASE_CREATE_REJECTED'; end if;
  lease := (created#>>'{record,detail,attentionLeaseId}')::uuid;
  selected := app_private.set_capture_customer(actor,(creation-array['sourceChannel','fulfillmentChannel'])
    || jsonb_build_object('expectedVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
      'attentionLeaseId',lease::text,'customerId',customer::text,'contactId',contact::text,'expectedCustomerVersion',1));
  if selected->>'status'<>'applied' then raise exception using errcode='55000', message='CAPTURE_TRAY_LEASE_CUSTOMER_REJECTED'; end if;

  -- Tray V2: customer from the party snapshot, lease expiry but never the lease id, no plan.
  tray := app_private.list_capture_work_tray_v2(actor,jsonb_build_object('schemaVersion',2,'scope',scope,'limit',10));
  if tray->>'schemaVersion'<>'2' or jsonb_array_length(tray->'items')<>1 then
    raise exception using errcode='55000', message='CAPTURE_TRAY_V2_SHAPE_REJECTED'; end if;
  tray_item := tray#>'{items,0}';
  if tray_item->>'captureDraftId'<>capture::text
    or tray_item#>>'{customer,displayName}'<>'Ana Perez' or tray_item#>>'{customer,phone}'<>'+52 662 123 4567'
    or tray_item->'selectionPlan' is distinct from 'null'::jsonb
    or tray_item->>'attentionLeaseExpiresAt' is null
    or tray::text like '%'||lease::text||'%'
  then raise exception using errcode='55000', message='CAPTURE_TRAY_V2_ITEM_REJECTED'; end if;
  -- V1 request shape and scope isolation.
  if app_private.list_capture_work_tray_v2(actor,jsonb_build_object('schemaVersion',1,'scope',scope,'limit',10))->>'status'<>'rejected'
    or app_private.list_capture_work_tray_v2(actor,jsonb_build_object('schemaVersion',2,'scope',scope,'limit',51))->>'status'<>'rejected'
    or app_private.list_capture_work_tray_v2(actor,jsonb_build_object('schemaVersion',2,'scope',scope,'limit',10,'x',1))->>'status'<>'rejected'
  then raise exception using errcode='55000', message='CAPTURE_TRAY_V2_REQUEST_ACCEPTED'; end if;
  if app_private.list_capture_work_tray_v2(actor,jsonb_build_object('schemaVersion',2,
      'scope',jsonb_build_object('restaurantId',restaurant::text,'branchId',other_branch::text),'limit',10))->>'status'<>'denied'
  then raise exception using errcode='55000', message='CAPTURE_TRAY_V2_SCOPE_LEAK'; end if;
  -- foreign_actor has a membership in other_branch only AND in branch (other_member); a draft of
  -- `branch` must never appear in other_branch's tray.
  if jsonb_array_length(app_private.list_capture_work_tray_v2(foreign_actor,jsonb_build_object('schemaVersion',2,
      'scope',jsonb_build_object('restaurantId',restaurant::text,'branchId',other_branch::text),'limit',10))->'items')<>0
  then raise exception using errcode='55000', message='CAPTURE_TRAY_V2_CROSS_BRANCH_LEAK'; end if;

  -- Renewal.
  command := jsonb_build_object('schemaVersion',1,'scope',scope,'captureDraftId',capture::text,'attentionLeaseId',lease::text);
  execute 'reset role';
  select * into before_row from app.capture_drafts where restaurant_id=restaurant and branch_id=branch and id=capture;
  execute 'set local role app_api';
  first_renewal := app_private.renew_capture_lease(actor,command);
  if first_renewal->>'status'<>'applied' or first_renewal#>>'{record,version}'<>before_row.version::text
    or first_renewal#>>'{record,attentionLeaseId}'<>lease::text
  then raise exception using errcode='55000', message='CAPTURE_LEASE_RENEW_REJECTED'; end if;
  second_renewal := app_private.renew_capture_lease(actor,command);
  if second_renewal->>'status'<>'applied'
    or (second_renewal#>>'{record,attentionLeaseExpiresAt}')::timestamptz < (first_renewal#>>'{record,attentionLeaseExpiresAt}')::timestamptz
    or second_renewal#>>'{record,version}'<>before_row.version::text
  then raise exception using errcode='55000', message='CAPTURE_LEASE_RENEW_NOT_IDEMPOTENT'; end if;
  execute 'reset role';
  select * into after_row from app.capture_drafts where restaurant_id=restaurant and branch_id=branch and id=capture;
  if after_row.version<>before_row.version or after_row.updated_at<>before_row.updated_at
    or after_row.owner_membership_id is distinct from before_row.owner_membership_id
    or after_row.attention_lease_id is distinct from before_row.attention_lease_id
    or after_row.attention_status<>'claimed'
    or after_row.attention_lease_expires_at < before_row.attention_lease_expires_at
    or (select count(*) from app.capture_command_events where restaurant_id=restaurant and capture_draft_id=capture)<>2
  then raise exception using errcode='55000', message='CAPTURE_LEASE_RENEW_SIDE_EFFECT'; end if;

  execute 'set local role app_api';
  -- Malformed, foreign lease, scope, missing.
  if app_private.renew_capture_lease(actor,command||'{"x":1}'::jsonb)->>'status'<>'rejected'
    or app_private.renew_capture_lease(actor,command-'attentionLeaseId')->>'status'<>'rejected'
    or app_private.renew_capture_lease(actor,command||jsonb_build_object('attentionLeaseId','nope'))->>'status'<>'rejected'
    or app_private.renew_capture_lease(null,command)->>'status'<>'rejected'
  then raise exception using errcode='55000', message='CAPTURE_LEASE_RENEW_COMMAND_ACCEPTED'; end if;
  if app_private.renew_capture_lease(actor,command||jsonb_build_object('attentionLeaseId',gen_random_uuid()::text))
      is distinct from jsonb_build_object('status','conflict','reason','taken')
  then raise exception using errcode='55000', message='CAPTURE_LEASE_RENEW_FOREIGN_LEASE_ACCEPTED'; end if;
  if app_private.renew_capture_lease(actor,command||jsonb_build_object('captureDraftId',gen_random_uuid()::text))->>'status'<>'missing'
  then raise exception using errcode='55000', message='CAPTURE_LEASE_RENEW_MISSING_ACCEPTED'; end if;
  -- foreign_actor is a branch member but not the owner: taken. A member of other_branch only: denied.
  if app_private.renew_capture_lease(foreign_actor,command)
      is distinct from jsonb_build_object('status','conflict','reason','taken')
  then raise exception using errcode='55000', message='CAPTURE_LEASE_RENEW_NON_OWNER_ACCEPTED'; end if;
  if app_private.renew_capture_lease(foreign_actor,jsonb_set(command,'{scope,branchId}',to_jsonb(other_branch::text)))
      ->>'status'<>'missing'
  then raise exception using errcode='55000', message='CAPTURE_LEASE_RENEW_CROSS_BRANCH_LEAK'; end if;
  execute 'reset role';

  -- Another station took the capture (lease rotated, different owner): the original owner conflicts.
  update app.capture_drafts set owner_membership_id=other_member,attention_lease_id=gen_random_uuid(),
      attention_lease_expires_at=clock_timestamp()+interval '5 minutes'
    where restaurant_id=restaurant and branch_id=branch and id=capture;
  execute 'set local role app_api';
  if app_private.renew_capture_lease(actor,command) is distinct from jsonb_build_object('status','conflict','reason','taken')
  then raise exception using errcode='55000', message='CAPTURE_LEASE_RENEW_TAKEN_ACCEPTED'; end if;
  execute 'reset role';

  -- Own but expired lease, nobody else took it: renewal revives it.
  update app.capture_drafts set owner_membership_id=member,attention_lease_id=lease,
      attention_lease_expires_at=clock_timestamp()-interval '1 minute'
    where restaurant_id=restaurant and branch_id=branch and id=capture;
  execute 'set local role app_api';
  if app_private.renew_capture_lease(actor,command)->>'status'<>'applied'
  then raise exception using errcode='55000', message='CAPTURE_LEASE_RENEW_EXPIRED_OWN_REJECTED'; end if;
  execute 'reset role';
  if not exists(select 1 from app.capture_drafts where restaurant_id=restaurant and branch_id=branch and id=capture
      and attention_lease_expires_at>clock_timestamp()+interval '4 minutes')
  then raise exception using errcode='55000', message='CAPTURE_LEASE_RENEW_EXPIRED_OWN_NOT_EXTENDED'; end if;

  -- Held draft is not renewable.
  update app.capture_drafts set attention_status='held',owner_membership_id=null,attention_lease_id=null,attention_lease_expires_at=null
    where restaurant_id=restaurant and branch_id=branch and id=capture;
  execute 'set local role app_api';
  if app_private.renew_capture_lease(actor,command) is distinct from jsonb_build_object('status','conflict','reason','not_active')
  then raise exception using errcode='55000', message='CAPTURE_LEASE_RENEW_HELD_ACCEPTED'; end if;
  execute 'reset role';
end
$capture_tray_lease_invariants$;
commit;
