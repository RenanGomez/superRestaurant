begin;

create table app.sync_devices (
  device_id text primary key,
  actor_id uuid not null references auth.users(id),
  last_local_sequence bigint not null default -1 check (last_local_sequence >= -1),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (length(device_id) between 1 and 128)
);
create table app.sync_event_ledger (
  restaurant_id uuid not null,
  branch_id uuid not null,
  event_id text not null,
  idempotency_key text not null check (idempotency_key ~ '^[!-~]{1,128}$'),
  device_id text not null references app.sync_devices(device_id),
  actor_id uuid not null references auth.users(id),
  local_sequence bigint not null check (local_sequence >= 0),
  entity_type text not null,
  entity_id text not null,
  operation text not null,
  schema_version text not null,
  event_fingerprint bytea not null,
  intention_fingerprint bytea not null,
  result jsonb not null,
  financial boolean generated always as (entity_type in ('Payment','CashMovement','CashRegisterSession','Refund','OrderDiscount')) stored,
  received_at timestamptz not null default clock_timestamp(),
  primary key (restaurant_id, branch_id, event_id),
  unique (restaurant_id, branch_id, idempotency_key),
  unique (device_id, local_sequence),
  foreign key (restaurant_id, branch_id) references app.branches(restaurant_id,id)
);
-- Every reconstructed envelope retains its own identity and device sequence.
create table app.sync_event_receipts (
  restaurant_id uuid not null,
  branch_id uuid not null,
  event_id text not null,
  ledger_event_id text not null,
  event_fingerprint bytea not null,
  device_id text not null references app.sync_devices(device_id),
  local_sequence bigint not null check (local_sequence >= 0),
  primary key (restaurant_id,branch_id,event_id),
  unique (device_id,local_sequence),
  foreign key (restaurant_id,branch_id,ledger_event_id) references app.sync_event_ledger(restaurant_id,branch_id,event_id)
);
create table app.sync_changelog (
  canonical_sequence bigint primary key check (canonical_sequence > 0),
  restaurant_id uuid not null,
  branch_id uuid not null,
  entity_type text not null,
  entity_id text not null,
  canonical_version bigint not null check (canonical_version > 0),
  tombstone boolean not null,
  snapshot jsonb,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (restaurant_id, branch_id) references app.branches(restaurant_id,id),
  check ((tombstone and snapshot is null) or (not tombstone and jsonb_typeof(snapshot) = 'object')),
  check (not tombstone or entity_type in ('OrderItem','DiningTable','MenuCatalog','CaptureDraft','Customer'))
);
create index sync_changelog_scope_sequence_idx on app.sync_changelog(restaurant_id,branch_id,canonical_sequence);
create table app.sync_manual_review_cases (
  case_id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid not null,
  event_id text not null,
  reason_code text not null check (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  status text not null default 'open' check (status in ('open','resolved_compensated','resolved_rejected')),
  opened_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  resolved_by_actor_id uuid references auth.users(id),
  resolution_reason text,
  compensating_event_id text,
  foreign key (restaurant_id,branch_id,event_id) references app.sync_event_ledger(restaurant_id,branch_id,event_id),
  check ((status = 'open' and resolved_at is null and resolved_by_actor_id is null and resolution_reason is null and compensating_event_id is null) or
    (status <> 'open' and resolved_at is not null and resolved_by_actor_id is not null and resolution_reason is not null and length(btrim(resolution_reason)) > 0 and
      ((status = 'resolved_compensated' and compensating_event_id is not null) or (status = 'resolved_rejected' and compensating_event_id is null))))
);
-- This row serializes allocation until commit, preventing pull cursors from skipping late commits.
create table app_private.sync_cursor_counter (singleton boolean primary key default true check(singleton), value bigint not null default 0);
insert into app_private.sync_cursor_counter values (true, 0);

alter table app.sync_devices enable row level security;
alter table app.sync_devices force row level security;
alter table app.sync_event_ledger enable row level security;
alter table app.sync_event_ledger force row level security;
alter table app.sync_event_receipts enable row level security;
alter table app.sync_event_receipts force row level security;
alter table app.sync_changelog enable row level security;
alter table app.sync_changelog force row level security;
alter table app.sync_manual_review_cases enable row level security;
alter table app.sync_manual_review_cases force row level security;
revoke all on app.sync_devices, app.sync_event_ledger, app.sync_event_receipts, app.sync_changelog, app.sync_manual_review_cases from public, anon, authenticated, service_role, app_api;
revoke all on app_private.sync_cursor_counter from public, anon, authenticated, service_role, app_api;

create function app_private.sync_authorized(p_actor uuid, p_restaurant uuid, p_branch uuid)
returns boolean language sql stable security definer set search_path = '' as $f$
 select exists (select 1 from app.memberships m join app.membership_role_grants g on g.membership_id=m.id
 join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
 join app.restaurants r on r.id=m.restaurant_id
 where m.user_id=p_actor and m.restaurant_id=p_restaurant and m.branch_id=p_branch
 and m.revoked_at is null and g.revoked_at is null and b.disabled_at is null and r.disabled_at is null)
$f$;

-- Registration cannot transfer an existing device to another actor.
create function app_private.sync_register_device(p_actor uuid, p_restaurant uuid, p_branch uuid, p_device text)
returns boolean language plpgsql security definer set search_path = '' as $f$
begin
 if not app_private.sync_authorized(p_actor,p_restaurant,p_branch) or p_device is null or length(p_device) not between 1 and 128 then return false; end if;
 insert into app.sync_devices(device_id,actor_id) values(p_device,p_actor) on conflict do nothing;
 return exists(select 1 from app.sync_devices where device_id=p_device and actor_id=p_actor and revoked_at is null);
end $f$;

-- Caller must commit this ledger write and the corresponding business effect atomically.
create function app_private.sync_record_event(p_actor uuid, p_event jsonb, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $f$
declare r uuid; b uuid; seq bigint; d app.sync_devices%rowtype; prior app.sync_event_ledger%rowtype;
 event_hash bytea; intent_hash bytea; normalized jsonb; entity text; op text; receipt app.sync_event_receipts%rowtype;
begin
 begin
  r := (p_event->>'restaurantId')::uuid; b := (p_event->>'branchId')::uuid;
  seq := (p_event->>'localSequence')::bigint;
 exception when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('status','rejected'); end;
 if r is null or b is null or not app_private.sync_authorized(p_actor,r,b) then return jsonb_build_object('status','denied'); end if;
 entity := p_event->>'entityType'; op := p_event->>'operation';
 if p_event->>'actorId' is distinct from p_actor::text or coalesce(p_event->>'eventId','') = '' or coalesce(p_event->>'deviceId','') = ''
 or coalesce(p_event->>'entityId','') = '' or coalesce(p_event->>'schemaVersion','') <> '1'
 or coalesce(p_event->>'idempotencyKey','') !~ '^[!-~]{1,128}$' or seq is null or seq < 0
 or jsonb_typeof(p_event->'payload') is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
 or not coalesce((entity = 'Order' and op in ('create','update','transition','compensate'))
  or (entity = 'OrderItem' and op in ('create','update','transition','delete','compensate'))
  or (entity = 'DiningTable' and op in ('create','update','transition','delete'))
  or (entity = 'KdsTicket' and op in ('create','transition','compensate'))
  or (entity in ('Payment','CashMovement','Refund','OrderDiscount') and op in ('create','compensate'))
  or (entity = 'CashRegisterSession' and op in ('create','transition','compensate'))
  or (entity = 'MenuCatalog' and op in ('create','update','delete','compensate'))
  or (entity = 'CaptureDraft' and op in ('create','update','transition','delete'))
  or (entity = 'Customer' and op in ('create','update','delete')),false)
 then return jsonb_build_object('status','rejected'); end if;
 select * into d from app.sync_devices where device_id=p_event->>'deviceId' for update;
 if not found or d.actor_id <> p_actor or d.revoked_at is not null then return jsonb_build_object('status','denied'); end if;
 normalized := p_event - 'receivedAt' - 'retryCount' - 'localState';
 event_hash := pg_catalog.sha256(pg_catalog.convert_to(normalized::text,'UTF8'));
 intent_hash := pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('restaurantId',r,'branchId',b,'entityType',entity,'entityId',p_event->>'entityId','operation',op,'schemaVersion',p_event->>'schemaVersion','baseVersion',p_event->'baseVersion','payload',p_event->'payload')::text,'UTF8'));
 select * into receipt from app.sync_event_receipts where restaurant_id=r and branch_id=b and event_id=p_event->>'eventId';
 if found then
  if receipt.event_fingerprint <> event_hash then return jsonb_build_object('status','rejected','code','EVENT_ID_REUSE'); end if;
  select * into strict prior from app.sync_event_ledger where restaurant_id=r and branch_id=b and event_id=receipt.ledger_event_id;
  return jsonb_build_object('status','duplicate','result',prior.result);
 end if;
 select * into prior from app.sync_event_ledger where restaurant_id=r and branch_id=b and idempotency_key=p_event->>'idempotencyKey';
 if found then
  if prior.intention_fingerprint <> intent_hash then return jsonb_build_object('status','rejected','code','IDEMPOTENCY_KEY_REUSE'); end if;
  if seq <= d.last_local_sequence then return jsonb_build_object('status','rejected','code','LOCAL_SEQUENCE_REUSE'); end if;
  insert into app.sync_event_receipts values(r,b,p_event->>'eventId',prior.event_id,event_hash,d.device_id,seq);
  update app.sync_devices set last_local_sequence=seq where device_id=d.device_id;
  return jsonb_build_object('status','duplicate','result',prior.result);
 end if;
 if seq <= d.last_local_sequence then return jsonb_build_object('status','rejected','code','LOCAL_SEQUENCE_REUSE'); end if;
 insert into app.sync_event_ledger(restaurant_id,branch_id,event_id,idempotency_key,device_id,actor_id,local_sequence,entity_type,entity_id,operation,schema_version,event_fingerprint,intention_fingerprint,result)
 values(r,b,p_event->>'eventId',p_event->>'idempotencyKey',d.device_id,p_actor,seq,entity,p_event->>'entityId',op,p_event->>'schemaVersion',event_hash,intent_hash,p_result);
 insert into app.sync_event_receipts values(r,b,p_event->>'eventId',p_event->>'eventId',event_hash,d.device_id,seq);
 update app.sync_devices set last_local_sequence=seq where device_id=d.device_id;
 return jsonb_build_object('status','recorded','result',p_result);
exception when unique_violation then
 -- A competing device may have committed the same scope/key while this transaction waited.
 return jsonb_build_object('status','rejected','code','CONCURRENT_RETRY');
end $f$;

create function app_private.sync_append_change(p_actor uuid,p_restaurant uuid,p_branch uuid,p_entity text,p_entity_id text,p_version bigint,p_tombstone boolean,p_snapshot jsonb)
returns bigint language plpgsql security definer set search_path = '' as $f$
declare next_sequence bigint;
begin
 if not app_private.sync_authorized(p_actor,p_restaurant,p_branch) then return null; end if;
 update app_private.sync_cursor_counter set value=value+1 where singleton returning value into next_sequence;
 insert into app.sync_changelog values(next_sequence,p_restaurant,p_branch,p_entity,p_entity_id,p_version,p_tombstone,p_snapshot,clock_timestamp());
 return next_sequence;
end $f$;

alter function app_private.sync_authorized(uuid,uuid,uuid) owner to postgres;
alter function app_private.sync_register_device(uuid,uuid,uuid,text) owner to postgres;
alter function app_private.sync_record_event(uuid,jsonb,jsonb) owner to postgres;
alter function app_private.sync_append_change(uuid,uuid,uuid,text,text,bigint,boolean,jsonb) owner to postgres;
revoke all on function app_private.sync_authorized(uuid,uuid,uuid), app_private.sync_register_device(uuid,uuid,uuid,text), app_private.sync_record_event(uuid,jsonb,jsonb), app_private.sync_append_change(uuid,uuid,uuid,text,text,bigint,boolean,jsonb) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.sync_register_device(uuid,uuid,uuid,text), app_private.sync_record_event(uuid,jsonb,jsonb), app_private.sync_append_change(uuid,uuid,uuid,text,text,bigint,boolean,jsonb) to app_api;
commit;
