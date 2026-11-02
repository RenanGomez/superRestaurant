begin;

-- 1. Order account label: additive column for table accounts («a nombre de quién»).
alter table app.orders add column account_label text null check (account_label is null or (char_length(account_label) between 1 and 60));

-- 2. Audit operation constraint updates.
alter table app.order_audit_events drop constraint order_audit_operation_valid;
alter table app.order_audit_events add constraint order_audit_operation_valid check (
  operation in (
    'order.created', 'order.item_added', 'order.state_changed', 'order_item.state_changed',
    'order.waiter_assigned', 'order.account_label_set'
  )
);

alter table app.order_audit_events drop constraint order_audit_entity_valid;
alter table app.order_audit_events add constraint order_audit_entity_valid check (
  (operation in ('order.created', 'order.state_changed', 'order.waiter_assigned', 'order.account_label_set') and entity_type = 'order' and entity_id = order_id)
  or (operation in ('order.item_added', 'order_item.state_changed') and entity_type = 'order_item')
);

-- 3. Mutator function: app_private.set_order_account_label
create function app_private.set_order_account_label(
  p_actor_id uuid,
  p_expected_version bigint,
  p_order_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_account_label text,
  p_audit jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_event_id uuid;
  v_device_id uuid;
  v_occurred_at timestamptz;
  v_idempotency_key text;
  v_existing app.order_audit_events%rowtype;
  v_current app.orders%rowtype;
  v_new_version bigint;
  v_result_order jsonb;
  v_audit_stored jsonb;
begin
  if p_actor_id is null or p_expected_version is null or p_expected_version < 0
    or p_order_id is null or p_restaurant_id is null or p_branch_id is null
    or (p_account_label is not null and (
      pg_catalog.char_length(p_account_label) not between 1 and 60
      or p_account_label <> pg_catalog.btrim(p_account_label)
      or p_account_label ~ '[[:cntrl:]]'
    ))
    or pg_catalog.jsonb_typeof(p_audit) <> 'object'
    or not app_private.jsonb_has_exact_keys(p_audit, array[
      'schemaVersion','eventId','idempotencyKey','restaurantId','branchId','orderId',
      'actorId','deviceId','occurredAt','operation','entityType','entityId','payload'
    ])
    or p_audit ->> 'operation' <> 'order.account_label_set'
    or p_audit ->> 'entityType' <> 'order'
    or p_audit ->> 'entityId' <> p_order_id::text
    or p_audit ->> 'orderId' <> p_order_id::text
    or p_audit ->> 'restaurantId' <> p_restaurant_id::text
    or p_audit ->> 'branchId' <> p_branch_id::text
    or p_audit ->> 'actorId' <> p_actor_id::text
    or pg_catalog.jsonb_typeof(p_audit -> 'payload') <> 'object'
    or not app_private.jsonb_has_exact_keys(p_audit -> 'payload', array['to'])
  then return pg_catalog.jsonb_build_object('status', 'conflict'); end if;

  begin
    v_event_id := (p_audit ->> 'eventId')::uuid;
    v_device_id := (p_audit ->> 'deviceId')::uuid;
    v_occurred_at := (p_audit ->> 'occurredAt')::timestamptz;
  exception when invalid_text_representation or datetime_field_overflow then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end;
  v_idempotency_key := p_audit ->> 'idempotencyKey';
  if v_idempotency_key is null or v_idempotency_key <> pg_catalog.btrim(v_idempotency_key)
    or pg_catalog.char_length(v_idempotency_key) not between 1 and 200 or v_idempotency_key ~ '[[:cntrl:]]'
  then return pg_catalog.jsonb_build_object('status', 'conflict'); end if;

  if not exists (
    select 1 from app_private.find_active_branch_membership(p_actor_id, p_restaurant_id, p_branch_id)
  ) then
    return pg_catalog.jsonb_build_object('status', 'forbidden');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('order:' || p_order_id::text, 0));

  select * into v_existing from app.order_audit_events
  where actor_id = p_actor_id and restaurant_id = p_restaurant_id and branch_id = p_branch_id
    and idempotency_key = v_idempotency_key;
  if found then
    if (v_existing.event_payload #- '{payload,from}') <> p_audit
      or v_existing.expected_order_version <> p_expected_version
      or v_existing.order_id <> p_order_id
    then
      return pg_catalog.jsonb_build_object('status', 'conflict');
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'replayed', 'version', v_existing.result_order_version, 'order', v_existing.result_order
    );
  end if;

  select * into v_current from app.orders
  where restaurant_id = p_restaurant_id and branch_id = p_branch_id and id = p_order_id
  for update;
  if not found or v_current.version <> p_expected_version
    or v_current.status not in ('draft', 'open', 'partially_paid')
  then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end if;

  if (p_audit -> 'payload' ->> 'to') is distinct from p_account_label then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end if;
  v_audit_stored := pg_catalog.jsonb_set(
    p_audit, '{payload,from}',
    case when v_current.account_label is null then 'null'::jsonb else pg_catalog.to_jsonb(v_current.account_label) end
  );

  v_new_version := v_current.version + 1;
  update app.orders set
    account_label = p_account_label,
    version = v_new_version,
    updated_at = pg_catalog.clock_timestamp(),
    updated_by = p_actor_id
  where restaurant_id = p_restaurant_id and branch_id = p_branch_id and id = p_order_id;

  v_result_order := pg_catalog.jsonb_build_object(
    'orderId', p_order_id::text,
    'restaurantId', p_restaurant_id::text,
    'branchId', p_branch_id::text,
    'accountLabel', p_account_label,
    'version', v_new_version
  );

  insert into app.order_audit_events (
    event_id, idempotency_key, restaurant_id, branch_id, order_id, actor_id, device_id,
    operation, entity_type, entity_id, expected_order_version, result_order_version,
    event_payload, result_order, occurred_at
  ) values (
    v_event_id, v_idempotency_key, p_restaurant_id, p_branch_id, p_order_id, p_actor_id, v_device_id,
    'order.account_label_set', 'order', p_order_id, p_expected_version, v_new_version,
    v_audit_stored, v_result_order, v_occurred_at
  );

  return pg_catalog.jsonb_build_object('status', 'saved', 'version', v_new_version, 'order', v_result_order);
end
$function$;

-- 4. Reader update: app_private.read_order emits accountLabel
create or replace function app_private.read_order(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid,
  p_order_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare result jsonb;
begin
  if not exists (
    select 1 from app.memberships m
    join app.membership_role_grants rg on rg.membership_id = m.id and rg.revoked_at is null
      and rg.role_code in ('owner','admin','manager','supervisor','cashier','waiter','kitchen','viewer','auditor')
    join app.restaurants r on r.id = m.restaurant_id and r.disabled_at is null
    join app.branches b on b.id = m.branch_id and b.restaurant_id = m.restaurant_id and b.disabled_at is null
    where m.user_id = p_actor_id and m.restaurant_id = p_restaurant_id and m.branch_id = p_branch_id and m.revoked_at is null
  ) then return null; end if;

  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('restaurantId', o.restaurant_id::text, 'branchId', o.branch_id::text),
    'order', o.aggregate,
    'version', o.version,
    'accountLabel', o.account_label,
    'updatedAt', pg_catalog.to_char(o.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) into result
  from app.orders o
  where o.restaurant_id = p_restaurant_id and o.branch_id = p_branch_id and o.id = p_order_id;
  return result;
end $function$;

-- 5. Reader update: app_private.list_branch_order_work_items emits accountLabel
create or replace function app_private.list_branch_order_work_items(p_actor_id uuid, p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_restaurant uuid;
  v_branch uuid;
  v_limit integer;
  v_channel text;
  v_unassigned boolean := false;
  v_after_at timestamptz;
  v_after_id uuid;
  v_rows jsonb;
  v_next jsonb;
begin
  if p_actor_id is null
    or not (
      app_private.jsonb_has_exact_keys(p_request, array['schemaVersion','scope','limit','after','channel'])
      or (app_private.jsonb_has_exact_keys(p_request,
          array['schemaVersion','scope','limit','after','channel','unassignedDeliveriesOnly'])
        and pg_catalog.jsonb_typeof(p_request -> 'unassignedDeliveriesOnly') = 'boolean'))
    or not app_private.jsonb_has_exact_keys(p_request -> 'scope', array['restaurantId','branchId'])
    or p_request -> 'schemaVersion' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_request -> 'limit') is distinct from 'number'
    or not coalesce(p_request ->> 'limit' ~ '^[1-9][0-9]*$', false)
    or (p_request -> 'after' <> 'null'::jsonb and not app_private.jsonb_has_exact_keys(
      p_request -> 'after', array['updatedAt','orderId']))
    or (p_request -> 'channel' <> 'null'::jsonb
      and not (p_request ->> 'channel' in ('table','counter','takeout','delivery')))
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;
  begin
    v_restaurant := (p_request #>> '{scope,restaurantId}')::uuid;
    v_branch := (p_request #>> '{scope,branchId}')::uuid;
    v_limit := (p_request ->> 'limit')::integer;
    v_channel := p_request ->> 'channel';
    v_unassigned := coalesce((p_request ->> 'unassignedDeliveriesOnly')::boolean, false);
    if v_unassigned then v_channel := 'delivery'; end if;
    if p_request -> 'after' <> 'null'::jsonb then
      v_after_at := (p_request #>> '{after,updatedAt}')::timestamptz;
      v_after_id := (p_request #>> '{after,orderId}')::uuid;
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range
    or datetime_field_overflow or invalid_datetime_format then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if v_restaurant is null or v_branch is null or v_limit not between 1 and 100
    or (p_request -> 'after' <> 'null'::jsonb and (
      v_after_at is null or v_after_id is null
      or p_request #>> '{after,updatedAt}' is distinct from
        pg_catalog.to_char(v_after_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  if not exists (
    select 1 from app.memberships m
    join app.branches b on b.restaurant_id=m.restaurant_id and b.id=m.branch_id
    join app.restaurants r on r.id=m.restaurant_id
    join app.membership_role_grants g on g.membership_id=m.id
    where m.user_id=p_actor_id and m.restaurant_id=v_restaurant and m.branch_id=v_branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null
      and g.revoked_at is null
      and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter','kitchen','viewer','auditor')
  ) then return pg_catalog.jsonb_build_object('status','denied'); end if;

  with page as materialized (
    select o.id, o.channel, o.status, o.version, o.created_at, o.updated_at, o.aggregate, o.account_label,
      frozen.snapshot, frozen.confirmed_at, delivery.state as delivery_state
    from app.orders o
    left join app.order_fulfillment_snapshots frozen
      on frozen.restaurant_id=o.restaurant_id and frozen.branch_id=o.branch_id and frozen.order_id=o.id
    left join app.order_deliveries delivery
      on delivery.restaurant_id=o.restaurant_id and delivery.branch_id=o.branch_id and delivery.order_id=o.id
    where o.restaurant_id=v_restaurant and o.branch_id=v_branch
      and (case when v_unassigned then o.status in ('open','partially_paid','paid')
        else o.status in ('draft','open','partially_paid') end)
      and (not v_unassigned or delivery.state = 'failed' or (delivery.state is null
        and (o.status <> 'paid' or o.created_at > pg_catalog.clock_timestamp() - interval '2 days')))
      and (v_channel is null or o.channel=v_channel)
      and (v_after_at is null or o.updated_at < v_after_at
        or (o.updated_at = v_after_at and o.id > v_after_id))
    order by o.updated_at desc, o.id
    limit v_limit + 1
  ), numbered as (
    select page.*, row_number() over (order by updated_at desc, id) as row_number from page
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'orderId', n.id::text, 'channel', n.channel, 'status', n.status, 'version', n.version,
    'accountLabel', n.account_label,
    'createdAt', pg_catalog.to_char(n.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', pg_catalog.to_char(n.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'confirmedAt', case when n.confirmed_at is null then null
      else pg_catalog.to_char(n.confirmed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'order', n.aggregate, 'snapshot', n.snapshot, 'deliveryState', n.delivery_state
  ) order by n.updated_at desc, n.id), '[]'::jsonb),
    (select pg_catalog.jsonb_build_object('updatedAt',
      pg_catalog.to_char(c.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'orderId', c.id::text) from numbered c where c.row_number=v_limit and exists (
        select 1 from numbered extra where extra.row_number=v_limit+1))
  into v_rows, v_next
  from numbered n where n.row_number<=v_limit;

  return pg_catalog.jsonb_build_object('schemaVersion',1,
    'scope',pg_catalog.jsonb_build_object('restaurantId',v_restaurant::text,'branchId',v_branch::text),
    'orders',v_rows,'next',v_next);
end
$function$;

-- 6. Reader update: app_private.list_table_board emits accountLabel
create or replace function app_private.list_table_board(
  p_actor_id uuid,
  p_restaurant_id uuid,
  p_branch_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  has_membership boolean;
  result jsonb;
begin
  if p_actor_id is null or p_restaurant_id is null or p_branch_id is null then return null; end if;

  select exists (
    select 1 from app_private.find_active_branch_membership(p_actor_id, p_restaurant_id, p_branch_id)
  ) into has_membership;
  if not has_membership then return null; end if;

  -- Never truncate silently: above the cap the caller gets an explicit limit_exceeded.
  if (
    select pg_catalog.count(*) from (
      select 1 from app.orders as orders
      where orders.restaurant_id = p_restaurant_id and orders.branch_id = p_branch_id
        and orders.table_id is not null and orders.status in ('draft', 'open', 'partially_paid')
      limit 501
    ) as capped
  ) > 500 then
    return '{"status":"limit_exceeded"}'::jsonb;
  end if;

  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'scope', pg_catalog.jsonb_build_object('restaurantId', p_restaurant_id, 'branchId', p_branch_id),
    'orders', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'tableId', bounded_order.table_id,
      'orderId', bounded_order.id,
      'status', bounded_order.status,
      'version', bounded_order.version,
      'waiterUserId', bounded_order.waiter_user_id,
      'accountLabel', bounded_order.account_label,
      'openedAt', pg_catalog.to_char(bounded_order.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) order by bounded_order.table_id, bounded_order.created_at, bounded_order.id), '[]'::jsonb)
  ) into result
  from (
    select orders.table_id, orders.id, orders.status, orders.version, orders.waiter_user_id, orders.account_label, orders.created_at
    from app.orders as orders
    where orders.restaurant_id = p_restaurant_id
      and orders.branch_id = p_branch_id
      and orders.table_id is not null
      and orders.status in ('draft', 'open', 'partially_paid')
    order by orders.table_id, orders.created_at, orders.id
    limit 500
  ) as bounded_order;

  return result;
end
$function$;

-- 7. Roles, grants and comments
do $owner$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname='postgres' and rolbypassrls)
    or not exists (select 1 from pg_catalog.pg_roles where rolname='app_api'
      and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolinherit and not rolreplication and not rolbypassrls)
  then raise exception using errcode='55000', message='APP_API_ROLE_REJECTED'; end if;
end
$owner$;

alter function app_private.set_order_account_label(uuid,bigint,uuid,uuid,uuid,text,jsonb) owner to postgres;
revoke all on function app_private.set_order_account_label(uuid,bigint,uuid,uuid,uuid,text,jsonb)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.set_order_account_label(uuid,bigint,uuid,uuid,uuid,text,jsonb) to app_api;
comment on function app_private.set_order_account_label(uuid,bigint,uuid,uuid,uuid,text,jsonb) is
  'Server-only: sets or clears the optional account_label of an order with CAS version check and full audit.';

alter function app_private.read_order(uuid,uuid,uuid,uuid) owner to postgres;
revoke all on function app_private.read_order(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.read_order(uuid,uuid,uuid,uuid) to app_api;

alter function app_private.list_branch_order_work_items(uuid,jsonb) owner to postgres;
revoke all on function app_private.list_branch_order_work_items(uuid,jsonb) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.list_branch_order_work_items(uuid,jsonb) to app_api;

alter function app_private.list_table_board(uuid,uuid,uuid) owner to postgres;
revoke all on function app_private.list_table_board(uuid,uuid,uuid) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.list_table_board(uuid,uuid,uuid) to app_api;

commit;
