-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
begin;
do $capture_delivery_order_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  membership uuid := gen_random_uuid();
  customer uuid := gen_random_uuid();
  contact uuid := gen_random_uuid();
  address uuid := gen_random_uuid();
  capture uuid := gen_random_uuid();
  suggestion_capture uuid := gen_random_uuid();
  collision_capture uuid := gen_random_uuid();
  shift uuid := gen_random_uuid();
  confirmed_order uuid := gen_random_uuid();
  collision_order uuid := gen_random_uuid();
  existing_order uuid := gen_random_uuid();
  confirmation_event uuid := gen_random_uuid();
  device_id uuid := gen_random_uuid();
  now_at timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  created jsonb;
  party jsonb;
  fulfillment jsonb;
  instruction_command jsonb;
  instructed jsonb;
  confirm_command jsonb;
  order_record jsonb;
  order_audit jsonb;
  confirmed jsonb;
  suggestions jsonb;
  party_snapshot uuid;
  test_case record;
  actual_constraint text;
  history_capture uuid;
  history_order uuid;
  history_instruction text;
  history_at timestamptz;
  history_index integer;
begin
  if actor is null then raise exception 'CAPTURE_DELIVERY_ORDER_TEST_ACTOR_REQUIRED'; end if;

  insert into app.restaurants(id,name,time_zone)
    values(restaurant,'rollback-only Capture delivery Order','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (branch,restaurant,'rollback-only primary branch'),
    (other_branch,restaurant,'rollback-only excluded branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)
    values(membership,actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by)
    values(membership,'cashier',actor);
  insert into app.customers(id,restaurant_id,display_name,created_by,updated_by)
    values(customer,restaurant,'Rollback delivery customer',actor,actor);
  insert into app.customer_phones(restaurant_id,customer_id,contact_id,label,display_value,normalized_value)
    values(restaurant,customer,contact,'Main','662 100 2000','6621002000');
  insert into app.customer_addresses(
    id,restaurant_id,customer_id,label,street_line,locality,country_code,instructions,
    validation_branch_id,validation_event_id,validated_by,validation_device_id,validated_at,
    created_at,created_by,updated_at,updated_by
  ) values (
    address,restaurant,customer,'Home','Calle Uno 100','Hermosillo','MX','Legacy: puerta antigua',
    branch,gen_random_uuid(),actor,gen_random_uuid(),now_at,now_at,actor,now_at,actor
  );
  insert into app.operational_shifts(id,restaurant_id,branch_id,name,status,opened_at,opened_by)
    values(shift,restaurant,branch,'Rollback shift','open',now_at - interval '1 hour',actor);

  execute 'set local role app_api';
  created := app_private.create_capture_draft(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',capture::text,'expectedVersion',0,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId',device_id::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceChannel','phone','fulfillmentChannel','delivery'
  ));
  if created->>'status' <> 'applied' then raise exception 'CAPTURE_DELIVERY_CREATE_REJECTED'; end if;
  party := app_private.set_capture_customer(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',capture::text,'expectedVersion',1,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId',device_id::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'attentionLeaseId',created#>>'{record,detail,attentionLeaseId}',
    'customerId',customer::text,'contactId',contact::text,'expectedCustomerVersion',1
  ));
  if party->>'status' <> 'applied' then raise exception 'CAPTURE_DELIVERY_CUSTOMER_REJECTED'; end if;
  fulfillment := app_private.set_capture_fulfillment(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',capture::text,'expectedVersion',2,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId',device_id::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'attentionLeaseId',created#>>'{record,detail,attentionLeaseId}',
    'customerSnapshotRef',party#>>'{record,detail,customerSnapshotRef}',
    'addressId',address::text,'expectedAddressVersion',1
  ));
  if fulfillment->>'status' <> 'applied' then raise exception 'CAPTURE_DELIVERY_FULFILLMENT_REJECTED'; end if;

  instruction_command := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',capture::text,'expectedVersion',3,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId',device_id::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'attentionLeaseId',created#>>'{record,detail,attentionLeaseId}',
    'deliveryInstructions','Dejar en recepción, no copiar la dirección'
  );
  if app_private.set_capture_delivery_instructions(actor,instruction_command || '{"unexpected":true}'::jsonb)->>'status' <> 'rejected'
    then raise exception 'CAPTURE_DELIVERY_EXTRA_FIELD_ACCEPTED'; end if;
  if app_private.set_capture_delivery_instructions(actor,instruction_command || pg_catalog.jsonb_build_object(
    'attentionLeaseId',gen_random_uuid()::text))->>'status' <> 'conflict'
    then raise exception 'CAPTURE_DELIVERY_WRONG_LEASE_ACCEPTED'; end if;
  instructed := app_private.set_capture_delivery_instructions(actor,instruction_command);
  if instructed->>'status' <> 'applied' or instructed#>>'{record,detail,version}' <> '4'
    or instructed->>'deliveryInstructions' <> 'Dejar en recepción, no copiar la dirección'
  then raise exception 'CAPTURE_DELIVERY_INSTRUCTION_REJECTED'; end if;
  if app_private.set_capture_delivery_instructions(actor,instruction_command)->>'status' <> 'replayed'
    then raise exception 'CAPTURE_DELIVERY_REPLAY_REJECTED'; end if;
  if app_private.set_capture_delivery_instructions(actor,instruction_command || '{"deliveryInstructions":"Otro valor"}'::jsonb)->>'status' <> 'conflict'
    then raise exception 'CAPTURE_DELIVERY_DIVERGENT_REPLAY_ACCEPTED'; end if;
  if app_private.set_capture_delivery_instructions(actor,instruction_command || pg_catalog.jsonb_build_object(
    'expectedVersion',4,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text))->>'status' <> 'applied'
  then raise exception 'CAPTURE_DELIVERY_SECOND_WRITE_REJECTED'; end if;
  -- Restore the canonical instruction with one more audited CAS write.
  instruction_command := instruction_command || pg_catalog.jsonb_build_object(
    'expectedVersion',5,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'deliveryInstructions','Dejar en recepción, no copiar la dirección'
  );
  instructed := app_private.set_capture_delivery_instructions(actor,instruction_command);
  if instructed->>'status' <> 'applied' or instructed#>>'{record,detail,version}' <> '6'
    then raise exception 'CAPTURE_DELIVERY_RESTORE_REJECTED'; end if;

  if app_private.read_capture_workspace_v2(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',2,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',capture::text
  ))#>>'{detail,deliveryInstructions}' <> 'Dejar en recepción, no copiar la dirección'
  then raise exception 'CAPTURE_DELIVERY_WORKSPACE_REJECTED'; end if;
  execute 'reset role';

  for test_case in select * from (values
    (1, 'delivery_instructions = ''''', 'capture_drafts_delivery_instructions_valid'),
    (2, 'delivery_instructions = '' padded ''', 'capture_drafts_delivery_instructions_valid'),
    (3, 'delivery_instructions = repeat(''x'',501)', 'capture_drafts_delivery_instructions_valid'),
    (4, 'delivery_instructions = E''line\nbreak''', 'capture_drafts_delivery_instructions_valid')
  ) as cases(case_number,assignment,expected_constraint) loop
    begin
      execute pg_catalog.format(
        'update app.capture_drafts set %s where restaurant_id=$1 and branch_id=$2 and id=$3',
        test_case.assignment
      ) using restaurant,branch,capture;
      raise exception 'CAPTURE_DELIVERY_INVALID_VALUE_ACCEPTED_%', test_case.case_number;
    exception when check_violation then
      get stacked diagnostics actual_constraint = constraint_name;
      if actual_constraint <> test_case.expected_constraint then
        raise exception using message='CAPTURE_DELIVERY_WRONG_CONSTRAINT',detail=actual_constraint;
      end if;
    end;
  end loop;
  update app.capture_drafts set fulfillment_channel='counter'
    where restaurant_id=restaurant and branch_id=branch and id=capture;
  if (select delivery_instructions from app.capture_drafts
      where restaurant_id=restaurant and branch_id=branch and id=capture) is not null
    then raise exception 'CAPTURE_DELIVERY_TRIGGER_DID_NOT_CLEAR'; end if;
  update app.capture_drafts set fulfillment_channel='delivery',
    delivery_instructions='Dejar en recepción, no copiar la dirección'
    where restaurant_id=restaurant and branch_id=branch and id=capture;

  confirmation_event := gen_random_uuid();
  confirmed_order := gen_random_uuid();
  confirm_command := pg_catalog.jsonb_build_object(
    'schemaVersion',2,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',capture::text,'expectedVersion',6,'eventId',confirmation_event::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId',device_id::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'attentionLeaseId',created#>>'{record,detail,attentionLeaseId}',
    'orderId',confirmed_order::text,'shiftId',shift::text,'tableId',null,'currency','MXN','timeZone','America/Hermosillo'
  );
  order_record := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'restaurantId',restaurant::text,'branchId',branch::text,'orderId',confirmed_order::text,
    'channel','delivery','status','draft','currency','MXN','timeZone','America/Hermosillo','items','[]'::jsonb
  );
  order_audit := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'eventId',confirmation_event::text,'idempotencyKey',confirm_command->>'idempotencyKey',
    'restaurantId',restaurant::text,'branchId',branch::text,'orderId',confirmed_order::text,
    'actorId',actor::text,'deviceId',device_id::text,'operation','order.created',
    'entityType','order','entityId',confirmed_order::text,'to','draft','occurredAt',confirm_command->>'occurredAt'
  );
  execute 'set local role app_api';
  if app_private.confirm_capture_draft(actor,confirm_command,order_record || '{"channel":"counter"}'::jsonb,order_audit)->>'status' <> 'rejected'
    or exists(select 1 from app.orders where restaurant_id=restaurant and branch_id=branch and id=confirmed_order)
  then raise exception 'CAPTURE_CONFIRM_DERIVED_CHANNEL_REJECTED'; end if;
  confirmed := app_private.confirm_capture_draft(actor,confirm_command,order_record,order_audit);
  if confirmed->>'status' <> 'applied' or confirmed#>>'{record,detail,status}' <> 'confirmed'
    or confirmed#>>'{record,detail,version}' <> '7'
  then raise exception 'CAPTURE_CONFIRM_POSITIVE_PATH_REJECTED'; end if;
  if app_private.confirm_capture_draft(actor,confirm_command,order_record,order_audit)->>'status' <> 'replayed'
    then raise exception 'CAPTURE_CONFIRM_REPLAY_REJECTED'; end if;
  if app_private.confirm_capture_draft(actor,confirm_command,order_record || '{"currency":"USD"}'::jsonb,order_audit)->>'status' <> 'conflict'
    then raise exception 'CAPTURE_CONFIRM_DIVERGENT_REPLAY_ACCEPTED'; end if;
  execute 'reset role';

  if (select count(*) from app.orders as placed where placed.restaurant_id=restaurant and placed.branch_id=branch
      and placed.id=confirmed_order) <> 1
    or (select count(*) from app.order_operational_shifts as link where link.restaurant_id=restaurant
      and link.branch_id=branch and link.order_id=confirmed_order and link.shift_id=shift) <> 1
    or (select count(*) from app.capture_command_events as journal where journal.restaurant_id=restaurant
      and journal.branch_id=branch and journal.capture_draft_id=capture and journal.operation='capture.confirmed') <> 1
    or not exists (
      select 1 from app.order_fulfillment_snapshots frozen
      where frozen.restaurant_id=restaurant and frozen.branch_id=branch and frozen.order_id=confirmed_order
        and frozen.capture_draft_id=capture and frozen.capture_version=6 and frozen.customer_id=customer
        and frozen.fulfillment_channel='delivery'
        and frozen.delivery_instructions='Dejar en recepción, no copiar la dirección'
        and frozen.snapshot#>>'{fulfillmentSnapshot,legacyAddressInstructions}'='Legacy: puerta antigua'
        and frozen.snapshot->>'deliveryInstructions'='Dejar en recepción, no copiar la dirección'
    )
  then raise exception 'CAPTURE_CONFIRM_ATOMIC_GRAPH_REJECTED'; end if;

  update app.customer_addresses set instructions='Legacy changed',updated_at=clock_timestamp(),updated_by=actor
    where restaurant_id=restaurant and customer_id=customer and id=address;
  if not exists (
    select 1 from app.order_fulfillment_snapshots frozen
    where frozen.restaurant_id=restaurant and frozen.branch_id=branch and frozen.order_id=confirmed_order
      and frozen.snapshot#>>'{fulfillmentSnapshot,legacyAddressInstructions}'='Legacy: puerta antigua'
      and frozen.delivery_instructions='Dejar en recepción, no copiar la dirección'
  ) then raise exception 'CAPTURE_CONFIRM_SNAPSHOT_MUTATED_WITH_ADDRESS'; end if;

  party_snapshot := (party#>>'{record,detail,customerSnapshotRef}')::uuid;
  -- Add bounded same-customer history without invoking a second product path.
  for history_index in 1..7 loop
    history_capture := gen_random_uuid();
    history_order := gen_random_uuid();
    history_instruction := case history_index
      when 1 then 'Puerta azul' when 2 then 'Puerta azul' when 3 then 'Recepción'
      when 4 then 'Portón norte' when 5 then 'Casa esquina' when 6 then 'Tocar timbre'
      else 'Fuera de ventana' end;
    history_at := case when history_index=7 then current_timestamp-interval '181 days'
      else current_timestamp-(history_index||' days')::interval end;
    insert into app.capture_drafts(
      id,restaurant_id,branch_id,folio,source_channel,fulfillment_channel,status,attention_status,
      recovery_expires_at,confirmed_order_id,version,created_by,updated_by,customer_id,customer_snapshot_id,
      delivery_instructions
    ) values (
      history_capture,restaurant,branch,'history-'||history_index,'phone','delivery','draft','unclaimed',
      current_timestamp+interval '1 month',null,1,actor,actor,customer,party_snapshot,history_instruction
    );
    insert into app.orders(id,restaurant_id,branch_id,channel,status,aggregate,version,created_by,updated_by)
    values(history_order,restaurant,branch,'delivery','draft',pg_catalog.jsonb_build_object(
      'schemaVersion',1,'restaurantId',restaurant::text,'branchId',branch::text,'orderId',history_order::text,
      'channel','delivery','status','draft','currency','MXN','timeZone','America/Hermosillo','items','[]'::jsonb
    ),1,actor,actor);
    update app.capture_drafts set status='confirmed',confirmed_order_id=history_order,version=2
      where restaurant_id=restaurant and branch_id=branch and id=history_capture;
    insert into app.order_fulfillment_snapshots(
      restaurant_id,branch_id,order_id,capture_draft_id,capture_version,customer_id,fulfillment_channel,
      delivery_instructions,snapshot,confirmed_at,confirmed_by
    ) values (
      restaurant,branch,history_order,history_capture,1,customer,'delivery',history_instruction,
      pg_catalog.jsonb_build_object('schemaVersion',1,'orderId',history_order::text,
        'captureDraftId',history_capture::text,'captureVersion',1,'fulfillmentChannel','delivery',
        'deliveryInstructions',history_instruction),history_at,actor
    );
  end loop;

  insert into app.capture_drafts(
    id,restaurant_id,branch_id,folio,source_channel,fulfillment_channel,attention_status,
    owner_membership_id,attention_lease_id,attention_lease_expires_at,recovery_expires_at,
    created_by,updated_by,customer_id,customer_snapshot_id
  ) values (
    suggestion_capture,restaurant,branch,'suggestion-target','phone','delivery','claimed',membership,
    gen_random_uuid(),current_timestamp+interval '5 minutes',current_timestamp+interval '1 month',
    actor,actor,customer,party_snapshot
  );
  execute 'set local role app_api';
  suggestions := app_private.list_capture_delivery_instruction_suggestions(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',suggestion_capture::text
  ));
  execute 'reset role';
  if suggestions->>'schemaVersion' <> '1' or suggestions->>'captureDraftId' <> suggestion_capture::text
    or pg_catalog.jsonb_array_length(suggestions->'items') <> 5
    or suggestions#>>'{items,0,deliveryInstructions}' <> 'Dejar en recepción, no copiar la dirección'
    or not exists (
      select 1 from pg_catalog.jsonb_array_elements(suggestions->'items') item
      where item->>'deliveryInstructions'='Puerta azul' and item->>'usageCount'='2'
    ) or exists (
      select 1 from pg_catalog.jsonb_array_elements(suggestions->'items') item
      where item->>'deliveryInstructions' in ('Tocar timbre','Fuera de ventana')
    ) or (select delivery_instructions from app.capture_drafts
      where restaurant_id=restaurant and branch_id=branch and id=suggestion_capture) is not null
  then raise exception 'CAPTURE_DELIVERY_SUGGESTIONS_REJECTED'; end if;

  -- A late snapshot collision must roll back the Order and audit created inside confirmation.
  execute 'set local role app_api';
  created := app_private.create_capture_draft(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',collision_capture::text,'expectedVersion',0,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId',device_id::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceChannel','counter','fulfillmentChannel','counter'
  ));
  execute 'reset role';
  insert into app.orders(id,restaurant_id,branch_id,channel,status,aggregate,version,created_by,updated_by)
  values(existing_order,restaurant,branch,'counter','draft',pg_catalog.jsonb_build_object(
    'schemaVersion',1,'restaurantId',restaurant::text,'branchId',branch::text,'orderId',existing_order::text,
    'channel','counter','status','draft','currency','MXN','timeZone','America/Hermosillo','items','[]'::jsonb
  ),1,actor,actor);
  insert into app.order_fulfillment_snapshots(
    restaurant_id,branch_id,order_id,capture_draft_id,capture_version,customer_id,fulfillment_channel,
    delivery_instructions,snapshot,confirmed_at,confirmed_by
  ) values (
    restaurant,branch,existing_order,collision_capture,1,null,'counter',null,
    pg_catalog.jsonb_build_object('schemaVersion',1,'orderId',existing_order::text,
      'captureDraftId',collision_capture::text,'captureVersion',1,'fulfillmentChannel','counter',
      'deliveryInstructions',null),now_at,actor
  );
  collision_order := gen_random_uuid(); confirmation_event := gen_random_uuid();
  confirm_command := pg_catalog.jsonb_build_object(
    'schemaVersion',2,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',collision_capture::text,'expectedVersion',1,'eventId',confirmation_event::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId',device_id::text,
    'occurredAt',pg_catalog.to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'attentionLeaseId',created#>>'{record,detail,attentionLeaseId}',
    'orderId',collision_order::text,'shiftId',shift::text,'tableId',null,'currency','MXN','timeZone','America/Hermosillo'
  );
  order_record := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'restaurantId',restaurant::text,'branchId',branch::text,'orderId',collision_order::text,
    'channel','counter','status','draft','currency','MXN','timeZone','America/Hermosillo','items','[]'::jsonb
  );
  order_audit := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'eventId',confirmation_event::text,'idempotencyKey',confirm_command->>'idempotencyKey',
    'restaurantId',restaurant::text,'branchId',branch::text,'orderId',collision_order::text,
    'actorId',actor::text,'deviceId',device_id::text,'operation','order.created',
    'entityType','order','entityId',collision_order::text,'to','draft','occurredAt',confirm_command->>'occurredAt'
  );
  begin
    execute 'set local role app_api';
    perform app_private.confirm_capture_draft(actor,confirm_command,order_record,order_audit);
    execute 'reset role';
    raise exception 'CAPTURE_CONFIRM_LATE_COLLISION_ACCEPTED';
  exception when unique_violation then
    execute 'reset role';
    get stacked diagnostics actual_constraint = constraint_name;
    if actual_constraint <> 'order_fulfillment_snapshots_capture_unique'
      then raise exception using message='CAPTURE_CONFIRM_WRONG_LATE_COLLISION',detail=actual_constraint; end if;
  end;
  if exists(select 1 from app.orders where restaurant_id=restaurant and branch_id=branch and id=collision_order)
    or exists(select 1 from app.order_audit_events as audit where audit.event_id=confirmation_event)
    or not exists(select 1 from app.capture_drafts where restaurant_id=restaurant and branch_id=branch
      and id=collision_capture and status='draft' and version=1)
  then raise exception 'CAPTURE_CONFIRM_LATE_COLLISION_NOT_ATOMIC'; end if;
end
$capture_delivery_order_tests$;
commit;
