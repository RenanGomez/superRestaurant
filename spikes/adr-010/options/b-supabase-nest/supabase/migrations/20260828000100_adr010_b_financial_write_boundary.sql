-- ADR-010 option B financial thin slice. This is additive and intentionally
-- limited to cash: Nest/Auth -> PostgreSQL port -> private SQL is the sole
-- write frontier for Payment, Refund and its immutable CashMovement.

-- This cursor is deliberately private: localSequence is a device-level
-- protocol cursor, not tenant data. It is claimed under a row lock so the
-- same device cannot restart, skip, or reuse a sequence across scopes/users.
create table if not exists adr010_b_private.device_sequences (
  device_id text primary key check (char_length(device_id) between 1 and 200),
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists adr010_b.payments (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid not null,
  order_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  method text not null check (method = 'cash'),
  device_id text not null check (char_length(device_id) between 1 and 200),
  local_sequence bigint not null check (local_sequence > 0),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (restaurant_id, branch_id, id),
  unique (restaurant_id, branch_id, id, order_id),
  unique (restaurant_id, branch_id, idempotency_key),
  foreign key (restaurant_id, branch_id, order_id) references adr010_b.orders(restaurant_id, branch_id, id) on delete restrict
);

create table if not exists adr010_b.refunds (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid not null,
  order_id uuid not null,
  payment_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  device_id text not null check (char_length(device_id) between 1 and 200),
  local_sequence bigint not null check (local_sequence > 0),
  occurred_at timestamptz not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  authorization_approved boolean not null check (authorization_approved = true),
  authorization_actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (restaurant_id, branch_id, id),
  unique (restaurant_id, branch_id, idempotency_key),
  foreign key (restaurant_id, branch_id, order_id) references adr010_b.orders(restaurant_id, branch_id, id) on delete restrict,
  foreign key (restaurant_id, branch_id, payment_id, order_id) references adr010_b.payments(restaurant_id, branch_id, id, order_id) on delete restrict
);

create table if not exists adr010_b.cash_movements (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid not null,
  payment_id uuid,
  refund_id uuid,
  actor_id uuid not null references auth.users(id) on delete restrict,
  direction text not null check (direction in ('in', 'out')),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  source_type text not null check (source_type in ('cash_payment', 'cash_refund')),
  source_id uuid not null,
  device_id text not null check (char_length(device_id) between 1 and 200),
  local_sequence bigint not null check (local_sequence > 0),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  check ((source_type = 'cash_payment' and payment_id is not null and refund_id is null and direction = 'in' and source_id = payment_id) or
         (source_type = 'cash_refund' and refund_id is not null and payment_id is not null and direction = 'out' and source_id = refund_id)),
  foreign key (restaurant_id, branch_id, payment_id) references adr010_b.payments(restaurant_id, branch_id, id) on delete restrict,
  foreign key (restaurant_id, branch_id, refund_id) references adr010_b.refunds(restaurant_id, branch_id, id) on delete restrict,
  unique (restaurant_id, branch_id, id)
);

create table if not exists adr010_b.financial_audit_log (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  branch_id uuid not null,
  order_id uuid not null,
  payment_id uuid not null,
  refund_id uuid,
  cash_movement_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('CASH_PAYMENT_CAPTURED', 'CASH_PAYMENT_REFUNDED')),
  reason text,
  authorization_approved boolean,
  authorization_actor_id uuid references auth.users(id) on delete restrict,
  device_id text not null check (char_length(device_id) between 1 and 200),
  local_sequence bigint not null check (local_sequence > 0),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  check ((action = 'CASH_PAYMENT_CAPTURED' and refund_id is null and reason is null and authorization_approved is null and authorization_actor_id is null) or
         (action = 'CASH_PAYMENT_REFUNDED' and refund_id is not null and char_length(btrim(reason)) between 1 and 500 and authorization_approved = true and authorization_actor_id is not null)),
  foreign key (restaurant_id, branch_id, order_id) references adr010_b.orders(restaurant_id, branch_id, id) on delete restrict,
  foreign key (restaurant_id, branch_id, payment_id) references adr010_b.payments(restaurant_id, branch_id, id) on delete restrict,
  foreign key (restaurant_id, branch_id, refund_id) references adr010_b.refunds(restaurant_id, branch_id, id) on delete restrict,
  foreign key (restaurant_id, branch_id, cash_movement_id) references adr010_b.cash_movements(restaurant_id, branch_id, id) on delete restrict
);

create index if not exists payments_scope_order_idx on adr010_b.payments (restaurant_id, branch_id, order_id, created_at);
create index if not exists refunds_payment_idx on adr010_b.refunds (payment_id, created_at);
create index if not exists cash_movements_scope_created_idx on adr010_b.cash_movements (restaurant_id, branch_id, created_at);
create unique index if not exists cash_movements_payment_capture_uidx on adr010_b.cash_movements (payment_id) where source_type = 'cash_payment';
create unique index if not exists cash_movements_refund_uidx on adr010_b.cash_movements (refund_id) where source_type = 'cash_refund';

alter table adr010_b.payments enable row level security;
alter table adr010_b.refunds enable row level security;
alter table adr010_b.cash_movements enable row level security;
alter table adr010_b.financial_audit_log enable row level security;
alter table adr010_b.payments force row level security;
alter table adr010_b.refunds force row level security;
alter table adr010_b.cash_movements force row level security;
alter table adr010_b.financial_audit_log force row level security;
alter table adr010_b_private.device_sequences enable row level security;
alter table adr010_b_private.device_sequences force row level security;

-- No Data API grants or policies: even authenticated users cannot create,
-- update or delete financial rows directly. Privileged server PostgreSQL is
-- constrained by the private functions below and each function revalidates
-- active membership at the instant of mutation.
revoke all on table adr010_b.payments, adr010_b.refunds, adr010_b.cash_movements, adr010_b.financial_audit_log from public, anon, authenticated, service_role;
revoke all on table adr010_b_private.device_sequences from public, anon, authenticated, service_role;

create or replace function adr010_b_private.adr010_b_prevent_financial_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('adr010_b.financial_cleanup', true) = 'on' then
    return old;
  end if;
  raise exception 'ADR010_FINANCIAL_LEDGER_IMMUTABLE';
end;
$$;

drop trigger if exists adr010_b_payments_immutable on adr010_b.payments;
drop trigger if exists adr010_b_refunds_immutable on adr010_b.refunds;
drop trigger if exists adr010_b_cash_movements_immutable on adr010_b.cash_movements;
drop trigger if exists adr010_b_financial_audit_immutable on adr010_b.financial_audit_log;
create trigger adr010_b_payments_immutable before update or delete on adr010_b.payments for each row execute function adr010_b_private.adr010_b_prevent_financial_mutation();
create trigger adr010_b_refunds_immutable before update or delete on adr010_b.refunds for each row execute function adr010_b_private.adr010_b_prevent_financial_mutation();
create trigger adr010_b_cash_movements_immutable before update or delete on adr010_b.cash_movements for each row execute function adr010_b_private.adr010_b_prevent_financial_mutation();
create trigger adr010_b_financial_audit_immutable before update or delete on adr010_b.financial_audit_log for each row execute function adr010_b_private.adr010_b_prevent_financial_mutation();

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
  on conflict (restaurant_id,branch_id,actor_id,device_id,local_sequence) do nothing returning id into v_movement_id;
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
  on conflict (restaurant_id,branch_id,actor_id,device_id,local_sequence) do nothing returning id into v_movement_id;
  if not found then raise exception 'ADR010_FINANCIAL_LOCAL_SEQUENCE_REUSED'; end if;
  insert into adr010_b.financial_audit_log(restaurant_id,branch_id,order_id,payment_id,refund_id,cash_movement_id,actor_id,action,reason,authorization_approved,authorization_actor_id,device_id,local_sequence,occurred_at)
  values(v_restaurant_id,v_branch_id,v_order_id,v_payment_id,v_refund.id,v_movement_id,v_actor_id,'CASH_PAYMENT_REFUNDED',v_reason,v_authorization_approved,v_authorization_actor_id,v_device_id,v_local_sequence,v_occurred_at);
  if coalesce((p_payload ->> 'induceFailureAfterRefund')::boolean, false) then raise exception 'ADR010_INDUCED_FAILURE_AFTER_REFUND'; end if;
  return jsonb_build_object('id',v_refund.id,'paymentId',v_refund.payment_id,'idempotencyKey',v_refund.idempotency_key,'amountMinor',v_refund.amount_minor,'currency',v_refund.currency,'cashMovementId',v_movement_id,'localSequence',v_refund.local_sequence);
end;
$$;

-- Keep cleanup/retry-safe Auth deletion compatible with financial FKs.
create or replace function adr010_b_private.adr010_b_cleanup_auth_bootstrap(p_user_ids jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user_ids jsonb;
begin
  if jsonb_typeof(p_user_ids) is distinct from 'array' then raise exception 'ADR010_INVALID_AUTH_BOOTSTRAP_INPUT'; end if;
  perform pg_catalog.set_config('adr010_b.financial_cleanup', 'on', true);
  select coalesce(jsonb_agg(user_id order by fixture_key), '[]'::jsonb) into v_user_ids from adr010_b.bootstrap_users where user_id in (select value::uuid from jsonb_array_elements_text(p_user_ids));
  -- Financial rows may be authored by different disposable users (for
  -- example, one user captures and another refunds). Delete the complete
  -- connected fixture graph, not only rows whose actor is in p_user_ids, so
  -- Auth deletion cannot be stranded by an FK from a linked record.
  -- A cursor is removed only when no non-bootstrap actor still uses its device;
  -- shared devices retain their global monotonic history.
  delete from adr010_b_private.device_sequences ds
   where exists (select 1 from adr010_b.cash_movements movement
                  where movement.device_id=ds.device_id
                    and movement.actor_id in (select value::uuid from jsonb_array_elements_text(p_user_ids)))
     and not exists (select 1 from adr010_b.cash_movements movement
                      where movement.device_id=ds.device_id
                        and movement.actor_id not in (select value::uuid from jsonb_array_elements_text(p_user_ids)));
  delete from adr010_b.financial_audit_log audit
   where audit.actor_id in (select value::uuid from jsonb_array_elements_text(p_user_ids))
      or exists (select 1 from adr010_b.payments payment where payment.id=audit.payment_id and payment.actor_id in (select value::uuid from jsonb_array_elements_text(p_user_ids)))
      or exists (select 1 from adr010_b.refunds refund where refund.id=audit.refund_id and refund.actor_id in (select value::uuid from jsonb_array_elements_text(p_user_ids)))
      or exists (select 1 from adr010_b.cash_movements movement where movement.id=audit.cash_movement_id and movement.actor_id in (select value::uuid from jsonb_array_elements_text(p_user_ids)))
      or exists (select 1 from adr010_b.orders ord where ord.id=audit.order_id and ord.actor_id in (select value::uuid from jsonb_array_elements_text(p_user_ids)));
  delete from adr010_b.cash_movements movement
   where movement.actor_id in (select value::uuid from jsonb_array_elements_text(p_user_ids))
      or exists (select 1 from adr010_b.payments payment where payment.id=movement.payment_id and payment.actor_id in (select value::uuid from jsonb_array_elements_text(p_user_ids)))
      or exists (select 1 from adr010_b.refunds refund where refund.id=movement.refund_id and refund.actor_id in (select value::uuid from jsonb_array_elements_text(p_user_ids)))
      or exists (select 1 from adr010_b.payments payment join adr010_b.orders ord on ord.id=payment.order_id where payment.id=movement.payment_id and ord.actor_id in (select value::uuid from jsonb_array_elements_text(p_user_ids)))
      or exists (select 1 from adr010_b.refunds refund join adr010_b.orders ord on ord.id=refund.order_id where refund.id=movement.refund_id and ord.actor_id in (select value::uuid from jsonb_array_elements_text(p_user_ids)));
  delete from adr010_b.refunds refund
   where refund.actor_id in (select value::uuid from jsonb_array_elements_text(p_user_ids))
      or exists (select 1 from adr010_b.payments payment where payment.id=refund.payment_id and payment.actor_id in (select value::uuid from jsonb_array_elements_text(p_user_ids)))
      or exists (select 1 from adr010_b.orders ord where ord.id=refund.order_id and ord.actor_id in (select value::uuid from jsonb_array_elements_text(p_user_ids)));
  delete from adr010_b.payments payment
   where payment.actor_id in (select value::uuid from jsonb_array_elements_text(p_user_ids))
      or exists (select 1 from adr010_b.orders ord where ord.id=payment.order_id and ord.actor_id in (select value::uuid from jsonb_array_elements_text(p_user_ids)));
  delete from adr010_b.kds_events event using adr010_b.orders "order", adr010_b.bootstrap_users bootstrap_user where event.order_id="order".id and "order".actor_id=bootstrap_user.user_id and bootstrap_user.user_id in (select value::uuid from jsonb_array_elements_text(p_user_ids));
  delete from adr010_b.audit_log audit using adr010_b.orders "order", adr010_b.bootstrap_users bootstrap_user where audit.order_id="order".id and "order".actor_id=bootstrap_user.user_id and bootstrap_user.user_id in (select value::uuid from jsonb_array_elements_text(p_user_ids));
  delete from adr010_b.order_line_snapshots snapshot using adr010_b.order_lines line, adr010_b.orders "order", adr010_b.bootstrap_users bootstrap_user where snapshot.line_id=line.id and line.order_id="order".id and "order".actor_id=bootstrap_user.user_id and bootstrap_user.user_id in (select value::uuid from jsonb_array_elements_text(p_user_ids));
  delete from adr010_b.order_lines line using adr010_b.orders "order", adr010_b.bootstrap_users bootstrap_user where line.order_id="order".id and "order".actor_id=bootstrap_user.user_id and bootstrap_user.user_id in (select value::uuid from jsonb_array_elements_text(p_user_ids));
  delete from adr010_b.order_idempotency idempotency using adr010_b.orders "order", adr010_b.bootstrap_users bootstrap_user where idempotency.order_id="order".id and "order".actor_id=bootstrap_user.user_id and bootstrap_user.user_id in (select value::uuid from jsonb_array_elements_text(p_user_ids));
  delete from adr010_b.orders "order" using adr010_b.bootstrap_users bootstrap_user where "order".actor_id=bootstrap_user.user_id and bootstrap_user.user_id in (select value::uuid from jsonb_array_elements_text(p_user_ids));
  delete from adr010_b.memberships membership using adr010_b.bootstrap_users bootstrap_user where membership.user_id=bootstrap_user.user_id and bootstrap_user.user_id in (select value::uuid from jsonb_array_elements_text(p_user_ids));
  return v_user_ids;
end;
$$;

revoke all on function adr010_b_private.adr010_b_prevent_financial_mutation() from public, anon, authenticated, service_role;

create or replace function adr010_b_private.adr010_b_claim_device_sequence(p_device_id text, p_requested bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last bigint;
begin
  if char_length(coalesce(p_device_id, '')) not between 1 and 200 or p_requested is null or p_requested <= 0 then
    raise exception 'ADR010_INVALID_FINANCIAL_LOCAL_SEQUENCE';
  end if;
  insert into adr010_b_private.device_sequences(device_id, last_sequence)
  values(p_device_id, 0)
  on conflict (device_id) do nothing;
  select last_sequence into v_last
    from adr010_b_private.device_sequences
   where device_id = p_device_id
   for update;
  if v_last >= 9223372036854775807 then
    raise exception 'ADR010_FINANCIAL_LOCAL_SEQUENCE_EXHAUSTED';
  end if;
  if p_requested <= v_last then
    raise exception 'ADR010_FINANCIAL_LOCAL_SEQUENCE_REUSED';
  end if;
  if p_requested <> v_last + 1 then
    raise exception 'ADR010_FINANCIAL_LOCAL_SEQUENCE_GAP';
  end if;
  update adr010_b_private.device_sequences
     set last_sequence = p_requested, updated_at = now()
   where device_id = p_device_id;
end;
$$;

revoke all on function adr010_b_private.adr010_b_claim_device_sequence(text, bigint) from public, anon, authenticated, service_role;
revoke all on function adr010_b_private.adr010_b_create_cash_payment(jsonb) from public, anon, authenticated, service_role;
revoke all on function adr010_b_private.adr010_b_refund_cash_payment(jsonb) from public, anon, authenticated, service_role;
revoke all on function adr010_b_private.adr010_b_cleanup_auth_bootstrap(jsonb) from public, anon, authenticated, service_role;
