begin;

create function app_private.read_capture_workspace_v3(p_actor_id uuid, p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v2 jsonb;
  restaurant uuid;
  branch uuid;
  capture uuid;
  repeat_plan jsonb;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_request,array['schemaVersion','scope','captureDraftId'])
    or not app_private.jsonb_has_exact_keys(p_request->'scope',array['restaurantId','branchId'])
    or p_request->'schemaVersion' is distinct from '3'::jsonb
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  begin
    restaurant := (p_request#>>'{scope,restaurantId}')::uuid;
    branch := (p_request#>>'{scope,branchId}')::uuid;
    capture := (p_request->>'captureDraftId')::uuid;
  exception when invalid_text_representation then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;

  v2 := app_private.read_capture_workspace_v2(p_actor_id,pg_catalog.jsonb_build_object(
    'schemaVersion',2,
    'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',capture::text
  ));
  if app_private.jsonb_has_exact_keys(v2,array['status']) then return v2; end if;

  select pg_catalog.jsonb_build_object(
    'schemaVersion',1,
    'customerId',stored.customer_id::text,
    'sourceOrderId',stored.source_order_id::text,
    'catalogVersion',stored.catalog_id::text,
    'appliedCaptureVersion',stored.applied_capture_version,
    'lineCount',pg_catalog.jsonb_array_length(stored.selection_plan->'lines')
  ) into repeat_plan
  from app.capture_repeat_order_plans stored
  where stored.restaurant_id=restaurant
    and stored.branch_id=branch
    and stored.capture_draft_id=capture;

  return (v2-'schemaVersion')||pg_catalog.jsonb_build_object(
    'schemaVersion',3,
    'repeatOrderPlan',repeat_plan
  );
end
$function$;

alter function app_private.read_capture_workspace_v3(uuid,jsonb) owner to postgres;
revoke all on function app_private.read_capture_workspace_v3(uuid,jsonb)
  from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.read_capture_workspace_v3(uuid,jsonb) to app_api;

comment on function app_private.read_capture_workspace_v3(uuid,jsonb) is
  'Rehydrates Capture V2 facts plus a bounded durable repeat-order intent summary; selections remain server-owned.';

commit;
