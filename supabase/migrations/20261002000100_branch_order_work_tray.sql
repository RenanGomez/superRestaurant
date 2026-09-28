begin;

-- S9.1 web operator view: paginated Branch-scoped active Orders plus each Order's full
-- immutable aggregate (for Nest to compute totals via calculateOrderAggregateTotals; never
-- recalculated from the catalog) and the frozen fulfillment snapshot (V1 or V2), so the API can
-- project customer/address/payment-intent facts without exposing PII directly from SQL. Read-only:
-- no new money, no new state. Reuses the same keyset cursor shape as list_branch_active_orders.
create or replace function app_private.list_branch_order_work_items(p_actor_id uuid, p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_restaurant uuid;
  v_branch uuid;
  v_limit integer;
  v_after_at timestamptz;
  v_after_id uuid;
  v_rows jsonb;
  v_next jsonb;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_request, array['schemaVersion','scope','limit','after'])
    or not app_private.jsonb_has_exact_keys(p_request -> 'scope', array['restaurantId','branchId'])
    or p_request -> 'schemaVersion' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_request -> 'limit') is distinct from 'number'
    or not coalesce(p_request ->> 'limit' ~ '^[1-9][0-9]*$', false)
    or (p_request -> 'after' <> 'null'::jsonb and not app_private.jsonb_has_exact_keys(
      p_request -> 'after', array['updatedAt','orderId']))
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;
  begin
    v_restaurant := (p_request #>> '{scope,restaurantId}')::uuid;
    v_branch := (p_request #>> '{scope,branchId}')::uuid;
    v_limit := (p_request ->> 'limit')::integer;
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
    select o.id, o.channel, o.status, o.version, o.updated_at, o.aggregate,
      frozen.snapshot, frozen.confirmed_at
    from app.orders o
    left join app.order_fulfillment_snapshots frozen
      on frozen.restaurant_id=o.restaurant_id and frozen.branch_id=o.branch_id and frozen.order_id=o.id
    where o.restaurant_id=v_restaurant and o.branch_id=v_branch
      and o.status in ('draft','open','partially_paid')
      and (v_after_at is null or o.updated_at < v_after_at
        or (o.updated_at = v_after_at and o.id > v_after_id))
    order by o.updated_at desc, o.id
    limit v_limit + 1
  ), numbered as (
    select page.*, row_number() over (order by updated_at desc, id) as row_number from page
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'orderId', n.id::text, 'channel', n.channel, 'status', n.status, 'version', n.version,
    'updatedAt', pg_catalog.to_char(n.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'confirmedAt', case when n.confirmed_at is null then null
      else pg_catalog.to_char(n.confirmed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'order', n.aggregate, 'snapshot', n.snapshot
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
  'Server-only, Branch-scoped keyset page of active Orders with their full immutable aggregate and frozen fulfillment snapshot, for the /app/orders operator view (S9.1). Nest computes totals from the aggregate; SQL never derives money.';

commit;
