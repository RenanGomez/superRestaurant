begin;

-- OrderItem now carries an optional, immutable kitchen note (packages/domain/src/order-totals.ts,
-- 1-200 chars, no control characters, or null). confirm_capture_draft_v3 revalidates every
-- materialized item's exact shape against server-derived facts; this replaces it to additionally
-- require a 'note' key and to check it matches the selection plan line's note (repeat-order plan
-- lines carry no 'note' field at all, so their expected note is always null). No other check is
-- relaxed.
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
  line_record record; item jsonb; expected_snapshot jsonb; expected_modifiers jsonb; expected_note jsonb;
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

      -- A repeat-order plan line never carries a 'note' key at all (it is not part of
      -- CaptureRepeatSelectionLine); its expected note is therefore always null. A selection
      -- plan line always carries 'note' (string or json null); its expected note is that value.
      if line_record.value ? 'note' then
        expected_note := line_record.value->'note';
      else
        expected_note := 'null'::jsonb;
      end if;

      item := p_order#>array['items',(line_record.ordinality-1)::text];
      if item is null
        or not app_private.jsonb_has_exact_keys(item,array[
          'orderItemId','snapshot','quantity','restaurantId','branchId','status','note'
        ])
        or not coalesce(item->>'orderItemId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
        or item->>'quantity' is distinct from line_record.value->>'quantity'
        or item->>'restaurantId' is distinct from restaurant::text
        or item->>'branchId' is distinct from branch::text
        or item->>'status'<>'pending'
        or item->'snapshot' is distinct from expected_snapshot
        or item->'note' is distinct from expected_note
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
  'Probes idempotent Capture confirmation and atomically revalidates current catalog facts, including the frozen order item note, before materializing a repeat OR selection plan into Order and KDS state.';

commit;
