begin;
do $test$
declare
  actor uuid := '00000000-0000-4000-8000-000000000001';
  restaurant uuid := gen_random_uuid(); branch uuid := gen_random_uuid(); other_branch uuid := gen_random_uuid();
  other_restaurant uuid := gen_random_uuid(); foreign_branch uuid := gen_random_uuid(); member uuid := gen_random_uuid();
  customer uuid := gen_random_uuid(); snapshot uuid := gen_random_uuid(); draft uuid := gen_random_uuid();
  request jsonb; result jsonb;
begin
  insert into app.restaurants(id,name,time_zone) values(restaurant,'open captures','America/Hermosillo'),(other_restaurant,'other','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(branch,restaurant,'one'),(other_branch,restaurant,'two'),(foreign_branch,other_restaurant,'foreign');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values(member,actor,restaurant,branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values(member,'cashier',actor);
  insert into app.customers(id,restaurant_id,display_name,created_by,updated_by) values(customer,restaurant,'customer',actor,actor);
  insert into app.customer_party_snapshots(id,restaurant_id,customer_id,contact_id,display_name,phone_display_value,phone_normalized_value,created_by)
    values(snapshot,restaurant,customer,gen_random_uuid(),'customer','123','123',actor);
  insert into app.capture_drafts(id,restaurant_id,branch_id,folio,source_channel,fulfillment_channel,status,attention_status,
    recovery_expires_at,customer_id,customer_snapshot_id,created_by,updated_by)
  values(draft,restaurant,branch,'A','phone','pickup','draft','unclaimed',clock_timestamp()+interval '1 day',customer,snapshot,actor,actor),
    (gen_random_uuid(),restaurant,other_branch,'B','phone','pickup','draft','unclaimed',clock_timestamp()+interval '1 day',customer,snapshot,actor,actor),
    (gen_random_uuid(),restaurant,branch,'C','phone','pickup','no_sale','unclaimed',clock_timestamp()+interval '1 day',customer,snapshot,actor,actor);
  request := jsonb_build_object('schemaVersion',1,'scope',jsonb_build_object('restaurantId',restaurant,'branchId',branch),'customerId',customer,'limit',50);
  result := app_private.list_customer_open_captures(actor,request);
  if jsonb_array_length(result->'items') <> 1 or result#>>'{items,0,captureDraftId}' <> draft::text then raise exception 'unexpected drafts: %',result; end if;
  result := app_private.list_customer_open_captures(actor,jsonb_set(request,'{scope,branchId}',to_jsonb(other_branch)));
  if result->>'status' is distinct from 'denied' then raise exception 'branch leak: %',result; end if;
  result := app_private.list_customer_open_captures(actor,jsonb_set(jsonb_set(request,'{scope,restaurantId}',to_jsonb(other_restaurant)),'{scope,branchId}',to_jsonb(foreign_branch)));
  if result->>'status' is distinct from 'denied' then raise exception 'restaurant leak: %',result; end if;
  update app.membership_role_grants set revoked_at=clock_timestamp(),revoked_by=actor,revocation_reason='test' where membership_id=member;
  result := app_private.list_customer_open_captures(actor,request);
  if result->>'status' is distinct from 'denied' then raise exception 'revoked grant allowed: %',result; end if;
end
$test$;
rollback;
