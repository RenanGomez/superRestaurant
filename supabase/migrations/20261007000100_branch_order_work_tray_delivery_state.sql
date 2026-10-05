begin;

-- deliveries-unassigned-tray: the "Por asignar" list of /app/deliveries is computed by the server.
-- Additive over 20261002000100 (create or replace, same signature, same grants, same cursor and order):
--   * every item carries `deliveryState` = the state of the Order's app.order_deliveries row
--     (assigned|en_route|delivered|failed|settled) or null when it has none. order_deliveries is keyed by
--     (restaurant_id, branch_id, order_id), so the left join yields at most one row per Order.
--   * the request accepts an optional boolean `unassignedDeliveriesOnly`. When true the reader forces
--     channel = 'delivery', admits status open|partially_paid|paid (prepaid Orders included) and keeps only
--     Orders with no delivery row or a `failed` one (a failed trip is assignable again). The filter runs
--     before the keyset limit so pagination stays exact. Without it the behaviour is unchanged.
-- Read-only: no new money, no new state, no writes to order_deliveries.
create or replace function app_private.list_branch_order_work_items(p_actor_id uuid, p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_restaurant uuid;
  v_branch uuid;
  v_limit integer;
  v_channel text;
  v_unassigned boolean := false;
  v_after_at timestamptz;
  v_after_id uuid;
  v_rows jsonb;
  v_next jsonb;
begin
  if p_actor_id is null
    or not (
      app_private.jsonb_has_exact_keys(p_request, array['schemaVersion','scope','limit','after','channel'])
      or (app_private.jsonb_has_exact_keys(p_request,
          array['schemaVersion','scope','limit','after','channel','unassignedDeliveriesOnly'])
        and pg_catalog.jsonb_typeof(p_request -> 'unassignedDeliveriesOnly') = 'boolean'))
    or not app_private.jsonb_has_exact_keys(p_request -> 'scope', array['restaurantId','branchId'])
    or p_request -> 'schemaVersion' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_request -> 'limit') is distinct from 'number'
    or not coalesce(p_request ->> 'limit' ~ '^[1-9][0-9]*$', false)
    or (p_request -> 'after' <> 'null'::jsonb and not app_private.jsonb_has_exact_keys(
      p_request -> 'after', array['updatedAt','orderId']))
    or (p_request -> 'channel' <> 'null'::jsonb
      and not (p_request ->> 'channel' in ('table','counter','takeout','delivery')))
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;
  begin
    v_restaurant := (p_request #>> '{scope,restaurantId}')::uuid;
    v_branch := (p_request #>> '{scope,branchId}')::uuid;
    v_limit := (p_request ->> 'limit')::integer;
    v_channel := p_request ->> 'channel';
    v_unassigned := coalesce((p_request ->> 'unassignedDeliveriesOnly')::boolean, false);
    if v_unassigned then v_channel := 'delivery'; end if;
    if p_request -> 'after' <> 'null'::jsonb then
      v_after_at := (p_request #>> '{after,updatedAt}')::timestamptz;
      v_after_id := (p_request #>> '{after,orderId}')::uuid;
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range
    or datetime_field_overflow or invalid_datetime_format then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if v_restaurant is null or v_branch is null or v_limit not between 1 and 100
    or (p_request -> 'after' <> 'null'::jsonb and (
      v_after_at is null or v_after_id is null
      or p_request #>> '{after,updatedAt}' is distinct from
        pg_catalog.to_char(v_after_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  if not exists (
    select 1 from app.memberships m
    join app.branches b on b.restaurant_id=m.restaurant_id and b.id=m.branch_id
    join app.restaurants r on r.id=m.restaurant_id
    join app.membership_role_grants g on g.membership_id=m.id
    where m.user_id=p_actor_id and m.restaurant_id=v_restaurant and m.branch_id=v_branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null
      and g.revoked_at is null
      and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter','kitchen','viewer','auditor')
  ) then return pg_catalog.jsonb_build_object('status','denied'); end if;

  with page as materialized (
    select o.id, o.channel, o.status, o.version, o.created_at, o.updated_at, o.aggregate,
      frozen.snapshot, frozen.confirmed_at, delivery.state as delivery_state
    from app.orders o
    left join app.order_fulfillment_snapshots frozen
      on frozen.restaurant_id=o.restaurant_id and frozen.branch_id=o.branch_id and frozen.order_id=o.id
    left join app.order_deliveries delivery
      on delivery.restaurant_id=o.restaurant_id and delivery.branch_id=o.branch_id and delivery.order_id=o.id
    where o.restaurant_id=v_restaurant and o.branch_id=v_branch
      and (case when v_unassigned then o.status in ('open','partially_paid','paid')
        else o.status in ('draft','open','partially_paid') end)
      and (not v_unassigned or delivery.state is null or delivery.state = 'failed')
      and (v_channel is null or o.channel=v_channel)
      and (v_after_at is null or o.updated_at < v_after_at
        or (o.updated_at = v_after_at and o.id > v_after_id))
    order by o.updated_at desc, o.id
    limit v_limit + 1
  ), numbered as (
    select page.*, row_number() over (order by updated_at desc, id) as row_number from page
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'orderId', n.id::text, 'channel', n.channel, 'status', n.status, 'version', n.version,
    'createdAt', pg_catalog.to_char(n.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', pg_catalog.to_char(n.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'confirmedAt', case when n.confirmed_at is null then null
      else pg_catalog.to_char(n.confirmed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'order', n.aggregate, 'snapshot', n.snapshot, 'deliveryState', n.delivery_state
  ) order by n.updated_at desc, n.id), '[]'::jsonb),
    (select pg_catalog.jsonb_build_object('updatedAt',
      pg_catalog.to_char(c.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'orderId', c.id::text) from numbered c where c.row_number=v_limit and exists (
        select 1 from numbered extra where extra.row_number=v_limit+1))
  into v_rows, v_next
  from numbered n where n.row_number<=v_limit;

  return pg_catalog.jsonb_build_object('schemaVersion',1,
    'scope',pg_catalog.jsonb_build_object('restaurantId',v_restaurant::text,'branchId',v_branch::text),
    'orders',v_rows,'next',v_next);
end
$function$;

do $owner$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname='postgres' and rolbypassrls)
    or not exists (select 1 from pg_catalog.pg_roles where rolname='app_api'
      and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolinherit and not rolreplication and not rolbypassrls)
  then raise exception using errcode='55000', message='APP_API_ROLE_REJECTED'; end if;
end
$owner$;

alter function app_private.list_branch_order_work_items(uuid,jsonb) owner to postgres;
revoke all on function app_private.list_branch_order_work_items(uuid,jsonb)
  from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.list_branch_order_work_items(uuid,jsonb) to app_api;
comment on function app_private.list_branch_order_work_items(uuid,jsonb) is
  'Server-only, Branch-scoped keyset page of active Orders with their full immutable aggregate, frozen fulfillment snapshot and delivery state, for the /app/orders and /app/deliveries operator views. Optional unassignedDeliveriesOnly returns delivery-channel Orders (prepaid included) with no delivery or a failed one. Nest computes totals from the aggregate; SQL never derives money.';

commit;
