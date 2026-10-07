-- Test-only fixtures. The schema verifier executes this body inside its rollback transaction.
-- Exercises app_private.cancel_order and app_private.list_cancelled_work_items: cancel draft/open (kitchen lines get a
-- KDS correction)/partially_paid/paid orders, a recorded pending refund obligation (also with real captured money),
-- active delivery blocks, closed/cancelled/delivered-line orders are rejected, command-level idempotency (replay and
-- divergent payload), atomicity, role/scope isolation and the cancelled reader (orders + no-sale captures, paging).
begin;

create function pg_temp.item(p_restaurant uuid, p_branch uuid, p_status text) returns jsonb
language sql as $f$
  select pg_catalog.jsonb_build_object(
    'orderItemId', gen_random_uuid()::text,
    'snapshot', pg_catalog.jsonb_build_object(
      'catalogVersion','11111111-1111-1111-1111-111111111111','productId','22222222-2222-2222-2222-222222222222',
      'name','Taco','sku','TACO','stationId','kitchen','unit','piece',
      'unitPrice', pg_catalog.jsonb_build_object('amountMinor',4900,'currency','MXN'),
      'modifiers', pg_catalog.jsonb_build_array()),
    'quantity', 1, 'restaurantId', p_restaurant::text, 'branchId', p_branch::text, 'status', p_status, 'note', null)
$f$;

create function pg_temp.mk_order(p_restaurant uuid, p_branch uuid, p_order uuid, p_status text, p_channel text,
  p_items jsonb, p_actor uuid) returns void language plpgsql as $f$
begin
  insert into app.orders(id,restaurant_id,branch_id,channel,status,aggregate,version,created_by,updated_by)
  values (p_order,p_restaurant,p_branch,p_channel,p_status,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',p_order::text,'restaurantId',p_restaurant::text,'branchId',p_branch::text,
    'channel',p_channel,'status',p_status,'currency','MXN','timeZone','America/Hermosillo','items',p_items),1,p_actor,p_actor);
end $f$;

create function pg_temp.cmd(p_restaurant uuid, p_branch uuid, p_order uuid, p_version bigint, p_now text, p_reason text)
returns jsonb language sql as $f$
  select pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',p_restaurant::text,'branchId',p_branch::text),
    'orderId',p_order::text,'expectedVersion',p_version,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId','00000000-0000-4000-8000-000000000001','occurredAt',p_now,'reason',p_reason)
$f$;

-- Mirrors packages/domain `cancelOrder`: one step per kitchen line, then the order step.
create function pg_temp.build(p_order uuid, p_actor uuid, p_device uuid, p_cmd jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $f$
declare
  v_row app.orders%rowtype;
  v_cur jsonb;
  v_steps jsonb := '[]'::jsonb;
  v_auth jsonb := pg_catalog.jsonb_build_object('approved',true,'actorId',p_actor::text);
  v_item jsonb;
  v_idx integer;
  v_event uuid;
  v_key text;
  v_pending jsonb := '[]'::jsonb;
  v_cancel_audit jsonb;
  v_base jsonb;
begin
  select * into v_row from app.orders where id = p_order;
  v_cur := v_row.aggregate;
  v_base := pg_catalog.jsonb_build_object(
    'schemaVersion',1,'restaurantId',p_cmd#>>'{scope,restaurantId}','branchId',p_cmd#>>'{scope,branchId}',
    'orderId',p_order::text,'actorId',p_actor::text,'deviceId',p_cmd->>'deviceId','occurredAt',p_cmd->>'occurredAt',
    'reason',p_cmd->>'reason','authorization',v_auth);
  for v_idx in 0..pg_catalog.jsonb_array_length(v_cur->'items')-1 loop
    v_item := v_cur->'items'->v_idx;
    if v_item->>'status' in ('sent','preparing','ready') then
      v_event := gen_random_uuid();
      v_key := gen_random_uuid()::text;
      v_cancel_audit := pg_catalog.jsonb_build_object(
        'eventId',v_event::text,'idempotencyKey',v_key,'from',v_item->>'status','actorId',p_actor::text,
        'branchId',p_cmd#>>'{scope,branchId}','deviceId',p_cmd->>'deviceId','occurredAt',p_cmd->>'occurredAt',
        'reason',p_cmd->>'reason','authorization',v_auth);
      v_cur := pg_catalog.jsonb_set(v_cur,array['items',v_idx::text],
        (v_item - 'status') || pg_catalog.jsonb_build_object('status','cancelled','cancellationAudit',v_cancel_audit));
      v_steps := v_steps || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('order',v_cur,'audit',
        v_base || pg_catalog.jsonb_build_object('eventId',v_event::text,'idempotencyKey',v_key,'operation','order_item.state_changed',
          'entityType','order_item','entityId',v_item->>'orderItemId','orderItemId',v_item->>'orderItemId',
          'from',v_item->>'status','to','cancelled')));
    end if;
  end loop;
  for v_idx in 0..pg_catalog.jsonb_array_length(v_cur->'items')-1 loop
    v_item := v_cur->'items'->v_idx;
    if v_item->>'status' = 'pending' then
      v_pending := v_pending || pg_catalog.jsonb_build_array(v_item->>'orderItemId');
      v_cancel_audit := pg_catalog.jsonb_build_object(
        'eventId',p_cmd->>'eventId','idempotencyKey',p_cmd->>'idempotencyKey','from','pending','actorId',p_actor::text,
        'branchId',p_cmd#>>'{scope,branchId}','deviceId',p_cmd->>'deviceId','occurredAt',p_cmd->>'occurredAt',
        'reason',p_cmd->>'reason','authorization',v_auth);
      v_cur := pg_catalog.jsonb_set(v_cur,array['items',v_idx::text],
        (v_item - 'status') || pg_catalog.jsonb_build_object('status','cancelled','cancellationAudit',v_cancel_audit));
    end if;
  end loop;
  v_cur := pg_catalog.jsonb_set(v_cur,'{status}','"cancelled"'::jsonb) || pg_catalog.jsonb_build_object('cancellationAudit',
    pg_catalog.jsonb_build_object('eventId',p_cmd->>'eventId','idempotencyKey',p_cmd->>'idempotencyKey','from',v_row.status,
      'actorId',p_actor::text,'branchId',p_cmd#>>'{scope,branchId}','deviceId',p_cmd->>'deviceId',
      'occurredAt',p_cmd->>'occurredAt','reason',p_cmd->>'reason','authorization',v_auth));
  return v_steps || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('order',v_cur,'audit',
    v_base || pg_catalog.jsonb_build_object('eventId',p_cmd->>'eventId','idempotencyKey',p_cmd->>'idempotencyKey',
      'operation','order.state_changed','entityType','order','entityId',p_order::text,'from',v_row.status,'to','cancelled',
      'automaticallyCancelledOrderItemIds',v_pending)));
end $f$;

do $cancel_order_tests$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  waiter uuid := (select id from auth.users where deleted_at is null order by id offset 1 limit 1);
  restaurant uuid := gen_random_uuid();
  branch uuid := gen_random_uuid();
  other_restaurant uuid := gen_random_uuid();
  other_branch uuid := gen_random_uuid();
  m_actor uuid := gen_random_uuid();
  m_waiter uuid := gen_random_uuid();
  m_foreign uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  now_text text := pg_catalog.to_char(pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_session uuid := gen_random_uuid();
  v_register uuid := gen_random_uuid();
  v_shift uuid := gen_random_uuid();
  o_draft uuid := gen_random_uuid();
  o_open uuid := gen_random_uuid();
  o_partial uuid := gen_random_uuid();
  o_paid uuid := gen_random_uuid();
  o_route uuid := gen_random_uuid();
  o_failed uuid := gen_random_uuid();
  o_closed uuid := gen_random_uuid();
  o_delivered uuid := gen_random_uuid();
  o_atomic uuid := gen_random_uuid();
  o_flight uuid := gen_random_uuid();
  capture uuid := gen_random_uuid();
  lease uuid;
  cmd jsonb;
  steps jsonb;
  result jsonb;
  replayed jsonb;
  items_pending jsonb;
  items_kitchen jsonb;
  create_result jsonb;
  page jsonb;
  page2 jsonb;
  n integer;
begin
  if actor is null or waiter is null or actor = waiter then raise exception 'CANCEL_ORDER_TWO_ACTORS_REQUIRED'; end if;
  insert into app.restaurants(id,name,time_zone) values
    (restaurant,'rollback-only cancel order','America/Hermosillo'),
    (other_restaurant,'rollback-only cancel order foreign','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values
    (branch,restaurant,'rollback-only cancel order branch'),
    (other_branch,other_restaurant,'rollback-only cancel order foreign branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values
    (m_actor,actor,restaurant,branch,actor),(m_waiter,waiter,restaurant,branch,actor),
    (m_foreign,actor,other_restaurant,other_branch,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values
    (m_actor,'manager',actor),(m_waiter,'waiter',actor),(m_foreign,'waiter',actor);

  items_pending := pg_catalog.jsonb_build_array(
    pg_temp.item(restaurant,branch,'pending'),pg_temp.item(restaurant,branch,'pending'));
  items_kitchen := pg_catalog.jsonb_build_array(
    pg_temp.item(restaurant,branch,'sent'),pg_temp.item(restaurant,branch,'preparing'),
    pg_temp.item(restaurant,branch,'pending'),pg_temp.item(restaurant,branch,'cancelled'));

  perform pg_temp.mk_order(restaurant,branch,o_draft,'draft','counter',items_pending,actor);
  perform pg_temp.mk_order(restaurant,branch,o_open,'open','counter',items_kitchen,actor);
  perform pg_temp.mk_order(restaurant,branch,o_partial,'partially_paid','counter',items_pending,actor);
  perform pg_temp.mk_order(restaurant,branch,o_paid,'paid','counter',items_kitchen,actor);
  perform pg_temp.mk_order(restaurant,branch,o_route,'open','delivery',items_pending,actor);
  perform pg_temp.mk_order(restaurant,branch,o_failed,'open','delivery',items_pending,actor);
  perform pg_temp.mk_order(restaurant,branch,o_closed,'closed','counter',pg_catalog.jsonb_build_array(pg_temp.item(restaurant,branch,'delivered')),actor);
  perform pg_temp.mk_order(restaurant,branch,o_delivered,'paid','counter',pg_catalog.jsonb_build_array(pg_temp.item(restaurant,branch,'delivered'),pg_temp.item(restaurant,branch,'pending')),actor);
  perform pg_temp.mk_order(restaurant,branch,o_flight,'open','counter',items_pending,actor);
  perform pg_temp.mk_order(restaurant,branch,o_atomic,'open','counter',items_kitchen,actor);

  insert into app.cash_register_sessions(
    id,restaurant_id,branch_id,register_id,shift_id,cashier_id,currency,status,opening_float_minor,aggregate,version,opened_at,opened_by
  ) values (
    v_session,restaurant,branch,v_register,v_shift,actor,'MXN','open',0,pg_catalog.jsonb_build_object(
      'schemaVersion',1,'cashRegisterId',v_session::text,'restaurantId',restaurant::text,'branchId',branch::text,
      'registerId',v_register::text,'shiftId',v_shift::text,'cashierId',actor::text,'currency','MXN','status','open',
      'openingFloat',pg_catalog.jsonb_build_object('amountMinor',0,'currency','MXN'),
      'openedByActorId',actor::text,'openedAt',now_text,'openedDeviceId',device::text,'movements','[]'::jsonb),
    1,pg_catalog.clock_timestamp(),actor);
  insert into app.payments(id,restaurant_id,branch_id,order_id,cash_register_session_id,method,amount_minor,currency,state,aggregate,captured_at,captured_by,tip_minor)
  values (gen_random_uuid(),restaurant,branch,o_partial,v_session,'cash',3000,'MXN','captured','{}'::jsonb,now(),actor,0),
         (gen_random_uuid(),restaurant,branch,o_partial,v_session,'transfer',1500,'MXN','captured','{}'::jsonb,now(),actor,200);
  -- the aggregate of a payment must match its columns: rebuild it as the payment table demands
  update app.payments set aggregate = pg_catalog.jsonb_build_object(
    'schemaVersion',1,'paymentId',id::text,'restaurantId',restaurant_id::text,'branchId',branch_id::text,'orderId',order_id::text,
    'method',method,'state',state,'amount',pg_catalog.jsonb_build_object('amountMinor',amount_minor,'currency',currency))
  where order_id = o_partial;
  insert into app.order_deliveries(restaurant_id,branch_id,order_id,courier_user_id,state,attempt_count,assigned_at,dispatched_at,failed_reason,created_by,updated_by)
  values (restaurant,branch,o_route,waiter,'en_route',1,now(),now(),null,actor,actor),
         (restaurant,branch,o_failed,waiter,'failed',1,now(),now(),'No contestaron',actor,actor);

  execute 'set local role app_api';

  -- 1. Draft order, two pending lines: one order step, no KDS, obligation none.
  cmd := pg_temp.cmd(restaurant,branch,o_draft,1,now_text,'Cliente se arrepintio');
  steps := pg_temp.build(o_draft,actor,device,cmd);
  result := app_private.cancel_order(actor,cmd,steps);
  if result->>'status'<>'saved' or (result->>'version')::bigint<>2 or result#>>'{order,status}'<>'cancelled'
    or result#>>'{refundObligation,status}'<>'none' or pg_catalog.jsonb_array_length(result->'kdsEvents')<>0
  then raise exception 'CANCEL_ORDER_DRAFT_REJECTED %',result; end if;
  execute 'reset role';
  if (select status from app.orders where id=o_draft)<>'cancelled'
    or (select refund_obligation_status from app.order_cancellations where order_id=o_draft)<>'none'
    or (select count(*) from app.order_command_events where order_id=o_draft and command_kind='cancel_order')<>1
  then raise exception 'CANCEL_ORDER_DRAFT_NOT_PERSISTED'; end if;
  execute 'set local role app_api';

  -- 2. Replay is byte-identical; a divergent payload under the same key is a conflict; no duplicated events.
  replayed := app_private.cancel_order(actor,cmd,steps);
  if replayed->>'status'<>'replayed' or replayed->'order'<>result->'order' then raise exception 'CANCEL_ORDER_REPLAY_MISMATCH'; end if;
  if app_private.cancel_order(actor,cmd || pg_catalog.jsonb_build_object('reason','Otro motivo'),steps)->>'status'<>'conflict'
  then raise exception 'CANCEL_ORDER_KEY_REUSE_ACCEPTED'; end if;
  execute 'reset role';
  if (select count(*) from app.order_audit_events where order_id=o_draft and operation='order.state_changed')<>1
  then raise exception 'CANCEL_ORDER_REPLAY_DUPLICATED_EVENTS'; end if;
  execute 'set local role app_api';

  -- 3. Open order with sent + preparing + pending + cancelled lines: 2 KDS corrections, version +3.
  cmd := pg_temp.cmd(restaurant,branch,o_open,1,now_text,'Se cayo el pedido');
  result := app_private.cancel_order(actor,cmd,pg_temp.build(o_open,actor,device,cmd));
  if result->>'status'<>'saved' or (result->>'version')::bigint<>4 or pg_catalog.jsonb_array_length(result->'kdsEvents')<>2
    or result#>>'{refundObligation,status}'<>'none'
  then raise exception 'CANCEL_ORDER_OPEN_REJECTED %',result; end if;
  execute 'reset role';
  if (select count(*) from app.kds_events where order_id=o_open and status='cancelled')<>2
    or exists (select 1 from pg_catalog.jsonb_array_elements((select aggregate->'items' from app.orders where id=o_open)) i(v) where i.v->>'status'<>'cancelled')
  then raise exception 'CANCEL_ORDER_OPEN_KDS_OR_ITEMS'; end if;
  execute 'set local role app_api';

  -- 4. partially_paid with captured money: cancelled with a pending obligation that records the captured amounts.
  cmd := pg_temp.cmd(restaurant,branch,o_partial,1,now_text,'Error de captura');
  result := app_private.cancel_order(actor,cmd,pg_temp.build(o_partial,actor,device,cmd));
  if result->>'status'<>'saved' or result#>>'{refundObligation,status}'<>'pending'
    or (result#>>'{refundObligation,capturedMinor}')::bigint<>4500 or (result#>>'{refundObligation,capturedTipMinor}')::bigint<>200
  then raise exception 'CANCEL_ORDER_PARTIAL_REJECTED %',result; end if;

  -- 5. paid with no payment rows still carries a pending obligation by state (money cannot be dropped silently).
  cmd := pg_temp.cmd(restaurant,branch,o_paid,1,now_text,'Pedido duplicado');
  result := app_private.cancel_order(actor,cmd,pg_temp.build(o_paid,actor,device,cmd));
  if result->>'status'<>'saved' or result#>>'{refundObligation,status}'<>'pending' or pg_catalog.jsonb_array_length(result->'kdsEvents')<>2
  then raise exception 'CANCEL_ORDER_PAID_REJECTED %',result; end if;

  -- 6. Active delivery blocks without effects; a failed delivery does not.
  cmd := pg_temp.cmd(restaurant,branch,o_route,1,now_text,'Ya no lo quieren');
  result := app_private.cancel_order(actor,cmd,pg_temp.build(o_route,actor,device,cmd));
  if result->>'status'<>'delivery_active' then raise exception 'CANCEL_ORDER_DELIVERY_ACTIVE_ACCEPTED %',result; end if;
  cmd := pg_temp.cmd(restaurant,branch,o_failed,1,now_text,'Nadie contesto');
  if app_private.cancel_order(actor,cmd,pg_temp.build(o_failed,actor,device,cmd))->>'status'<>'saved'
  then raise exception 'CANCEL_ORDER_FAILED_DELIVERY_REJECTED'; end if;

  -- 7. closed, already cancelled, delivered lines, stale version: conflict, no effects.
  cmd := pg_temp.cmd(restaurant,branch,o_closed,1,now_text,'x');
  if app_private.cancel_order(actor,cmd,pg_temp.build(o_closed,actor,device,cmd))->>'status'<>'conflict'
  then raise exception 'CANCEL_ORDER_CLOSED_ACCEPTED'; end if;
  cmd := pg_temp.cmd(restaurant,branch,o_draft,2,now_text,'otra vez');
  if app_private.cancel_order(actor,cmd,pg_temp.build(o_draft,actor,device,cmd))->>'status'<>'conflict'
  then raise exception 'CANCEL_ORDER_ALREADY_CANCELLED_ACCEPTED'; end if;
  cmd := pg_temp.cmd(restaurant,branch,o_delivered,1,now_text,'ya entregado');
  if app_private.cancel_order(actor,cmd,pg_temp.build(o_delivered,actor,device,cmd))->>'status'<>'conflict'
  then raise exception 'CANCEL_ORDER_DELIVERED_LINES_ACCEPTED'; end if;
  cmd := pg_temp.cmd(restaurant,branch,o_atomic,9,now_text,'version vieja');
  if app_private.cancel_order(actor,cmd,pg_temp.build(o_atomic,actor,device,cmd))->>'status'<>'conflict'
  then raise exception 'CANCEL_ORDER_STALE_VERSION_ACCEPTED'; end if;

  -- 7b. A non-terminal payment blocks with payment_in_flight (the state check is lifted inside this rollback only).
  execute 'reset role';
  alter table app.payments drop constraint payments_state_valid;
  insert into app.payments(id,restaurant_id,branch_id,order_id,cash_register_session_id,method,amount_minor,currency,state,aggregate,captured_at,captured_by)
  values (gen_random_uuid(),restaurant,branch,o_flight,v_session,'cash',100,'MXN','pending','{}'::jsonb,now(),actor);
  execute 'set local role app_api';
  cmd := pg_temp.cmd(restaurant,branch,o_flight,1,now_text,'pago en vuelo');
  result := app_private.cancel_order(actor,cmd,pg_temp.build(o_flight,actor,device,cmd));
  if result->>'status'<>'conflict' or result->>'reason'<>'payment_in_flight' then raise exception 'CANCEL_ORDER_PAYMENT_IN_FLIGHT_ACCEPTED %',result; end if;
  execute 'reset role';
  if (select status from app.orders where id=o_flight)<>'open' or exists (select 1 from app.order_cancellations where order_id=o_flight)
  then raise exception 'CANCEL_ORDER_PAYMENT_IN_FLIGHT_PERSISTED'; end if;
  execute 'set local role app_api';

  -- 8. Atomicity: a poisoned final step rolls back the kitchen-line steps already applied.
  cmd := pg_temp.cmd(restaurant,branch,o_atomic,1,now_text,'prueba atomica');
  steps := pg_temp.build(o_atomic,actor,device,cmd);
  steps := pg_catalog.jsonb_set(steps,array[(pg_catalog.jsonb_array_length(steps)-1)::text,'audit','from'],'"draft"'::jsonb);
  if app_private.cancel_order(actor,cmd,steps)->>'status'<>'conflict' then raise exception 'CANCEL_ORDER_POISONED_STEP_ACCEPTED'; end if;
  execute 'reset role';
  if (select version from app.orders where id=o_atomic)<>1 or (select status from app.orders where id=o_atomic)<>'open'
    or (select count(*) from app.kds_events where order_id=o_atomic)<>0
    or (select count(*) from app.order_audit_events where order_id=o_atomic)<>0
    or exists (select 1 from app.order_cancellations where order_id=o_atomic)
  then raise exception 'CANCEL_ORDER_ATOMICITY_LEAKED'; end if;
  execute 'set local role app_api';

  -- 9. Authorization and scope: a waiter, a foreign member and a null actor never cancel.
  cmd := pg_temp.cmd(restaurant,branch,o_atomic,1,now_text,'sin permiso');
  steps := pg_temp.build(o_atomic,actor,device,cmd);
  if app_private.cancel_order(waiter,cmd,steps)->>'status'<>'forbidden' then raise exception 'CANCEL_ORDER_WAITER_ACCEPTED'; end if;
  if app_private.cancel_order(null,cmd,steps)->>'status'<>'conflict' then raise exception 'CANCEL_ORDER_NULL_ACTOR_ACCEPTED'; end if;
  if app_private.cancel_order(actor,pg_catalog.jsonb_set(cmd,'{scope,branchId}',pg_catalog.to_jsonb(other_branch::text)),steps)->>'status' not in ('forbidden','conflict')
  then raise exception 'CANCEL_ORDER_WRONG_SCOPE_ACCEPTED'; end if;
  if app_private.cancel_order(actor,cmd || pg_catalog.jsonb_build_object('reason',repeat('x',201)),steps)->>'status'<>'conflict'
    or app_private.cancel_order(actor,cmd || pg_catalog.jsonb_build_object('reason',' '),steps)->>'status'<>'conflict'
    or app_private.cancel_order(actor,cmd || '{"extra":1}'::jsonb,steps)->>'status'<>'conflict'
  then raise exception 'CANCEL_ORDER_REASON_OR_SHAPE_ACCEPTED'; end if;
  execute 'reset role';
  if (select status from app.orders where id=o_atomic)<>'open' then raise exception 'CANCEL_ORDER_FORBIDDEN_PERSISTED'; end if;

  -- 10. Immutable cancellation record.
  begin
    update app.order_cancellations set reason = 'otro' where order_id = o_draft;
    raise exception 'CANCEL_ORDER_RECORD_MUTABLE';
  exception when sqlstate '55000' then null; end;

  -- 11. A no-sale capture also appears in the reader.
  execute 'set local role app_api';
  create_result := app_private.create_capture_draft(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',capture::text,'eventId',gen_random_uuid()::text,'idempotencyKey',gen_random_uuid()::text,
    'deviceId',device::text,'occurredAt',now_text,'expectedVersion',0,'sourceChannel','phone','fulfillmentChannel',null));
  if create_result->>'status'<>'applied' then raise exception 'CANCEL_ORDER_CAPTURE_SETUP_REJECTED'; end if;
  lease := (create_result#>>'{record,detail,attentionLeaseId}')::uuid;
  if app_private.close_capture_no_sale(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',capture::text,'expectedVersion',1,'eventId',gen_random_uuid()::text,
    'idempotencyKey',gen_random_uuid()::text,'deviceId',device::text,'occurredAt',now_text,
    'attentionLeaseId',lease::text,'reason','Cliente colgo'))->>'status'<>'applied'
  then raise exception 'CANCEL_ORDER_CAPTURE_NO_SALE_REJECTED'; end if;

  -- 12. Reader: 5 cancelled orders + 1 capture = 6 rows; paging by 4 is exact and disjoint; scope/role isolation.
  page := app_private.list_cancelled_work_items(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'limit',4,'after','null'::jsonb));
  if pg_catalog.jsonb_array_length(page->'items')<>4 or page->'next' is null or page->'next'='null'::jsonb
  then raise exception 'CANCEL_ORDER_READER_PAGE_1 %',page; end if;
  page2 := app_private.list_cancelled_work_items(actor,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'limit',4,'after',page->'next'));
  if pg_catalog.jsonb_array_length(page2->'items')<>2 or page2->'next' is distinct from 'null'::jsonb
  then raise exception 'CANCEL_ORDER_READER_PAGE_2 %',page2; end if;
  select count(distinct x->>'id') into n from (
    select pg_catalog.jsonb_array_elements(page->'items') x union all select pg_catalog.jsonb_array_elements(page2->'items')) q;
  if n<>6 then raise exception 'CANCEL_ORDER_READER_NOT_DISJOINT'; end if;
  if not exists (select 1 from pg_catalog.jsonb_array_elements((page->'items') || (page2->'items')) x
      where x->>'kind'='capture' and x->>'reason'='Cliente colgo')
    or not exists (select 1 from pg_catalog.jsonb_array_elements((page->'items') || (page2->'items')) x
      where x->>'kind'='order' and x->>'id'=o_partial::text and x->>'refundObligationStatus'='pending'
        and (x->>'capturedMinor')::bigint=4500 and x->>'reason'='Error de captura' and x->>'actorId'=actor::text)
  then raise exception 'CANCEL_ORDER_READER_CONTENT'; end if;
  if app_private.list_cancelled_work_items(actor,pg_catalog.jsonb_build_object(
      'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',other_restaurant::text,'branchId',other_branch::text),
      'limit',4,'after','null'::jsonb))->>'status'<>'denied'
    or app_private.list_cancelled_work_items(null,pg_catalog.jsonb_build_object(
      'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
      'limit',4,'after','null'::jsonb))->>'status'<>'rejected'
    or app_private.list_cancelled_work_items(actor,pg_catalog.jsonb_build_object(
      'schemaVersion',1,'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
      'limit',0,'after','null'::jsonb))->>'status'<>'rejected'
  then raise exception 'CANCEL_ORDER_READER_ISOLATION'; end if;
  -- the foreign-scope member sees nothing of this branch
  execute 'reset role';
  if exists (select 1 from app.order_cancellations where branch_id=other_branch) then raise exception 'CANCEL_ORDER_FOREIGN_ROWS'; end if;
end
$cancel_order_tests$;
commit;
