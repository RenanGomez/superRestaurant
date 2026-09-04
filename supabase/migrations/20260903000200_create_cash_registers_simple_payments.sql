begin;

create table app.cash_register_sessions (
  id uuid primary key,
  restaurant_id uuid not null,
  branch_id uuid not null,
  register_id uuid not null,
  shift_id uuid not null,
  cashier_id uuid not null references auth.users (id) on delete restrict,
  currency text not null,
  status text not null,
  opening_float_minor bigint not null,
  expected_closing_balance_minor bigint,
  counted_closing_balance_minor bigint,
  difference_minor bigint,
  aggregate jsonb not null,
  version bigint not null,
  opened_at timestamptz not null,
  opened_by uuid not null references auth.users (id) on delete restrict,
  closed_at timestamptz,
  closed_by uuid references auth.users (id) on delete restrict,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint cash_register_sessions_branch_scope_fk foreign key (restaurant_id, branch_id)
    references app.branches (restaurant_id, id) on delete restrict,
  constraint cash_register_sessions_scope_id_unique unique (restaurant_id, branch_id, id),
  constraint cash_register_sessions_status_valid check (status in ('open','closed')),
  constraint cash_register_sessions_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint cash_register_sessions_money_valid check (
    opening_float_minor between 0 and 9007199254740991
    and (expected_closing_balance_minor is null or expected_closing_balance_minor between -9007199254740991 and 9007199254740991)
    and (counted_closing_balance_minor is null or counted_closing_balance_minor between 0 and 9007199254740991)
    and (difference_minor is null or difference_minor between -9007199254740991 and 9007199254740991)
  ),
  constraint cash_register_sessions_close_shape_valid check (
    (status = 'open' and expected_closing_balance_minor is null and counted_closing_balance_minor is null
      and difference_minor is null and closed_at is null and closed_by is null)
    or
    (status = 'closed' and expected_closing_balance_minor is not null and counted_closing_balance_minor is not null
      and difference_minor = counted_closing_balance_minor - expected_closing_balance_minor
      and closed_at is not null and closed_by is not null)
  ),
  constraint cash_register_sessions_version_positive check (version > 0),
  constraint cash_register_sessions_aggregate_valid check (
    pg_catalog.jsonb_typeof(aggregate) = 'object'
    and aggregate ->> 'schemaVersion' = '1'
    and aggregate ->> 'cashRegisterId' = id::text
    and aggregate ->> 'restaurantId' = restaurant_id::text
    and aggregate ->> 'branchId' = branch_id::text
    and aggregate ->> 'registerId' = register_id::text
    and aggregate ->> 'shiftId' = shift_id::text
    and aggregate ->> 'cashierId' = cashier_id::text
    and aggregate ->> 'currency' = currency
    and aggregate ->> 'status' = status
    and pg_catalog.jsonb_typeof(aggregate -> 'movements') = 'array'
  )
);

create unique index cash_register_one_open_session_idx
  on app.cash_register_sessions (restaurant_id, branch_id, register_id)
  where status = 'open';
create index cash_register_sessions_branch_idx
  on app.cash_register_sessions (restaurant_id, branch_id, status, updated_at, id);

create table app.payments (
  id uuid primary key,
  restaurant_id uuid not null,
  branch_id uuid not null,
  order_id uuid not null,
  cash_register_session_id uuid not null,
  method text not null,
  amount_minor bigint not null,
  currency text not null,
  state text not null,
  manual_provider text,
  manual_terminal_id text,
  manual_reference text,
  aggregate jsonb not null,
  captured_at timestamptz not null,
  captured_by uuid not null references auth.users (id) on delete restrict,
  constraint payments_order_scope_fk foreign key (restaurant_id, branch_id, order_id)
    references app.orders (restaurant_id, branch_id, id) on delete restrict,
  constraint payments_register_scope_fk foreign key (restaurant_id, branch_id, cash_register_session_id)
    references app.cash_register_sessions (restaurant_id, branch_id, id) on delete restrict,
  constraint payments_scope_id_unique unique (restaurant_id, branch_id, id),
  constraint payments_method_valid check (method in ('cash','card_manual')),
  constraint payments_money_valid check (amount_minor between 1 and 9007199254740991 and currency ~ '^[A-Z]{3}$'),
  constraint payments_state_valid check (state = 'captured'),
  constraint payments_card_manual_shape_valid check (
    (method = 'cash' and manual_provider is null and manual_terminal_id is null and manual_reference is null)
    or
    (method = 'card_manual' and manual_provider is not null and manual_terminal_id is not null)
  ),
  constraint payments_aggregate_valid check (
    pg_catalog.jsonb_typeof(aggregate) = 'object'
    and aggregate ->> 'schemaVersion' = '1'
    and aggregate ->> 'paymentId' = id::text
    and aggregate ->> 'restaurantId' = restaurant_id::text
    and aggregate ->> 'branchId' = branch_id::text
    and aggregate ->> 'orderId' = order_id::text
    and aggregate ->> 'method' = method
    and aggregate ->> 'state' = state
    and aggregate -> 'amount' ->> 'amountMinor' = amount_minor::text
    and aggregate -> 'amount' ->> 'currency' = currency
  )
);

create index payments_order_idx on app.payments
  (restaurant_id, branch_id, order_id, captured_at, id);

create table app.cash_movements (
  id uuid primary key,
  event_id uuid not null unique,
  idempotency_key text not null,
  restaurant_id uuid not null,
  branch_id uuid not null,
  cash_register_session_id uuid not null,
  register_id uuid not null,
  shift_id uuid not null,
  cashier_id uuid not null references auth.users (id) on delete restrict,
  actor_id uuid not null references auth.users (id) on delete restrict,
  device_id uuid not null,
  local_sequence bigint not null,
  movement_type text not null,
  direction text not null,
  amount_minor bigint not null,
  currency text not null,
  source_payment_id uuid,
  source_refund_id uuid,
  compensates_movement_id uuid,
  reason text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint cash_movements_register_scope_fk foreign key (restaurant_id, branch_id, cash_register_session_id)
    references app.cash_register_sessions (restaurant_id, branch_id, id) on delete restrict,
  constraint cash_movements_payment_scope_fk foreign key (restaurant_id, branch_id, source_payment_id)
    references app.payments (restaurant_id, branch_id, id) on delete restrict,
  constraint cash_movements_compensation_fk foreign key (compensates_movement_id)
    references app.cash_movements (id) on delete restrict,
  constraint cash_movements_idempotency_unique unique (actor_id, restaurant_id, branch_id, idempotency_key),
  constraint cash_movements_device_sequence_unique unique (restaurant_id, branch_id, device_id, local_sequence),
  constraint cash_movements_sequence_positive check (local_sequence > 0),
  constraint cash_movements_type_valid check (movement_type in ('cash_sale','cash_refund','cash_in','cash_out','cash_adjustment')),
  constraint cash_movements_direction_valid check (direction in ('in','out')),
  constraint cash_movements_money_valid check (amount_minor between 1 and 9007199254740991 and currency ~ '^[A-Z]{3}$'),
  constraint cash_movements_source_valid check (
    (movement_type = 'cash_sale' and direction = 'in' and source_payment_id is not null
      and source_refund_id is null and compensates_movement_id is null and reason is null)
    or
    (movement_type = 'cash_refund' and direction = 'out' and source_payment_id is not null
      and source_refund_id is not null and compensates_movement_id is null)
    or
    (movement_type in ('cash_in','cash_out') and source_payment_id is null and source_refund_id is null
      and compensates_movement_id is null and reason is not null)
    or
    (movement_type = 'cash_adjustment' and source_payment_id is null and source_refund_id is null
      and compensates_movement_id is not null and reason is not null)
  )
);

create index cash_movements_register_idx on app.cash_movements
  (restaurant_id, branch_id, cash_register_session_id, received_at, id);

create table app.financial_audit_events (
  event_id uuid primary key,
  idempotency_key text not null,
  restaurant_id uuid not null,
  branch_id uuid not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  device_id uuid not null,
  operation text not null,
  entity_id uuid not null,
  cash_register_session_id uuid not null,
  order_id uuid,
  payment_id uuid,
  expected_cash_register_version bigint not null,
  result_cash_register_version bigint not null,
  expected_order_version bigint,
  result_order_version bigint,
  command_payload jsonb not null,
  result_payload jsonb not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint financial_audit_register_scope_fk foreign key (restaurant_id, branch_id, cash_register_session_id)
    references app.cash_register_sessions (restaurant_id, branch_id, id) on delete restrict,
  constraint financial_audit_order_scope_fk foreign key (restaurant_id, branch_id, order_id)
    references app.orders (restaurant_id, branch_id, id) on delete restrict,
  constraint financial_audit_payment_scope_fk foreign key (restaurant_id, branch_id, payment_id)
    references app.payments (restaurant_id, branch_id, id) on delete restrict,
  constraint financial_audit_idempotency_unique unique (actor_id, restaurant_id, branch_id, idempotency_key),
  constraint financial_audit_idempotency_valid check (
    idempotency_key = pg_catalog.btrim(idempotency_key)
    and pg_catalog.char_length(idempotency_key) between 1 and 200
    and idempotency_key !~ '[[:cntrl:]]'
  ),
  constraint financial_audit_operation_valid check (operation in ('cash_register.opened','payment.captured','cash_register.closed')),
  constraint financial_audit_versions_valid check (
    expected_cash_register_version >= 0 and result_cash_register_version = expected_cash_register_version + 1
    and ((operation = 'payment.captured' and expected_order_version is not null
      and result_order_version = expected_order_version + 1 and order_id is not null and payment_id is not null)
      or (operation <> 'payment.captured' and expected_order_version is null
        and result_order_version is null and order_id is null and payment_id is null))
  ),
  constraint financial_audit_payloads_valid check (
    pg_catalog.jsonb_typeof(command_payload) = 'object' and pg_catalog.jsonb_typeof(result_payload) = 'object'
    and command_payload ->> 'schemaVersion' = '1'
    and command_payload -> 'scope' ->> 'restaurantId' = restaurant_id::text
    and command_payload -> 'scope' ->> 'branchId' = branch_id::text
    and command_payload ->> 'eventId' = event_id::text
    and command_payload ->> 'idempotencyKey' = idempotency_key
    and command_payload ->> 'deviceId' = device_id::text
    and command_payload ->> 'cashRegisterSessionId' = cash_register_session_id::text
  )
);

create index financial_audit_register_idx on app.financial_audit_events
  (restaurant_id, branch_id, cash_register_session_id, received_at, event_id);

create table app_private.financial_device_sequences (
  restaurant_id uuid not null,
  branch_id uuid not null,
  device_id uuid not null,
  last_sequence bigint not null default 0,
  primary key (restaurant_id, branch_id, device_id),
  constraint financial_device_sequences_branch_scope_fk foreign key (restaurant_id, branch_id)
    references app.branches (restaurant_id, id) on delete restrict,
  constraint financial_device_sequences_nonnegative check (last_sequence >= 0)
);

create function app_private.read_cash_register(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_cash_register_session_id uuid,
  p_order_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare result jsonb;
begin
  if not exists (
    select 1 from app.memberships m
    join app.membership_role_grants rg on rg.membership_id = m.id and rg.revoked_at is null
      and rg.role_code in ('owner','admin','manager','supervisor','cashier')
    join app.restaurants r on r.id = m.restaurant_id and r.disabled_at is null
    join app.branches b on b.id = m.branch_id and b.restaurant_id = m.restaurant_id and b.disabled_at is null
    where m.user_id = p_actor_id and m.restaurant_id = p_restaurant_id and m.branch_id = p_branch_id and m.revoked_at is null
  ) then return null; end if;

  select pg_catalog.jsonb_build_object(
    'schemaVersion',1,
    'scope',pg_catalog.jsonb_build_object('restaurantId',s.restaurant_id::text,'branchId',s.branch_id::text),
    'register',s.aggregate,
    'version',s.version,
    'capturedAmountMinor',case when p_order_id is null then 0 else coalesce((
      select pg_catalog.sum(p.amount_minor) from app.payments p
      where p.restaurant_id=s.restaurant_id and p.branch_id=s.branch_id and p.order_id=p_order_id and p.state='captured'
    ),0) end
  ) into result
  from app.cash_register_sessions s
  where s.restaurant_id=p_restaurant_id and s.branch_id=p_branch_id and s.id=p_cash_register_session_id;
  return result;
end $function$;

create function app_private.replay_financial_command(
  p_actor_id uuid,
  p_operation text,
  p_command jsonb
) returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_restaurant_id uuid; v_branch_id uuid; v_event_id uuid; v_idempotency_key text;
  v_existing app.financial_audit_events%rowtype;
begin
  if p_actor_id is null or p_operation not in ('cash_register.opened','payment.captured','cash_register.closed')
    or pg_catalog.jsonb_typeof(p_command)<>'object' or p_command->>'schemaVersion'<>'1'
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  begin
    v_restaurant_id := (p_command->'scope'->>'restaurantId')::uuid;
    v_branch_id := (p_command->'scope'->>'branchId')::uuid;
    v_event_id := (p_command->>'eventId')::uuid;
  exception when invalid_text_representation then
    return pg_catalog.jsonb_build_object('status','conflict');
  end;
  v_idempotency_key := p_command->>'idempotencyKey';
  if v_idempotency_key is null or v_idempotency_key<>pg_catalog.btrim(v_idempotency_key)
    or pg_catalog.char_length(v_idempotency_key) not between 1 and 200 or v_idempotency_key~'[[:cntrl:]]'
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  if not exists (
    select 1 from app.memberships m join app.membership_role_grants rg on rg.membership_id=m.id and rg.revoked_at is null
      and rg.role_code in ('owner','admin','manager','supervisor','cashier')
    join app.restaurants r on r.id=m.restaurant_id and r.disabled_at is null
    join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id and b.disabled_at is null
    where m.user_id=p_actor_id and m.restaurant_id=v_restaurant_id and m.branch_id=v_branch_id and m.revoked_at is null
  ) then return pg_catalog.jsonb_build_object('status','forbidden'); end if;

  select * into v_existing from app.financial_audit_events
    where actor_id=p_actor_id and restaurant_id=v_restaurant_id and branch_id=v_branch_id and idempotency_key=v_idempotency_key;
  if found then
    if v_existing.event_id<>v_event_id or v_existing.operation<>p_operation or v_existing.command_payload<>p_command
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    return pg_catalog.jsonb_set(v_existing.result_payload,'{replayed}','true'::jsonb,true);
  end if;
  if exists(select 1 from app.financial_audit_events where event_id=v_event_id)
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  return null;
end $function$;

create function app_private.open_cash_register(
  p_actor_id uuid,
  p_command jsonb,
  p_register jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_restaurant_id uuid; v_branch_id uuid; v_session_id uuid; v_register_id uuid; v_shift_id uuid;
  v_event_id uuid; v_device_id uuid; v_occurred_at timestamptz; v_idempotency_key text; v_currency text;
  v_opening bigint; v_existing app.financial_audit_events%rowtype; v_result jsonb;
begin
  if p_actor_id is null or pg_catalog.jsonb_typeof(p_command)<>'object' or pg_catalog.jsonb_typeof(p_register)<>'object'
    or p_command->>'schemaVersion'<>'1' or p_register->>'schemaVersion'<>'1'
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  begin
    v_restaurant_id := (p_command->'scope'->>'restaurantId')::uuid;
    v_branch_id := (p_command->'scope'->>'branchId')::uuid;
    v_session_id := (p_command->>'cashRegisterSessionId')::uuid;
    v_register_id := (p_command->>'registerId')::uuid;
    v_shift_id := (p_command->>'shiftId')::uuid;
    v_event_id := (p_command->>'eventId')::uuid;
    v_device_id := (p_command->>'deviceId')::uuid;
    v_occurred_at := (p_command->>'occurredAt')::timestamptz;
    v_opening := (p_command->>'openingFloatMinor')::bigint;
  exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    return pg_catalog.jsonb_build_object('status','conflict');
  end;
  v_idempotency_key := p_command->>'idempotencyKey'; v_currency := p_command->>'currency';
  if v_idempotency_key is null or v_idempotency_key<>pg_catalog.btrim(v_idempotency_key)
    or pg_catalog.char_length(v_idempotency_key) not between 1 and 200 or v_idempotency_key~'[[:cntrl:]]'
    or v_currency!~'^[A-Z]{3}$' or v_opening not between 0 and 9007199254740991
    or p_register->>'cashRegisterId'<>v_session_id::text or p_register->>'restaurantId'<>v_restaurant_id::text
    or p_register->>'branchId'<>v_branch_id::text or p_register->>'registerId'<>v_register_id::text
    or p_register->>'shiftId'<>v_shift_id::text or p_register->>'cashierId'<>p_actor_id::text
    or p_register->>'currency'<>v_currency or p_register->>'status'<>'open'
    or p_register->'openingFloat'->>'amountMinor'<>v_opening::text
    or p_register->'openingFloat'->>'currency'<>v_currency
    or p_register->>'openedByActorId'<>p_actor_id::text or p_register->>'openedDeviceId'<>v_device_id::text
    or p_register->>'openedAt'<>p_command->>'occurredAt'
    or p_register->'movements'<>'[]'::jsonb
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  if not exists (
    select 1 from app.memberships m join app.membership_role_grants rg on rg.membership_id=m.id and rg.revoked_at is null
      and rg.role_code in ('owner','admin','manager','supervisor','cashier')
    join app.restaurants r on r.id=m.restaurant_id and r.disabled_at is null
    join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id and b.disabled_at is null
    where m.user_id=p_actor_id and m.restaurant_id=v_restaurant_id and m.branch_id=v_branch_id and m.revoked_at is null
  ) then return pg_catalog.jsonb_build_object('status','forbidden'); end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'cash-register:'||v_restaurant_id::text||':'||v_branch_id::text||':'||v_register_id::text,0));
  select * into v_existing from app.financial_audit_events
    where actor_id=p_actor_id and restaurant_id=v_restaurant_id and branch_id=v_branch_id and idempotency_key=v_idempotency_key;
  if found then
    if v_existing.event_id<>v_event_id or v_existing.operation<>'cash_register.opened' or v_existing.command_payload<>p_command
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    return pg_catalog.jsonb_set(v_existing.result_payload,'{replayed}','true'::jsonb,true);
  end if;
  if exists(select 1 from app.financial_audit_events where event_id=v_event_id)
    or exists(select 1 from app.cash_register_sessions where id=v_session_id)
    or exists(select 1 from app.cash_register_sessions where restaurant_id=v_restaurant_id and branch_id=v_branch_id
      and register_id=v_register_id and status='open')
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  insert into app.cash_register_sessions(
    id,restaurant_id,branch_id,register_id,shift_id,cashier_id,currency,status,opening_float_minor,
    aggregate,version,opened_at,opened_by
  ) values(v_session_id,v_restaurant_id,v_branch_id,v_register_id,v_shift_id,p_actor_id,v_currency,'open',v_opening,
    p_register,1,v_occurred_at,p_actor_id);
  v_result := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',v_restaurant_id::text,'branchId',v_branch_id::text),
    'cashRegisterSessionId',v_session_id::text,'registerId',v_register_id::text,'shiftId',v_shift_id::text,
    'cashierId',p_actor_id::text,'currency',v_currency,'status','open','openingFloatMinor',v_opening,
    'expectedCashBalanceMinor',v_opening,'countedClosingBalanceMinor',null,'differenceMinor',null,
    'version',1,'openedAt',pg_catalog.to_char(v_occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'closedAt',null,'replayed',false);
  insert into app.financial_audit_events(
    event_id,idempotency_key,restaurant_id,branch_id,actor_id,device_id,operation,entity_id,cash_register_session_id,
    expected_cash_register_version,result_cash_register_version,command_payload,result_payload,occurred_at
  ) values(v_event_id,v_idempotency_key,v_restaurant_id,v_branch_id,p_actor_id,v_device_id,'cash_register.opened',v_session_id,v_session_id,
    0,1,p_command,v_result,v_occurred_at);
  return v_result;
end $function$;

create function app_private.collect_simple_payment(
  p_actor_id uuid,
  p_command jsonb,
  p_payment jsonb,
  p_order jsonb,
  p_register jsonb,
  p_order_total_minor bigint,
  p_prior_captured_amount_minor bigint
) returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_restaurant_id uuid; v_branch_id uuid; v_session_id uuid; v_order_id uuid; v_payment_id uuid;
  v_event_id uuid; v_device_id uuid; v_occurred_at timestamptz; v_idempotency_key text; v_method text; v_currency text;
  v_amount bigint; v_local_sequence bigint; v_expected_register_version bigint; v_expected_order_version bigint;
  v_remaining bigint; v_result_status text; v_existing app.financial_audit_events%rowtype;
  v_session app.cash_register_sessions%rowtype; v_order_row app.orders%rowtype; v_captured bigint; v_result jsonb;
  v_manual_provider text; v_manual_terminal_id text; v_manual_reference text; v_movement jsonb;
begin
  if p_actor_id is null or pg_catalog.jsonb_typeof(p_command)<>'object' or pg_catalog.jsonb_typeof(p_payment)<>'object'
    or pg_catalog.jsonb_typeof(p_order)<>'object' or pg_catalog.jsonb_typeof(p_register)<>'object'
    or p_command->>'schemaVersion'<>'1' or p_payment->>'schemaVersion'<>'1'
    or p_order->>'schemaVersion'<>'1' or p_register->>'schemaVersion'<>'1'
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  begin
    v_restaurant_id := (p_command->'scope'->>'restaurantId')::uuid;
    v_branch_id := (p_command->'scope'->>'branchId')::uuid;
    v_session_id := (p_command->>'cashRegisterSessionId')::uuid;
    v_order_id := (p_command->>'orderId')::uuid;
    v_payment_id := (p_command->>'paymentId')::uuid;
    v_event_id := (p_command->>'eventId')::uuid;
    v_device_id := (p_command->>'deviceId')::uuid;
    v_occurred_at := (p_command->>'occurredAt')::timestamptz;
    v_amount := (p_command->>'amountMinor')::bigint;
    v_local_sequence := (p_command->>'localSequence')::bigint;
    v_expected_register_version := (p_command->>'cashRegisterExpectedVersion')::bigint;
    v_expected_order_version := (p_command->>'orderExpectedVersion')::bigint;
  exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    return pg_catalog.jsonb_build_object('status','conflict');
  end;
  v_idempotency_key:=p_command->>'idempotencyKey'; v_method:=p_command->>'method';
  if v_idempotency_key is null or v_idempotency_key<>pg_catalog.btrim(v_idempotency_key)
    or pg_catalog.char_length(v_idempotency_key) not between 1 and 200 or v_idempotency_key~'[[:cntrl:]]'
    or v_method not in ('cash','card_manual') or v_amount not between 1 and 9007199254740991
    or v_local_sequence<1 or v_expected_register_version<1 or v_expected_order_version<1
    or p_order_total_minor not between 1 and 9007199254740991
    or p_prior_captured_amount_minor not between 0 and 9007199254740991
    or p_payment->>'paymentId'<>v_payment_id::text or p_payment->>'eventId'<>v_event_id::text
    or p_payment->>'restaurantId'<>v_restaurant_id::text or p_payment->>'branchId'<>v_branch_id::text
    or p_payment->>'orderId'<>v_order_id::text or p_payment->>'idempotencyKey'<>v_idempotency_key
    or p_payment->>'method'<>v_method or p_payment->>'state'<>'captured'
    or p_payment->'amount'->>'amountMinor'<>v_amount::text
    or p_order->>'orderId'<>v_order_id::text or p_order->>'restaurantId'<>v_restaurant_id::text
    or p_order->>'branchId'<>v_branch_id::text
    or p_register->>'cashRegisterId'<>v_session_id::text or p_register->>'restaurantId'<>v_restaurant_id::text
    or p_register->>'branchId'<>v_branch_id::text
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  if v_method='cash' then
    if p_command->'cardManualEvidence' is distinct from 'null'::jsonb or p_payment?'cardManualEvidence'
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  else
    if pg_catalog.jsonb_typeof(p_command->'cardManualEvidence')<>'object'
      or p_command->'cardManualEvidence'->>'externalConfirmed'<>'true'
      or p_command->'cardManualEvidence' ?| array['pan','cvv','cardNumber','card_number','securityCode']
      or pg_catalog.jsonb_typeof(p_payment->'cardManualEvidence')<>'object'
      or p_payment->'cardManualEvidence'->>'externalConfirmed'<>'true'
      or p_payment->'cardManualEvidence'->>'provider'<>p_command->'cardManualEvidence'->>'provider'
      or p_payment->'cardManualEvidence'->>'terminalId'<>p_command->'cardManualEvidence'->>'terminalId'
      or (p_payment->'cardManualEvidence'->>'reference') is distinct from (p_command->'cardManualEvidence'->>'reference')
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    v_manual_provider:=p_command->'cardManualEvidence'->>'provider';
    v_manual_terminal_id:=p_command->'cardManualEvidence'->>'terminalId';
    v_manual_reference:=p_command->'cardManualEvidence'->>'reference';
    if v_manual_provider is null or v_manual_provider<>pg_catalog.btrim(v_manual_provider)
      or pg_catalog.char_length(v_manual_provider) not between 1 and 120 or v_manual_provider~'[[:cntrl:]]'
      or v_manual_terminal_id is null or v_manual_terminal_id<>pg_catalog.btrim(v_manual_terminal_id)
      or pg_catalog.char_length(v_manual_terminal_id) not between 1 and 100 or v_manual_terminal_id~'[[:cntrl:]]'
      or (v_manual_reference is not null and (v_manual_reference<>pg_catalog.btrim(v_manual_reference)
        or pg_catalog.char_length(v_manual_reference) not between 1 and 200 or v_manual_reference~'[[:cntrl:]]'))
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  end if;
  if not exists (
    select 1 from app.memberships m join app.membership_role_grants rg on rg.membership_id=m.id and rg.revoked_at is null
      and rg.role_code in ('owner','admin','manager','supervisor','cashier')
    join app.restaurants r on r.id=m.restaurant_id and r.disabled_at is null
    join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id and b.disabled_at is null
    where m.user_id=p_actor_id and m.restaurant_id=v_restaurant_id and m.branch_id=v_branch_id and m.revoked_at is null
  ) then return pg_catalog.jsonb_build_object('status','forbidden'); end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('order:'||v_order_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cash-register-session:'||v_session_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'financial-device:'||v_restaurant_id::text||':'||v_branch_id::text||':'||v_device_id::text,0));
  select * into v_existing from app.financial_audit_events
    where actor_id=p_actor_id and restaurant_id=v_restaurant_id and branch_id=v_branch_id and idempotency_key=v_idempotency_key;
  if found then
    if v_existing.event_id<>v_event_id or v_existing.operation<>'payment.captured' or v_existing.command_payload<>p_command
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    return pg_catalog.jsonb_set(v_existing.result_payload,'{replayed}','true'::jsonb,true);
  end if;
  if exists(select 1 from app.financial_audit_events where event_id=v_event_id)
    or exists(select 1 from app.payments where id=v_payment_id)
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  select * into v_order_row from app.orders where restaurant_id=v_restaurant_id and branch_id=v_branch_id and id=v_order_id for update;
  select * into v_session from app.cash_register_sessions
    where restaurant_id=v_restaurant_id and branch_id=v_branch_id and id=v_session_id for update;
  if v_order_row.id is null or v_session.id is null or v_order_row.version<>v_expected_order_version
    or v_session.version<>v_expected_register_version or v_session.status<>'open'
    or v_order_row.status not in ('open','partially_paid') or v_session.currency<>v_order_row.aggregate->>'currency'
    or p_payment->'amount'->>'currency'<>v_session.currency
    or p_order->>'currency'<>v_session.currency or p_register->>'currency'<>v_session.currency
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  select coalesce(pg_catalog.sum(p.amount_minor),0) into v_captured from app.payments p
    where p.restaurant_id=v_restaurant_id and p.branch_id=v_branch_id and p.order_id=v_order_id and p.state='captured';
  if v_captured<>p_prior_captured_amount_minor or v_captured>=p_order_total_minor
    or v_amount>p_order_total_minor-v_captured
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  v_remaining:=p_order_total_minor-v_captured-v_amount;
  v_result_status:=case when v_remaining=0 then 'paid' else 'partially_paid' end;
  if p_order->>'status'<>v_result_status or (p_order-'status')<>(v_order_row.aggregate-'status')
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  insert into app_private.financial_device_sequences(restaurant_id,branch_id,device_id,last_sequence)
    values(v_restaurant_id,v_branch_id,v_device_id,0) on conflict do nothing;
  if not exists(select 1 from app_private.financial_device_sequences d where d.restaurant_id=v_restaurant_id
    and d.branch_id=v_branch_id and d.device_id=v_device_id and d.last_sequence+1=v_local_sequence for update)
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  if v_method='cash' then
    if pg_catalog.jsonb_array_length(p_register->'movements')<>pg_catalog.jsonb_array_length(v_session.aggregate->'movements')+1
      or not ((p_register->'movements') @> (v_session.aggregate->'movements'))
      or (p_register-'movements')<>(v_session.aggregate-'movements')
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    select value into v_movement from pg_catalog.jsonb_array_elements(p_register->'movements') value
      where value->>'movementId'=v_payment_id::text;
    if v_movement is null or v_movement->>'eventId'<>v_event_id::text or v_movement->>'idempotencyKey'<>v_idempotency_key
      or v_movement->>'restaurantId'<>v_restaurant_id::text or v_movement->>'branchId'<>v_branch_id::text
      or v_movement->>'cashRegisterId'<>v_session_id::text or v_movement->>'registerId'<>v_session.register_id::text
      or v_movement->>'shiftId'<>v_session.shift_id::text or v_movement->>'cashierId'<>v_session.cashier_id::text
      or v_movement->>'actorId'<>p_actor_id::text or v_movement->>'deviceId'<>v_device_id::text
      or v_movement->>'localSequence'<>v_local_sequence::text or v_movement->>'type'<>'cash_sale'
      or v_movement->>'direction'<>'in' or v_movement->'amount'->>'amountMinor'<>v_amount::text
      or v_movement->'amount'->>'currency'<>v_session.currency or v_movement->'source'->>'type'<>'payment'
      or v_movement->'source'->>'paymentId'<>v_payment_id::text
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  elsif p_register<>v_session.aggregate then
    return pg_catalog.jsonb_build_object('status','conflict');
  end if;

  insert into app.payments(id,restaurant_id,branch_id,order_id,cash_register_session_id,method,amount_minor,currency,state,
    manual_provider,manual_terminal_id,manual_reference,aggregate,captured_at,captured_by)
  values(v_payment_id,v_restaurant_id,v_branch_id,v_order_id,v_session_id,v_method,v_amount,v_session.currency,'captured',
    v_manual_provider,v_manual_terminal_id,v_manual_reference,p_payment,v_occurred_at,p_actor_id);
  if v_method='cash' then
    insert into app.cash_movements(id,event_id,idempotency_key,restaurant_id,branch_id,cash_register_session_id,
      register_id,shift_id,cashier_id,actor_id,device_id,local_sequence,movement_type,direction,amount_minor,currency,
      source_payment_id,occurred_at)
    values(v_payment_id,v_event_id,v_idempotency_key,v_restaurant_id,v_branch_id,v_session_id,
      v_session.register_id,v_session.shift_id,v_session.cashier_id,p_actor_id,v_device_id,v_local_sequence,
      'cash_sale','in',v_amount,v_session.currency,v_payment_id,v_occurred_at);
  end if;
  update app_private.financial_device_sequences set last_sequence=v_local_sequence
    where restaurant_id=v_restaurant_id and branch_id=v_branch_id and device_id=v_device_id;
  update app.cash_register_sessions set aggregate=p_register,version=version+1,updated_at=pg_catalog.clock_timestamp()
    where restaurant_id=v_restaurant_id and branch_id=v_branch_id and id=v_session_id and version=v_expected_register_version
    returning * into strict v_session;
  update app.orders set status=v_result_status,aggregate=p_order,version=version+1,
    updated_at=pg_catalog.clock_timestamp(),updated_by=p_actor_id
    where restaurant_id=v_restaurant_id and branch_id=v_branch_id and id=v_order_id and version=v_expected_order_version
    returning * into strict v_order_row;
  v_result:=pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',v_restaurant_id::text,'branchId',v_branch_id::text),
    'cashRegisterSessionId',v_session_id::text,'cashRegisterVersion',v_session.version,
    'paymentId',v_payment_id::text,'orderId',v_order_id::text,'method',v_method,'amountMinor',v_amount,
    'currency',v_session.currency,'paymentState','captured','orderStatus',v_result_status,
    'orderVersion',v_order_row.version,'remainingBalanceMinor',v_remaining,'replayed',false);
  insert into app.financial_audit_events(
    event_id,idempotency_key,restaurant_id,branch_id,actor_id,device_id,operation,entity_id,cash_register_session_id,
    order_id,payment_id,expected_cash_register_version,result_cash_register_version,expected_order_version,
    result_order_version,command_payload,result_payload,occurred_at
  ) values(v_event_id,v_idempotency_key,v_restaurant_id,v_branch_id,p_actor_id,v_device_id,'payment.captured',v_payment_id,v_session_id,
    v_order_id,v_payment_id,v_expected_register_version,v_session.version,v_expected_order_version,
    v_order_row.version,p_command,v_result,v_occurred_at);
  return v_result;
end $function$;

create function app_private.close_cash_register(
  p_actor_id uuid,
  p_command jsonb,
  p_register jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_restaurant_id uuid; v_branch_id uuid; v_session_id uuid; v_event_id uuid; v_device_id uuid;
  v_occurred_at timestamptz; v_idempotency_key text; v_expected_version bigint; v_counted bigint; v_expected bigint;
  v_difference bigint; v_reason text; v_existing app.financial_audit_events%rowtype;
  v_session app.cash_register_sessions%rowtype; v_result jsonb;
begin
  if p_actor_id is null or pg_catalog.jsonb_typeof(p_command)<>'object' or pg_catalog.jsonb_typeof(p_register)<>'object'
    or p_command->>'schemaVersion'<>'1' or p_register->>'schemaVersion'<>'1'
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  begin
    v_restaurant_id:=(p_command->'scope'->>'restaurantId')::uuid;
    v_branch_id:=(p_command->'scope'->>'branchId')::uuid;
    v_session_id:=(p_command->>'cashRegisterSessionId')::uuid;
    v_event_id:=(p_command->>'eventId')::uuid;
    v_device_id:=(p_command->>'deviceId')::uuid;
    v_occurred_at:=(p_command->>'occurredAt')::timestamptz;
    v_expected_version:=(p_command->>'cashRegisterExpectedVersion')::bigint;
    v_counted:=(p_command->>'countedClosingBalanceMinor')::bigint;
  exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    return pg_catalog.jsonb_build_object('status','conflict');
  end;
  v_idempotency_key:=p_command->>'idempotencyKey'; v_reason:=p_command->>'reason';
  if v_idempotency_key is null or v_idempotency_key<>pg_catalog.btrim(v_idempotency_key)
    or pg_catalog.char_length(v_idempotency_key) not between 1 and 200 or v_idempotency_key~'[[:cntrl:]]'
    or v_expected_version<1 or v_counted not between 0 and 9007199254740991
    or (v_reason is not null and (v_reason<>pg_catalog.btrim(v_reason) or pg_catalog.char_length(v_reason) not between 1 and 500 or v_reason~'[[:cntrl:]]'))
    or p_register->>'cashRegisterId'<>v_session_id::text or p_register->>'restaurantId'<>v_restaurant_id::text
    or p_register->>'branchId'<>v_branch_id::text or p_register->>'status'<>'closed'
    or p_register->>'closedByActorId'<>p_actor_id::text or p_register->>'closedDeviceId'<>v_device_id::text
    or p_register->>'closedAt'<>p_command->>'occurredAt' or p_register->>'closeEventId'<>v_event_id::text
    or p_register->>'closeIdempotencyKey'<>v_idempotency_key
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  if not exists (
    select 1 from app.memberships m join app.membership_role_grants rg on rg.membership_id=m.id and rg.revoked_at is null
      and rg.role_code in ('owner','admin','manager','supervisor','cashier')
    join app.restaurants r on r.id=m.restaurant_id and r.disabled_at is null
    join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id and b.disabled_at is null
    where m.user_id=p_actor_id and m.restaurant_id=v_restaurant_id and m.branch_id=v_branch_id and m.revoked_at is null
  ) then return pg_catalog.jsonb_build_object('status','forbidden'); end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cash-register-session:'||v_session_id::text,0));
  select * into v_existing from app.financial_audit_events
    where actor_id=p_actor_id and restaurant_id=v_restaurant_id and branch_id=v_branch_id and idempotency_key=v_idempotency_key;
  if found then
    if v_existing.event_id<>v_event_id or v_existing.operation<>'cash_register.closed' or v_existing.command_payload<>p_command
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    return pg_catalog.jsonb_set(v_existing.result_payload,'{replayed}','true'::jsonb,true);
  end if;
  if exists(select 1 from app.financial_audit_events where event_id=v_event_id)
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  select * into v_session from app.cash_register_sessions
    where restaurant_id=v_restaurant_id and branch_id=v_branch_id and id=v_session_id for update;
  if v_session.id is null or v_session.version<>v_expected_version or v_session.status<>'open'
    or (p_register-'status'-'closedByActorId'-'closedAt'-'closedDeviceId'-'expectedClosingBalance'-'countedClosingBalance'-'difference'-'closeEventId'-'closeIdempotencyKey'-'closeReason')
      <> (v_session.aggregate-'status')
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  select v_session.opening_float_minor + coalesce(pg_catalog.sum(
    case when m.direction='in' then m.amount_minor else -m.amount_minor end),0)
    into v_expected from app.cash_movements m
    where m.restaurant_id=v_restaurant_id and m.branch_id=v_branch_id and m.cash_register_session_id=v_session_id;
  v_difference:=v_counted-v_expected;
  if p_register->'expectedClosingBalance'->>'amountMinor'<>v_expected::text
    or p_register->'expectedClosingBalance'->>'currency'<>v_session.currency
    or p_register->'countedClosingBalance'->>'amountMinor'<>v_counted::text
    or p_register->'countedClosingBalance'->>'currency'<>v_session.currency
    or p_register->'difference'->>'amountMinor'<>v_difference::text
    or p_register->'difference'->>'currency'<>v_session.currency
    or (v_difference<>0 and v_reason is null)
    or (p_register->>'closeReason') is distinct from v_reason
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  update app.cash_register_sessions set status='closed',aggregate=p_register,version=version+1,
    expected_closing_balance_minor=v_expected,counted_closing_balance_minor=v_counted,difference_minor=v_difference,
    closed_at=v_occurred_at,closed_by=p_actor_id,updated_at=pg_catalog.clock_timestamp()
    where restaurant_id=v_restaurant_id and branch_id=v_branch_id and id=v_session_id and version=v_expected_version
    returning * into strict v_session;
  v_result:=pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',v_restaurant_id::text,'branchId',v_branch_id::text),
    'cashRegisterSessionId',v_session_id::text,'registerId',v_session.register_id::text,'shiftId',v_session.shift_id::text,
    'cashierId',v_session.cashier_id::text,'currency',v_session.currency,'status','closed',
    'openingFloatMinor',v_session.opening_float_minor,'expectedCashBalanceMinor',v_expected,
    'countedClosingBalanceMinor',v_counted,'differenceMinor',v_difference,'version',v_session.version,
    'openedAt',pg_catalog.to_char(v_session.opened_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'closedAt',pg_catalog.to_char(v_occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'replayed',false);
  insert into app.financial_audit_events(
    event_id,idempotency_key,restaurant_id,branch_id,actor_id,device_id,operation,entity_id,cash_register_session_id,
    expected_cash_register_version,result_cash_register_version,command_payload,result_payload,occurred_at
  ) values(v_event_id,v_idempotency_key,v_restaurant_id,v_branch_id,p_actor_id,v_device_id,'cash_register.closed',v_session_id,v_session_id,
    v_expected_version,v_session.version,p_command,v_result,v_occurred_at);
  return v_result;
end $function$;

do $security$
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname='postgres' and rolbypassrls) then
    raise exception 'SECURITY_DEFINER_OWNER_REJECTED';
  end if;
end $security$;

alter function app_private.read_cash_register(uuid,uuid,uuid,uuid,uuid) owner to postgres;
alter function app_private.replay_financial_command(uuid,text,jsonb) owner to postgres;
alter function app_private.open_cash_register(uuid,jsonb,jsonb) owner to postgres;
alter function app_private.collect_simple_payment(uuid,jsonb,jsonb,jsonb,jsonb,bigint,bigint) owner to postgres;
alter function app_private.close_cash_register(uuid,jsonb,jsonb) owner to postgres;

revoke all on app.cash_register_sessions,app.payments,app.cash_movements,app.financial_audit_events
  from public,anon,authenticated,service_role,app_api;
revoke all on app_private.financial_device_sequences from public,anon,authenticated,service_role,app_api;
revoke all on function app_private.read_cash_register(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role,app_api;
revoke all on function app_private.replay_financial_command(uuid,text,jsonb) from public,anon,authenticated,service_role,app_api;
revoke all on function app_private.open_cash_register(uuid,jsonb,jsonb) from public,anon,authenticated,service_role,app_api;
revoke all on function app_private.collect_simple_payment(uuid,jsonb,jsonb,jsonb,jsonb,bigint,bigint) from public,anon,authenticated,service_role,app_api;
revoke all on function app_private.close_cash_register(uuid,jsonb,jsonb) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.read_cash_register(uuid,uuid,uuid,uuid,uuid) to app_api;
grant execute on function app_private.replay_financial_command(uuid,text,jsonb) to app_api;
grant execute on function app_private.open_cash_register(uuid,jsonb,jsonb) to app_api;
grant execute on function app_private.collect_simple_payment(uuid,jsonb,jsonb,jsonb,jsonb,bigint,bigint) to app_api;
grant execute on function app_private.close_cash_register(uuid,jsonb,jsonb) to app_api;

alter table app.cash_register_sessions enable row level security;
alter table app.cash_register_sessions force row level security;
alter table app.payments enable row level security;
alter table app.payments force row level security;
alter table app.cash_movements enable row level security;
alter table app.cash_movements force row level security;
alter table app.financial_audit_events enable row level security;
alter table app.financial_audit_events force row level security;
alter table app_private.financial_device_sequences enable row level security;
alter table app_private.financial_device_sequences force row level security;

comment on table app.cash_register_sessions is 'Authoritative restaurant/branch-scoped cash register sessions; mutations only through private atomic functions.';
comment on table app.payments is 'Immutable captured cash and externally confirmed manual-card payments; no PAN or CVV is stored.';
comment on table app.cash_movements is 'Immutable cash ledger; corrections are new compensating movements and existing rows are never updated.';
comment on table app.financial_audit_events is 'Immutable idempotent financial command evidence with authoritative received time and historical result.';
comment on table app_private.financial_device_sequences is 'Private authoritative monotonic sequence per restaurant, branch and device for financial attempts.';

commit;
