begin;
do $test$
declare
 actor uuid := gen_random_uuid(); other_actor uuid := gen_random_uuid(); r uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); b2 uuid := gen_random_uuid(); m uuid := gen_random_uuid();
 e jsonb; answer jsonb; tbl text; f record; n bigint;
begin
 foreach tbl in array array['sync_devices','sync_event_ledger','sync_event_receipts','sync_changelog','sync_manual_review_cases'] loop
  if not exists(select 1 from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='app' and c.relname=tbl and c.relrowsecurity and c.relforcerowsecurity) then raise exception 'missing RLS: %',tbl; end if;
  if has_table_privilege('app_api','app.'||tbl,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated','app.'||tbl,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'direct grant: %',tbl; end if;
 end loop;
 for f in select p.oid,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname in ('sync_register_device','sync_record_event','sync_append_change') loop
  if not f.prosecdef or not (f.proconfig @> array['search_path=""'] or f.proconfig @> array['search_path=']) or not has_function_privilege('app_api',f.oid,'EXECUTE') or has_function_privilege('public',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE') then raise exception 'function security'; end if;
 end loop;
 insert into auth.users(id,email) values(actor,'sync@invalid.test'),(other_actor,'other@invalid.test');
 insert into app.restaurants(id,name,time_zone) values(r,'sync','America/Hermosillo'),(r2,'foreign','America/Hermosillo');
 insert into app.branches(id,restaurant_id,name) values(b,r,'sync'),(b2,r2,'foreign');
 insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values(m,actor,r,b,actor);
 insert into app.membership_role_grants(membership_id,role_code,granted_by) values(m,'cashier',actor);
 execute 'set local role app_api';
 if not app_private.sync_register_device(actor,r,b,'device-1') or app_private.sync_register_device(other_actor,r,b,'device-1') then raise exception 'device registration'; end if;
 e := jsonb_build_object('eventId','event-1','idempotencyKey','key-1','deviceId','device-1','actorId',actor,'restaurantId',r,'branchId',b,'entityType','Payment','entityId','payment-1','operation','create','schemaVersion','1','localSequence',0,'baseVersion',null,'occurredAt','2026-01-01T00:00:00Z','payload',jsonb_build_object('amountMinor',100));
 answer := app_private.sync_record_event(actor,e,'{"status":"accepted"}'); if answer->>'status' <> 'recorded' then raise exception 'record %',answer; end if;
 answer := app_private.sync_record_event(actor,e,'{}'); if answer->>'status' <> 'duplicate' or answer#>>'{result,status}' <> 'accepted' then raise exception 'replay %',answer; end if;
 answer := app_private.sync_record_event(actor,jsonb_set(e,'{payload,amountMinor}','200'),'{}'); if answer->>'code' <> 'EVENT_ID_REUSE' then raise exception 'event mismatch %',answer; end if;
 answer := app_private.sync_record_event(actor,jsonb_set(jsonb_set(e,'{eventId}','"event-2"'),'{payload,amountMinor}','200'),'{}'); if answer->>'code' <> 'IDEMPOTENCY_KEY_REUSE' then raise exception 'key mismatch %',answer; end if;
 answer := app_private.sync_record_event(actor,jsonb_set(jsonb_set(e,'{eventId}','"event-2"'),'{localSequence}','1'),'{}'); if answer->>'status' <> 'duplicate' then raise exception 'rebuilt intent %',answer; end if;
 answer := app_private.sync_record_event(actor,jsonb_set(jsonb_set(jsonb_set(e,'{eventId}','"event-2"'),'{localSequence}','1'),'{idempotencyKey}','"key-new"'),'{}'); if answer->>'code' <> 'EVENT_ID_REUSE' then raise exception 'rebuilt event reused %',answer; end if;
 answer := app_private.sync_record_event(actor,jsonb_set(jsonb_set(e,'{eventId}','"event-3"'),'{idempotencyKey}','"key-3"'),'{}'); if answer->>'code' <> 'LOCAL_SEQUENCE_REUSE' then raise exception 'sequence %',answer; end if;
 answer := app_private.sync_record_event(actor,jsonb_set(jsonb_set(e,'{restaurantId}',to_jsonb(r2)),'{branchId}',to_jsonb(b2)),'{}'); if answer->>'status' <> 'denied' then raise exception 'tenant leak %',answer; end if;
 n := app_private.sync_append_change(actor,r,b,'Customer','customer-1',1,true,null); if n <> 1 then raise exception 'first cursor'; end if;
 n := app_private.sync_append_change(actor,r,b,'Customer','customer-1',2,false,'{}'); if n <> 2 then raise exception 'second cursor'; end if;
 begin perform app_private.sync_append_change(actor,r,b,'Payment','payment-1',1,true,null); raise exception 'financial tombstone accepted'; exception when check_violation then null; end;
 if app_private.sync_append_change(actor,r2,b2,'Customer','x',1,true,null) is not null then raise exception 'foreign append'; end if;
 execute 'reset role';
 if not exists(select 1 from app.sync_event_ledger where event_id='event-1' and financial) then raise exception 'financial classification'; end if;
end $test$;
rollback;
