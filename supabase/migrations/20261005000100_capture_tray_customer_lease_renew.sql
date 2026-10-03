begin;

-- capture-tray-lease-api: (1) enriched draft tray reader (party snapshot customer + the stored
-- selection plan so the API can price a total) and (2) an attention-lease heartbeat.
-- Both are new functions; list_capture_work_tray and mutate_capture_attention are untouched.

create function app_private.list_capture_work_tray_v2(p_actor_id uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare restaurant uuid;branch uuid;member uuid;requested_limit integer;items jsonb;
begin
  if p_actor_id is null or not app_private.jsonb_has_exact_keys(p_request,array['schemaVersion','scope','limit'])
    or not app_private.jsonb_has_exact_keys(p_request->'scope',array['restaurantId','branchId'])
    or p_request->'schemaVersion' is distinct from '2'::jsonb
    or pg_catalog.jsonb_typeof(p_request->'limit') is distinct from 'number'
    or not coalesce(p_request->>'limit' ~ '^[1-9][0-9]*$',false)
  then return jsonb_build_object('status','rejected');end if;
  begin restaurant:=(p_request#>>'{scope,restaurantId}')::uuid;branch:=(p_request#>>'{scope,branchId}')::uuid;
    requested_limit:=(p_request->>'limit')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('status','rejected');end;
  if requested_limit not between 1 and 50 then return jsonb_build_object('status','rejected');end if;
  select m.id into member from app.memberships m join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
    join app.restaurants r on r.id=m.restaurant_id join app.membership_role_grants g on g.membership_id=m.id
    where m.user_id=p_actor_id and m.restaurant_id=restaurant and m.branch_id=branch and m.revoked_at is null
      and b.disabled_at is null and r.disabled_at is null and g.revoked_at is null
      and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter') order by g.role_code limit 1 for share of m,b,r,g;
  if member is null then return jsonb_build_object('status','denied');end if;
  -- Raw facts only: the API strips `customer` for actors without customers.read and prices
  -- `selectionPlan` itself (money is never computed in SQL). The lease id is never returned.
  select coalesce(jsonb_agg(summary order by updated_at desc,id),'[]'::jsonb) into items from (
    select c.updated_at,c.id,jsonb_build_object('schemaVersion',1,'scope',jsonb_build_object('restaurantId',c.restaurant_id::text,'branchId',c.branch_id::text),
      'captureDraftId',c.id::text,'folio',c.folio,'sourceChannel',c.source_channel,'fulfillmentChannel',c.fulfillment_channel,
      'status',c.status,'attentionStatus',c.attention_status,'ownerMembershipId',c.owner_membership_id::text,
      'version',c.version,'updatedAt',to_char(c.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'attentionLeaseExpiresAt',case when c.attention_lease_expires_at is null then null
        else to_char(c.attention_lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'customer',case when s.id is null then null
        else jsonb_build_object('displayName',s.display_name,'phone',s.phone_display_value) end,
      'selectionPlan',p.selection_plan) as summary
    from app.capture_drafts c
    left join app.customer_party_snapshots s on s.restaurant_id=c.restaurant_id and s.customer_id=c.customer_id
      and s.id=c.customer_snapshot_id
    left join app.capture_repeat_order_plans p on p.restaurant_id=c.restaurant_id and p.branch_id=c.branch_id
      and p.capture_draft_id=c.id and p.plan_kind='selection'
    where c.restaurant_id=restaurant and c.branch_id=branch and c.status='draft'
      and c.recovery_expires_at>clock_timestamp() order by c.updated_at desc,c.id limit requested_limit
  ) listed;
  return jsonb_build_object('schemaVersion',2,'items',items);
end
$function$;
alter function app_private.list_capture_work_tray_v2(uuid,jsonb) owner to postgres;
revoke all on function app_private.list_capture_work_tray_v2(uuid,jsonb) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.list_capture_work_tray_v2(uuid,jsonb) to app_api;
comment on function app_private.list_capture_work_tray_v2(uuid,jsonb) is
  'Server-only branch-scoped draft tray with party-snapshot customer and stored selection plan; raw facts, the API reduces PII by role and prices the total.';

create function app_private.renew_capture_lease(p_actor_id uuid,p_command jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  restaurant uuid;branch uuid;capture uuid;requested_lease uuid;member uuid;
  observed timestamptz;expires timestamptz;
  current_capture app.capture_drafts%rowtype;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_command,array['schemaVersion','scope','captureDraftId','attentionLeaseId'])
    or not app_private.jsonb_has_exact_keys(p_command->'scope',array['restaurantId','branchId'])
    or p_command->'schemaVersion' is distinct from '1'::jsonb
  then return jsonb_build_object('status','rejected');end if;
  begin
    restaurant:=(p_command#>>'{scope,restaurantId}')::uuid;branch:=(p_command#>>'{scope,branchId}')::uuid;
    capture:=(p_command->>'captureDraftId')::uuid;requested_lease:=(p_command->>'attentionLeaseId')::uuid;
  exception when invalid_text_representation then return jsonb_build_object('status','rejected');end;
  if restaurant is null or branch is null or capture is null or requested_lease is null
  then return jsonb_build_object('status','rejected');end if;
  select m.id into member from app.memberships m join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
    join app.restaurants r on r.id=m.restaurant_id join app.membership_role_grants g on g.membership_id=m.id
    where m.user_id=p_actor_id and m.restaurant_id=restaurant and m.branch_id=branch and m.revoked_at is null
      and b.disabled_at is null and r.disabled_at is null and g.revoked_at is null
      and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter') order by g.role_code limit 1 for share of m,b,r,g;
  if member is null then return jsonb_build_object('status','denied');end if;
  select * into current_capture from app.capture_drafts
    where restaurant_id=restaurant and branch_id=branch and id=capture for update;
  if not found then return jsonb_build_object('status','missing');end if;
  -- Observe after the row lock so lock wait time counts toward the lease.
  observed:=greatest(date_trunc('milliseconds',clock_timestamp()),current_capture.updated_at);
  if current_capture.status<>'draft' or current_capture.attention_status<>'claimed'
    or current_capture.recovery_expires_at<=observed
  then return jsonb_build_object('status','conflict','reason','not_active');end if;
  -- Another station owns the capture (claimed/taken over/transferred rotate the lease id or owner).
  if current_capture.owner_membership_id is distinct from member
    or current_capture.attention_lease_id is distinct from requested_lease
  then return jsonb_build_object('status','conflict','reason','taken');end if;
  -- Heartbeat: only moves the expiry forward (idempotent under replay/retry), never changes
  -- version, updated_at, owner or lease id, so it cannot race an autosave's expectedVersion.
  expires:=greatest(current_capture.attention_lease_expires_at,observed+interval '5 minutes');
  update app.capture_drafts set attention_lease_expires_at=expires
    where restaurant_id=restaurant and branch_id=branch and id=capture;
  return jsonb_build_object('status','applied','record',jsonb_build_object('schemaVersion',1,
    'captureDraftId',capture::text,'attentionLeaseId',requested_lease::text,
    'attentionLeaseExpiresAt',to_char(expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'version',current_capture.version));
end
$function$;
alter function app_private.renew_capture_lease(uuid,jsonb) owner to postgres;
revoke all on function app_private.renew_capture_lease(uuid,jsonb) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.renew_capture_lease(uuid,jsonb) to app_api;
comment on function app_private.renew_capture_lease(uuid,jsonb) is
  'Server-only attention-lease heartbeat for the owner of a claimed draft; extends expiry only, no version bump, conflict(taken|not_active) otherwise.';

commit;
