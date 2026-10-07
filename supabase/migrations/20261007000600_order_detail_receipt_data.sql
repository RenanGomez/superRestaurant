begin;

-- order-detail-receipt-data: the facts a printed ticket needs and the Order aggregate does not carry.
--
-- app_private.read_order_receipt_data(actor, restaurant, branch, order) returns
--   { schemaVersion:1, createdAt, shortFolio, payments:[...] }
--   * createdAt: the Order row's created_at, UTC ISO with milliseconds (never invented by a client).
--   * shortFolio: the first 8 characters of the Order id in upper case. It is deterministic and needs no table:
--     it is exactly the label the web already shows as "Orden XXXXXXXX" / "Cuenta XXXXXXXX", so the ticket and
--     every screen agree. It is a reading aid, NOT a unique key (the id is); a daily sequence per Branch would need
--     a counter table and an assignment point and is deliberately not introduced here.
--   * payments: the CAPTURED payments of the Order (oldest first): id, method, amountMinor, tipMinor,
--     tenderedAmountMinor/changeMinor (cash with a tender only, else null), transferReference (method = transfer only,
--     else null) and capturedAt. Minor units only; nothing is recomputed.
-- Authorization is NOT re-implemented: the actor must pass `read_order` (orders.read roles) OR
-- `read_courier_delivery_order` (the courier assigned to that delivery) for the exact Restaurant/Branch/Order;
-- anything else, including a missing Order, is the same NULL. Read-only. EXECUTE is for `app_api` only.

create function app_private.read_order_receipt_data(
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
        'capturedAt', pg_catalog.to_char(p.captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
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
  'Server-only: createdAt, shortFolio and captured payments of an Order for the printed ticket; NULL unless the actor passes read_order or read_courier_delivery_order.';

commit;
