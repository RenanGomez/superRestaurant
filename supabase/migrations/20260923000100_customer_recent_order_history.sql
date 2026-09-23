begin;

create index order_fulfillment_customer_history_idx
  on app.order_fulfillment_snapshots (restaurant_id,branch_id,customer_id,confirmed_at desc,order_id desc)
  where customer_id is not null;

create function app_private.list_customer_recent_orders(
  p_actor_id uuid,
  p_request jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  restaurant uuid;
  branch uuid;
  customer uuid;
  requested_limit integer;
  orders jsonb;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_request,array['schemaVersion','scope','customerId','limit'])
    or not app_private.jsonb_has_exact_keys(p_request->'scope',array['restaurantId','branchId'])
    or p_request->'schemaVersion' is distinct from '1'::jsonb
    or not coalesce(p_request->>'limit' ~ '^[1-9][0-9]*$',false)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;
  begin
    restaurant := (p_request#>>'{scope,restaurantId}')::uuid;
    branch := (p_request#>>'{scope,branchId}')::uuid;
    customer := (p_request->>'customerId')::uuid;
    requested_limit := (p_request->>'limit')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or customer is null or requested_limit not between 1 and 20
    or p_request#>>'{scope,restaurantId}' is distinct from restaurant::text
    or p_request#>>'{scope,branchId}' is distinct from branch::text
    or p_request->>'customerId' is distinct from customer::text
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  if not exists (
    select 1 from app.memberships m
    join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
    join app.restaurants r on r.id=m.restaurant_id
    join app.membership_role_grants g on g.membership_id=m.id
    where m.user_id=p_actor_id and m.restaurant_id=restaurant and m.branch_id=branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null and g.revoked_at is null
      and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
  ) then return pg_catalog.jsonb_build_object('status','denied'); end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'confirmedAt',pg_catalog.to_char(history.confirmed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'fulfillmentChannel',history.fulfillment_channel,
    'order',history.aggregate
  ) order by history.confirmed_at desc,history.order_id desc),'[]'::jsonb) into orders
  from (
    select frozen.confirmed_at,frozen.fulfillment_channel,o.id as order_id,o.aggregate
    from app.order_fulfillment_snapshots frozen
    join app.orders o on o.restaurant_id=frozen.restaurant_id and o.branch_id=frozen.branch_id and o.id=frozen.order_id
    where frozen.restaurant_id=restaurant and frozen.branch_id=branch and frozen.customer_id=customer
    order by frozen.confirmed_at desc,frozen.order_id desc
    limit requested_limit
  ) history;

  return pg_catalog.jsonb_build_object('status','ok','result',pg_catalog.jsonb_build_object(
    'schemaVersion',1,
    'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'customerId',customer::text,
    'orders',orders
  ));
end
$function$;

alter function app_private.list_customer_recent_orders(uuid,jsonb) owner to postgres;
revoke all on function app_private.list_customer_recent_orders(uuid,jsonb)
  from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.list_customer_recent_orders(uuid,jsonb) to app_api;

comment on function app_private.list_customer_recent_orders(uuid,jsonb) is
  'Server-only bounded Customer Order history for one exact authorized Restaurant/Branch; returns immutable Order aggregates for Nest validation.';

commit;
