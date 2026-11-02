begin;

-- order-payments-captured-by: projection of captured_by in read_order_receipt_data
--
-- Replaces app_private.read_order_receipt_data from 20261007000600 adding
-- 'capturedBy', p.captured_by::text
-- Retains security definer, search_path = '', owner to postgres, grants to app_api only.

create or replace function app_private.read_order_receipt_data(
  p_actor_id uuid, p_restaurant_id uuid, p_branch_id uuid, p_order_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  result jsonb;
begin
  if p_actor_id is null or p_restaurant_id is null or p_branch_id is null or p_order_id is null then return null; end if;
  if app_private.read_order(p_actor_id, p_restaurant_id, p_branch_id, p_order_id) is null
    and app_private.read_courier_delivery_order(p_actor_id, p_restaurant_id, p_branch_id, p_order_id) is null
  then return null; end if;

  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'createdAt', pg_catalog.to_char(o.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'shortFolio', pg_catalog.upper(pg_catalog.left(o.id::text, 8)),
    'payments', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'paymentId', p.id::text,
        'method', p.method,
        'amountMinor', p.amount_minor,
        'tipMinor', p.tip_minor,
        'tenderedAmountMinor', p.tendered_amount_minor,
        'changeMinor', p.change_minor,
        'transferReference', case when p.method = 'transfer' then p.manual_reference else null end,
        'capturedAt', pg_catalog.to_char(p.captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'capturedBy', p.captured_by::text
      ) order by p.captured_at, p.id)
      from app.payments p
      where p.restaurant_id = o.restaurant_id and p.branch_id = o.branch_id and p.order_id = o.id
        and p.state = 'captured'
    ), '[]'::jsonb)
  ) into result
  from app.orders o
  where o.restaurant_id = p_restaurant_id and o.branch_id = p_branch_id and o.id = p_order_id;
  return result;
end
$function$;

alter function app_private.read_order_receipt_data(uuid,uuid,uuid,uuid) owner to postgres;
revoke all on function app_private.read_order_receipt_data(uuid,uuid,uuid,uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.read_order_receipt_data(uuid,uuid,uuid,uuid) to app_api;

comment on function app_private.read_order_receipt_data(uuid,uuid,uuid,uuid) is
  'Server-only: createdAt, shortFolio and captured payments (including capturedBy) of an Order for the printed ticket; NULL unless the actor passes read_order or read_courier_delivery_order.';

commit;
