begin;

-- courier-order-detail: a courier may read the Order of a delivery assigned to them, and only that Order.
--
-- `app_private.read_order` deliberately excludes the `courier` role (it has no `orders.read`), so the
-- assigned courier cannot see lines or totals of the trip they carry. This adds a second, narrower reader with
-- the exact shape of `read_order` (same aggregate, version and updatedAt) whose ownership is decided HERE, in
-- the database, never in the UI or the API alone:
--   * the actor needs an active membership of the exact restaurant/branch that grants `courier`;
--   * `app.order_deliveries.courier_user_id` of that very Order must be the actor (any delivery state: the row
--     only exists after an assignment, and a reassignment hands the Order to the new courier at once);
--   * anything else (another courier's Order, an unassigned Order, another branch, a missing Order) returns the
--     same NULL, so the API cannot be used to learn whether an Order exists.
-- Additive: no table, grant or existing function changes. EXECUTE is for `app_api` only.

create function app_private.read_courier_delivery_order(
  p_actor_id uuid, p_restaurant_id uuid, p_branch_id uuid, p_order_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_roles text[]; result jsonb;
begin
  if p_actor_id is null or p_restaurant_id is null or p_branch_id is null or p_order_id is null then return null; end if;
  select m.roles into v_roles from app_private.find_active_branch_membership(p_actor_id, p_restaurant_id, p_branch_id) m;
  if v_roles is null or not ('courier' = any(v_roles)) then return null; end if;

  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('restaurantId', o.restaurant_id::text, 'branchId', o.branch_id::text),
    'order', o.aggregate,
    'version', o.version,
    'updatedAt', pg_catalog.to_char(o.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) into result
  from app.orders o
  join app.order_deliveries d
    on d.restaurant_id = o.restaurant_id and d.branch_id = o.branch_id and d.order_id = o.id
  where o.restaurant_id = p_restaurant_id and o.branch_id = p_branch_id and o.id = p_order_id
    and o.channel = 'delivery' and d.courier_user_id = p_actor_id;
  return result;
end
$function$;

alter function app_private.read_courier_delivery_order(uuid,uuid,uuid,uuid) owner to postgres;
revoke all on function app_private.read_courier_delivery_order(uuid,uuid,uuid,uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.read_courier_delivery_order(uuid,uuid,uuid,uuid) to app_api;

comment on function app_private.read_courier_delivery_order(uuid,uuid,uuid,uuid) is
  'Server-only: the Order aggregate (read_order shape) of a delivery assigned to the calling courier; NULL for anything else, so existence of foreign Orders is never revealed.';

commit;
