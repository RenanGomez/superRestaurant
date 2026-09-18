begin;
do $tests$
declare
 actor uuid:=(select id from auth.users where deleted_at is null order by id limit 1);restaurant uuid:=gen_random_uuid();branch uuid:=gen_random_uuid();member uuid:=gen_random_uuid();
 customer uuid:=gen_random_uuid();contact uuid:=gen_random_uuid();address uuid:=gen_random_uuid();capture uuid:=gen_random_uuid();created jsonb;party jsonb;selected jsonb;command jsonb;now_at timestamptz:=date_trunc('milliseconds',clock_timestamp());
begin
 insert into app.restaurants(id,name,time_zone)values(restaurant,'rollback fulfillment','America/Hermosillo');insert into app.branches(id,restaurant_id,name)values(branch,restaurant,'rollback fulfillment');
 insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by)values(member,actor,restaurant,branch,actor);insert into app.membership_role_grants(membership_id,role_code,granted_by)values(member,'cashier',actor);
 insert into app.customers(id,restaurant_id,display_name,created_by,updated_by)values(customer,restaurant,'Customer',actor,actor);insert into app.customer_phones(restaurant_id,customer_id,contact_id,label,display_value,normalized_value)values(restaurant,customer,contact,'Main','6421002000','6421002000');
 insert into app.customer_addresses(id,restaurant_id,customer_id,label,street_line,locality,country_code,validation_branch_id,validation_event_id,validated_by,validation_device_id,validated_at,created_at,created_by,updated_at,updated_by)
 values(address,restaurant,customer,'Home','Street','City','MX',branch,gen_random_uuid(),actor,gen_random_uuid(),now_at,now_at,actor,now_at,actor);
 created:=app_private.create_capture_draft(actor,jsonb_build_object('schemaVersion',1,'scope',jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),'captureDraftId',capture::text,'expectedVersion',0,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',gen_random_uuid()::text,'occurredAt',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'sourceChannel','phone','fulfillmentChannel','delivery'));
 party:=app_private.set_capture_customer(actor,jsonb_build_object('schemaVersion',1,'scope',jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),'captureDraftId',capture::text,'expectedVersion',1,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',gen_random_uuid()::text,'occurredAt',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'attentionLeaseId',created#>>'{record,detail,attentionLeaseId}','customerId',customer::text,'contactId',contact::text,'expectedCustomerVersion',1));
 command:=jsonb_build_object('schemaVersion',1,'scope',jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),'captureDraftId',capture::text,'expectedVersion',2,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,'deviceId',gen_random_uuid()::text,'occurredAt',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'attentionLeaseId',created#>>'{record,detail,attentionLeaseId}','customerSnapshotRef',party#>>'{record,detail,customerSnapshotRef}','addressId',address::text,'expectedAddressVersion',1);
 selected:=app_private.set_capture_fulfillment(actor,command);
 if selected->>'status'<>'applied' or selected#>'{record,detail,fulfillmentSnapshotRef}'='null'::jsonb then raise exception 'FULFILLMENT_SELECTION_REJECTED';end if;
 if app_private.set_capture_fulfillment(actor,command)->>'status'<>'replayed' then raise exception 'FULFILLMENT_REPLAY_REJECTED';end if;
 update app.customer_addresses set street_line='Changed',validation_branch_id=null,validation_event_id=null,validated_by=null,validation_device_id=null,validated_at=null,version=2,updated_at=clock_timestamp(),updated_by=actor where restaurant_id=restaurant and customer_id=customer and id=address;
 if not exists(select 1 from app.customer_fulfillment_snapshots where restaurant_id=restaurant and id=(selected#>>'{record,detail,fulfillmentSnapshotRef}')::uuid and street_line='Street') then raise exception 'FULFILLMENT_SNAPSHOT_MUTATED';end if;
 if app_private.set_capture_fulfillment(actor,command||jsonb_build_object('expectedVersion',3,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text))->>'status'<>'conflict' then raise exception 'STALE_ADDRESS_ACCEPTED';end if;
end $tests$;
commit;
