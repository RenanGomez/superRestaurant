begin;

-- payments-transfer-method: a bill can be collected by bank transfer, the third simple method.
--
-- Rule: a transfer is a captured payment of exactly the bill amount with an optional bank reference (1..64
-- characters); it has no terminal evidence, no tender and no change, never moves cash (no `cash_sale`, and a tip
-- on it is recorded on the payment only, like a card tip, so it never reaches the expected cash balance) and the
-- operational report lists it apart as `transferCapturedMinor`.
--
-- Additive and idempotent in meaning:
--   * the two method-shaped CHECKs of app.payments admit `transfer` (tender/tip CHECKs already forbid a tender
--     for any non-cash method);
--   * `collect_simple_payment_core` (the authority behind the delivery guard `collect_simple_payment`, whose
--     body is NOT touched) accepts `transfer`; the optional reference travels in the command as
--     `transferReference` and is stored in `manual_reference`; the Payment aggregate carries no evidence;
--   * the report gains `transferCapturedMinor`; `totalCapturedMinor` stays the sum of every captured amount.
-- Owner and grants are preserved by CREATE OR REPLACE (EXECUTE stays app_api only).

-- 1. Payments: allow `transfer` with its own shape.
alter table app.payments drop constraint payments_method_valid;
alter table app.payments drop constraint payments_card_manual_shape_valid;
alter table app.payments
  add constraint payments_method_valid check (method in ('cash','card_manual','transfer')),
  add constraint payments_card_manual_shape_valid check (
    (method = 'cash' and manual_provider is null and manual_terminal_id is null and manual_reference is null)
    or
    (method = 'card_manual' and manual_provider is not null and manual_terminal_id is not null)
    or
    (method = 'transfer' and manual_provider is null and manual_terminal_id is null
      and (manual_reference is null or (manual_reference = pg_catalog.btrim(manual_reference)
        and pg_catalog.char_length(manual_reference) between 1 and 64 and manual_reference !~ '[[:cntrl:]]')))
  );

-- 2. collect_simple_payment_core: accept `transfer`.

create or replace function app_private.collect_simple_payment_core(
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
  v_tendered bigint; v_change bigint; v_tip bigint := 0; v_cash_tip bigint := 0; v_tip_movement jsonb;
  v_last_sequence bigint; v_transfer_reference text;
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
    if p_command ? 'tenderedAmountMinor' then
      if pg_catalog.jsonb_typeof(p_command->'tenderedAmountMinor') not in ('number','null')
      then return pg_catalog.jsonb_build_object('status','conflict'); end if;
      if pg_catalog.jsonb_typeof(p_command->'tenderedAmountMinor')='number' then
        v_tendered := (p_command->>'tenderedAmountMinor')::bigint;
      end if;
    end if;
    if p_command ? 'tipMinor' then
      if pg_catalog.jsonb_typeof(p_command->'tipMinor')<>'number'
      then return pg_catalog.jsonb_build_object('status','conflict'); end if;
      v_tip := (p_command->>'tipMinor')::bigint;
    end if;
    if p_command ? 'transferReference' then
      if pg_catalog.jsonb_typeof(p_command->'transferReference') not in ('string','null')
      then return pg_catalog.jsonb_build_object('status','conflict'); end if;
      v_transfer_reference := p_command->>'transferReference';
    end if;
  exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    return pg_catalog.jsonb_build_object('status','conflict');
  end;
  v_idempotency_key:=p_command->>'idempotencyKey'; v_method:=p_command->>'method';
  if v_idempotency_key is null or v_idempotency_key<>pg_catalog.btrim(v_idempotency_key)
    or pg_catalog.char_length(v_idempotency_key) not between 1 and 200 or v_idempotency_key~'[[:cntrl:]]'
    or v_method not in ('cash','card_manual','transfer') or v_amount not between 1 and 9007199254740991
    or v_local_sequence<1 or v_expected_register_version<1 or v_expected_order_version<1
    or p_order_total_minor not between 1 and 9007199254740991
    or p_prior_captured_amount_minor not between 0 and 9007199254740991
    or v_tip not between 0 and 9007199254740991
    or (v_tendered is not null and (v_method<>'cash' or v_tendered not between v_amount+v_tip and 9007199254740991))
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

  -- The Payment aggregate must carry exactly the tender/change/tip the command states.
  if v_tendered is null then
    if p_payment ? 'tenderedAmount' or p_payment ? 'change' then
      return pg_catalog.jsonb_build_object('status','conflict'); end if;
  else
    v_change := v_tendered - v_amount - v_tip;
    if p_payment->'tenderedAmount'->>'amountMinor' is distinct from v_tendered::text
      or p_payment->'change'->>'amountMinor' is distinct from v_change::text
      or p_payment->'tenderedAmount'->>'currency' is distinct from p_payment->'amount'->>'currency'
      or p_payment->'change'->>'currency' is distinct from p_payment->'amount'->>'currency'
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  end if;
  if v_tip=0 then
    if p_payment ? 'tip' then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  elsif p_payment->'tip'->>'amountMinor' is distinct from v_tip::text
    or p_payment->'tip'->>'currency' is distinct from p_payment->'amount'->>'currency'
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  v_cash_tip := case when v_method='cash' then v_tip else 0 end;

  -- Only a transfer may carry a reference, and it is validated like the other free-text evidence.
  if v_method<>'transfer' then
    if v_transfer_reference is not null then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  elsif v_transfer_reference is not null and (v_transfer_reference<>pg_catalog.btrim(v_transfer_reference)
    or pg_catalog.char_length(v_transfer_reference) not between 1 and 64 or v_transfer_reference~'[[:cntrl:]]')
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  if v_method in ('cash','transfer') then
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
  -- A cash tip is its own movement and consumes the next device sequence number.
  v_last_sequence := v_local_sequence + case when v_cash_tip>0 then 1 else 0 end;

  if v_method='cash' then
    if pg_catalog.jsonb_array_length(p_register->'movements')
        <>pg_catalog.jsonb_array_length(v_session.aggregate->'movements')+1+(v_cash_tip>0)::integer
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
    if v_cash_tip>0 then
      select value into v_tip_movement from pg_catalog.jsonb_array_elements(p_register->'movements') value
        where value->>'type'='tip_in' and value->'source'->>'paymentId'=v_payment_id::text;
      if v_tip_movement is null or v_tip_movement->>'movementId'=v_payment_id::text
        or v_tip_movement->>'eventId'=v_event_id::text
        or v_tip_movement->>'idempotencyKey' is distinct from v_idempotency_key||':tip'
        or v_tip_movement->>'restaurantId' is distinct from v_restaurant_id::text or v_tip_movement->>'branchId' is distinct from v_branch_id::text
        or v_tip_movement->>'cashRegisterId' is distinct from v_session_id::text or v_tip_movement->>'registerId' is distinct from v_session.register_id::text
        or v_tip_movement->>'shiftId' is distinct from v_session.shift_id::text or v_tip_movement->>'cashierId' is distinct from v_session.cashier_id::text
        or v_tip_movement->>'actorId' is distinct from p_actor_id::text or v_tip_movement->>'deviceId' is distinct from v_device_id::text
        or v_tip_movement->>'localSequence' is distinct from (v_local_sequence+1)::text or v_tip_movement->>'direction' is distinct from 'in'
        or v_tip_movement->'amount'->>'amountMinor' is distinct from v_cash_tip::text
        or v_tip_movement->'amount'->>'currency' is distinct from v_session.currency or v_tip_movement->'source'->>'type' is distinct from 'payment'
        or v_tip_movement ? 'compensatesMovementId' or v_tip_movement ? 'reason'
      then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    end if;
  elsif p_register<>v_session.aggregate then
    return pg_catalog.jsonb_build_object('status','conflict');
  end if;

  insert into app.payments(id,restaurant_id,branch_id,order_id,cash_register_session_id,method,amount_minor,currency,state,
    manual_provider,manual_terminal_id,manual_reference,aggregate,captured_at,captured_by,
    tendered_amount_minor,change_minor,tip_minor)
  values(v_payment_id,v_restaurant_id,v_branch_id,v_order_id,v_session_id,v_method,v_amount,v_session.currency,'captured',
    v_manual_provider,v_manual_terminal_id,coalesce(v_manual_reference,v_transfer_reference),p_payment,v_occurred_at,p_actor_id,
    v_tendered,v_change,v_tip);
  if v_method='cash' then
    insert into app.cash_movements(id,event_id,idempotency_key,restaurant_id,branch_id,cash_register_session_id,
      register_id,shift_id,cashier_id,actor_id,device_id,local_sequence,movement_type,direction,amount_minor,currency,
      source_payment_id,occurred_at)
    values(v_payment_id,v_event_id,v_idempotency_key,v_restaurant_id,v_branch_id,v_session_id,
      v_session.register_id,v_session.shift_id,v_session.cashier_id,p_actor_id,v_device_id,v_local_sequence,
      'cash_sale','in',v_amount,v_session.currency,v_payment_id,v_occurred_at);
    if v_cash_tip>0 then
      insert into app.cash_movements(id,event_id,idempotency_key,restaurant_id,branch_id,cash_register_session_id,
        register_id,shift_id,cashier_id,actor_id,device_id,local_sequence,movement_type,direction,amount_minor,currency,
        source_payment_id,occurred_at)
      values((v_tip_movement->>'movementId')::uuid,(v_tip_movement->>'eventId')::uuid,v_idempotency_key||':tip',
        v_restaurant_id,v_branch_id,v_session_id,v_session.register_id,v_session.shift_id,v_session.cashier_id,
        p_actor_id,v_device_id,v_local_sequence+1,'tip_in','in',v_cash_tip,v_session.currency,v_payment_id,v_occurred_at);
    end if;
  end if;
  update app_private.financial_device_sequences set last_sequence=v_last_sequence
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
    'orderVersion',v_order_row.version,'remainingBalanceMinor',v_remaining,'replayed',false,
    'tenderedAmountMinor',v_tendered,'changeMinor',v_change,'tipMinor',v_tip);
  insert into app.financial_audit_events(
    event_id,idempotency_key,restaurant_id,branch_id,actor_id,device_id,operation,entity_id,cash_register_session_id,
    order_id,payment_id,expected_cash_register_version,result_cash_register_version,expected_order_version,
    result_order_version,command_payload,result_payload,occurred_at
  ) values(v_event_id,v_idempotency_key,v_restaurant_id,v_branch_id,p_actor_id,v_device_id,'payment.captured',v_payment_id,v_session_id,
    v_order_id,v_payment_id,v_expected_register_version,v_session.version,v_expected_order_version,
    v_order_row.version,p_command,v_result,v_occurred_at);
  return v_result;
end $function$;

-- 4. Operational report: tips and the session's movements (newest first, capped).
create or replace function app_private.read_cash_register_operational_report(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_register_id uuid,
  p_cash_register_session_id uuid,
  p_device_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_session app.cash_register_sessions%rowtype;
  v_payment_count bigint;
  v_cash_captured numeric;
  v_card_manual_captured numeric;
  v_transfer_captured numeric;
  v_total_captured numeric;
  v_tips numeric;
  v_cash_tips numeric;
  v_next_local_sequence numeric;
  v_movement_count bigint;
  v_movements jsonb;
begin
  if p_actor_id is null or p_restaurant_id is null or p_branch_id is null
    or p_register_id is null or p_device_id is null
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  if not exists (
    select 1
    from app.memberships m
    join app.membership_role_grants rg on rg.membership_id=m.id and rg.revoked_at is null
      and rg.role_code in ('owner','admin','manager','supervisor','cashier')
    join app.restaurants r on r.id=m.restaurant_id and r.disabled_at is null
    join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id and b.disabled_at is null
    where m.user_id=p_actor_id and m.restaurant_id=p_restaurant_id and m.branch_id=p_branch_id
      and m.revoked_at is null
  ) then return pg_catalog.jsonb_build_object('status','forbidden'); end if;

  select s.* into v_session
  from app.cash_register_sessions s
  where s.restaurant_id=p_restaurant_id and s.branch_id=p_branch_id and s.register_id=p_register_id
    and ((p_cash_register_session_id is null and s.status='open') or s.id=p_cash_register_session_id)
  order by (s.id=p_cash_register_session_id) desc, s.opened_at desc, s.id
  limit 1;
  if not found then return null; end if;

  select
    pg_catalog.count(*),
    coalesce(pg_catalog.sum(p.amount_minor) filter (where p.method='cash'),0),
    coalesce(pg_catalog.sum(p.amount_minor) filter (where p.method='card_manual'),0),
    coalesce(pg_catalog.sum(p.amount_minor) filter (where p.method='transfer'),0),
    coalesce(pg_catalog.sum(p.amount_minor),0),
    coalesce(pg_catalog.sum(p.tip_minor),0),
    coalesce(pg_catalog.sum(p.tip_minor) filter (where p.method='cash'),0)
  into v_payment_count,v_cash_captured,v_card_manual_captured,v_transfer_captured,v_total_captured,v_tips,v_cash_tips
  from app.payments p
  where p.restaurant_id=v_session.restaurant_id and p.branch_id=v_session.branch_id
    and p.cash_register_session_id=v_session.id and p.state='captured';

  select pg_catalog.count(*) into v_movement_count from app.cash_movements m
  where m.restaurant_id=v_session.restaurant_id and m.branch_id=v_session.branch_id
    and m.cash_register_session_id=v_session.id;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'movementId',x.id::text,
      'type',x.movement_type,
      'direction',x.direction,
      'amountMinor',x.amount_minor,
      'occurredAt',pg_catalog.to_char(x.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'sourcePaymentId',x.source_payment_id::text,
      'sourceRefundId',x.source_refund_id::text,
      'note',x.reason
    ) order by x.received_at desc, x.id),'[]'::jsonb) into v_movements
  from (
    select m.* from app.cash_movements m
    where m.restaurant_id=v_session.restaurant_id and m.branch_id=v_session.branch_id
      and m.cash_register_session_id=v_session.id
    order by m.received_at desc, m.id
    limit 200
  ) x;

  select coalesce((
    select d.last_sequence
    from app_private.financial_device_sequences d
    where d.restaurant_id=v_session.restaurant_id and d.branch_id=v_session.branch_id and d.device_id=p_device_id
  ),0)+1 into v_next_local_sequence;

  if v_payment_count>9007199254740991 or v_cash_captured>9007199254740991
    or v_card_manual_captured>9007199254740991 or v_transfer_captured>9007199254740991 or v_total_captured>9007199254740991
    or v_tips>9007199254740991 or v_cash_tips>9007199254740991
    or v_next_local_sequence>9007199254740991
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  return pg_catalog.jsonb_build_object(
    'schemaVersion',1,
    'scope',pg_catalog.jsonb_build_object('restaurantId',v_session.restaurant_id::text,'branchId',v_session.branch_id::text),
    'register',pg_catalog.jsonb_build_object(
      'schemaVersion',1,
      'scope',pg_catalog.jsonb_build_object('restaurantId',v_session.restaurant_id::text,'branchId',v_session.branch_id::text),
      'cashRegisterSessionId',v_session.id::text,
      'registerId',v_session.register_id::text,
      'shiftId',v_session.shift_id::text,
      'cashierId',v_session.cashier_id::text,
      'currency',v_session.currency,
      'status',v_session.status,
      'openingFloatMinor',v_session.opening_float_minor,
      'expectedCashBalanceMinor',case when v_session.status='open'
        then (v_session.aggregate->'openingFloat'->>'amountMinor')::bigint + coalesce((
          select pg_catalog.sum(case when m.direction='in' then m.amount_minor else -m.amount_minor end)
          from app.cash_movements m
          where m.restaurant_id=v_session.restaurant_id and m.branch_id=v_session.branch_id
            and m.cash_register_session_id=v_session.id
        ),0)
        else v_session.expected_closing_balance_minor end,
      'countedClosingBalanceMinor',v_session.counted_closing_balance_minor,
      'differenceMinor',v_session.difference_minor,
      'version',v_session.version,
      'openedAt',v_session.opened_at,
      'closedAt',v_session.closed_at,
      'replayed',false
    ),
    'paymentCount',v_payment_count,
    'cashCapturedMinor',v_cash_captured,
    'cardManualCapturedMinor',v_card_manual_captured,
    'transferCapturedMinor',v_transfer_captured,
    'totalCapturedMinor',v_total_captured,
    'tipsMinor',v_tips,
    'cashTipsMinor',v_cash_tips,
    'movementCount',v_movement_count,
    'movements',v_movements,
    'nextLocalSequence',v_next_local_sequence
  );
end $function$;

commit;
