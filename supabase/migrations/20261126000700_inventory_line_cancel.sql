begin;

-- Wrapper: reverses the stock of exactly the line the command cancelled. The existing line
-- cancellation is not edited; the inventory reversal runs after a `saved` result only, so a replay
-- never reverses twice and a rejected/conflicting cancellation never touches stock. Scope and line
-- come from the authoritative result, never from the caller's p_order.
create function app_private.persist_order_item_cancellation_with_inventory(
  p_actor_id uuid,
  p_expected_version bigint,
  p_order jsonb,
  p_audit jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_restaurant_id uuid;
  v_branch_id uuid;
  v_order_id uuid;
  v_order_item_id uuid;
begin
  v_result := app_private.persist_order_item_cancellation(
    p_actor_id, p_expected_version, p_order, p_audit
  );

  if v_result ->> 'status' is distinct from 'saved' then
    return v_result;
  end if;

  begin
    v_restaurant_id := (v_result #>> '{order,restaurantId}')::uuid;
    v_branch_id := (v_result #>> '{order,branchId}')::uuid;
    v_order_id := (v_result #>> '{order,orderId}')::uuid;
    v_order_item_id := (p_audit ->> 'entityId')::uuid;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '55000', message = 'INVENTORY_ORDER_REFERENCE_INVALID';
  end;

  if v_restaurant_id is null or v_branch_id is null
    or v_order_id is null or v_order_item_id is null
  then
    raise exception using errcode = '55000', message = 'INVENTORY_ORDER_REFERENCE_INVALID';
  end if;

  return v_result || pg_catalog.jsonb_build_object(
    'inventory', app_private.inventory_reverse_order_item(
      p_actor_id, v_restaurant_id, v_branch_id, v_order_id, v_order_item_id
    )
  );
end
$function$;

do $owner$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'postgres' and rolbypassrls)
    or not exists (
      select 1 from pg_catalog.pg_roles
      where rolname = 'app_api'
        and not rolsuper
        and not rolcreatedb
        and not rolcreaterole
        and not rolinherit
        and not rolreplication
        and not rolbypassrls
    )
  then
    raise exception using errcode = '55000', message = 'APP_API_ROLE_REJECTED';
  end if;
end
$owner$;

alter function app_private.persist_order_item_cancellation_with_inventory(uuid, bigint, jsonb, jsonb)
  owner to postgres;

revoke all on function app_private.persist_order_item_cancellation_with_inventory(uuid, bigint, jsonb, jsonb)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.persist_order_item_cancellation_with_inventory(uuid, bigint, jsonb, jsonb)
  to app_api;

comment on function app_private.persist_order_item_cancellation_with_inventory(uuid, bigint, jsonb, jsonb) is
  'API entry point for cancelling one order line with inventory: wraps persist_order_item_cancellation and reverses the line consumption only when the result is saved (never on replayed). Call this instead of persist_order_item_cancellation whenever stock must follow the cancellation.';

commit;
