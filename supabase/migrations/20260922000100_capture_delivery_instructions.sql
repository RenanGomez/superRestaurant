begin;

alter table app.capture_drafts
  add column delivery_instructions text,
  add constraint capture_drafts_delivery_instructions_valid check (
    delivery_instructions is null
    or (
      delivery_instructions = pg_catalog.btrim(delivery_instructions)
      and pg_catalog.char_length(delivery_instructions) between 1 and 500
      and delivery_instructions !~ '[[:cntrl:]]'
    )
  );

create function app_private.clear_capture_delivery_instructions_for_channel()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.fulfillment_channel is distinct from 'delivery' then
    new.delivery_instructions := null;
  end if;
  return new;
end
$function$;

create trigger capture_drafts_clear_delivery_instructions_for_channel
before insert or update of fulfillment_channel, delivery_instructions on app.capture_drafts
for each row execute function app_private.clear_capture_delivery_instructions_for_channel();

alter table app.capture_command_events drop constraint capture_events_operation_valid;
alter table app.capture_command_events add constraint capture_events_operation_valid check (operation in (
  'capture.created','capture.autosaved','capture.held','capture.claimed','capture.resumed','capture.transferred',
  'capture.confirmed','capture.no_sale','capture.recovery_preference_changed','capture.taken_over',
  'capture.customer_changed','capture.fulfillment_changed','capture.delivery_instructions_changed'
));

create function app_private.set_capture_delivery_instructions(p_actor_id uuid, p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  restaurant uuid; branch uuid; capture uuid; event uuid; device uuid; member uuid; lease uuid;
  expected bigint; occurred timestamptz; observed timestamptz; fingerprint text; result_record jsonb;
  current_capture app.capture_drafts%rowtype; stored app.capture_command_events%rowtype;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_command, array[
      'schemaVersion','scope','captureDraftId','expectedVersion','eventId','idempotencyKey','deviceId','occurredAt',
      'attentionLeaseId','deliveryInstructions'
    ])
    or not app_private.jsonb_has_exact_keys(p_command->'scope', array['restaurantId','branchId'])
    or p_command->'schemaVersion' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_command->'expectedVersion') is distinct from 'number'
    or not coalesce(p_command->>'expectedVersion' ~ '^[1-9][0-9]*$', false)
    or not coalesce(p_command->>'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
    or not (
      p_command->'deliveryInstructions' = 'null'::jsonb
      or (
        pg_catalog.jsonb_typeof(p_command->'deliveryInstructions') = 'string'
        and p_command->>'deliveryInstructions' = pg_catalog.btrim(p_command->>'deliveryInstructions')
        and pg_catalog.char_length(p_command->>'deliveryInstructions') between 1 and 500
        and p_command->>'deliveryInstructions' !~ '[[:cntrl:]]'
      )
    )
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  begin
    restaurant := (p_command#>>'{scope,restaurantId}')::uuid;
    branch := (p_command#>>'{scope,branchId}')::uuid;
    capture := (p_command->>'captureDraftId')::uuid;
    event := (p_command->>'eventId')::uuid;
    device := (p_command->>'deviceId')::uuid;
    lease := (p_command->>'attentionLeaseId')::uuid;
    expected := (p_command->>'expectedVersion')::bigint;
    occurred := (p_command->>'occurredAt')::timestamptz;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;

  if restaurant is null or branch is null or capture is null or event is null or device is null or lease is null
    or expected not between 1 and 9007199254740990 or occurred is null
    or p_command#>>'{scope,restaurantId}' is distinct from restaurant::text
    or p_command#>>'{scope,branchId}' is distinct from branch::text
    or p_command->>'occurredAt' is distinct from pg_catalog.to_char(occurred at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  select m.id into member
  from app.memberships m
  join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
  join app.restaurants r on r.id=m.restaurant_id
  join app.membership_role_grants g on g.membership_id=m.id
  where m.user_id=p_actor_id and m.restaurant_id=restaurant and m.branch_id=branch
    and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null and g.revoked_at is null
    and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
  order by g.role_code limit 1 for share of m,b,r,g;
  if member is null then return pg_catalog.jsonb_build_object('status','denied'); end if;

  fingerprint := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'capture.delivery_instructions_changed:'||p_command::text||':'||p_actor_id::text, 'UTF8'
  )), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'capture-command:'||p_actor_id::text||':'||restaurant::text||':'||branch::text||':'||(p_command->>'idempotencyKey'), 0
  ));
  select * into stored from app.capture_command_events
  where actor_id=p_actor_id and restaurant_id=restaurant and branch_id=branch
    and idempotency_key=p_command->>'idempotencyKey';
  if found then
    if stored.operation <> 'capture.delivery_instructions_changed' or stored.command_fingerprint <> fingerprint then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;
    return pg_catalog.jsonb_build_object(
      'status','replayed','record',stored.result_capture,'deliveryInstructions',p_command->'deliveryInstructions'
    );
  end if;

  select * into current_capture from app.capture_drafts
  where restaurant_id=restaurant and branch_id=branch and id=capture for update;
  observed := pg_catalog.greatest(pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp()),current_capture.updated_at);
  if not found or current_capture.version<>expected or current_capture.status<>'draft'
    or current_capture.attention_status<>'claimed' or current_capture.owner_membership_id is distinct from member
    or current_capture.attention_lease_id is distinct from lease or current_capture.attention_lease_expires_at<=observed
    or (p_command->'deliveryInstructions' <> 'null'::jsonb and current_capture.fulfillment_channel is distinct from 'delivery')
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  select result_capture into result_record from app.capture_command_events
  where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture and result_version=expected;
  if not found then
    raise exception using errcode='55000', message='CAPTURE_JOURNAL_CURRENT_VERSION_MISSING';
  end if;
  result_record := pg_catalog.jsonb_set(result_record,'{detail}',(result_record->'detail')||pg_catalog.jsonb_build_object(
    'version',expected+1,
    'updatedAt',pg_catalog.to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ));

  update app.capture_drafts
  set delivery_instructions=p_command->>'deliveryInstructions', version=expected+1,
    updated_at=observed, updated_by=p_actor_id
  where restaurant_id=restaurant and branch_id=branch and id=capture;
  insert into app.capture_command_events(
    event_id,restaurant_id,branch_id,capture_draft_id,actor_id,actor_membership_id,device_id,operation,
    idempotency_key,command_fingerprint,expected_version,result_version,result_capture,occurred_at,received_at
  ) values (
    event,restaurant,branch,capture,p_actor_id,member,device,'capture.delivery_instructions_changed',
    p_command->>'idempotencyKey',fingerprint,expected,expected+1,result_record,occurred,observed
  );
  return pg_catalog.jsonb_build_object(
    'status','applied','record',result_record,'deliveryInstructions',p_command->'deliveryInstructions'
  );
end
$function$;

alter function app_private.set_capture_delivery_instructions(uuid,jsonb) owner to postgres;
revoke all on function app_private.set_capture_delivery_instructions(uuid,jsonb)
  from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.set_capture_delivery_instructions(uuid,jsonb) to app_api;

create function app_private.read_capture_workspace_v2(p_actor_id uuid, p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v1 jsonb; restaurant uuid; branch uuid; capture uuid; instructions text;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_request,array['schemaVersion','scope','captureDraftId'])
    or not app_private.jsonb_has_exact_keys(p_request->'scope',array['restaurantId','branchId'])
    or p_request->'schemaVersion' is distinct from '2'::jsonb
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;
  begin
    restaurant := (p_request#>>'{scope,restaurantId}')::uuid;
    branch := (p_request#>>'{scope,branchId}')::uuid;
    capture := (p_request->>'captureDraftId')::uuid;
  exception when invalid_text_representation then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  v1 := app_private.read_capture_workspace(p_actor_id, pg_catalog.jsonb_build_object(
    'schemaVersion',1,
    'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',capture::text
  ));
  if app_private.jsonb_has_exact_keys(v1,array['status']) then return v1; end if;
  select draft.delivery_instructions into instructions from app.capture_drafts draft
  where draft.restaurant_id=restaurant and draft.branch_id=branch and draft.id=capture and draft.status='draft';
  if not found then return pg_catalog.jsonb_build_object('status','missing'); end if;
  return (v1 - 'schemaVersion' - 'detail') || pg_catalog.jsonb_build_object(
    'schemaVersion',2,
    'detail',(v1->'detail')||pg_catalog.jsonb_build_object('schemaVersion',2,'deliveryInstructions',instructions)
  );
end
$function$;

alter function app_private.read_capture_workspace_v2(uuid,jsonb) owner to postgres;
revoke all on function app_private.read_capture_workspace_v2(uuid,jsonb)
  from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.read_capture_workspace_v2(uuid,jsonb) to app_api;

revoke all on function app_private.clear_capture_delivery_instructions_for_channel()
  from public,anon,authenticated,service_role,app_api;
alter function app_private.clear_capture_delivery_instructions_for_channel() owner to postgres;

revoke all on app.capture_drafts from public,anon,authenticated,service_role,app_api;

comment on column app.capture_drafts.delivery_instructions is
  'Active per-capture delivery instructions. Address instructions remain legacy history and are never copied automatically.';

commit;
