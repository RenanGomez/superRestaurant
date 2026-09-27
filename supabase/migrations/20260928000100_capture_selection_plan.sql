begin;

-- Generalizes app.capture_repeat_order_plans to hold either a repeat-order
-- plan (unchanged shape) or a catalog-derived selection plan
-- (CaptureSelectionPlanV1). Both kinds share the same single-row-per-capture
-- primary key, so replacing one with the other is inherently exclusive.

alter table app.capture_repeat_order_plans
  add column plan_kind text not null default 'repeat' check (plan_kind in ('repeat','selection')),
  alter column customer_id drop not null,
  alter column source_order_id drop not null;

alter table app.capture_repeat_order_plans drop constraint capture_repeat_order_plans_payload_valid;
alter table app.capture_repeat_order_plans add constraint capture_repeat_order_plans_payload_valid check (
  case plan_kind
    when 'repeat' then
      customer_id is not null and source_order_id is not null
      and pg_catalog.jsonb_typeof(selection_plan)='object'
      and selection_plan->>'schemaVersion'='1'
      and selection_plan->>'customerId'=customer_id::text
      and selection_plan->>'sourceOrderId'=source_order_id::text
      and selection_plan->>'catalogVersion'=catalog_id::text
      and case when pg_catalog.jsonb_typeof(selection_plan->'lines')='array'
        then pg_catalog.jsonb_array_length(selection_plan->'lines') between 1 and 200 else false end
    when 'selection' then
      customer_id is null and source_order_id is null
      and pg_catalog.jsonb_typeof(selection_plan)='object'
      and selection_plan->>'schemaVersion'='1'
      and selection_plan->>'catalogVersion'=catalog_id::text
      and case when pg_catalog.jsonb_typeof(selection_plan->'lines')='array'
        then pg_catalog.jsonb_array_length(selection_plan->'lines') between 0 and 200 else false end
    else false
  end
);

alter table app.capture_command_events drop constraint capture_events_operation_valid;
alter table app.capture_command_events add constraint capture_events_operation_valid check (operation in (
  'capture.created','capture.autosaved','capture.held','capture.claimed','capture.resumed','capture.transferred',
  'capture.confirmed','capture.no_sale','capture.recovery_preference_changed','capture.taken_over',
  'capture.customer_changed','capture.fulfillment_changed','capture.delivery_instructions_changed',
  'capture.order_repeated','capture.selection_replaced'
));

comment on column app.capture_repeat_order_plans.plan_kind is
  'Discriminates whether selection_plan holds a repeat-order plan (customer/source order derived) or a catalog selection plan (CaptureSelectionPlanV1); exactly one plan of either kind lives per capture row.';

-- A repeat-order plan is derived from the Customer; changing the Customer must invalidate
-- it. A catalog selection plan carries no Customer dependency at all, so it must survive a
-- customer change untouched. Leaving draft status still clears either kind: a confirmed,
-- no-sale or reopened capture has no business keeping either plan attached.
drop trigger capture_drafts_clear_repeat_order_plan_for_context on app.capture_drafts;
drop function app_private.clear_capture_repeat_order_plan_for_context();

create function app_private.clear_capture_repeat_order_plan_for_context()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.status is distinct from 'draft' then
    delete from app.capture_repeat_order_plans
    where restaurant_id=new.restaurant_id and branch_id=new.branch_id and capture_draft_id=new.id;
  elsif new.customer_id is distinct from old.customer_id then
    delete from app.capture_repeat_order_plans
    where restaurant_id=new.restaurant_id and branch_id=new.branch_id and capture_draft_id=new.id
      and plan_kind='repeat';
  end if;
  return new;
end
$function$;

create trigger capture_drafts_clear_repeat_order_plan_for_context
after update of status,customer_id on app.capture_drafts
for each row execute function app_private.clear_capture_repeat_order_plan_for_context();

alter function app_private.clear_capture_repeat_order_plan_for_context() owner to postgres;
revoke all on function app_private.clear_capture_repeat_order_plan_for_context()
  from public,anon,authenticated,service_role,app_api;

comment on function app_private.clear_capture_repeat_order_plan_for_context() is
  'Clears any stored capture plan when the draft leaves draft status; a repeat-order plan is additionally cleared on a customer change, since it is derived from that Customer -- a catalog selection plan has no such dependency and survives.';

-- Repeats capture.order_repeated: fixes plan_kind='repeat' (and nulls the selection-only
-- columns this migration does not use for this kind) on every insert/update, so a prior
-- 'selection' row is correctly converted instead of violating capture_repeat_order_plans_payload_valid.
create or replace function app_private.repeat_customer_order_into_capture(
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
    restaurant_id,branch_id,capture_draft_id,plan_kind,customer_id,source_order_id,catalog_id,
    applied_capture_version,selection_plan,updated_at,updated_by
  ) values (
    restaurant,branch,capture,'repeat',customer,source_order,catalog,expected+1,p_plan,observed,p_actor_id
  ) on conflict (restaurant_id,branch_id,capture_draft_id) do update set
    plan_kind='repeat',customer_id=excluded.customer_id,source_order_id=excluded.source_order_id,
    catalog_id=excluded.catalog_id,applied_capture_version=excluded.applied_capture_version,
    selection_plan=excluded.selection_plan,updated_at=excluded.updated_at,updated_by=excluded.updated_by;

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

comment on function app_private.repeat_customer_order_into_capture(uuid,jsonb,jsonb) is
  'Atomically replaces one claimed Capture repeat plan after recent-order, customer, catalog, lease and CAS revalidation; fixes plan_kind=''repeat'' so a prior selection plan is correctly converted.';


-- Replaces the entire catalog-derived selection plan attached to a claimed
-- Capture draft. Mirrors repeat_customer_order_into_capture's scope,
-- membership, lease, CAS and idempotency discipline; unlike that function it
-- does not itself revalidate catalog contents against inactive products or
-- option limits -- that revalidation happens where the plan is priced
-- (confirm, and the API layer that quotes the workspace projection), exactly
-- as the pure-ids/quantities contract requires.
create function app_private.replace_capture_selection_plan(
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
  restaurant uuid; branch uuid; capture uuid; catalog uuid;
  event uuid; device uuid; lease uuid; member uuid;
  expected bigint; occurred timestamptz; observed timestamptz; fingerprint text;
  current_capture app.capture_drafts%rowtype; stored app.capture_command_events%rowtype;
  result_record jsonb;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_command,array[
      'schemaVersion','scope','captureDraftId','expectedVersion',
      'attentionLeaseId','eventId','idempotencyKey','deviceId','occurredAt'
    ]) -- keep in sync with parseReplaceCaptureSelectionPlanCommandV1's exact-key contract
    or not app_private.jsonb_has_exact_keys(p_command->'scope',array['restaurantId','branchId'])
    or p_command->'schemaVersion' is distinct from '1'::jsonb
    or not coalesce(p_command->>'expectedVersion' ~ '^[1-9][0-9]*$',false)
    or not coalesce(p_command->>'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
    or not app_private.jsonb_has_exact_keys(p_plan,array['schemaVersion','catalogVersion','lines'])
    or p_plan->'schemaVersion' is distinct from '1'::jsonb
    or not coalesce(p_plan->>'catalogVersion' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
    or not (case when pg_catalog.jsonb_typeof(p_plan->'lines')='array'
      then pg_catalog.jsonb_array_length(p_plan->'lines') between 0 and 200 else false end)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    where not app_private.jsonb_has_exact_keys(
        line.value,array['lineId','productId','variantId','quantity','modifierGroups','note']
      )
      or not coalesce(line.value->>'lineId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
      or not coalesce(line.value->>'productId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
      or not (
        pg_catalog.jsonb_typeof(line.value->'variantId')='null'
        or coalesce(line.value->>'variantId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
      )
      or not (case when coalesce(line.value->>'quantity' ~ '^[1-9][0-9]*$',false)
        then (line.value->>'quantity')::numeric<=1000 else false end)
      or not (case when pg_catalog.jsonb_typeof(line.value->'modifierGroups')='array'
        then pg_catalog.jsonb_array_length(line.value->'modifierGroups') between 0 and 50 else false end)
      or not (
        pg_catalog.jsonb_typeof(line.value->'note')='null'
        or (
          pg_catalog.jsonb_typeof(line.value->'note')='string'
          and pg_catalog.char_length(line.value->>'note') between 1 and 200
        )
      )
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    cross join lateral pg_catalog.jsonb_array_elements(line.value->'modifierGroups') modifier_group(value)
    where not app_private.jsonb_has_exact_keys(modifier_group.value,array['groupId','selections'])
      or not coalesce(modifier_group.value->>'groupId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
      or not (case when pg_catalog.jsonb_typeof(modifier_group.value->'selections')='array'
        then pg_catalog.jsonb_array_length(modifier_group.value->'selections') between 0 and 50 else false end)
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    cross join lateral pg_catalog.jsonb_array_elements(line.value->'modifierGroups') modifier_group(value)
    cross join lateral pg_catalog.jsonb_array_elements(modifier_group.value->'selections') selection(value)
    where not app_private.jsonb_has_exact_keys(selection.value,array['optionId','quantity'])
      or not coalesce(selection.value->>'optionId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
      or not (case when coalesce(selection.value->>'quantity' ~ '^[1-9][0-9]*$',false)
        then (selection.value->>'quantity')::numeric<=100 else false end)
  ) or exists (
    select line.value->>'lineId'
    from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    group by line.value->>'lineId' having pg_catalog.count(*)<>1
  ) or exists (
    select line.value->>'lineId',modifier_group.value->>'groupId'
    from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    cross join lateral pg_catalog.jsonb_array_elements(line.value->'modifierGroups') modifier_group(value)
    group by line.value->>'lineId',modifier_group.value->>'groupId' having pg_catalog.count(*)<>1
  ) or exists (
    select line.value->>'lineId',modifier_group.value->>'groupId',selection.value->>'optionId'
    from pg_catalog.jsonb_array_elements(p_plan->'lines') line(value)
    cross join lateral pg_catalog.jsonb_array_elements(line.value->'modifierGroups') modifier_group(value)
    cross join lateral pg_catalog.jsonb_array_elements(modifier_group.value->'selections') selection(value)
    group by line.value->>'lineId',modifier_group.value->>'groupId',selection.value->>'optionId'
    having pg_catalog.count(*)<>1
  ) then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  begin
    restaurant:=(p_command#>>'{scope,restaurantId}')::uuid;
    branch:=(p_command#>>'{scope,branchId}')::uuid;
    capture:=(p_command->>'captureDraftId')::uuid;
    catalog:=(p_plan->>'catalogVersion')::uuid;
    event:=(p_command->>'eventId')::uuid;
    device:=(p_command->>'deviceId')::uuid;
    lease:=(p_command->>'attentionLeaseId')::uuid;
    expected:=(p_command->>'expectedVersion')::bigint;
    occurred:=(p_command->>'occurredAt')::timestamptz;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or capture is null or catalog is null
    or event is null or device is null or lease is null
    or expected not between 1 and 9007199254740990 or occurred is null
    or p_command#>>'{scope,restaurantId}' is distinct from restaurant::text
    or p_command#>>'{scope,branchId}' is distinct from branch::text
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
    'capture.selection_replaced:'||p_command::text||':'||p_plan::text||':'||p_actor_id::text,'UTF8'
  )),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'capture-command:'||p_actor_id::text||':'||restaurant::text||':'||branch::text||':'||(p_command->>'idempotencyKey'),0
  ));
  select * into stored from app.capture_command_events
  where actor_id=p_actor_id and restaurant_id=restaurant and branch_id=branch
    and idempotency_key=p_command->>'idempotencyKey';
  if found then
    if stored.operation<>'capture.selection_replaced' or stored.command_fingerprint<>fingerprint then
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
  then return pg_catalog.jsonb_build_object('status','conflict'); end if;

  select result_capture into result_record from app.capture_command_events
  where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture and result_version=expected;
  if not found then raise exception using errcode='55000',message='CAPTURE_JOURNAL_CURRENT_VERSION_MISSING'; end if;
  result_record:=pg_catalog.jsonb_set(result_record,'{detail}',(result_record->'detail')||pg_catalog.jsonb_build_object(
    'version',expected+1,
    'updatedAt',pg_catalog.to_char(observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ));

  -- A single row per capture makes the repeat/selection plans mutually
  -- exclusive by construction: replacing one with the other overwrites
  -- whatever was stored, and the audit event below is the record of it.
  -- Zero lines means "no plan": delete the row (still audited by the command
  -- event below) instead of persisting an empty selection that
  -- materializeCaptureSelectionOrder/read_capture_workspace_v4 would then
  -- have to special-case; confirm falls back to the no-lines order route.
  if pg_catalog.jsonb_array_length(p_plan->'lines')=0 then
    delete from app.capture_repeat_order_plans
    where restaurant_id=restaurant and branch_id=branch and capture_draft_id=capture;
  else
    insert into app.capture_repeat_order_plans(
      restaurant_id,branch_id,capture_draft_id,plan_kind,customer_id,source_order_id,catalog_id,
      applied_capture_version,selection_plan,updated_at,updated_by
    ) values (
      restaurant,branch,capture,'selection',null,null,catalog,expected+1,p_plan,observed,p_actor_id
    ) on conflict (restaurant_id,branch_id,capture_draft_id) do update set
      plan_kind='selection',customer_id=null,source_order_id=null,catalog_id=excluded.catalog_id,
      applied_capture_version=excluded.applied_capture_version,selection_plan=excluded.selection_plan,
      updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  end if;

  update app.capture_drafts set version=expected+1,updated_at=observed,updated_by=p_actor_id
  where restaurant_id=restaurant and branch_id=branch and id=capture and version=expected;
  if not found then raise exception using errcode='40001',message='CAPTURE_SELECTION_PLAN_LOST_UPDATE'; end if;
  insert into app.capture_command_events(
    event_id,restaurant_id,branch_id,capture_draft_id,actor_id,actor_membership_id,device_id,operation,
    idempotency_key,command_fingerprint,expected_version,result_version,result_capture,occurred_at,received_at
  ) values (
    event,restaurant,branch,capture,p_actor_id,member,device,'capture.selection_replaced',p_command->>'idempotencyKey',
    fingerprint,expected,expected+1,result_record,occurred,observed
  );
  return pg_catalog.jsonb_build_object('status','applied','record',result_record);
end
$function$;

alter function app_private.replace_capture_selection_plan(uuid,jsonb,jsonb) owner to postgres;
revoke all on function app_private.replace_capture_selection_plan(uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.replace_capture_selection_plan(uuid,jsonb,jsonb) to app_api;

comment on function app_private.replace_capture_selection_plan(uuid,jsonb,jsonb) is
  'Atomically replaces one claimed Capture selection plan (catalog-derived lines, no prices) after lease/CAS revalidation; excludes any prior repeat plan by construction.';

-- Read-only idempotency probe for replace_capture_selection_plan: recognizes a replay purely
-- from actor+scope+idempotencyKey+fingerprint, before any catalog/pricing validation is
-- attempted by the caller. Mirrors confirm_capture_draft_v3's null-payload probe pattern
-- (called with p_order=null): the caller uses this first so a catalog change or a
-- since-superseded plan between the original apply and this retry never turns a legitimate
-- replay into a spurious rejection or a comparison against stale command data.
create function app_private.probe_capture_selection_plan_replace(
  p_actor_id uuid,
  p_command jsonb,
  p_plan jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  restaurant uuid; branch uuid; capture uuid; catalog uuid;
  event uuid; device uuid; lease uuid;
  expected bigint; occurred timestamptz; fingerprint text;
  stored app.capture_command_events%rowtype;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_command,array[
      'schemaVersion','scope','captureDraftId','expectedVersion',
      'attentionLeaseId','eventId','idempotencyKey','deviceId','occurredAt'
    ])
    or not app_private.jsonb_has_exact_keys(p_command->'scope',array['restaurantId','branchId'])
    or p_command->'schemaVersion' is distinct from '1'::jsonb
    or not coalesce(p_command->>'expectedVersion' ~ '^[1-9][0-9]*$',false)
    or not coalesce(p_command->>'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
    or not app_private.jsonb_has_exact_keys(p_plan,array['schemaVersion','catalogVersion','lines'])
    or p_plan->'schemaVersion' is distinct from '1'::jsonb
    or not coalesce(p_plan->>'catalogVersion' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
    or not (case when pg_catalog.jsonb_typeof(p_plan->'lines')='array'
      then pg_catalog.jsonb_array_length(p_plan->'lines') between 0 and 200 else false end)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  begin
    restaurant:=(p_command#>>'{scope,restaurantId}')::uuid;
    branch:=(p_command#>>'{scope,branchId}')::uuid;
    capture:=(p_command->>'captureDraftId')::uuid;
    catalog:=(p_plan->>'catalogVersion')::uuid;
    event:=(p_command->>'eventId')::uuid;
    device:=(p_command->>'deviceId')::uuid;
    lease:=(p_command->>'attentionLeaseId')::uuid;
    expected:=(p_command->>'expectedVersion')::bigint;
    occurred:=(p_command->>'occurredAt')::timestamptz;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or capture is null or catalog is null
    or event is null or device is null or lease is null
    or expected not between 1 and 9007199254740990 or occurred is null
    or p_command#>>'{scope,restaurantId}' is distinct from restaurant::text
    or p_command#>>'{scope,branchId}' is distinct from branch::text
    or p_command->>'occurredAt' is distinct from pg_catalog.to_char(occurred at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  if not exists (
    select 1
    from app.memberships m
    join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
    join app.restaurants r on r.id=m.restaurant_id
    join app.membership_role_grants g on g.membership_id=m.id
    where m.user_id=p_actor_id and m.restaurant_id=restaurant and m.branch_id=branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null and g.revoked_at is null
      and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
  ) then return pg_catalog.jsonb_build_object('status','denied'); end if;

  fingerprint:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'capture.selection_replaced:'||p_command::text||':'||p_plan::text||':'||p_actor_id::text,'UTF8'
  )),'hex');
  select * into stored from app.capture_command_events
  where actor_id=p_actor_id and restaurant_id=restaurant and branch_id=branch
    and idempotency_key=p_command->>'idempotencyKey';
  if found then
    if stored.operation<>'capture.selection_replaced' or stored.command_fingerprint<>fingerprint then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;
    return pg_catalog.jsonb_build_object('status','replayed','record',stored.result_capture);
  end if;
  return pg_catalog.jsonb_build_object('status','pending');
end
$function$;

alter function app_private.probe_capture_selection_plan_replace(uuid,jsonb,jsonb) owner to postgres;
revoke all on function app_private.probe_capture_selection_plan_replace(uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.probe_capture_selection_plan_replace(uuid,jsonb,jsonb) to app_api;

comment on function app_private.probe_capture_selection_plan_replace(uuid,jsonb,jsonb) is
  'Read-only idempotency probe for replace_capture_selection_plan: recognizes a replay purely from actor+scope+idempotencyKey+fingerprint before any catalog/pricing validation runs, so a catalog change since the original apply never turns a legitimate replay into a spurious rejection.';

-- Server-only reader mirroring read_capture_repeat_order_plan, for the
-- materialization step that confirm's caller runs before invoking
-- confirm_capture_draft_v3.
create function app_private.read_capture_selection_plan(
  p_actor_id uuid,
  p_request jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  restaurant uuid;
  branch uuid;
  capture uuid;
  selected_plan jsonb;
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
  if restaurant is null or branch is null or capture is null
    or p_request#>>'{scope,restaurantId}' is distinct from restaurant::text
    or p_request#>>'{scope,branchId}' is distinct from branch::text
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  if not exists (
    select 1
    from app.memberships membership
    join app.branches b on b.id=membership.branch_id and b.restaurant_id=membership.restaurant_id
    join app.restaurants r on r.id=membership.restaurant_id
    join app.membership_role_grants grant_record on grant_record.membership_id=membership.id
    where membership.user_id=p_actor_id and membership.restaurant_id=restaurant and membership.branch_id=branch
      and membership.revoked_at is null and b.disabled_at is null and r.disabled_at is null
      and grant_record.revoked_at is null
      and grant_record.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
  ) then return pg_catalog.jsonb_build_object('status','denied'); end if;

  -- A catalog selection plan has no Customer dependency, unlike a repeat-order plan: an
  -- unrelated mutation (fulfillment, customer, attention) that advances draft.version past
  -- applied_capture_version must not turn a perfectly valid selection into 'missing'. Only the
  -- draft's draft status is still required; line/catalog freshness is revalidated by the caller.
  select plan.selection_plan into selected_plan
  from app.capture_repeat_order_plans plan
  join app.capture_drafts draft on draft.restaurant_id=plan.restaurant_id and draft.branch_id=plan.branch_id
    and draft.id=plan.capture_draft_id and draft.status='draft'
  where plan.restaurant_id=restaurant and plan.branch_id=branch and plan.capture_draft_id=capture
    and plan.plan_kind='selection';
  if not found then return pg_catalog.jsonb_build_object('status','missing'); end if;

  return pg_catalog.jsonb_build_object('status','ok','plan',selected_plan);
end
$function$;

alter function app_private.read_capture_selection_plan(uuid,jsonb) owner to postgres;
revoke all on function app_private.read_capture_selection_plan(uuid,jsonb)
  from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.read_capture_selection_plan(uuid,jsonb) to app_api;

comment on function app_private.read_capture_selection_plan(uuid,jsonb) is
  'Server-only reader for the exact Capture selection-plan lines used during confirmation; never exposed through the client contract.';

-- read_capture_workspace_v3 keeps its original schemaVersion-3, five-key
-- shape (its shared-types parser, `parseCaptureWorkspaceV3`, requires
-- exactly those keys) so no existing V3 reader breaks. It DOES need one
-- correctness fix now that a single capture row can hold either plan kind:
-- the original body built `repeatOrderPlan` from any row in
-- capture_repeat_order_plans, unconditionally. For a 'selection' row that
-- produced a non-null object with null customerId/sourceOrderId instead of
-- the null the V3 contract requires, which parseCaptureWorkspaceV3 (and the
-- API's uuid-shaped customerId check) then rejects outright. Restricting the
-- lookup to plan_kind='repeat' restores the original, correct behavior for
-- every existing repeat-order capture and returns null for a selection-plan
-- capture, exactly as before this migration existed.
create or replace function app_private.read_capture_workspace_v3(p_actor_id uuid, p_request jsonb)
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
    and stored.capture_draft_id=capture
    and stored.plan_kind='repeat';

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
  'Rehydrates Capture V2 facts plus a bounded durable repeat-order intent summary; selections remain server-owned. Only surfaces plan_kind=repeat rows; a selection-plan capture reports repeatOrderPlan=null.';

--
-- Widens the workspace projection with a bounded selectionPlan summary
-- alongside the existing repeatOrderPlan; only one of the two is ever
-- non-null per capture. The full selection-plan projection (resolved
-- names/prices) is computed by the API from the live catalog and is never
-- persisted here.
create function app_private.read_capture_workspace_v4(p_actor_id uuid, p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v3 jsonb;
  restaurant uuid;
  branch uuid;
  capture uuid;
  selection_plan jsonb;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_request,array['schemaVersion','scope','captureDraftId'])
    or not app_private.jsonb_has_exact_keys(p_request->'scope',array['restaurantId','branchId'])
    or p_request->'schemaVersion' is distinct from '4'::jsonb
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  begin
    restaurant := (p_request#>>'{scope,restaurantId}')::uuid;
    branch := (p_request#>>'{scope,branchId}')::uuid;
    capture := (p_request->>'captureDraftId')::uuid;
  exception when invalid_text_representation then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;

  v3 := app_private.read_capture_workspace_v3(p_actor_id,pg_catalog.jsonb_build_object(
    'schemaVersion',3,
    'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'captureDraftId',capture::text
  ));
  if app_private.jsonb_has_exact_keys(v3,array['status']) then return v3; end if;

  select case when stored.plan_kind='selection' then pg_catalog.jsonb_build_object(
    'schemaVersion',1,
    'catalogVersion',stored.catalog_id::text,
    'appliedCaptureVersion',stored.applied_capture_version,
    'lineCount',pg_catalog.jsonb_array_length(stored.selection_plan->'lines')
  ) end into selection_plan
  from app.capture_repeat_order_plans stored
  where stored.restaurant_id=restaurant
    and stored.branch_id=branch
    and stored.capture_draft_id=capture;

  return (v3-'schemaVersion')||pg_catalog.jsonb_build_object(
    'schemaVersion',4,
    'selectionPlan',selection_plan
  );
end
$function$;

alter function app_private.read_capture_workspace_v4(uuid,jsonb) owner to postgres;
revoke all on function app_private.read_capture_workspace_v4(uuid,jsonb)
  from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.read_capture_workspace_v4(uuid,jsonb) to app_api;

comment on function app_private.read_capture_workspace_v4(uuid,jsonb) is
  'Rehydrates Capture V3 facts plus a bounded durable catalog-selection plan summary (no lines/prices); selections remain server-owned and are priced by the API from the live catalog.';

-- Confirm now accepts either plan kind: the per-line catalog/product/option
-- revalidation loop is generic over {productId, modifierGroups}, which both
-- plan shapes carry; only the repeat plan's customerId cross-check is
-- specific to that kind and is now gated on plan_kind. No existing check for
-- either plan kind is relaxed.
create or replace function app_private.confirm_capture_draft_v3(
  p_actor_id uuid,
  p_command jsonb,
  p_order jsonb,
  p_order_audits jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  restaurant uuid; branch uuid; capture uuid; requested_order_id uuid; member uuid;
  expected bigint; fingerprint text; catalog uuid; catalog_currency text;
  stored app.capture_command_events%rowtype;
  repeat_plan app.capture_repeat_order_plans%rowtype;
  old_result jsonb; mutation_result jsonb; result_record jsonb; base_order jsonb;
  line_record record; item jsonb; expected_snapshot jsonb; expected_modifiers jsonb;
  product app.menu_products%rowtype; line_index bigint; item_count integer; write_status text;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_command,array[
      'schemaVersion','scope','captureDraftId','expectedVersion','eventId','idempotencyKey','deviceId','occurredAt',
      'attentionLeaseId','orderId','shiftId','tableId','currency','timeZone'
    ])
    or not app_private.jsonb_has_exact_keys(p_command->'scope',array['restaurantId','branchId'])
    or p_command->'schemaVersion' is distinct from '2'::jsonb
    or not coalesce(p_command->>'expectedVersion' ~ '^[1-9][0-9]*$',false)
    or not coalesce(p_command->>'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
    or not coalesce(p_command->>'currency' ~ '^[A-Z]{3}$',false)
    or pg_catalog.char_length(p_command->>'timeZone') not between 1 and 100
    or (p_order is null) is distinct from (p_order_audits is null)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  begin
    restaurant := (p_command#>>'{scope,restaurantId}')::uuid;
    branch := (p_command#>>'{scope,branchId}')::uuid;
    capture := (p_command->>'captureDraftId')::uuid;
    requested_order_id := (p_command->>'orderId')::uuid;
    expected := (p_command->>'expectedVersion')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or capture is null or requested_order_id is null
    or expected not between 1 and 9007199254740990
    or p_command#>>'{scope,restaurantId}' is distinct from restaurant::text
    or p_command#>>'{scope,branchId}' is distinct from branch::text
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  select membership.id into member
  from app.memberships membership
  join app.branches b on b.id=membership.branch_id and b.restaurant_id=membership.restaurant_id
  join app.restaurants r on r.id=membership.restaurant_id
  join app.membership_role_grants grant_record on grant_record.membership_id=membership.id
  where membership.user_id=p_actor_id and membership.restaurant_id=restaurant and membership.branch_id=branch
    and membership.revoked_at is null and b.disabled_at is null and r.disabled_at is null
    and grant_record.revoked_at is null
    and grant_record.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
  order by grant_record.role_code limit 1 for share of membership,b,r,grant_record;
  if member is null then return pg_catalog.jsonb_build_object('status','denied'); end if;

  fingerprint := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'capture.confirmed.v3:'||p_command::text||':'||p_actor_id::text,'UTF8'
  )),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'capture-command:'||p_actor_id::text||':'||restaurant::text||':'||branch::text||':'||(p_command->>'idempotencyKey'),0
  ));
  select * into stored from app.capture_command_events
  where actor_id=p_actor_id and restaurant_id=restaurant and branch_id=branch
    and idempotency_key=p_command->>'idempotencyKey';
  if found then
    if stored.operation<>'capture.confirmed' or stored.command_fingerprint<>fingerprint
      or stored.capture_draft_id<>capture or stored.expected_version<>expected
      or stored.result_capture#>>'{detail,confirmedOrderId}' is distinct from requested_order_id::text
      or not exists (
        select 1 from app.orders confirmed
        join app.order_operational_shifts shift_link on shift_link.restaurant_id=confirmed.restaurant_id
          and shift_link.branch_id=confirmed.branch_id and shift_link.order_id=confirmed.id
        join app.order_fulfillment_snapshots frozen on frozen.restaurant_id=confirmed.restaurant_id
          and frozen.branch_id=confirmed.branch_id and frozen.order_id=confirmed.id
          and frozen.capture_draft_id=capture
        where confirmed.restaurant_id=restaurant and confirmed.branch_id=branch and confirmed.id=requested_order_id
          and shift_link.shift_id=(p_command->>'shiftId')::uuid
      )
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    return pg_catalog.jsonb_build_object('status','replayed','record',stored.result_capture);
  end if;
  if p_order is null then return pg_catalog.jsonb_build_object('status','pending'); end if;

  if pg_catalog.jsonb_typeof(p_order)<>'object' or pg_catalog.jsonb_typeof(p_order_audits)<>'array'
    or not (
      app_private.jsonb_has_exact_keys(p_order,array[
        'schemaVersion','orderId','restaurantId','branchId','channel','currency','timeZone','status','items'
      ])
      or app_private.jsonb_has_exact_keys(p_order,array[
        'schemaVersion','orderId','restaurantId','branchId','channel','tableId','currency','timeZone','status','items'
      ])
    )
    or p_order->>'schemaVersion'<>'1'
    or p_order->>'restaurantId' is distinct from restaurant::text
    or p_order->>'branchId' is distinct from branch::text
    or p_order->>'orderId' is distinct from requested_order_id::text
    or p_order->>'currency' is distinct from p_command->>'currency'
    or p_order->>'timeZone' is distinct from p_command->>'timeZone'
    or p_order->>'status'<>'draft'
    or pg_catalog.jsonb_typeof(p_order->'items')<>'array'
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  item_count := pg_catalog.jsonb_array_length(p_order->'items');
  if pg_catalog.jsonb_array_length(p_order_audits)<>item_count+1
    or p_order_audits->0->>'operation'<>'order.created'
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  select * into repeat_plan from app.capture_repeat_order_plans plan
  where plan.restaurant_id=restaurant and plan.branch_id=branch and plan.capture_draft_id=capture for update;

  if not found then
    if item_count<>0 then return pg_catalog.jsonb_build_object('status','conflict'); end if;
  else
    -- A repeat-order plan is derived from the Customer and is invalidated the moment the
    -- draft advances without it (applied_capture_version must still match the confirmed
    -- version). A catalog selection plan has no such dependency: fulfillment/customer/other
    -- mutations unrelated to the lines must not turn a perfectly valid selection into a 409;
    -- its lines/catalog freshness is independently revalidated below against the live catalog.
    if (repeat_plan.plan_kind='repeat' and repeat_plan.applied_capture_version<>expected)
      or (repeat_plan.plan_kind='repeat' and repeat_plan.customer_id::text is distinct from repeat_plan.selection_plan->>'customerId')
      or pg_catalog.jsonb_array_length(repeat_plan.selection_plan->'lines')<>item_count
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;

    select head.catalog_id,catalog_record.currency into catalog,catalog_currency
    from app.menu_catalog_heads head
    join app.menu_catalogs catalog_record on catalog_record.restaurant_id=head.restaurant_id
      and catalog_record.id=head.catalog_id and catalog_record.version=head.version
    where head.restaurant_id=restaurant for share of head,catalog_record;
    if not found or catalog_currency is distinct from p_command->>'currency' then
      return pg_catalog.jsonb_build_object('status','conflict');
    end if;

    for line_record in
      select line.value, line.ordinality
      from pg_catalog.jsonb_array_elements(repeat_plan.selection_plan->'lines') with ordinality line(value,ordinality)
      order by line.ordinality
    loop
      begin
        select product_record.* into product
        from app.menu_products product_record
        join app.menu_categories category on category.restaurant_id=product_record.restaurant_id
          and category.catalog_id=product_record.catalog_id and category.id=product_record.category_id
        where product_record.restaurant_id=restaurant and product_record.catalog_id=catalog
          and product_record.id=(line_record.value->>'productId')::uuid
          and product_record.active and category.active;
      exception when invalid_text_representation then
        return pg_catalog.jsonb_build_object('status','conflict');
      end;
      if not found then return pg_catalog.jsonb_build_object('status','conflict'); end if;

      if exists (
        select 1 from app.menu_modifier_groups catalog_group
        left join lateral (
          select requested.value from pg_catalog.jsonb_array_elements(line_record.value->'modifierGroups') requested(value)
          where requested.value->>'groupId'=catalog_group.id::text
        ) requested_group on true
        where catalog_group.restaurant_id=restaurant and catalog_group.catalog_id=catalog
          and catalog_group.product_id=product.id
          and (not catalog_group.active or requested_group.value is null)
      ) or exists (
        select 1 from pg_catalog.jsonb_array_elements(line_record.value->'modifierGroups') requested_group(value)
        left join app.menu_modifier_groups catalog_group on catalog_group.restaurant_id=restaurant
          and catalog_group.catalog_id=catalog and catalog_group.product_id=product.id
          and catalog_group.id=(requested_group.value->>'groupId')::uuid
        where catalog_group.id is null or not catalog_group.active
          or (select coalesce(pg_catalog.sum((selection.value->>'quantity')::integer),0)
              from pg_catalog.jsonb_array_elements(requested_group.value->'selections') selection(value))
            not between catalog_group.minimum_quantity and catalog_group.maximum_quantity
      ) or exists (
        select 1 from pg_catalog.jsonb_array_elements(line_record.value->'modifierGroups') requested_group(value)
        cross join lateral pg_catalog.jsonb_array_elements(requested_group.value->'selections') selection(value)
        left join app.menu_modifier_options option_record on option_record.restaurant_id=restaurant
          and option_record.catalog_id=catalog and option_record.group_id=(requested_group.value->>'groupId')::uuid
          and option_record.id=(selection.value->>'optionId')::uuid
        where option_record.id is null or not option_record.active
          or (option_record.maximum_quantity is not null
            and (selection.value->>'quantity')::integer>option_record.maximum_quantity)
      ) then return pg_catalog.jsonb_build_object('status','conflict'); end if;

      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'modifierId',option_record.id::text,
        'name',option_record.name,
        'groupId',catalog_group.id::text,
        'groupName',catalog_group.name,
        'groupCatalogVersion',catalog::text,
        'unitPrice',pg_catalog.jsonb_build_object('amountMinor',option_record.unit_price_minor,'currency',catalog_currency),
        'quantity',(selection.value->>'quantity')::integer
      ) order by catalog_group.display_order,catalog_group.id,option_record.id),'[]'::jsonb) into expected_modifiers
      from pg_catalog.jsonb_array_elements(line_record.value->'modifierGroups') requested_group(value)
      cross join lateral pg_catalog.jsonb_array_elements(requested_group.value->'selections') selection(value)
      join app.menu_modifier_groups catalog_group on catalog_group.restaurant_id=restaurant
        and catalog_group.catalog_id=catalog and catalog_group.product_id=product.id
        and catalog_group.id=(requested_group.value->>'groupId')::uuid
      join app.menu_modifier_options option_record on option_record.restaurant_id=restaurant
        and option_record.catalog_id=catalog and option_record.group_id=catalog_group.id
        and option_record.id=(selection.value->>'optionId')::uuid;

      expected_snapshot := pg_catalog.jsonb_build_object(
        'catalogVersion',catalog::text,'productId',product.id::text,'name',product.name,
        'stationId',product.station_id,'unit',product.unit,
        'unitPrice',pg_catalog.jsonb_build_object('amountMinor',product.unit_price_minor,'currency',catalog_currency),
        'modifiers',expected_modifiers
      );
      if product.sku is not null then
        expected_snapshot := expected_snapshot||pg_catalog.jsonb_build_object('sku',product.sku);
      end if;
      if product.tax_id is not null then
        expected_snapshot := expected_snapshot||pg_catalog.jsonb_build_object('tax',pg_catalog.jsonb_build_object(
          'taxId',product.tax_id,'name',product.tax_name,'taxRuleVersion',product.tax_rule_version,
          'rate',pg_catalog.jsonb_build_object(
            'numerator',product.tax_rate_numerator::text,'denominator',product.tax_rate_denominator::text
          ),'inclusion',product.tax_inclusion
        ));
      end if;

      item := p_order#>array['items',(line_record.ordinality-1)::text];
      if item is null
        or not app_private.jsonb_has_exact_keys(item,array[
          'orderItemId','snapshot','quantity','restaurantId','branchId','status'
        ])
        or not coalesce(item->>'orderItemId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
        or item->>'quantity' is distinct from line_record.value->>'quantity'
        or item->>'restaurantId' is distinct from restaurant::text
        or item->>'branchId' is distinct from branch::text
        or item->>'status'<>'pending'
        or item->'snapshot' is distinct from expected_snapshot
      then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    end loop;
  end if;

  begin
    base_order := pg_catalog.jsonb_set(p_order,'{items}','[]'::jsonb,false);
    old_result := app_private.confirm_capture_draft(p_actor_id,p_command,base_order,p_order_audits->0);
    if old_result->>'status'='denied' then
      write_status := 'denied';
      raise exception using errcode='P5100',message='CAPTURE_CONFIRMATION_ATOMIC_ABORT';
    end if;
    if old_result->>'status'<>'applied' then
      write_status := 'conflict';
      raise exception using errcode='P5100',message='CAPTURE_CONFIRMATION_ATOMIC_ABORT';
    end if;
    result_record := old_result->'record';

    if item_count>0 then
      for line_index in 1..item_count loop
        mutation_result := app_private.persist_order_mutation(
          p_actor_id,
          line_index,
          pg_catalog.jsonb_set(p_order,'{items}',(
            select pg_catalog.jsonb_agg(prefix.value order by prefix.ordinality)
            from pg_catalog.jsonb_array_elements(p_order->'items') with ordinality prefix(value,ordinality)
            where prefix.ordinality<=line_index
          ),false),
          p_order_audits->line_index::integer
        );
        if mutation_result->>'status'='forbidden' then
          write_status := 'denied';
          raise exception using errcode='P5100',message='CAPTURE_CONFIRMATION_ATOMIC_ABORT';
        end if;
        if mutation_result->>'status'<>'saved' then
          write_status := 'conflict';
          raise exception using errcode='P5100',message='CAPTURE_CONFIRMATION_ATOMIC_ABORT';
        end if;
      end loop;
    end if;

    update app.capture_command_events set command_fingerprint=fingerprint
    where actor_id=p_actor_id and restaurant_id=restaurant and branch_id=branch
      and idempotency_key=p_command->>'idempotencyKey' and operation='capture.confirmed'
      and capture_draft_id=capture and expected_version=expected;
    if not found then raise exception using errcode='55000',message='CAPTURE_CONFIRMATION_EVENT_MISSING'; end if;
  exception when sqlstate 'P5100' then
    return pg_catalog.jsonb_build_object('status',write_status);
  end;

  return pg_catalog.jsonb_build_object('status','applied','record',result_record);
end
$function$;

alter function app_private.confirm_capture_draft_v3(uuid,jsonb,jsonb,jsonb) owner to postgres;
revoke all on function app_private.confirm_capture_draft_v3(uuid,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.confirm_capture_draft_v3(uuid,jsonb,jsonb,jsonb) to app_api;

comment on function app_private.confirm_capture_draft_v3(uuid,jsonb,jsonb,jsonb) is
  'Probes idempotent Capture confirmation and atomically revalidates current catalog facts before materializing a repeat OR selection plan into Order and KDS state.';

commit;
