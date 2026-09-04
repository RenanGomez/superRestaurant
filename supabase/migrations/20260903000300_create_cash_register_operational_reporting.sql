begin;

create function app_private.read_cash_register_operational_report(
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
  v_total_captured numeric;
  v_next_local_sequence numeric;
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
    coalesce(pg_catalog.sum(p.amount_minor),0)
  into v_payment_count,v_cash_captured,v_card_manual_captured,v_total_captured
  from app.payments p
  where p.restaurant_id=v_session.restaurant_id and p.branch_id=v_session.branch_id
    and p.cash_register_session_id=v_session.id and p.state='captured';

  select coalesce((
    select d.last_sequence
    from app_private.financial_device_sequences d
    where d.restaurant_id=v_session.restaurant_id and d.branch_id=v_session.branch_id and d.device_id=p_device_id
  ),0)+1 into v_next_local_sequence;

  if v_payment_count>9007199254740991 or v_cash_captured>9007199254740991
    or v_card_manual_captured>9007199254740991 or v_total_captured>9007199254740991
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
    'totalCapturedMinor',v_total_captured,
    'nextLocalSequence',v_next_local_sequence
  );
end $function$;

do $security$
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname='postgres' and rolbypassrls) then
    raise exception 'SECURITY_DEFINER_OWNER_REJECTED';
  end if;
end $security$;

alter function app_private.read_cash_register_operational_report(uuid,uuid,uuid,uuid,uuid,uuid) owner to postgres;
revoke all on function app_private.read_cash_register_operational_report(uuid,uuid,uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.read_cash_register_operational_report(uuid,uuid,uuid,uuid,uuid,uuid) to app_api;

comment on function app_private.read_cash_register_operational_report(uuid,uuid,uuid,uuid,uuid,uuid)
  is 'Authorized non-fiscal operational register summary; read-only X view and immutable closed-session Z result.';

commit;
