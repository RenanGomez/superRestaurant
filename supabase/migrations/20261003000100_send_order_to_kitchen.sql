begin;

-- S9.1 web-order-actions r12: atomic send-to-kitchen with command-level idempotency. Replaces the
-- API's prior client-side loop of N `persist_order_mutation` calls (one `open` + one per listed
-- line) with a single SQL transaction: either every step is persisted or none is, and a
-- byte-identical retry (same actor/scope/idempotencyKey *and* same command payload) replays the
-- exact stored result instead of re-deriving per-step keys and hoping each step's own idempotency
-- lookup lines up. Each step still goes through `app_private.persist_order_mutation` itself, so
-- per-step auditing (`app.order_audit_events`, `app.kds_events`) is unchanged; this only adds the
-- command-level wrapper and its own identity record.
create table app.order_command_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid not null,
  order_id uuid not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  device_id uuid not null,
  command_kind text not null,
  event_id uuid not null,
  idempotency_key text not null,
  command_payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint order_command_events_order_scope_fk foreign key (restaurant_id, branch_id, order_id)
    references app.orders (restaurant_id, branch_id, id) on delete restrict,
  constraint order_command_events_idempotency_unique unique (actor_id, restaurant_id, branch_id, idempotency_key),
  constraint order_command_events_event_unique unique (event_id),
  constraint order_command_events_idempotency_valid check (
    idempotency_key = pg_catalog.btrim(idempotency_key)
    and pg_catalog.char_length(idempotency_key) between 1 and 200
    and idempotency_key !~ '[[:cntrl:]]'
  ),
  constraint order_command_events_kind_valid check (command_kind in ('send_to_kitchen')),
  constraint order_command_events_payload_valid check (
    pg_catalog.jsonb_typeof(command_payload) = 'object'
    and command_payload ->> 'schemaVersion' = '1'
    and command_payload ->> 'orderId' = order_id::text
    and command_payload #>> '{scope,restaurantId}' = restaurant_id::text
    and command_payload #>> '{scope,branchId}' = branch_id::text
    and command_payload ->> 'eventId' = event_id::text
    and command_payload ->> 'idempotencyKey' = idempotency_key
    and command_payload ->> 'deviceId' = device_id::text
  ),
  constraint order_command_events_result_valid check (
    pg_catalog.jsonb_typeof(result) = 'object'
    and result ->> 'status' = 'saved'
  )
);

alter table app.order_command_events enable row level security;
alter table app.order_command_events force row level security;

create index order_command_events_order_idx on app.order_command_events
  (restaurant_id, branch_id, order_id, created_at, id);

create function app_private.send_order_to_kitchen(
  p_actor_id uuid,
  p_expected_version bigint,
  p_command jsonb,
  p_steps jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_restaurant_id uuid;
  v_branch_id uuid;
  v_order_id uuid;
  v_event_id uuid;
  v_device_id uuid;
  v_idempotency_key text;
  v_order_item_ids jsonb;
  v_existing app.order_command_events%rowtype;
  v_step jsonb;
  v_step_result jsonb;
  v_version bigint;
  v_order jsonb;
  v_kds_events jsonb := '[]'::jsonb;
  v_result jsonb;
  v_step_count integer;
begin
  if p_actor_id is null or p_expected_version is null or p_expected_version < 0
    or pg_catalog.jsonb_typeof(p_command) <> 'object'
    or pg_catalog.jsonb_typeof(p_steps) <> 'array'
    or not app_private.jsonb_has_exact_keys(p_command, array[
      'schemaVersion','scope','orderId','orderItemIds','expectedVersion',
      'eventId','idempotencyKey','deviceId','occurredAt'
    ])
    or not app_private.jsonb_has_exact_keys(p_command -> 'scope', array['restaurantId','branchId'])
    or p_command -> 'schemaVersion' is distinct from '1'::jsonb
    or p_command -> 'expectedVersion' is distinct from pg_catalog.to_jsonb(p_expected_version)
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  v_order_item_ids := p_command -> 'orderItemIds';
  if pg_catalog.jsonb_typeof(v_order_item_ids) <> 'array' or pg_catalog.jsonb_array_length(v_order_item_ids) < 1 then
    return pg_catalog.jsonb_build_object('status','conflict');
  end if;

  begin
    v_restaurant_id := (p_command #>> '{scope,restaurantId}')::uuid;
    v_branch_id := (p_command #>> '{scope,branchId}')::uuid;
    v_order_id := (p_command ->> 'orderId')::uuid;
    v_event_id := (p_command ->> 'eventId')::uuid;
    v_device_id := (p_command ->> 'deviceId')::uuid;
    perform (p_command ->> 'occurredAt')::timestamptz;
  exception when invalid_text_representation or datetime_field_overflow then
    return pg_catalog.jsonb_build_object('status','conflict');
  end;
  v_idempotency_key := p_command ->> 'idempotencyKey';
  if v_idempotency_key is null or v_idempotency_key <> pg_catalog.btrim(v_idempotency_key)
    or pg_catalog.char_length(v_idempotency_key) not between 1 and 200 or v_idempotency_key ~ '[[:cntrl:]]'
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('order:' || v_order_id::text, 0));

  select * into v_existing from app.order_command_events
  where actor_id = p_actor_id and restaurant_id = v_restaurant_id and branch_id = v_branch_id
    and idempotency_key = v_idempotency_key;
  if found then
    if v_existing.command_payload <> p_command then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;
    return pg_catalog.jsonb_set(v_existing.result, '{status}', '"replayed"'::jsonb);
  end if;

  if not exists (
    select 1 from app.orders
    where restaurant_id = v_restaurant_id and branch_id = v_branch_id and id = v_order_id
      and version = p_expected_version
  ) then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  v_step_count := pg_catalog.jsonb_array_length(p_steps);
  if v_step_count < 1 then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  v_version := p_expected_version;
  begin
    for v_step in
      select value from pg_catalog.jsonb_array_elements(p_steps) with ordinality as elements(value, ordinality)
      order by ordinality
    loop
      v_step_result := app_private.persist_order_mutation(p_actor_id, v_version, v_step -> 'order', v_step -> 'audit');
      if v_step_result ->> 'status' <> 'saved' then
        raise exception 'SEND_TO_KITCHEN_STEP_FAILED' using errcode = 'P0001';
      end if;
      v_version := (v_step_result ->> 'version')::bigint;
      v_order := v_step_result -> 'order';
      v_kds_events := v_kds_events || pg_catalog.jsonb_build_array(v_step_result -> 'kdsEvent');
    end loop;
  exception when others then
    return pg_catalog.jsonb_build_object('status','conflict');
  end;

  v_result := pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('restaurantId', v_restaurant_id::text, 'branchId', v_branch_id::text),
    'status', 'saved',
    'order', v_order,
    'version', v_version,
    'kdsEvents', v_kds_events
  );

  insert into app.order_command_events(
    restaurant_id, branch_id, order_id, actor_id, device_id, command_kind,
    event_id, idempotency_key, command_payload, result
  ) values (
    v_restaurant_id, v_branch_id, v_order_id, p_actor_id, v_device_id, 'send_to_kitchen',
    v_event_id, v_idempotency_key, p_command, v_result
  );

  return v_result;
end $function$;

do $security$
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname='postgres' and rolbypassrls) then
    raise exception 'SECURITY_DEFINER_OWNER_REJECTED';
  end if;
end $security$;

alter function app_private.send_order_to_kitchen(uuid,bigint,jsonb,jsonb) owner to postgres;

revoke all on app.order_command_events from public,anon,authenticated,service_role,app_api;
revoke all on function app_private.send_order_to_kitchen(uuid,bigint,jsonb,jsonb) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.send_order_to_kitchen(uuid,bigint,jsonb,jsonb) to app_api;
comment on function app_private.send_order_to_kitchen(uuid,bigint,jsonb,jsonb) is
  'Server-only, atomic send-to-kitchen (S9.1 r12): persists an order''s draft-open-plus-line-sent batch as one all-or-nothing transaction with command-level idempotency keyed by (actor, restaurant, branch, idempotencyKey); a byte-identical retry replays the stored result, any other difference (payload, version, missing order) is a conflict, and any mid-batch step failure rolls back every step in the batch.';

commit;
