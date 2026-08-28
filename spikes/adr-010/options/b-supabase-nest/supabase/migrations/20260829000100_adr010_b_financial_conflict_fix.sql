-- Correct the conflict target after localSequence became global by device.
-- The prior migration is already applied and remains immutable.
create unique index if not exists cash_movements_device_sequence_global_uidx
  on adr010_b.cash_movements(device_id, local_sequence);

create or replace function adr010_b_private.adr010_b_create_cash_payment(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (p_payload ->> 'actorId')::uuid;
  v_restaurant_id uuid := (p_payload ->> 'restaurantId')::uuid;
  v_branch_id uuid := (p_payload ->> 'branchId')::uuid;
  v_order_id uuid := (p_payload ->> 'orderId')::uuid;
  v_key text := p_payload ->> 'idempotencyKey';
  v_amount bigint;
  v_currency text := p_payload ->> 'currency';
  v_device_id text := p_payload ->> 'deviceId';
  v_local_sequence bigint;
  v_occurred_at timestamptz := (p_payload ->> 'occurredAt')::timestamptz;
  v_request jsonb;
  v_payment adr010_b.payments;
  v_movement_id uuid;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' or char_length(coalesce(v_key, '')) not between 1 and 200 or char_length(coalesce(v_device_id, '')) not between 1 and 200 or
     v_actor_id is null or v_restaurant_id is null or v_branch_id is null or v_order_id is null or v_occurred_at is null or
     coalesce(p_payload ->> 'amountMinor', '') !~ '^[1-9][0-9]*$' or coalesce(p_payload ->> 'localSequence', '') !~ '^[1-9][0-9]*$' or coalesce(v_currency, '') !~ '^[A-Z]{3}$' then
    raise exception 'ADR010_INVALID_CASH_PAYMENT_INPUT';
  end if;
  v_amount := (p_payload ->> 'amountMinor')::bigint;
  v_local_sequence := (p_payload ->> 'localSequence')::bigint;
  v_request := jsonb_build_object('actorId',v_actor_id,'restaurantId',v_restaurant_id,'branchId',v_branch_id,'orderId',v_order_id,
    'idempotencyKey',v_key,'amountMinor',v_amount,'currency',v_currency,'deviceId',v_device_id,'localSequence',v_local_sequence,'occurredAt',v_occurred_at);
  if not exists (select 1 from adr010_b.memberships m where m.user_id=v_actor_id and m.restaurant_id=v_restaurant_id and m.branch_id=v_branch_id and m.revoked_at is null) then
    raise exception 'ADR010_MEMBERSHIP_NOT_ACTIVE';
  end if;
  if not exists (select 1 from adr010_b.orders o where o.id=v_order_id and o.restaurant_id=v_restaurant_id and o.branch_id=v_branch_id) then
    raise exception 'ADR010_ORDER_OUTSIDE_SCOPE';
  end if;
  insert into adr010_b.payments(restaurant_id,branch_id,order_id,actor_id,idempotency_key,request_payload,amount_minor,currency,method,device_id,local_sequence,occurred_at)
  values(v_restaurant_id,v_branch_id,v_order_id,v_actor_id,v_key,v_request,v_amount,v_currency,'cash',v_device_id,v_local_sequence,v_occurred_at)
  on conflict (restaurant_id,branch_id,idempotency_key) do nothing returning * into v_payment;
  if not found then
    select * into v_payment from adr010_b.payments where restaurant_id=v_restaurant_id and branch_id=v_branch_id and idempotency_key=v_key for key share;
    if v_payment.request_payload is distinct from v_request then raise exception 'ADR010_FINANCIAL_IDEMPOTENCY_KEY_REUSED'; end if;
    select id into v_movement_id from adr010_b.cash_movements where payment_id=v_payment.id and source_type='cash_payment';
    return jsonb_build_object('id',v_payment.id,'orderId',v_payment.order_id,'idempotencyKey',v_payment.idempotency_key,'amountMinor',v_payment.amount_minor,'currency',v_payment.currency,'cashMovementId',v_movement_id,'localSequence',v_payment.local_sequence);
  end if;
  perform adr010_b_private.adr010_b_claim_device_sequence(v_device_id, v_local_sequence);
  insert into adr010_b.cash_movements(restaurant_id,branch_id,payment_id,actor_id,direction,amount_minor,currency,source_type,source_id,device_id,local_sequence,occurred_at)
  values(v_restaurant_id,v_branch_id,v_payment.id,v_actor_id,'in',v_amount,v_currency,'cash_payment',v_payment.id,v_device_id,v_local_sequence,v_occurred_at)
  on conflict (device_id,local_sequence) do nothing returning id into v_movement_id;
  if not found then raise exception 'ADR010_FINANCIAL_LOCAL_SEQUENCE_REUSED'; end if;
  insert into adr010_b.financial_audit_log(restaurant_id,branch_id,order_id,payment_id,cash_movement_id,actor_id,action,device_id,local_sequence,occurred_at)
  values(v_restaurant_id,v_branch_id,v_order_id,v_payment.id,v_movement_id,v_actor_id,'CASH_PAYMENT_CAPTURED',v_device_id,v_local_sequence,v_occurred_at);
  if coalesce((p_payload ->> 'induceFailureAfterPayment')::boolean, false) then raise exception 'ADR010_INDUCED_FAILURE_AFTER_PAYMENT'; end if;
  return jsonb_build_object('id',v_payment.id,'orderId',v_payment.order_id,'idempotencyKey',v_payment.idempotency_key,'amountMinor',v_payment.amount_minor,'currency',v_payment.currency,'cashMovementId',v_movement_id,'localSequence',v_payment.local_sequence);
end;
$$;

create or replace function adr010_b_private.adr010_b_refund_cash_payment(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (p_payload ->> 'actorId')::uuid;
  v_restaurant_id uuid := (p_payload ->> 'restaurantId')::uuid;
  v_branch_id uuid := (p_payload ->> 'branchId')::uuid;
  v_order_id uuid := (p_payload ->> 'orderId')::uuid;
  v_payment_id uuid := (p_payload ->> 'paymentId')::uuid;
  v_key text := p_payload ->> 'idempotencyKey';
  v_amount bigint;
  v_currency text := p_payload ->> 'currency';
  v_device_id text := p_payload ->> 'deviceId';
  v_local_sequence bigint;
  v_occurred_at timestamptz := (p_payload ->> 'occurredAt')::timestamptz;
  v_reason text := p_payload ->> 'reason';
  v_authorization_approved boolean := (p_payload -> 'authorization' ->> 'approved')::boolean;
  v_authorization_actor_id uuid := (p_payload -> 'authorization' ->> 'actorId')::uuid;
  v_request jsonb;
  v_payment adr010_b.payments;
  v_refund adr010_b.refunds;
  v_refunded bigint;
  v_movement_id uuid;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' or char_length(coalesce(v_key, '')) not between 1 and 200 or char_length(coalesce(v_device_id, '')) not between 1 and 200 or char_length(coalesce(btrim(v_reason), '')) not between 1 and 500 or
     v_actor_id is null or v_restaurant_id is null or v_branch_id is null or v_order_id is null or v_payment_id is null or v_occurred_at is null or
     coalesce(p_payload ->> 'amountMinor', '') !~ '^[1-9][0-9]*$' or coalesce(p_payload ->> 'localSequence', '') !~ '^[1-9][0-9]*$' or coalesce(v_currency, '') !~ '^[A-Z]{3}$' then
    raise exception 'ADR010_INVALID_CASH_REFUND_INPUT';
  end if;
  v_amount := (p_payload ->> 'amountMinor')::bigint;
  v_local_sequence := (p_payload ->> 'localSequence')::bigint;
  if v_authorization_approved is distinct from true or v_authorization_actor_id is null then raise exception 'ADR010_REFUND_AUTHORIZATION_REQUIRED'; end if;
  v_request := jsonb_build_object('actorId',v_actor_id,'restaurantId',v_restaurant_id,'branchId',v_branch_id,'orderId',v_order_id,'paymentId',v_payment_id,
    'idempotencyKey',v_key,'amountMinor',v_amount,'currency',v_currency,'deviceId',v_device_id,'localSequence',v_local_sequence,'occurredAt',v_occurred_at,'reason',v_reason,
    'authorization',jsonb_build_object('approved',v_authorization_approved,'actorId',v_authorization_actor_id));
  if not exists (select 1 from adr010_b.memberships m where m.user_id=v_actor_id and m.restaurant_id=v_restaurant_id and m.branch_id=v_branch_id and m.revoked_at is null) then
    raise exception 'ADR010_MEMBERSHIP_NOT_ACTIVE';
  end if;
  if not exists (select 1 from adr010_b.memberships m where m.user_id=v_authorization_actor_id and m.restaurant_id=v_restaurant_id and m.branch_id=v_branch_id and m.role in ('owner','manager') and m.revoked_at is null) then
    raise exception 'ADR010_REFUND_AUTHORIZATION_NOT_SUPERVISOR';
  end if;
  select * into v_payment from adr010_b.payments where id=v_payment_id and restaurant_id=v_restaurant_id and branch_id=v_branch_id and order_id=v_order_id for update;
  if not found or v_payment.currency <> v_currency or v_payment.method <> 'cash' then raise exception 'ADR010_PAYMENT_OUTSIDE_SCOPE'; end if;
  insert into adr010_b.refunds(restaurant_id,branch_id,order_id,payment_id,actor_id,idempotency_key,request_payload,amount_minor,currency,device_id,local_sequence,occurred_at,reason,authorization_approved,authorization_actor_id)
  values(v_restaurant_id,v_branch_id,v_order_id,v_payment_id,v_actor_id,v_key,v_request,v_amount,v_currency,v_device_id,v_local_sequence,v_occurred_at,v_reason,v_authorization_approved,v_authorization_actor_id)
  on conflict (restaurant_id,branch_id,idempotency_key) do nothing returning * into v_refund;
  if not found then
    select * into v_refund from adr010_b.refunds where restaurant_id=v_restaurant_id and branch_id=v_branch_id and idempotency_key=v_key for key share;
    if v_refund.request_payload is distinct from v_request then raise exception 'ADR010_FINANCIAL_IDEMPOTENCY_KEY_REUSED'; end if;
    select id into v_movement_id from adr010_b.cash_movements where refund_id=v_refund.id;
    return jsonb_build_object('id',v_refund.id,'paymentId',v_refund.payment_id,'idempotencyKey',v_refund.idempotency_key,'amountMinor',v_refund.amount_minor,'currency',v_refund.currency,'cashMovementId',v_movement_id,'localSequence',v_refund.local_sequence);
  end if;
  select coalesce(sum(amount_minor),0) into v_refunded from adr010_b.refunds where payment_id=v_payment_id and id <> v_refund.id;
  if v_refunded > v_payment.amount_minor - v_amount then raise exception 'ADR010_REFUND_EXCEEDS_CAPTURED_AMOUNT'; end if;
  perform adr010_b_private.adr010_b_claim_device_sequence(v_device_id, v_local_sequence);
  insert into adr010_b.cash_movements(restaurant_id,branch_id,payment_id,refund_id,actor_id,direction,amount_minor,currency,source_type,source_id,device_id,local_sequence,occurred_at)
  values(v_restaurant_id,v_branch_id,v_payment_id,v_refund.id,v_actor_id,'out',v_amount,v_currency,'cash_refund',v_refund.id,v_device_id,v_local_sequence,v_occurred_at)
  on conflict (device_id,local_sequence) do nothing returning id into v_movement_id;
  if not found then raise exception 'ADR010_FINANCIAL_LOCAL_SEQUENCE_REUSED'; end if;
  insert into adr010_b.financial_audit_log(restaurant_id,branch_id,order_id,payment_id,refund_id,cash_movement_id,actor_id,action,reason,authorization_approved,authorization_actor_id,device_id,local_sequence,occurred_at)
  values(v_restaurant_id,v_branch_id,v_order_id,v_payment_id,v_refund.id,v_movement_id,v_actor_id,'CASH_PAYMENT_REFUNDED',v_reason,v_authorization_approved,v_authorization_actor_id,v_device_id,v_local_sequence,v_occurred_at);
  if coalesce((p_payload ->> 'induceFailureAfterRefund')::boolean, false) then raise exception 'ADR010_INDUCED_FAILURE_AFTER_REFUND'; end if;
  return jsonb_build_object('id',v_refund.id,'paymentId',v_refund.payment_id,'idempotencyKey',v_refund.idempotency_key,'amountMinor',v_refund.amount_minor,'currency',v_refund.currency,'cashMovementId',v_movement_id,'localSequence',v_refund.local_sequence);
end;
$$;

revoke all on function adr010_b_private.adr010_b_create_cash_payment(jsonb) from public, anon, authenticated, service_role;
revoke all on function adr010_b_private.adr010_b_refund_cash_payment(jsonb) from public, anon, authenticated, service_role;
