begin;

create table app.capture_repeat_order_plans (
  restaurant_id uuid not null,
  branch_id uuid not null,
  capture_draft_id uuid not null,
  customer_id uuid not null,
  source_order_id uuid not null,
  catalog_id uuid not null,
  applied_capture_version bigint not null,
  selection_plan jsonb not null,
  updated_at timestamptz not null,
  updated_by uuid not null references auth.users (id) on delete restrict,
  constraint capture_repeat_order_plans_pk primary key (restaurant_id,branch_id,capture_draft_id),
  constraint capture_repeat_order_plans_capture_fk foreign key (restaurant_id,branch_id,capture_draft_id)
    references app.capture_drafts (restaurant_id,branch_id,id) on delete restrict,
  constraint capture_repeat_order_plans_customer_fk foreign key (restaurant_id,customer_id)
    references app.customers (restaurant_id,id) on delete restrict,
  constraint capture_repeat_order_plans_source_order_fk foreign key (restaurant_id,branch_id,source_order_id)
    references app.orders (restaurant_id,branch_id,id) on delete restrict,
  constraint capture_repeat_order_plans_catalog_fk foreign key (restaurant_id,catalog_id)
    references app.menu_catalogs (restaurant_id,id) on delete restrict,
  constraint capture_repeat_order_plans_version_valid check (
    applied_capture_version between 2 and 9007199254740991
  ),
  constraint capture_repeat_order_plans_payload_valid check (
    pg_catalog.jsonb_typeof(selection_plan)='object'
    and selection_plan->>'schemaVersion'='1'
    and selection_plan->>'customerId'=customer_id::text
    and selection_plan->>'sourceOrderId'=source_order_id::text
    and selection_plan->>'catalogVersion'=catalog_id::text
    and case when pg_catalog.jsonb_typeof(selection_plan->'lines')='array'
      then pg_catalog.jsonb_array_length(selection_plan->'lines') between 1 and 200 else false end
  )
);

alter table app.capture_repeat_order_plans enable row level security;
alter table app.capture_repeat_order_plans force row level security;
revoke all on app.capture_repeat_order_plans from public,anon,authenticated,service_role,app_api;

create function app_private.clear_capture_repeat_order_plan_for_context()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.status is distinct from 'draft' or new.customer_id is distinct from old.customer_id then
    delete from app.capture_repeat_order_plans
    where restaurant_id=new.restaurant_id and branch_id=new.branch_id and capture_draft_id=new.id;
  end if;
  return new;
end
$function$;

create trigger capture_drafts_clear_repeat_order_plan_for_context
after update of status,customer_id on app.capture_drafts
for each row execute function app_private.clear_capture_repeat_order_plan_for_context();

alter table app.capture_command_events drop constraint capture_events_operation_valid;
alter table app.capture_command_events add constraint capture_events_operation_valid check (operation in (
  'capture.created','capture.autosaved','capture.held','capture.claimed','capture.resumed','capture.transferred',
  'capture.confirmed','capture.no_sale','capture.recovery_preference_changed','capture.taken_over',
  'capture.customer_changed','capture.fulfillment_changed','capture.delivery_instructions_changed',
  'capture.order_repeated'
));

create function app_private.repeat_customer_order_into_capture(
  p_actor_id uuid,
  p_command jsonb,
  p_plan jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  restaurant uuid; branch uuid; capture uuid; customer uuid; source_order uuid; catalog uuid;
  event uuid; device uuid; lease uuid; member uuid; catalog_head_id uuid;
  expected bigint; occurred timestamptz; observed timestamptz; fingerprint text;
  current_capture app.capture_drafts%rowtype; stored app.capture_command_events%rowtype;
  result_record jsonb; source_aggregate jsonb;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_command,array[
      'schemaVersion','scope','customerId','sourceOrderId','captureDraftId','expectedVersion',
      'attentionLeaseId','eventId','idempotencyKey','deviceId','occurredAt'
    ])
    or not app_private.jsonb_has_exact_keys(p_command->'scope',array['restaurantId','branchId'])
    or p_command->'schemaVersion' is distinct from '1'::jsonb
    or not coalesce(p_command->>'expectedVersion' ~ '^[1-9][0-9]*$',false)
    or not coalesce(p_command->>'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
    or not app_private.jsonb_has_exact_keys(p_plan,array[
      'schemaVersion','customerId','sourceOrderId','catalogVersion','lines'
    ])
    or p_plan->'schemaVersion' is distinct from '1'::jsonb
    or not (case when pg_catalog.jsonb_typeof(p_plan->'lines')='array'
      then pg_catalog.jsonb_array_length(p_plan->'lines') between 1 and 200 else false end)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    where not app_private.jsonb_has_exact_keys(line.value,array[
      'sourceOrderItemId','productId','quantity','modifierGroups'
    ])
      or not coalesce(line.value->>'sourceOrderItemId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
      or not coalesce(line.value->>'productId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
      or not (case when coalesce(line.value->>'quantity' ~ '^[1-9][0-9]*$',false)
        then (line.value->>'quantity')::numeric<=1000000 else false end)
      or not (case when pg_catalog.jsonb_typeof(line.value->'modifierGroups')='array'
        then pg_catalog.jsonb_array_length(line.value->'modifierGroups')<=200 else false end)
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    cross join lateral pg_catalog.jsonb_array_elements(case
      when pg_catalog.jsonb_typeof(line.value->'modifierGroups')='array'
      then line.value->'modifierGroups' else '[]'::jsonb end) modifier_group(value)
    where not app_private.jsonb_has_exact_keys(modifier_group.value,array['groupId','selections'])
      or not coalesce(modifier_group.value->>'groupId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
      or not (case when pg_catalog.jsonb_typeof(modifier_group.value->'selections')='array'
        then pg_catalog.jsonb_array_length(modifier_group.value->'selections')<=1000 else false end)
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    cross join lateral pg_catalog.jsonb_array_elements(case
      when pg_catalog.jsonb_typeof(line.value->'modifierGroups')='array'
      then line.value->'modifierGroups' else '[]'::jsonb end) modifier_group(value)
    cross join lateral pg_catalog.jsonb_array_elements(case
      when pg_catalog.jsonb_typeof(modifier_group.value->'selections')='array'
      then modifier_group.value->'selections' else '[]'::jsonb end) selection(value)
    where not app_private.jsonb_has_exact_keys(selection.value,array['optionId','quantity'])
      or not coalesce(selection.value->>'optionId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
      or not (case when coalesce(selection.value->>'quantity' ~ '^[1-9][0-9]*$',false)
        then (selection.value->>'quantity')::numeric<=1000 else false end)
  ) or exists (
    select line.value->>'sourceOrderItemId'
    from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    group by line.value->>'sourceOrderItemId' having pg_catalog.count(*)<>1
  ) or exists (
    select line.value->>'sourceOrderItemId',modifier_group.value->>'groupId'
    from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    cross join lateral pg_catalog.jsonb_array_elements(case
      when pg_catalog.jsonb_typeof(line.value->'modifierGroups')='array'
      then line.value->'modifierGroups' else '[]'::jsonb end) modifier_group(value)
    group by line.value->>'sourceOrderItemId',modifier_group.value->>'groupId' having pg_catalog.count(*)<>1
  ) or exists (
    select line.value->>'sourceOrderItemId',modifier_group.value->>'groupId',selection.value->>'optionId'
    from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    cross join lateral pg_catalog.jsonb_array_elements(case
      when pg_catalog.jsonb_typeof(line.value->'modifierGroups')='array'
      then line.value->'modifierGroups' else '[]'::jsonb end) modifier_group(value)
    cross join lateral pg_catalog.jsonb_array_elements(case
      when pg_catalog.jsonb_typeof(modifier_group.value->'selections')='array'
      then modifier_group.value->'selections' else '[]'::jsonb end) selection(value)
    group by line.value->>'sourceOrderItemId',modifier_group.value->>'groupId',selection.value->>'optionId'
    having pg_catalog.count(*)<>1
  ) then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  begin
    restaurant:=(p_command#>>'{scope,restaurantId}')::uuid;
    branch:=(p_command#>>'{scope,branchId}')::uuid;
    capture:=(p_command->>'captureDraftId')::uuid;
    customer:=(p_command->>'customerId')::uuid;
    source_order:=(p_command->>'sourceOrderId')::uuid;
    catalog:=(p_plan->>'catalogVersion')::uuid;
    event:=(p_command->>'eventId')::uuid;
    device:=(p_command->>'deviceId')::uuid;
    lease:=(p_command->>'attentionLeaseId')::uuid;
    expected:=(p_command->>'expectedVersion')::bigint;
    occurred:=(p_command->>'occurredAt')::timestamptz;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or capture is null or customer is null or source_order is null
    or catalog is null or event is null or device is null or lease is null
    or expected not between 1 and 9007199254740990 or occurred is null
    or p_command#>>'{scope,restaurantId}' is distinct from restaurant::text
    or p_command#>>'{scope,branchId}' is distinct from branch::text
    or p_command->>'customerId' is distinct from customer::text
    or p_command->>'sourceOrderId' is distinct from source_order::text
    or p_plan->>'customerId' is distinct from customer::text
    or p_plan->>'sourceOrderId' is distinct from source_order::text
    or p_plan->>'catalogVersion' is distinct from catalog::text
    or p_command->>'occurredAt' is distinct from pg_catalog.to_char(occurred at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  select m.id into member
  from app.memberships m
  join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
  join app.restaurants r on r.id=m.restaurant_id
  join app.membership_role_grants g on g.membership_id=m.id
  where m.user_id=p_actor_id and m.restaurant_id=restaurant and m.branch_id=branch
    and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null and g.revoked_at is null
    and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
  order by g.role_code limit 1 for share of m,b,r,g;
  if member is null then return pg_catalog.jsonb_build_object('status','denied'); end if;

  fingerprint:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'capture.order_repeated:'||p_command::text||':'||p_plan::text||':'||p_actor_id::text,'UTF8'
  )),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'capture-command:'||p_actor_id::text||':'||restaurant::text||':'||branch::text||':'||(p_command->>'idempotencyKey'),0
  ));
  select * into stored from app.capture_command_events
  where actor_id=p_actor_id and restaurant_id=restaurant and branch_id=branch
    and idempotency_key=p_command->>'idempotencyKey';
  if found then
    if stored.operation<>'capture.order_repeated' or stored.command_fingerprint<>fingerprint then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;
    return pg_catalog.jsonb_build_object('status','replayed','record',stored.result_capture);
  end if;
  if exists (select 1 from app.capture_command_events where event_id=event) then
    return pg_catalog.jsonb_build_object('status','conflict');
  end if;

  select * into current_capture from app.capture_drafts
  where restaurant_id=restaurant and branch_id=branch and id=capture for update;
  observed:=greatest(pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp()),current_capture.updated_at);
  if not found or current_capture.version<>expected or current_capture.status<>'draft'
    or current_capture.attention_status<>'claimed' or current_capture.owner_membership_id is distinct from member
    or current_capture.attention_lease_id is distinct from lease or current_capture.attention_lease_expires_at<=observed
    or current_capture.customer_id is distinct from customer or current_capture.customer_snapshot_id is null
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  select recent.aggregate into source_aggregate from (
    select o.aggregate,frozen.order_id
    from app.order_fulfillment_snapshots frozen
    join app.orders o on o.restaurant_id=frozen.restaurant_id and o.branch_id=frozen.branch_id and o.id=frozen.order_id
    where frozen.restaurant_id=restaurant and frozen.branch_id=branch and frozen.customer_id=customer
    order by frozen.confirmed_at desc,frozen.order_id desc limit 20
  ) recent where recent.order_id=source_order;
  if not found then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  if pg_catalog.jsonb_typeof(source_aggregate->'items') is distinct from 'array' then
    return pg_catalog.jsonb_build_object('status','conflict');
  end if;

  select head.catalog_id into catalog_head_id from app.menu_catalog_heads head
  where head.restaurant_id=restaurant for share;
  if catalog_head_id is distinct from catalog then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    where not exists (
      select 1 from pg_catalog.jsonb_array_elements(source_aggregate->'items') historical(value)
      where historical.value->>'orderItemId'=line.value->>'sourceOrderItemId'
        and historical.value#>>'{snapshot,productId}'=line.value->>'productId'
        and historical.value->>'quantity'=line.value->>'quantity'
        and historical.value->>'status'<>'cancelled'
    )
      or not exists (
        select 1 from app.menu_products product
        join app.menu_categories category on category.restaurant_id=product.restaurant_id
          and category.catalog_id=product.catalog_id and category.id=product.category_id
        where product.restaurant_id=restaurant and product.catalog_id=catalog
          and product.id=(line.value->>'productId')::uuid and product.active and category.active
      )
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    join app.menu_modifier_groups catalog_group on catalog_group.restaurant_id=restaurant
      and catalog_group.catalog_id=catalog and catalog_group.product_id=(line.value->>'productId')::uuid
    where not exists (
      select 1 from pg_catalog.jsonb_array_elements(line.value->'modifierGroups') requested_group(value)
      where requested_group.value->>'groupId'=catalog_group.id::text
    )
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    cross join lateral pg_catalog.jsonb_array_elements(line.value->'modifierGroups') requested_group(value)
    left join app.menu_modifier_groups catalog_group on catalog_group.restaurant_id=restaurant
      and catalog_group.catalog_id=catalog and catalog_group.product_id=(line.value->>'productId')::uuid
      and catalog_group.id=(requested_group.value->>'groupId')::uuid
    where catalog_group.id is null or not catalog_group.active
      or (select coalesce(pg_catalog.sum((selection.value->>'quantity')::integer),0)
          from pg_catalog.jsonb_array_elements(requested_group.value->'selections') selection(value))
        not between catalog_group.minimum_quantity and catalog_group.maximum_quantity
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    cross join lateral pg_catalog.jsonb_array_elements(line.value->'modifierGroups') requested_group(value)
    cross join lateral pg_catalog.jsonb_array_elements(requested_group.value->'selections') selection(value)
    left join app.menu_modifier_options option on option.restaurant_id=restaurant and option.catalog_id=catalog
      and option.group_id=(requested_group.value->>'groupId')::uuid and option.id=(selection.value->>'optionId')::uuid
    where option.id is null or not option.active
      or (option.maximum_quantity is not null and (selection.value->>'quantity')::integer>option.maximum_quantity)
  ) then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  select result_capture into result_record from app.capture_command_events
  where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture and result_version=expected;
  if not found then raise exception using errcode='55000',message='CAPTURE_JOURNAL_CURRENT_VERSION_MISSING'; end if;
  result_record:=pg_catalog.jsonb_set(result_record,'{detail}',(result_record->'detail')||pg_catalog.jsonb_build_object(
    'version',expected+1,
    'updatedAt',pg_catalog.to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ));

  insert into app.capture_repeat_order_plans(
    restaurant_id,branch_id,capture_draft_id,customer_id,source_order_id,catalog_id,
    applied_capture_version,selection_plan,updated_at,updated_by
  ) values (
    restaurant,branch,capture,customer,source_order,catalog,expected+1,p_plan,observed,p_actor_id
  ) on conflict (restaurant_id,branch_id,capture_draft_id) do update set
    customer_id=excluded.customer_id,source_order_id=excluded.source_order_id,catalog_id=excluded.catalog_id,
    applied_capture_version=excluded.applied_capture_version,selection_plan=excluded.selection_plan,
    updated_at=excluded.updated_at,updated_by=excluded.updated_by;

  update app.capture_drafts set version=expected+1,updated_at=observed,updated_by=p_actor_id
  where restaurant_id=restaurant and branch_id=branch and id=capture and version=expected;
  if not found then raise exception using errcode='40001',message='CAPTURE_REPEAT_ORDER_LOST_UPDATE'; end if;
  insert into app.capture_command_events(
    event_id,restaurant_id,branch_id,capture_draft_id,actor_id,actor_membership_id,device_id,operation,
    idempotency_key,command_fingerprint,expected_version,result_version,result_capture,occurred_at,received_at
  ) values (
    event,restaurant,branch,capture,p_actor_id,member,device,'capture.order_repeated',p_command->>'idempotencyKey',
    fingerprint,expected,expected+1,result_record,occurred,observed
  );
  return pg_catalog.jsonb_build_object('status','applied','record',result_record);
end
$function$;

alter function app_private.repeat_customer_order_into_capture(uuid,jsonb,jsonb) owner to postgres;
revoke all on function app_private.repeat_customer_order_into_capture(uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.repeat_customer_order_into_capture(uuid,jsonb,jsonb) to app_api;

alter function app_private.clear_capture_repeat_order_plan_for_context() owner to postgres;
revoke all on function app_private.clear_capture_repeat_order_plan_for_context()
  from public,anon,authenticated,service_role,app_api;

comment on table app.capture_repeat_order_plans is
  'Current Capture-owned product selections reconstructed from a recent Customer Order; contains IDs and quantities only, never sale prices.';
comment on function app_private.repeat_customer_order_into_capture(uuid,jsonb,jsonb) is
  'Atomically replaces one claimed Capture repeat plan after recent-order, customer, catalog, lease and CAS revalidation.';
comment on function app_private.clear_capture_repeat_order_plan_for_context() is
  'Clears a repeat plan whenever its Capture changes customer or leaves draft status.';

commit;
