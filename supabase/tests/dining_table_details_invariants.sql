-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises app_private.update_dining_table_details (authorization, scope isolation, optimistic
-- version, duplicate name, idempotent replay, key reuse, event reuse, audit journal, layout untouched,
-- deleted table, grants).
begin;
do $dining_table_details_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  waiter uuid := gen_random_uuid();
  foreign_actor uuid := gen_random_uuid();
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_restaurant uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  membership uuid := gen_random_uuid();
  waiter_membership uuid := gen_random_uuid();
  foreign_membership uuid := gen_random_uuid();
  zone_id uuid := gen_random_uuid();
  foreign_zone uuid := gen_random_uuid();
  table_a uuid := gen_random_uuid();
  table_b uuid := gen_random_uuid();
  foreign_table uuid := gen_random_uuid();
  deleted_table uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  key_1 uuid := gen_random_uuid();
  event_1 uuid := gen_random_uuid();
  occurred timestamptz := pg_catalog.clock_timestamp();
  r record;
  n integer;
  updated_before timestamptz;
begin
  if actor is null then raise exception 'DINING_TABLE_DETAILS_TEST_ACTOR_REQUIRED'; end if;
  insert into app.restaurants(id,name,time_zone) values
    (restaurant,'rollback-only details','America/Hermosillo'),
    (other_restaurant,'rollback-only details foreign','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (branch,restaurant,'rollback-only details branch'),
    (other_branch,other_restaurant,'rollback-only details foreign branch');
  insert into auth.users(id,email) values
    (waiter,'local-details-waiter@invalid.test'),
    (foreign_actor,'local-details-foreign@invalid.test');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values
    (membership,actor,restaurant,branch,actor),
    (waiter_membership,waiter,restaurant,branch,actor),
    (foreign_membership,foreign_actor,other_restaurant,other_branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values
    (membership,'manager',actor),(waiter_membership,'waiter',actor),(foreign_membership,'manager',actor);
  insert into app.dining_zones(id,restaurant_id,branch_id,name,created_by) values
    (zone_id,restaurant,branch,'rollback-only zone',actor),
    (foreign_zone,other_restaurant,other_branch,'rollback-only foreign zone',actor);
  insert into app.dining_tables(id,restaurant_id,branch_id,zone_id,name,capacity,shape,layout_x,layout_y,layout_width,layout_height,created_by,updated_by) values
    (table_a,restaurant,branch,zone_id,'Mesa A',4,'square',1,2,3,4,actor,actor),
    (table_b,restaurant,branch,zone_id,'Mesa B',2,'round',5,5,2,2,actor,actor),
    (foreign_table,other_restaurant,other_branch,foreign_zone,'Mesa A',4,'square',0,0,2,2,actor,actor);
  insert into app.dining_tables(id,restaurant_id,branch_id,zone_id,name,capacity,shape,layout_x,layout_y,layout_width,layout_height,created_by,updated_by,deleted_at)
    values (deleted_table,restaurant,branch,zone_id,'Mesa borrada',4,'square',8,8,2,2,actor,actor,pg_catalog.clock_timestamp());

  execute 'set local role app_api';
  -- non-manager role in the same branch: forbidden
  select * into r from app_private.update_dining_table_details(waiter,restaurant,branch,table_a,gen_random_uuid(),gen_random_uuid(),device,occurred,1,'Terraza 1',6,'round');
  if r.status<>'forbidden' then raise exception 'DINING_TABLE_DETAILS_WAITER_ACCEPTED'; end if;
  -- manager of another restaurant targeting this scope: forbidden
  select * into r from app_private.update_dining_table_details(foreign_actor,restaurant,branch,table_a,gen_random_uuid(),gen_random_uuid(),device,occurred,1,'Terraza 1',6,'round');
  if r.status<>'forbidden' then raise exception 'DINING_TABLE_DETAILS_FOREIGN_ACTOR_ACCEPTED'; end if;
  -- own manager addressing a table of another branch/restaurant through own scope: conflict, untouched
  select * into r from app_private.update_dining_table_details(actor,restaurant,branch,foreign_table,gen_random_uuid(),gen_random_uuid(),device,occurred,1,'Hackeada',6,'round');
  if r.status<>'conflict' then raise exception 'DINING_TABLE_DETAILS_CROSS_SCOPE_ACCEPTED'; end if;
  -- invalid inputs: blank/untrimmed/control/too long name, capacity and shape bounds, version 0
  select * into r from app_private.update_dining_table_details(actor,restaurant,branch,table_a,gen_random_uuid(),gen_random_uuid(),device,occurred,1,' Mesa',4,'square');
  if r.status<>'conflict' then raise exception 'DINING_TABLE_DETAILS_UNTRIMMED_NAME_ACCEPTED'; end if;
  select * into r from app_private.update_dining_table_details(actor,restaurant,branch,table_a,gen_random_uuid(),gen_random_uuid(),device,occurred,1,'',4,'square');
  if r.status<>'conflict' then raise exception 'DINING_TABLE_DETAILS_EMPTY_NAME_ACCEPTED'; end if;
  select * into r from app_private.update_dining_table_details(actor,restaurant,branch,table_a,gen_random_uuid(),gen_random_uuid(),device,occurred,1,pg_catalog.repeat('x',41),4,'square');
  if r.status<>'conflict' then raise exception 'DINING_TABLE_DETAILS_LONG_NAME_ACCEPTED'; end if;
  select * into r from app_private.update_dining_table_details(actor,restaurant,branch,table_a,gen_random_uuid(),gen_random_uuid(),device,occurred,1,E'Me\tsa',4,'square');
  if r.status<>'conflict' then raise exception 'DINING_TABLE_DETAILS_CONTROL_NAME_ACCEPTED'; end if;
  select * into r from app_private.update_dining_table_details(actor,restaurant,branch,table_a,gen_random_uuid(),gen_random_uuid(),device,occurred,1,'Mesa',0,'square');
  if r.status<>'conflict' then raise exception 'DINING_TABLE_DETAILS_ZERO_CAPACITY_ACCEPTED'; end if;
  select * into r from app_private.update_dining_table_details(actor,restaurant,branch,table_a,gen_random_uuid(),gen_random_uuid(),device,occurred,1,'Mesa',51,'square');
  if r.status<>'conflict' then raise exception 'DINING_TABLE_DETAILS_HUGE_CAPACITY_ACCEPTED'; end if;
  select * into r from app_private.update_dining_table_details(actor,restaurant,branch,table_a,gen_random_uuid(),gen_random_uuid(),device,occurred,1,'Mesa',4,'triangle');
  if r.status<>'conflict' then raise exception 'DINING_TABLE_DETAILS_BAD_SHAPE_ACCEPTED'; end if;
  select * into r from app_private.update_dining_table_details(actor,restaurant,branch,table_a,gen_random_uuid(),gen_random_uuid(),device,occurred,0,'Mesa',4,'square');
  if r.status<>'conflict' then raise exception 'DINING_TABLE_DETAILS_ZERO_VERSION_ACCEPTED'; end if;
  execute 'reset role';
  select count(*) into n from app.dining_table_audit_events where restaurant_id in (restaurant,other_restaurant);
  if n<>0 or (select name from app.dining_tables where id=foreign_table)<>'Mesa A'
    or (select version from app.dining_tables where id=table_a)<>1 then raise exception 'DINING_TABLE_DETAILS_REJECTION_MUTATED_STATE'; end if;
  updated_before := (select updated_at from app.dining_tables where id=table_a);

  execute 'set local role app_api';
  -- success: only name/capacity/shape change; layout, zone and scope stay; version +1
  select * into r from app_private.update_dining_table_details(actor,restaurant,branch,table_a,event_1,key_1,device,occurred,1,'Terraza 1',6,'rectangle');
  if r.status<>'updated' or r.table_name<>'Terraza 1' or r.capacity<>6 or r.shape<>'rectangle' or r.table_version<>2
    or r.layout_x<>1 or r.layout_y<>2 or r.layout_width<>3 or r.layout_height<>4 or r.zone_id<>zone_id
    or r.restaurant_id<>restaurant or r.branch_id<>branch or r.updated_by<>actor or r.updated_at<=updated_before
  then raise exception 'DINING_TABLE_DETAILS_UPDATE_REJECTED'; end if;
  execute 'reset role';
  select count(*) into n from app.dining_table_audit_events
    where event_id=event_1 and operation='details_updated' and expected_version=1 and result_version=2 and table_id=table_a
      and name_snapshot='Terraza 1' and capacity_snapshot=6 and shape_snapshot='rectangle'
      and layout_x_snapshot=1 and layout_y_snapshot=2 and layout_width_snapshot=3 and layout_height_snapshot=4
      and actor_id=actor and device_id=device and occurred_at=occurred;
  if n<>1 then raise exception 'DINING_TABLE_DETAILS_AUDIT_NOT_PERSISTED'; end if;

  execute 'set local role app_api';
  -- exact replay returns the same result without a second version bump or audit row
  select * into r from app_private.update_dining_table_details(actor,restaurant,branch,table_a,event_1,key_1,device,occurred,1,'Terraza 1',6,'rectangle');
  if r.status<>'replayed' or r.table_version<>2 or r.table_name<>'Terraza 1' then raise exception 'DINING_TABLE_DETAILS_REPLAY_REJECTED'; end if;
  -- same key with a different payload, version, device, event or time: conflict
  select * into r from app_private.update_dining_table_details(actor,restaurant,branch,table_a,event_1,key_1,device,occurred,1,'Terraza 1',7,'rectangle');
  if r.status<>'conflict' then raise exception 'DINING_TABLE_DETAILS_KEY_REUSE_CAPACITY_ACCEPTED'; end if;
  select * into r from app_private.update_dining_table_details(actor,restaurant,branch,table_a,event_1,key_1,device,occurred,1,'Terraza 2',6,'rectangle');
  if r.status<>'conflict' then raise exception 'DINING_TABLE_DETAILS_KEY_REUSE_NAME_ACCEPTED'; end if;
  select * into r from app_private.update_dining_table_details(actor,restaurant,branch,table_a,event_1,key_1,device,occurred,1,'Terraza 1',6,'round');
  if r.status<>'conflict' then raise exception 'DINING_TABLE_DETAILS_KEY_REUSE_SHAPE_ACCEPTED'; end if;
  select * into r from app_private.update_dining_table_details(actor,restaurant,branch,table_a,gen_random_uuid(),key_1,device,occurred,1,'Terraza 1',6,'rectangle');
  if r.status<>'conflict' then raise exception 'DINING_TABLE_DETAILS_KEY_REUSE_EVENT_ACCEPTED'; end if;
  select * into r from app_private.update_dining_table_details(actor,restaurant,branch,table_b,event_1,key_1,device,occurred,1,'Terraza 1',6,'rectangle');
  if r.status<>'conflict' then raise exception 'DINING_TABLE_DETAILS_KEY_REUSE_TABLE_ACCEPTED'; end if;
  -- event id reuse under a fresh key: conflict
  select * into r from app_private.update_dining_table_details(actor,restaurant,branch,table_a,event_1,gen_random_uuid(),device,occurred,2,'Terraza 3',6,'rectangle');
  if r.status<>'conflict' then raise exception 'DINING_TABLE_DETAILS_EVENT_REUSE_ACCEPTED'; end if;
  -- stale version: conflict
  select * into r from app_private.update_dining_table_details(actor,restaurant,branch,table_a,gen_random_uuid(),gen_random_uuid(),device,occurred,1,'Terraza 4',6,'rectangle');
  if r.status<>'conflict' then raise exception 'DINING_TABLE_DETAILS_STALE_VERSION_ACCEPTED'; end if;
  -- duplicate name inside the branch (case-insensitive): conflict, no mutation and no audit row
  select * into r from app_private.update_dining_table_details(actor,restaurant,branch,table_a,gen_random_uuid(),gen_random_uuid(),device,occurred,2,'mesa b',6,'rectangle');
  if r.status<>'conflict' then raise exception 'DINING_TABLE_DETAILS_DUPLICATE_NAME_ACCEPTED'; end if;
  -- keeping an own name with different casing is allowed (the unique key ignores the row itself)
  select * into r from app_private.update_dining_table_details(actor,restaurant,branch,table_a,gen_random_uuid(),gen_random_uuid(),device,occurred,2,'TERRAZA 1',8,'square');
  if r.status<>'updated' or r.table_name<>'TERRAZA 1' or r.table_version<>3 or r.capacity<>8 then raise exception 'DINING_TABLE_DETAILS_SELF_RENAME_REJECTED'; end if;
  -- soft-deleted table: conflict
  select * into r from app_private.update_dining_table_details(actor,restaurant,branch,deleted_table,gen_random_uuid(),gen_random_uuid(),device,occurred,1,'Resucitada',4,'square');
  if r.status<>'conflict' then raise exception 'DINING_TABLE_DETAILS_DELETED_TABLE_ACCEPTED'; end if;
  execute 'reset role';

  select count(*) into n from app.dining_table_audit_events where restaurant_id=restaurant and operation='details_updated';
  if n<>2 then raise exception 'DINING_TABLE_DETAILS_AUDIT_COUNT_REJECTED'; end if;
  if (select version from app.dining_tables where id=table_a)<>3
    or (select name from app.dining_tables where id=table_b)<>'Mesa B'
    or (select version from app.dining_tables where id=table_b)<>1
    or (select name from app.dining_tables where id=foreign_table)<>'Mesa A'
    or (select name from app.dining_tables where id=deleted_table)<>'Mesa borrada'
  then raise exception 'DINING_TABLE_DETAILS_FINAL_STATE_REJECTED'; end if;

  -- the layout command still works on top of a details edit (versions chain), and the audit CHECK stays strict
  execute 'set local role app_api';
  select * into r from app_private.update_dining_table_layout(actor,restaurant,branch,table_a,gen_random_uuid(),gen_random_uuid(),device,occurred,3,10,10,2,2);
  if r.status<>'updated' or r.table_version<>4 or r.table_name<>'TERRAZA 1' then raise exception 'DINING_TABLE_DETAILS_LAYOUT_CHAIN_REJECTED'; end if;
  execute 'reset role';
  begin
    insert into app.dining_table_audit_events(event_id,idempotency_key,restaurant_id,branch_id,table_id,zone_id,actor_id,device_id,operation,expected_version,result_version,result_updated_at,name_snapshot,capacity_snapshot,shape_snapshot,layout_x_snapshot,layout_y_snapshot,layout_width_snapshot,layout_height_snapshot,occurred_at)
      values(gen_random_uuid(),gen_random_uuid(),restaurant,branch,table_a,zone_id,actor,device,'details_updated',null,2,occurred,'x',1,'round',0,0,2,2,occurred);
    raise exception 'DINING_TABLE_DETAILS_AUDIT_CHECK_NOT_ENFORCED';
  exception when check_violation then null;
  end;

  if pg_catalog.has_function_privilege('authenticated','app_private.update_dining_table_details(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,text,integer,text)','EXECUTE')
    or pg_catalog.has_function_privilege('anon','app_private.update_dining_table_details(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,text,integer,text)','EXECUTE')
    or pg_catalog.has_function_privilege('service_role','app_private.update_dining_table_details(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,text,integer,text)','EXECUTE')
    or not pg_catalog.has_function_privilege('app_api','app_private.update_dining_table_details(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,text,integer,text)','EXECUTE')
  then raise exception 'DINING_TABLE_DETAILS_GRANTS_REJECTED'; end if;
end
$dining_table_details_tests$;
commit;
