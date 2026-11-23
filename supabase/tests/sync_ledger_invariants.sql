begin;
do $test$
declare
 actor uuid := gen_random_uuid(); other_actor uuid := gen_random_uuid(); kitchen uuid := gen_random_uuid(); supervisor uuid := gen_random_uuid(); r uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); b2 uuid := gen_random_uuid(); b3 uuid := gen_random_uuid(); m uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); m3 uuid := gen_random_uuid(); mk uuid := gen_random_uuid(); ms uuid := gen_random_uuid(); mk2 uuid := gen_random_uuid(); review_id uuid;
 e jsonb; answer jsonb; tbl text; f record; n bigint; financial_entity text;
begin
 foreach tbl in array array['sync_devices','sync_event_ledger','sync_event_receipts','sync_changelog','sync_manual_review_cases'] loop
  if not exists(select 1 from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='app' and c.relname=tbl and c.relrowsecurity and c.relforcerowsecurity) then raise exception 'missing RLS: %',tbl; end if;
  if has_table_privilege('app_api','app.'||tbl,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated','app.'||tbl,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'direct grant: %',tbl; end if;
 end loop;
 for f in select p.oid,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname in ('sync_authorized','sync_register_device','sync_record_event','sync_append_change','sync_open_review','sync_resolve_review','sync_revoke_device') loop
  if not f.prosecdef or not (f.proconfig @> array['search_path=""'] or f.proconfig @> array['search_path=']) or not has_function_privilege('app_api',f.oid,'EXECUTE') or has_function_privilege('public',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE') or has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('service_role',f.oid,'EXECUTE') then raise exception 'function security'; end if;
 end loop;
 insert into auth.users(id,email) values(actor,'sync@invalid.test'),(other_actor,'other@invalid.test'),(kitchen,'kitchen@invalid.test'),(supervisor,'supervisor@invalid.test');
 insert into app.restaurants(id,name,time_zone) values(r,'sync','America/Hermosillo'),(r2,'foreign','America/Hermosillo');
 insert into app.branches(id,restaurant_id,name) values(b,r,'sync'),(b2,r2,'foreign'),(b3,r,'second branch');
 insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values(m,actor,r,b,actor),(m2,actor,r2,b2,actor),(m3,actor,r,b3,actor),(mk,kitchen,r,b,actor),(mk2,kitchen,r2,b2,actor),(ms,supervisor,r,b,actor);
 insert into app.membership_role_grants(membership_id,role_code,granted_by) values(m,'cashier',actor),(m2,'cashier',actor),(m3,'cashier',actor),(mk,'kitchen',actor),(mk2,'kitchen',actor),(ms,'supervisor',actor);
 execute 'set local role app_api';
 if not app_private.sync_register_device(actor,r,b,'device-1') or app_private.sync_register_device(other_actor,r,b,'device-1') then raise exception 'device registration'; end if;
 if not app_private.sync_register_device(kitchen,r2,b2,'device-1') then raise exception 'cross tenant device squatting'; end if;
 if not app_private.sync_register_device(kitchen,r,b,'kitchen-device') then raise exception 'kitchen device'; end if;
 if not app_private.sync_register_device(supervisor,r,b,'supervisor-device') then raise exception 'supervisor device'; end if;
 e := jsonb_build_object('eventId','event-1','idempotencyKey','key-1','deviceId','device-1','actorId',actor,'restaurantId',r,'branchId',b,'entityType','Payment','entityId','payment-1','operation','create','schemaVersion','1','localSequence',0,'baseVersion',null,'occurredAt','2026-01-01T00:00:00Z','payload',jsonb_build_object('amountMinor',100));
 answer := app_private.sync_record_event(actor,e,'{"status":"accepted"}'); if answer->>'status' <> 'recorded' then raise exception 'record %',answer; end if;
 answer := app_private.sync_record_event(actor,e,'{}'); if answer->>'status' <> 'duplicate' or answer#>>'{result,status}' <> 'accepted' then raise exception 'replay %',answer; end if;
 answer := app_private.sync_record_event(actor,jsonb_set(e,'{payload,amountMinor}','200'),'{}'); if answer->>'code' <> 'EVENT_ID_REUSE' then raise exception 'event mismatch %',answer; end if;
 answer := app_private.sync_record_event(actor,jsonb_set(jsonb_set(e,'{eventId}','"event-2"'),'{payload,amountMinor}','200'),'{}'); if answer->>'code' <> 'IDEMPOTENCY_KEY_REUSE' then raise exception 'key mismatch %',answer; end if;
 answer := app_private.sync_record_event(actor,jsonb_set(jsonb_set(e,'{eventId}','"event-2"'),'{localSequence}','1'),'{}'); if answer->>'status' <> 'duplicate' then raise exception 'rebuilt intent %',answer; end if;
 answer := app_private.sync_record_event(actor,jsonb_set(jsonb_set(jsonb_set(e,'{eventId}','"event-2"'),'{localSequence}','1'),'{idempotencyKey}','"key-new"'),'{}'); if answer->>'code' <> 'EVENT_ID_REUSE' then raise exception 'rebuilt event reused %',answer; end if;
 answer := app_private.sync_record_event(actor,jsonb_set(jsonb_set(e,'{eventId}','"event-3"'),'{idempotencyKey}','"key-3"'),'{}'); if answer->>'code' <> 'LOCAL_SEQUENCE_REUSE' then raise exception 'sequence %',answer; end if;
 answer := app_private.sync_record_event(other_actor,jsonb_set(jsonb_set(jsonb_set(e,'{actorId}',to_jsonb(other_actor)),'{restaurantId}',to_jsonb(r2)),'{branchId}',to_jsonb(b2)),'{}'); if answer->>'status' <> 'denied' then raise exception 'tenant leak %',answer; end if;
 foreach financial_entity in array array['Payment','Refund','CashMovement','OrderDiscount'] loop
  answer := app_private.sync_record_event(kitchen,jsonb_set(jsonb_set(jsonb_set(e,'{actorId}',to_jsonb(kitchen)),'{deviceId}','"kitchen-device"'),'{entityType}',to_jsonb(financial_entity)),'{}');
  if answer->>'status' <> 'denied' then raise exception 'kitchen financial %: %',financial_entity,answer; end if;
 end loop;
 answer := app_private.sync_record_event(supervisor,jsonb_set(jsonb_set(jsonb_set(jsonb_set(e,'{actorId}',to_jsonb(supervisor)),'{deviceId}','"supervisor-device"'),'{eventId}','"other-actor-event"'),'{localSequence}','0'),'{}'); if answer->>'code' <> 'IDEMPOTENCY_KEY_REUSE' then raise exception 'actor fingerprint %',answer; end if;
 if app_private.sync_append_change(kitchen,r,b,'Payment','payment-2',1,false,'{}','create') is not null then raise exception 'kitchen changelog'; end if;
 review_id := app_private.sync_open_review(actor,r,b,'event-1','PAYMENT_UNCERTAIN'); if review_id is null then raise exception 'open review'; end if;
 if app_private.sync_resolve_review(actor,r,b,review_id,'resolved_rejected','reason',null) then raise exception 'cashier resolved'; end if;
 if not app_private.sync_resolve_review(supervisor,r,b,review_id,'resolved_rejected','reason',null) then raise exception 'supervisor resolve'; end if;
 if not app_private.sync_register_device(actor,r,b3,'branch-device') then raise exception 'same restaurant branch registration'; end if;
 answer := app_private.sync_record_event(actor,jsonb_set(jsonb_set(jsonb_set(e,'{branchId}',to_jsonb(b3)),'{deviceId}','"branch-device"'),'{eventId}','"same-restaurant-event"'),'{}'); if answer->>'status' <> 'recorded' then raise exception 'same restaurant branch key %',answer; end if;
 if not app_private.sync_register_device(actor,r2,b2,'actor-device') then raise exception 'second branch registration'; end if;
 answer := app_private.sync_record_event(actor,jsonb_set(jsonb_set(jsonb_set(jsonb_set(e,'{restaurantId}',to_jsonb(r2)),'{branchId}',to_jsonb(b2)),'{deviceId}','"actor-device"'),'{eventId}','"branch-event"'),'{}'); if answer->>'status' <> 'recorded' then raise exception 'scoped key %',answer; end if;
 if not app_private.sync_revoke_device(actor,r2,b2,'actor-device') then raise exception 'revoke'; end if;
 answer := app_private.sync_record_event(actor,jsonb_set(jsonb_set(jsonb_set(e,'{restaurantId}',to_jsonb(r2)),'{branchId}',to_jsonb(b2)),'{deviceId}','"actor-device"'),'{}'); if answer->>'status' <> 'denied' then raise exception 'revoked device %',answer; end if;
 n := app_private.sync_append_change(actor,r,b,'Customer','customer-1',1,false,'{}','create'); if n <> 1 then raise exception 'first cursor'; end if;
 begin perform app_private.sync_append_change(actor,r,b,'Customer','customer-1',1,false,'{}','update'); raise exception 'version accepted'; exception when check_violation then null; end;
 n := app_private.sync_append_change(actor,r,b,'Customer','customer-1',2,true,null,'delete'); if n <> 2 then raise exception 'second cursor'; end if;
 begin perform app_private.sync_append_change(actor,r,b,'Customer','customer-1',3,false,'{}','update'); raise exception 'resurrection accepted'; exception when check_violation then null; end;
 if app_private.sync_append_change(actor,r,b,'Payment','payment-1',1,true,null,'delete') is not null then raise exception 'financial tombstone accepted'; end if;
 if app_private.sync_append_change(other_actor,r2,b2,'Customer','x',1,true,null,'delete') is not null then raise exception 'foreign append'; end if;
 execute 'reset role';
 if not exists(select 1 from app.sync_event_ledger where event_id='event-1' and financial) then raise exception 'financial classification'; end if;
 if not exists(select 1 from app.sync_manual_review_cases where case_id=review_id and resolved_by_actor_id=supervisor) then raise exception 'resolution actor'; end if;
 foreach tbl in array array['sync_event_ledger','sync_event_receipts','sync_changelog'] loop
  begin execute format('update app.%I set restaurant_id=restaurant_id',tbl); raise exception 'update accepted'; exception when object_not_in_prerequisite_state then null; end;
  begin execute format('delete from app.%I',tbl); raise exception 'delete accepted'; exception when object_not_in_prerequisite_state then null; end;
  begin if tbl='sync_event_ledger' then execute 'truncate app.sync_event_ledger, app.sync_event_receipts, app.sync_manual_review_cases'; else execute format('truncate app.%I',tbl); end if; raise exception 'truncate accepted'; exception when object_not_in_prerequisite_state then null; end;
 end loop;
 update app.memberships set revoked_at=clock_timestamp(),revoked_by=actor,revocation_reason='test' where id=m;
 execute 'set local role app_api';
 if app_private.sync_authorized(actor,r,b) or app_private.sync_record_event(actor,e,'{}')->>'status' <> 'denied' then raise exception 'revoked membership'; end if;
 execute 'reset role';
end $test$;
rollback;
