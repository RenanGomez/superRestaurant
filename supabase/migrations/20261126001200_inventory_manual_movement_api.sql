begin;

-- Manual inventory entry point. The raw ledger writer (20261126000200) stays private: this wrapper
-- is the only path left for app_api to append a manual movement, and it pins the source to
-- 'inventory_manual' so receipt (purchasing) and sale_consumption are unreachable from here.

create function app_private.inventory_record_manual_movement(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_item_id uuid,
  p_kind text,
  p_quantity_delta integer,
  p_reason text,
  p_idempotency_key text,
  p_device_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if p_actor_id is null
    or p_restaurant_id is null
    or p_branch_id is null
    or p_warehouse_id is null
    or p_item_id is null
    or p_kind is null
    or p_quantity_delta is null
    or p_idempotency_key is null
  then
    raise exception using errcode = '22000', message = 'INVENTORY_MANUAL_MOVEMENT_ARGUMENT_MISSING';
  end if;

  if p_kind not in ('adjustment', 'waste', 'count_adjustment') then
    raise exception using errcode = '22000', message = 'INVENTORY_MANUAL_MOVEMENT_KIND_INVALID';
  end if;

  if p_reason is null or pg_catalog.char_length(pg_catalog.btrim(p_reason)) = 0 then
    raise exception using errcode = '22000', message = 'INVENTORY_MANUAL_MOVEMENT_REASON_REQUIRED';
  end if;

  -- p_quantity_delta = 0 is left to the raw ledger so its single rule and message stay authoritative.
  return app_private.inventory_record_movement(
    p_actor_id, p_restaurant_id, p_branch_id, p_warehouse_id, p_item_id,
    p_kind, p_quantity_delta, p_reason, p_idempotency_key,
    'inventory_manual', null, null, pg_catalog.clock_timestamp(), p_device_id
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

alter function app_private.inventory_record_manual_movement(
  uuid, uuid, uuid, uuid, uuid, text, integer, text, text, uuid
) owner to postgres;

revoke all on function app_private.inventory_record_manual_movement(
  uuid, uuid, uuid, uuid, uuid, text, integer, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function app_private.inventory_record_manual_movement(
  uuid, uuid, uuid, uuid, uuid, text, integer, text, text, uuid
) to app_api;

-- Close the raw ledger to every client role: app_api must go through a per-operation wrapper.
revoke all on function app_private.inventory_record_movement(
  uuid, uuid, uuid, uuid, uuid, text, integer, text, text, text, uuid, uuid, timestamptz, uuid
) from public, anon, authenticated, service_role, app_api;

comment on function app_private.inventory_record_manual_movement(
  uuid, uuid, uuid, uuid, uuid, text, integer, text, text, uuid
) is
  'Server-only manual inventory movement (adjustment, waste, count_adjustment) that pins the source to inventory_manual and delegates to the private ledger writer.';

commit;
