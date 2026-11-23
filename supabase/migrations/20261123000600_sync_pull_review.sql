begin;

create function app_private.sync_read_changes(p_actor uuid,p_restaurant uuid,p_branch uuid,p_after bigint,p_limit integer)
returns setof app.sync_changelog language plpgsql stable security definer set search_path = '' as $f$
begin
 if not app_private.sync_authorized(p_actor,p_restaurant,p_branch) then raise exception 'SYNC_FORBIDDEN' using errcode='42501'; end if;
 if p_after < 0 or p_limit < 1 or p_limit > 501 then raise exception 'SYNC_INVALID'; end if;
 return query select c.* from app.sync_changelog c where c.restaurant_id=p_restaurant and c.branch_id=p_branch and c.canonical_sequence>p_after
 and exists (select 1 from app_private.find_active_branch_membership(p_actor,p_restaurant,p_branch) m where
   m.roles && array['owner','admin','manager','supervisor']::text[]
   or (c.entity_type in ('Order','OrderItem','DiningTable','MenuCatalog','CaptureDraft','Customer') and m.roles && array['cashier','waiter']::text[])
   or (c.entity_type in ('Payment','CashMovement','CashRegisterSession') and m.roles && array['cashier']::text[]))
 order by c.canonical_sequence limit p_limit;
end $f$;

-- Retain the minimum facts needed to render review cases; older ledger rows remain explicitly unknown.
create table app_private.sync_review_event_facts (
 restaurant_id uuid not null, branch_id uuid not null, event_id text not null,
 base_version jsonb not null, amount_minor jsonb, currency jsonb,
 primary key (restaurant_id,branch_id,event_id),
 foreign key (restaurant_id,branch_id,event_id) references app.sync_event_ledger(restaurant_id,branch_id,event_id)
);
revoke all on app_private.sync_review_event_facts from public,anon,authenticated,service_role,app_api;
alter function app_private.sync_record_event(uuid,jsonb,jsonb) rename to sync_record_event_internal;
revoke all on function app_private.sync_record_event_internal(uuid,jsonb,jsonb) from public,anon,authenticated,service_role,app_api;
create function app_private.sync_record_event(p_actor uuid,p_event jsonb,p_result jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $f$
declare outcome jsonb;
begin
 outcome := app_private.sync_record_event_internal(p_actor,p_event,p_result);
 if outcome->>'status'='recorded' then
  insert into app_private.sync_review_event_facts values ((p_event->>'restaurantId')::uuid,(p_event->>'branchId')::uuid,p_event->>'eventId',coalesce(p_event->'baseVersion','null'::jsonb),p_event->'payload'->'amountMinor',p_event->'payload'->'currency');
 end if;
 return outcome;
end $f$;
alter function app_private.sync_record_event(uuid,jsonb,jsonb) owner to postgres;
revoke all on function app_private.sync_record_event(uuid,jsonb,jsonb) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.sync_record_event(uuid,jsonb,jsonb) to app_api;

create function app_private.sync_read_reviews(p_actor uuid,p_restaurant uuid,p_branch uuid)
returns table(case_data jsonb, event_data jsonb, facts jsonb) language plpgsql stable security definer set search_path = '' as $f$
begin
 if not exists(select 1 from app_private.find_active_branch_membership(p_actor,p_restaurant,p_branch) m where m.roles && array['owner','admin','manager','supervisor']::text[]) then raise exception 'SYNC_FORBIDDEN' using errcode='42501'; end if;
 return query select to_jsonb(c),to_jsonb(e) - 'event_fingerprint' - 'intention_fingerprint',to_jsonb(f) from app.sync_manual_review_cases c join app.sync_event_ledger e using (restaurant_id,branch_id,event_id) left join app_private.sync_review_event_facts f using (restaurant_id,branch_id,event_id) where c.restaurant_id=p_restaurant and c.branch_id=p_branch order by c.opened_at,c.case_id;
end $f$;

create or replace function app_private.sync_resolve_review(p_actor uuid,p_restaurant uuid,p_branch uuid,p_case uuid,p_decision text,p_reason text,p_compensating_event text)
returns text language plpgsql security definer set search_path = '' as $f$
declare review app.sync_manual_review_cases%rowtype;
begin
 if not exists(select 1 from app_private.find_active_branch_membership(p_actor,p_restaurant,p_branch) m where m.roles && array['owner','admin','manager','supervisor']::text[]) then return 'denied'; end if;
 if p_decision is null or p_decision not in ('resolved_compensated','resolved_rejected') or coalesce(length(btrim(p_reason)),0)=0 or (p_decision='resolved_compensated' and p_compensating_event is null) or (p_decision='resolved_rejected' and p_compensating_event is not null) then return 'invalid'; end if;
 select * into review from app.sync_manual_review_cases where case_id=p_case and restaurant_id=p_restaurant and branch_id=p_branch for update;
 if not found then return 'not_found'; end if;
 if review.status <> 'open' then
  if p_decision='resolved_compensated' and review.status=p_decision and review.compensating_event_id=p_compensating_event then return 'duplicate'; end if;
  return 'already_resolved';
 end if;
 if p_compensating_event is not null and not exists(
  select 1 from app.sync_event_ledger original join app.sync_event_ledger compensation
   on compensation.restaurant_id=original.restaurant_id and compensation.branch_id=original.branch_id
   and compensation.entity_type=original.entity_type and compensation.entity_id=original.entity_id
  where original.restaurant_id=p_restaurant and original.branch_id=p_branch and original.event_id=review.event_id
   and compensation.event_id=p_compensating_event and compensation.operation='compensate'
   and compensation.result->>'status'='accepted'
 ) then return 'invalid'; end if;
 begin
  update app.sync_manual_review_cases set status=p_decision,resolved_at=clock_timestamp(),resolved_by_actor_id=p_actor,resolution_reason=p_reason,compensating_event_id=p_compensating_event
  where case_id=p_case;
 exception when unique_violation then return 'compensation_in_use'; end;
 return 'resolved';
end $f$;

alter function app_private.sync_read_changes(uuid,uuid,uuid,bigint,integer) owner to postgres;
alter function app_private.sync_read_reviews(uuid,uuid,uuid) owner to postgres;
revoke all on function app_private.sync_read_changes(uuid,uuid,uuid,bigint,integer), app_private.sync_read_reviews(uuid,uuid,uuid), app_private.sync_resolve_review(uuid,uuid,uuid,uuid,text,text,text) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.sync_read_changes(uuid,uuid,uuid,bigint,integer), app_private.sync_read_reviews(uuid,uuid,uuid), app_private.sync_resolve_review(uuid,uuid,uuid,uuid,text,text,text) to app_api;

create table app_private.sync_review_commands (
 restaurant_id uuid not null, branch_id uuid not null, idempotency_key text not null,
 actor_id uuid not null, device_id text not null, case_id uuid not null, decision text not null,
 reason text not null, compensating_event_id text, occurred_at text not null,
 primary key (restaurant_id,branch_id,idempotency_key)
);
revoke all on app_private.sync_review_commands from public,anon,authenticated,service_role,app_api;

create function app_private.sync_resolve_review_command(p_actor uuid,p_restaurant uuid,p_branch uuid,p_case uuid,p_decision text,p_reason text,p_compensating text,p_key text,p_device text,p_occurred_at text)
returns text language plpgsql security definer set search_path = '' as $f$
declare previous app_private.sync_review_commands%rowtype; outcome text;
begin
 if not exists(select 1 from app_private.find_active_branch_membership(p_actor,p_restaurant,p_branch) m where m.roles && array['owner','admin','manager','supervisor']::text[]) or app_private.sync_device_state(p_restaurant,p_branch,p_device,p_actor) <> 'active' then return 'denied'; end if;
 if p_key is null or p_key !~ '^[!-~]{1,128}$' or p_decision not in ('reject','compensate') then return 'invalid'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_restaurant::text || ':' || p_branch::text || ':' || p_key,0));
 select * into previous from app_private.sync_review_commands where restaurant_id=p_restaurant and branch_id=p_branch and idempotency_key=p_key;
 if found then
  if previous.actor_id=p_actor and previous.device_id=p_device and previous.case_id=p_case and previous.decision=p_decision and previous.reason=p_reason and previous.compensating_event_id is not distinct from p_compensating and previous.occurred_at=p_occurred_at then return 'duplicate'; end if;
  return 'idempotency_conflict';
 end if;
 outcome := app_private.sync_resolve_review(p_actor,p_restaurant,p_branch,p_case,case p_decision when 'reject' then 'resolved_rejected' else 'resolved_compensated' end,p_reason,p_compensating);
 if outcome <> 'resolved' then return outcome; end if;
 insert into app_private.sync_review_commands values(p_restaurant,p_branch,p_key,p_actor,p_device,p_case,p_decision,p_reason,p_compensating,p_occurred_at);
 return outcome;
end $f$;
alter function app_private.sync_resolve_review_command(uuid,uuid,uuid,uuid,text,text,text,text,text,text) owner to postgres;
revoke all on function app_private.sync_resolve_review_command(uuid,uuid,uuid,uuid,text,text,text,text,text,text) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.sync_resolve_review_command(uuid,uuid,uuid,uuid,text,text,text,text,text,text) to app_api;

commit;
