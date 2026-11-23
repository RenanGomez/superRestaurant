begin;

create function app_private.list_customer_open_captures(p_actor_id uuid, p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare restaurant uuid; branch uuid; customer uuid; requested_limit integer; items jsonb;
begin
  if p_actor_id is null or not app_private.jsonb_has_exact_keys(p_request,array['schemaVersion','scope','customerId','limit'])
    or not app_private.jsonb_has_exact_keys(p_request->'scope',array['restaurantId','branchId'])
    or p_request->'schemaVersion' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_request->'limit') is distinct from 'number'
    or not coalesce(p_request->>'limit' ~ '^[1-9][0-9]*$',false)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;
  begin
    restaurant := (p_request#>>'{scope,restaurantId}')::uuid;
    branch := (p_request#>>'{scope,branchId}')::uuid;
    customer := (p_request->>'customerId')::uuid;
    requested_limit := (p_request->>'limit')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or customer is null or requested_limit not between 1 and 50
    or p_request#>>'{scope,restaurantId}' is distinct from restaurant::text
    or p_request#>>'{scope,branchId}' is distinct from branch::text
    or p_request->>'customerId' is distinct from customer::text
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;
  if not exists (
    select 1 from app.memberships m
    join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
    join app.restaurants r on r.id=m.restaurant_id
    join app.membership_role_grants g on g.membership_id=m.id
    where m.user_id=p_actor_id and m.restaurant_id=restaurant and m.branch_id=branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null and g.revoked_at is null
      and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
  ) then return pg_catalog.jsonb_build_object('status','denied'); end if;
  select coalesce(pg_catalog.jsonb_agg(summary order by updated_at desc,id),'[]'::jsonb) into items from (
    select c.updated_at,c.id,pg_catalog.jsonb_build_object('schemaVersion',1,
      'scope',pg_catalog.jsonb_build_object('restaurantId',c.restaurant_id::text,'branchId',c.branch_id::text),
      'captureDraftId',c.id::text,'folio',c.folio,'sourceChannel',c.source_channel,'fulfillmentChannel',c.fulfillment_channel,
      'status',c.status,'attentionStatus',c.attention_status,'ownerMembershipId',c.owner_membership_id::text,
      'version',c.version,'updatedAt',pg_catalog.to_char(c.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) as summary
    from app.capture_drafts c where c.restaurant_id=restaurant and c.branch_id=branch and c.customer_id=customer
      and c.status='draft' and c.recovery_expires_at>pg_catalog.clock_timestamp()
    order by c.updated_at desc,c.id limit requested_limit
  ) listed;
  return pg_catalog.jsonb_build_object('schemaVersion',1,'items',items);
end
$function$;
alter function app_private.list_customer_open_captures(uuid,jsonb) owner to postgres;
revoke all on function app_private.list_customer_open_captures(uuid,jsonb) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.list_customer_open_captures(uuid,jsonb) to app_api;
commit;
