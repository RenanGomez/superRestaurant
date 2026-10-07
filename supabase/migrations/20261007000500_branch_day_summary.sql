begin;

-- day-summary-report (T3): read-only summary of one calendar day of a Branch.
--
-- app_private.read_branch_day_summary(actor, {schemaVersion:1, scope, date:'YYYY-MM-DD'}):
--   * `date` is a calendar day in the RESTAURANT's authoritative zone (app.restaurants.time_zone); the day is the
--     half-open UTC range [local 00:00, next local 00:00), so DST days are 23/25 hours long and never double count.
--   * Sales are CAPTURED PAYMENTS of the day (captured_at in range), by the channel of their Order and by method.
--     Tips are reported apart (payments.tip_minor) and never included in sales. Money stays in minor units.
--   * `ordersPaid` counts Orders in `paid`/`closed` whose LAST captured payment fell in the day; its amount is the sum
--     of every captured payment amount of those Orders (the Order's settled value, tips excluded).
--   * `deliveryFees` is the frozen `deliveryCharge` of those paid Orders; `deliveriesSettled` counts order_deliveries
--     settled in the day and the cash collected by couriers at settlement.
--   * Cancellations: Orders with status `cancelled` last updated in the day (a cancelled Order accepts no further
--     update) and Capture drafts closed as `no_sale` in the day. A dedicated cancellation journal is not read:
--     the Order status already carries the fact and nothing here depends on columns of tables outside main.
--   * Shifts: operational shifts overlapping the day (opened before its end and not closed before its start), at most
--     50, each with its cash register sessions: float, expected, counted, difference and the movements by type.
--     Session figures are the session's whole life, not only the day's slice.
--   * Currency comes from the captured payments; a day with several currencies is a `conflict` (never summed).
--     With no payments it falls back to the Branch's latest cash register session, then to MXN.
-- Only app_api can execute it. Membership with `reports.read` (owner, admin, manager, supervisor, viewer, auditor) in
-- the exact Restaurant/Branch is required. No writes.

-- The range scan on (restaurant, branch, captured_at) is the only access path the day report needs; payments_order_idx
-- leads with order_id after the scope, so without this index a day scans every payment of the Branch.
create index payments_branch_captured_idx on app.payments (restaurant_id, branch_id, captured_at);

create function app_private.read_branch_day_summary(p_actor_id uuid, p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_restaurant uuid;
  v_branch uuid;
  v_date date;
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
  v_currencies text[];
  v_currency text;
  v_by_channel jsonb;
  v_by_method jsonb;
  v_totals jsonb;
  v_paid jsonb;
  v_fees jsonb;
  v_settled jsonb;
  v_cancelled_orders bigint;
  v_no_sale bigint;
  v_shifts jsonb;
  v_max numeric;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_request, array['schemaVersion','scope','date'])
    or not app_private.jsonb_has_exact_keys(p_request -> 'scope', array['restaurantId','branchId'])
    or p_request -> 'schemaVersion' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_request -> 'date') is distinct from 'string'
    or not coalesce(p_request ->> 'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', false)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;
  begin
    v_restaurant := (p_request #>> '{scope,restaurantId}')::uuid;
    v_branch := (p_request #>> '{scope,branchId}')::uuid;
    v_date := (p_request ->> 'date')::date;
  exception when invalid_text_representation or numeric_value_out_of_range
    or datetime_field_overflow or invalid_datetime_format then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if v_restaurant is null or v_branch is null or v_date is null
    or v_date::text is distinct from p_request ->> 'date'
    or v_date < date '2000-01-01' or v_date > date '2100-01-01'
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  if not exists (
    select 1 from app.memberships m
    join app.branches b on b.restaurant_id=m.restaurant_id and b.id=m.branch_id
    join app.restaurants r on r.id=m.restaurant_id
    join app.membership_role_grants g on g.membership_id=m.id
    where m.user_id=p_actor_id and m.restaurant_id=v_restaurant and m.branch_id=v_branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null
      and g.revoked_at is null
      and g.role_code in ('owner','admin','manager','supervisor','viewer','auditor')
  ) then return pg_catalog.jsonb_build_object('status','denied'); end if;

  select r.time_zone into v_tz from app.restaurants r where r.id=v_restaurant;
  if v_tz is null then return pg_catalog.jsonb_build_object('status','denied'); end if;
  v_start := v_date::timestamp at time zone v_tz;
  v_end := (v_date + 1)::timestamp at time zone v_tz;

  with d as materialized (
    select p.id, p.order_id, o.channel, p.method, p.amount_minor, p.tip_minor, p.currency
    from app.payments p
    join app.orders o on o.restaurant_id=p.restaurant_id and o.branch_id=p.branch_id and o.id=p.order_id
    where p.restaurant_id=v_restaurant and p.branch_id=v_branch and p.state='captured'
      and p.captured_at >= v_start and p.captured_at < v_end
  ), paid as (
    select o.id, o.aggregate,
      (select pg_catalog.max(p.captured_at) from app.payments p
       where p.restaurant_id=o.restaurant_id and p.branch_id=o.branch_id and p.order_id=o.id and p.state='captured') as last_paid
    from app.orders o
    where o.restaurant_id=v_restaurant and o.branch_id=v_branch and o.status in ('paid','closed')
      and o.id in (select d.order_id from d)
  ), paid_day as (
    select * from paid where last_paid >= v_start and last_paid < v_end
  )
  select
    (select pg_catalog.array_agg(distinct d.currency order by d.currency) from d),
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'channel',c.channel,'paymentCount',coalesce(x.n,0),'amountMinor',coalesce(x.amount,0),'tipMinor',coalesce(x.tip,0)
      ) order by c.ord),'[]'::jsonb)
     from (values ('table',1),('counter',2),('takeout',3),('delivery',4)) as c(channel,ord)
     left join (select d.channel, pg_catalog.count(*) as n, pg_catalog.sum(d.amount_minor) as amount,
         pg_catalog.sum(d.tip_minor) as tip from d group by d.channel) x on x.channel=c.channel),
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'method',c.method,'paymentCount',coalesce(x.n,0),'amountMinor',coalesce(x.amount,0),'tipMinor',coalesce(x.tip,0)
      ) order by c.ord),'[]'::jsonb)
     from (values ('cash',1),('card_manual',2),('transfer',3)) as c(method,ord)
     left join (select d.method, pg_catalog.count(*) as n, pg_catalog.sum(d.amount_minor) as amount,
         pg_catalog.sum(d.tip_minor) as tip from d group by d.method) x on x.method=c.method),
    (select pg_catalog.jsonb_build_object(
        'paymentCount',pg_catalog.count(*),
        'salesMinor',coalesce(pg_catalog.sum(d.amount_minor),0),
        'tipsMinor',coalesce(pg_catalog.sum(d.tip_minor),0),
        'cashTipsMinor',coalesce(pg_catalog.sum(d.tip_minor) filter (where d.method='cash'),0)) from d),
    (select coalesce(pg_catalog.sum(d.amount_minor),0) + coalesce(pg_catalog.sum(d.tip_minor),0) from d),
    pg_catalog.jsonb_build_object('count',(select pg_catalog.count(*) from paid_day),
      'amountMinor',coalesce((select pg_catalog.sum(p.amount_minor) from app.payments p
        where p.restaurant_id=v_restaurant and p.branch_id=v_branch and p.state='captured'
          and p.order_id in (select pd.id from paid_day pd)),0)),
    pg_catalog.jsonb_build_object(
      'orderCount',(select pg_catalog.count(*) from paid_day pd
        where coalesce((pd.aggregate #>> '{deliveryCharge,amount,amountMinor}')::numeric,0) > 0),
      'amountMinor',coalesce((select pg_catalog.sum((pd.aggregate #>> '{deliveryCharge,amount,amountMinor}')::numeric)
        from paid_day pd),0))
  into v_currencies, v_by_channel, v_by_method, v_totals, v_max, v_paid, v_fees;

  if pg_catalog.cardinality(coalesce(v_currencies, array[]::text[])) > 1
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  v_currency := coalesce(v_currencies[1], (
    select s.currency from app.cash_register_sessions s
    where s.restaurant_id=v_restaurant and s.branch_id=v_branch order by s.opened_at desc, s.id limit 1), 'MXN');

  select pg_catalog.jsonb_build_object('count',pg_catalog.count(*),
    'cashCollectedMinor',coalesce(pg_catalog.sum(od.cash_to_collect_minor),0))
  into v_settled
  from app.order_deliveries od
  where od.restaurant_id=v_restaurant and od.branch_id=v_branch and od.state='settled'
    and od.settled_at >= v_start and od.settled_at < v_end;

  select pg_catalog.count(*) into v_cancelled_orders from app.orders o
  where o.restaurant_id=v_restaurant and o.branch_id=v_branch and o.status='cancelled'
    and o.updated_at >= v_start and o.updated_at < v_end;
  select pg_catalog.count(*) into v_no_sale from app.capture_drafts cd
  where cd.restaurant_id=v_restaurant and cd.branch_id=v_branch and cd.status='no_sale'
    and cd.updated_at >= v_start and cd.updated_at < v_end;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'shiftId',s.id::text,'name',s.name,'status',s.status,
    'openedAt',pg_catalog.to_char(s.opened_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'closedAt',case when s.closed_at is null then null
      else pg_catalog.to_char(s.closed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'registers',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'cashRegisterSessionId',c.id::text,'registerId',c.register_id::text,'cashierId',c.cashier_id::text,
        'status',c.status,
        'openedAt',pg_catalog.to_char(c.opened_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'closedAt',case when c.closed_at is null then null
          else pg_catalog.to_char(c.closed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
        'openingFloatMinor',c.opening_float_minor,
        'expectedCashBalanceMinor',case when c.status='open' then c.opening_float_minor + coalesce((
            select pg_catalog.sum(case when m.direction='in' then m.amount_minor else -m.amount_minor end)
            from app.cash_movements m
            where m.restaurant_id=c.restaurant_id and m.branch_id=c.branch_id and m.cash_register_session_id=c.id),0)
          else c.expected_closing_balance_minor end,
        'countedClosingBalanceMinor',c.counted_closing_balance_minor,
        'differenceMinor',c.difference_minor,
        'movements',coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'type',g.movement_type,'direction',g.direction,'count',g.n,'amountMinor',g.amount
          ) order by g.movement_type, g.direction)
          from (
            select m.movement_type, m.direction, pg_catalog.count(*) as n, pg_catalog.sum(m.amount_minor) as amount
            from app.cash_movements m
            where m.restaurant_id=c.restaurant_id and m.branch_id=c.branch_id and m.cash_register_session_id=c.id
            group by m.movement_type, m.direction
          ) g),'[]'::jsonb)
      ) order by c.opened_at, c.id)
      from app.cash_register_sessions c
      where c.restaurant_id=s.restaurant_id and c.branch_id=s.branch_id and c.shift_id=s.id),'[]'::jsonb)
  ) order by s.opened_at, s.id),'[]'::jsonb)
  into v_shifts
  from (
    select x.* from app.operational_shifts x
    where x.restaurant_id=v_restaurant and x.branch_id=v_branch
      and x.opened_at < v_end and (x.closed_at is null or x.closed_at >= v_start)
    order by x.opened_at, x.id limit 50
  ) s;

  if v_max > 9007199254740991
    or (v_paid ->> 'amountMinor')::numeric > 9007199254740991
    or (v_fees ->> 'amountMinor')::numeric > 9007199254740991
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  return pg_catalog.jsonb_build_object(
    'schemaVersion',1,
    'scope',pg_catalog.jsonb_build_object('restaurantId',v_restaurant::text,'branchId',v_branch::text),
    'date',v_date::text,
    'timeZone',v_tz,
    'currency',v_currency,
    'salesByChannel',v_by_channel,
    'salesByMethod',v_by_method,
    'totals',v_totals,
    'ordersPaid',v_paid,
    'deliveryFees',v_fees,
    'deliveriesSettled',v_settled,
    'cancellations',pg_catalog.jsonb_build_object('orders',v_cancelled_orders,'captures',v_no_sale),
    'shifts',v_shifts
  );
end $function$;

alter function app_private.read_branch_day_summary(uuid,jsonb) owner to postgres;
revoke all on function app_private.read_branch_day_summary(uuid,jsonb) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.read_branch_day_summary(uuid,jsonb) to app_api;
comment on function app_private.read_branch_day_summary(uuid,jsonb) is
  'Read-only day summary of one Branch (captured payments, tips, deliveries, cancellations, shifts); reports.read roles only.';

commit;
