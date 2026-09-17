begin;

create function app_private.read_customer_directory(p_actor_id uuid, p_query jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  restaurant uuid;
  branch uuid;
  customer uuid;
  member uuid;
  current_customer app.customers%rowtype;
  result jsonb;
begin
  if p_actor_id is null
    or not app_private.jsonb_has_exact_keys(p_query,array['schemaVersion','scope','customerId'])
    or not app_private.jsonb_has_exact_keys(p_query -> 'scope',array['restaurantId','branchId'])
    or p_query -> 'schemaVersion' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_query -> 'customerId') is distinct from 'string'
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;
  begin
    restaurant := (p_query #>> '{scope,restaurantId}')::uuid;
    branch := (p_query #>> '{scope,branchId}')::uuid;
    customer := (p_query ->> 'customerId')::uuid;
  exception when invalid_text_representation then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or customer is null
    or p_query #>> '{scope,restaurantId}' is distinct from restaurant::text
    or p_query #>> '{scope,branchId}' is distinct from branch::text
    or p_query ->> 'customerId' is distinct from customer::text
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  select m.id into member from app.memberships as m
    join app.branches as b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id
    join app.restaurants as r on r.id=m.restaurant_id
    join app.membership_role_grants as g on g.membership_id=m.id
    where m.user_id=p_actor_id and m.restaurant_id=restaurant and m.branch_id=branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null and g.revoked_at is null
      and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
    order by g.role_code limit 1 for share of m,b,r,g;
  if member is null then return pg_catalog.jsonb_build_object('status','denied'); end if;

  select c.* into current_customer from app.customers as c
    where c.restaurant_id=restaurant and c.id=customer and c.deleted_at is null;
  if not found then return pg_catalog.jsonb_build_object('status','missing'); end if;

  select pg_catalog.jsonb_build_object(
    'schemaVersion',1,
    'scope',pg_catalog.jsonb_build_object('restaurantId',restaurant::text,'branchId',branch::text),
    'customer',pg_catalog.jsonb_build_object(
      'customerId',current_customer.id::text,
      'displayName',current_customer.display_name,
      'version',current_customer.version,
      'updatedAt',pg_catalog.to_char(current_customer.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'phones',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'contactId',p.contact_id::text,'label',p.label,'displayValue',p.display_value)
        order by p.updated_at desc,p.contact_id) from app.customer_phones as p
        where p.restaurant_id=restaurant and p.customer_id=customer and p.deleted_at is null),'[]'::jsonb)
    ),
    'addresses',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'addressId',a.id::text,
      'address',pg_catalog.jsonb_build_object(
        'label',a.label,'streetLine',a.street_line,'unit',a.unit,'neighborhood',a.neighborhood,
        'locality',a.locality,'region',a.region,'countryCode',a.country_code,'postalCode',a.postal_code,
        'references',a.references_text,'instructions',a.instructions,
        'coordinates',case when a.latitude_e6 is null then null else pg_catalog.jsonb_build_object(
          'latitudeE6',a.latitude_e6,'longitudeE6',a.longitude_e6) end
      ),
      'version',a.version,
      'updatedAt',pg_catalog.to_char(a.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'validatedForRequestedBranch',a.validation_branch_id=branch and a.validated_at is not null
    ) order by a.updated_at desc,a.id) from (
      select candidate.* from app.customer_addresses as candidate
      where candidate.restaurant_id=restaurant and candidate.customer_id=customer and candidate.deleted_at is null
      order by candidate.updated_at desc,candidate.id limit 20
    ) as a),'[]'::jsonb),
    'addressesTruncated',exists(select 1 from app.customer_addresses as overflow
      where overflow.restaurant_id=restaurant and overflow.customer_id=customer and overflow.deleted_at is null
      order by overflow.updated_at desc,overflow.id offset 20 limit 1)
  ) into result;
  return pg_catalog.jsonb_build_object('status','ok','result',result);
end
$function$;

alter function app_private.read_customer_directory(uuid,jsonb) owner to postgres;
revoke all on function app_private.read_customer_directory(uuid,jsonb) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.read_customer_directory(uuid,jsonb) to app_api;

commit;
