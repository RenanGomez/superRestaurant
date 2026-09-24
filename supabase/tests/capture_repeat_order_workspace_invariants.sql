-- Transactional supplement. The caller must apply candidate migrations and always ROLLBACK.
begin;

do $capture_repeat_order_workspace_invariants$
declare
  actor uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  restaurant uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  branch uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
  capture uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
  customer uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5';
  source_order uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6';
  catalog uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7';
  result jsonb;
begin
  -- The full repeat-order invariant fixture owns positive-path row creation.
  -- Here the reader contract is independently fail-closed before any scoped read.
  result := app_private.read_capture_workspace_v3(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',3,
    'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',capture::text
  ));
  if result<>pg_catalog.jsonb_build_object('status','denied') then
    raise exception using errcode='55000', message='CAPTURE_REPEAT_ORDER_WORKSPACE_DENIAL_REJECTED';
  end if;
  if app_private.read_capture_workspace_v3(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',2,
    'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',capture::text
  ))<>pg_catalog.jsonb_build_object('status','rejected') then
    raise exception using errcode='55000', message='CAPTURE_REPEAT_ORDER_WORKSPACE_VERSION_REJECTED';
  end if;
  if app_private.read_capture_workspace_v3(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',3,
    'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',capture::text,
    'customerId',customer::text,
    'sourceOrderId',source_order::text,
    'catalogVersion',catalog::text
  ))<>pg_catalog.jsonb_build_object('status','rejected') then
    raise exception using errcode='55000', message='CAPTURE_REPEAT_ORDER_WORKSPACE_EXTRA_KEYS_REJECTED';
  end if;
end
$capture_repeat_order_workspace_invariants$;

commit;
