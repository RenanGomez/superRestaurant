begin;

create function app_private.search_customer_directory(p_actor_id uuid, p_query jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  restaurant uuid;
  branch uuid;
  member uuid;
  mode text;
  search_text text;
  phone_key text;
  requested_limit integer;
  cursor_updated timestamptz;
  cursor_customer uuid;
  result jsonb;
begin
  if p_actor_id is null or not app_private.jsonb_has_exact_keys(p_query,array['schemaVersion','scope','mode','query','limit','cursor'])
    or not app_private.jsonb_has_exact_keys(p_query -> 'scope',array['restaurantId','branchId'])
    or p_query -> 'schemaVersion' is distinct from '1'::jsonb
    or not coalesce(p_query ->> 'mode' in ('phone','name','address'),false)
    or pg_catalog.jsonb_typeof(p_query -> 'query') is distinct from 'string'
    or char_length(p_query ->> 'query') not between 1 and (case when p_query ->> 'mode' = 'address' then 200 else 120 end)
    or p_query ->> 'query' <> btrim(p_query ->> 'query') or p_query ->> 'query' ~ '[[:cntrl:]]'
    or pg_catalog.jsonb_typeof(p_query -> 'limit') is distinct from 'number'
    or not coalesce(p_query ->> 'limit' ~ '^([1-9]|1[0-9]|20)$',false)
    or (p_query -> 'cursor' <> 'null'::jsonb and not app_private.jsonb_has_exact_keys(p_query -> 'cursor',array['updatedAt','customerId']))
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;
  mode := p_query ->> 'mode';
  search_text := p_query ->> 'query';
  if mode = 'phone' then
    if search_text !~ '^[+0-9 ().-]+$' then return pg_catalog.jsonb_build_object('status','rejected'); end if;
    phone_key := pg_catalog.translate(search_text,' ().-','');
    if phone_key !~ '^\+?[0-9]{1,20}$' then return pg_catalog.jsonb_build_object('status','rejected'); end if;
  end if;
  begin
    restaurant := (p_query #>> '{scope,restaurantId}')::uuid;
    branch := (p_query #>> '{scope,branchId}')::uuid;
    requested_limit := (p_query ->> 'limit')::integer;
    if p_query -> 'cursor' <> 'null'::jsonb then
      cursor_updated := (p_query #>> '{cursor,updatedAt}')::timestamptz;
      cursor_customer := (p_query #>> '{cursor,customerId}')::uuid;
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or requested_limit not between 1 and 20
    or (p_query -> 'cursor' <> 'null'::jsonb and (cursor_updated is null or cursor_customer is null
      or p_query #>> '{cursor,updatedAt}' is distinct from pg_catalog.to_char(cursor_updated at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
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

  with matches as materialized (
    select c.id,c.display_name,c.version,c.updated_at
    from app.customers as c
    where c.restaurant_id=restaurant and c.deleted_at is null
      and (cursor_updated is null or c.updated_at < cursor_updated or (c.updated_at = cursor_updated and c.id > cursor_customer))
      and ((mode='phone' and exists (select 1 from app.customer_phones as p where p.restaurant_id=c.restaurant_id
          and p.customer_id=c.id and p.deleted_at is null and p.normalized_value=phone_key))
        or (mode='name' and pg_catalog.strpos(pg_catalog.lower(c.display_name),pg_catalog.lower(search_text)) > 0)
        or (mode='address' and exists (select 1 from app.customer_addresses as a where a.restaurant_id=c.restaurant_id
          and a.customer_id=c.id and a.deleted_at is null and pg_catalog.strpos(pg_catalog.lower(
            pg_catalog.concat_ws(' ',a.street_line,a.neighborhood,a.locality,a.region,a.postal_code)),pg_catalog.lower(search_text)) > 0)))
    order by c.updated_at desc,c.id
    limit requested_limit + 1
  ), page as materialized (
    select * from matches order by updated_at desc,id limit requested_limit
  ), assembled as (
    select p.id,p.updated_at,pg_catalog.jsonb_build_object(
      'customerId',p.id::text,'displayName',p.display_name,'version',p.version,
      'updatedAt',pg_catalog.to_char(p.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'phones',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'contactId',cp.contact_id::text,'label',cp.label,'displayValue',cp.display_value)
        order by cp.updated_at desc,cp.contact_id) from app.customer_phones as cp
        where cp.restaurant_id=restaurant and cp.customer_id=p.id and cp.deleted_at is null),'[]'::jsonb),
      'addresses',coalesce((select pg_catalog.jsonb_agg(item.value order by item.updated_at desc,item.address_id) from (
        select a.updated_at,a.id as address_id,pg_catalog.jsonb_build_object('addressId',a.id::text,'label',a.label,
          'streetLine',a.street_line,'neighborhood',a.neighborhood,'locality',a.locality,'version',a.version,
          'validatedForRequestedBranch',a.validation_branch_id=branch and a.validated_at is not null) as value
        from app.customer_addresses as a where a.restaurant_id=restaurant and a.customer_id=p.id and a.deleted_at is null
        order by a.updated_at desc,a.id limit 20
      ) as item),'[]'::jsonb)) as value
    from page as p
  )
  select pg_catalog.jsonb_build_object('schemaVersion',1,'scope',pg_catalog.jsonb_build_object(
      'restaurantId',restaurant::text,'branchId',branch::text),
    'candidates',coalesce(pg_catalog.jsonb_agg(assembled.value order by assembled.updated_at desc,assembled.id),'[]'::jsonb),
    'nextCursor',case when (select count(*) from matches) > requested_limit then (
      select pg_catalog.jsonb_build_object('updatedAt',pg_catalog.to_char(page.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'customerId',page.id::text) from page order by page.updated_at desc,page.id offset requested_limit-1 limit 1
    ) else null end) into result from assembled;
  return pg_catalog.jsonb_build_object('status','ok','result',result);
end
$function$;

alter function app_private.search_customer_directory(uuid,jsonb) owner to postgres;
revoke all on function app_private.search_customer_directory(uuid,jsonb) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.search_customer_directory(uuid,jsonb) to app_api;

commit;
