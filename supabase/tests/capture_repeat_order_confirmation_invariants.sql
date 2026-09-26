-- Transactional supplement. The positive atomic path is exercised by capture_repeat_order_invariants.sql.
begin;
do $capture_repeat_order_confirmation_invariants$
declare
  actor uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  restaurant uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  branch uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
  capture uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
  request jsonb;
begin
  request := pg_catalog.jsonb_build_object(
    'schemaVersion',3,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text
    ),'captureDraftId',capture::text
  );
  if app_private.read_capture_repeat_order_plan(actor,request)
      <>pg_catalog.jsonb_build_object('status','denied')
    or app_private.read_capture_repeat_order_plan(actor,request||'{"unexpected":true}'::jsonb)->>'status'<>'rejected'
    or app_private.confirm_capture_draft_v3(actor,'{}'::jsonb,null,null)->>'status'<>'rejected'
  then raise exception using errcode='55000', message='CAPTURE_REPEAT_CONFIRMATION_FAIL_CLOSED_REJECTED'; end if;
end
$capture_repeat_order_confirmation_invariants$;
commit;
