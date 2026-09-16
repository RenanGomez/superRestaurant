begin;

create table app.customer_command_events (
  event_id uuid primary key,
  restaurant_id uuid not null,
  branch_id uuid not null,
  customer_id uuid not null,
  entity_kind text not null,
  entity_id uuid not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  actor_membership_id uuid not null,
  device_id uuid not null,
  operation text not null,
  idempotency_key uuid not null,
  command_fingerprint text not null,
  expected_version bigint not null,
  result_version bigint not null,
  result_record jsonb not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint customer_command_events_branch_fk foreign key (restaurant_id, branch_id)
    references app.branches (restaurant_id, id) on delete restrict,
  constraint customer_command_events_customer_fk foreign key (restaurant_id, customer_id)
    references app.customers (restaurant_id, id) on delete restrict,
  constraint customer_command_events_actor_scope_fk foreign key (restaurant_id, branch_id, actor_membership_id, actor_id)
    references app.memberships (restaurant_id, branch_id, id, user_id) on delete restrict,
  constraint customer_command_events_entity_valid check (
    (entity_kind = 'profile' and entity_id = customer_id and operation = 'customer.profile_saved') or
    (entity_kind = 'address' and operation in ('customer.address_saved','customer.address_validated'))
  ),
  constraint customer_command_events_fingerprint_valid check (command_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint customer_command_events_versions_valid check (
    expected_version between 0 and 9007199254740990 and result_version = expected_version + 1
  ),
  constraint customer_command_events_result_valid check (
    pg_catalog.jsonb_typeof(result_record) = 'object' and
    ((entity_kind = 'profile' and result_record - array['schemaVersion','restaurantId','customerId','displayName','phones','version','createdAt','updatedAt','deletedAt'] = '{}'::jsonb) or
     (entity_kind = 'address' and result_record - array['schemaVersion','restaurantId','customerId','addressId','address','validation','version','createdAt','updatedAt','deletedAt'] = '{}'::jsonb)) and
    result_record -> 'schemaVersion' = '1'::jsonb and
    result_record ->> 'restaurantId' = restaurant_id::text and
    result_record ->> 'customerId' = customer_id::text and
    result_record ->> 'version' = result_version::text and
    (entity_kind = 'profile' or result_record ->> 'addressId' = entity_id::text) and
    result_record -> 'deletedAt' = 'null'::jsonb
  ),
  constraint customer_command_events_idempotency_unique unique (actor_id, restaurant_id, branch_id, idempotency_key),
  constraint customer_command_events_version_unique unique (restaurant_id, entity_kind, customer_id, entity_id, result_version)
);
alter table app.customer_command_events enable row level security;
alter table app.customer_command_events force row level security;
revoke all on app.customer_command_events from public, anon, authenticated, service_role, app_api;

create function app_private.mutate_customer_directory(p_actor_id uuid, p_operation text, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  restaurant uuid;
  branch uuid;
  customer uuid;
  entity uuid;
  event uuid;
  device uuid;
  member uuid;
  expected bigint;
  occurred timestamptz;
  observed timestamptz;
  fingerprint text;
  current_customer app.customers%rowtype;
  current_address app.customer_addresses%rowtype;
  stored app.customer_command_events%rowtype;
  result_record jsonb;
  field_name text;
  max_length integer;
  field_value jsonb;
  latitude integer;
  longitude integer;
  common_keys text[] := array['schemaVersion','scope','customerId','expectedVersion','eventId','deviceId','idempotencyKey','occurredAt'];
begin
  if p_actor_id is null or p_operation is null or p_operation not in ('customer.profile_saved','customer.address_saved','customer.address_validated')
    or not app_private.jsonb_has_exact_keys(p_command,
      case p_operation
        when 'customer.profile_saved' then common_keys || array['displayName','phones']
        when 'customer.address_saved' then common_keys || array['addressId','address']
        else common_keys || array['addressId'] end)
    or not app_private.jsonb_has_exact_keys(p_command -> 'scope', array['restaurantId','branchId'])
    or p_command -> 'schemaVersion' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_command -> 'expectedVersion') is distinct from 'number'
    or not coalesce(p_command ->> 'expectedVersion' ~ '^(0|[1-9][0-9]*)$', false)
    or not coalesce(p_command ->> 'idempotencyKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;
  begin
    restaurant := (p_command #>> '{scope,restaurantId}')::uuid;
    branch := (p_command #>> '{scope,branchId}')::uuid;
    customer := (p_command ->> 'customerId')::uuid;
    entity := case when p_operation = 'customer.profile_saved' then customer else (p_command ->> 'addressId')::uuid end;
    event := (p_command ->> 'eventId')::uuid;
    device := (p_command ->> 'deviceId')::uuid;
    expected := (p_command ->> 'expectedVersion')::bigint;
    occurred := (p_command ->> 'occurredAt')::timestamptz;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    return pg_catalog.jsonb_build_object('status','rejected');
  end;
  if restaurant is null or branch is null or customer is null or entity is null or event is null or device is null
    or expected not between 0 and 9007199254740990 or occurred is null
    or p_command ->> 'occurredAt' is distinct from pg_catalog.to_char(occurred at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    or (p_operation = 'customer.address_validated' and expected = 0)
  then return pg_catalog.jsonb_build_object('status','rejected'); end if;

  if p_operation = 'customer.profile_saved' then
    if pg_catalog.jsonb_typeof(p_command -> 'displayName') is distinct from 'string'
      or char_length(p_command ->> 'displayName') not between 1 and 120
      or p_command ->> 'displayName' <> btrim(p_command ->> 'displayName')
      or p_command ->> 'displayName' ~ '[[:cntrl:]]'
      or pg_catalog.jsonb_typeof(p_command -> 'phones') is distinct from 'array'
      or pg_catalog.jsonb_array_length(p_command -> 'phones') > 20
      or exists (select 1 from pg_catalog.jsonb_array_elements(p_command -> 'phones') as phone
        where not app_private.jsonb_has_exact_keys(phone,array['contactId','label','displayValue'])
          or not coalesce(phone ->> 'contactId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
          or pg_catalog.jsonb_typeof(phone -> 'label') is distinct from 'string'
          or char_length(phone ->> 'label') not between 1 and 40 or phone ->> 'label' <> btrim(phone ->> 'label') or phone ->> 'label' ~ '[[:cntrl:]]'
          or pg_catalog.jsonb_typeof(phone -> 'displayValue') is distinct from 'string'
          or char_length(phone ->> 'displayValue') not between 1 and 80 or phone ->> 'displayValue' <> btrim(phone ->> 'displayValue')
          or phone ->> 'displayValue' !~ '^[+0-9 ().-]+$'
          or pg_catalog.translate(phone ->> 'displayValue',' ().-','') !~ '^\+?[0-9]{1,20}$')
      or (select count(*) from pg_catalog.jsonb_array_elements(p_command -> 'phones')) is distinct from
        (select count(distinct phone ->> 'contactId') from pg_catalog.jsonb_array_elements(p_command -> 'phones') as phone)
    then return pg_catalog.jsonb_build_object('status','rejected'); end if;
  elsif p_operation = 'customer.address_saved' then
    if not app_private.jsonb_has_exact_keys(p_command -> 'address',array['label','streetLine','unit','neighborhood','locality','region','countryCode','postalCode','references','instructions','coordinates'])
      or pg_catalog.jsonb_typeof(p_command #> '{address,label}') is distinct from 'string'
      or char_length(p_command #>> '{address,label}') not between 1 and 40
      or p_command #>> '{address,label}' <> btrim(p_command #>> '{address,label}')
      or p_command #>> '{address,label}' ~ '[[:cntrl:]]'
    then return pg_catalog.jsonb_build_object('status','rejected'); end if;
    for field_name,max_length in select * from (values
      ('streetLine',200),('unit',200),('neighborhood',200),('locality',200),('region',200),('postalCode',200),('references',500),('instructions',500)
    ) as limits(name,maximum) loop
      field_value := p_command -> 'address' -> field_name;
      if field_value <> 'null'::jsonb and (pg_catalog.jsonb_typeof(field_value) is distinct from 'string'
        or char_length(field_value #>> '{}') not between 1 and max_length
        or field_value #>> '{}' <> btrim(field_value #>> '{}') or field_value #>> '{}' ~ '[[:cntrl:]]')
      then return pg_catalog.jsonb_build_object('status','rejected'); end if;
    end loop;
    if p_command #> '{address,countryCode}' <> 'null'::jsonb
      and (pg_catalog.jsonb_typeof(p_command #> '{address,countryCode}') is distinct from 'string'
        or p_command #>> '{address,countryCode}' !~ '^[A-Z]{2}$')
    then return pg_catalog.jsonb_build_object('status','rejected'); end if;
    if p_command #> '{address,coordinates}' <> 'null'::jsonb then
      if not app_private.jsonb_has_exact_keys(p_command #> '{address,coordinates}',array['latitudeE6','longitudeE6'])
        or pg_catalog.jsonb_typeof(p_command #> '{address,coordinates,latitudeE6}') is distinct from 'number'
        or pg_catalog.jsonb_typeof(p_command #> '{address,coordinates,longitudeE6}') is distinct from 'number'
        or not coalesce(p_command #>> '{address,coordinates,latitudeE6}' ~ '^-?(0|[1-9][0-9]*)$',false)
        or not coalesce(p_command #>> '{address,coordinates,longitudeE6}' ~ '^-?(0|[1-9][0-9]*)$',false)
      then return pg_catalog.jsonb_build_object('status','rejected'); end if;
      begin
        latitude := (p_command #>> '{address,coordinates,latitudeE6}')::integer;
        longitude := (p_command #>> '{address,coordinates,longitudeE6}')::integer;
      exception when numeric_value_out_of_range then return pg_catalog.jsonb_build_object('status','rejected'); end;
      if latitude not between -90000000 and 90000000 or longitude not between -180000000 and 180000000
      then return pg_catalog.jsonb_build_object('status','rejected'); end if;
    end if;
  end if;

  select m.id into member from app.memberships as m
    join app.branches as b on b.id = m.branch_id and b.restaurant_id = m.restaurant_id
    join app.restaurants as r on r.id = m.restaurant_id
    join app.membership_role_grants as g on g.membership_id = m.id
    where m.user_id = p_actor_id and m.restaurant_id = restaurant and m.branch_id = branch
      and m.revoked_at is null and b.disabled_at is null and r.disabled_at is null and g.revoked_at is null
      and g.role_code in ('owner','admin','manager','supervisor','cashier','waiter')
    order by g.role_code limit 1 for share of m,b,r,g;
  if member is null then return pg_catalog.jsonb_build_object('status','denied'); end if;

  fingerprint := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_operation || ':' || p_command::text || ':' || p_actor_id::text,'UTF8')),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'customer-command:' || p_actor_id::text || ':' || restaurant::text || ':' || branch::text || ':' || (p_command ->> 'idempotencyKey'),0));
  select * into stored from app.customer_command_events where actor_id = p_actor_id and restaurant_id = restaurant
    and branch_id = branch and idempotency_key = (p_command ->> 'idempotencyKey')::uuid;
  if found then
    if stored.operation <> p_operation or stored.command_fingerprint <> fingerprint
    then return pg_catalog.jsonb_build_object('status','conflict'); end if;
    return pg_catalog.jsonb_build_object('status','replayed','record',stored.result_record);
  end if;

  begin
    if p_operation = 'customer.profile_saved' then
      if expected = 0 then
        observed := date_trunc('milliseconds',pg_catalog.clock_timestamp());
        insert into app.customers (id,restaurant_id,display_name,version,created_at,updated_at,created_by,updated_by)
          values (customer,restaurant,p_command ->> 'displayName',1,observed,observed,p_actor_id,p_actor_id)
          returning * into current_customer;
      else
        select * into current_customer from app.customers where restaurant_id = restaurant and id = customer for update;
        if not found or current_customer.version <> expected or current_customer.deleted_at is not null
        then return pg_catalog.jsonb_build_object('status','conflict'); end if;
        observed := greatest(date_trunc('milliseconds',pg_catalog.clock_timestamp()),current_customer.updated_at);
        update app.customers set display_name = p_command ->> 'displayName',version = expected + 1,
          updated_at = observed,updated_by = p_actor_id where restaurant_id = restaurant and id = customer
          returning * into current_customer;
      end if;
      update app.customer_phones set deleted_at = observed,updated_at = observed
        where restaurant_id = restaurant and customer_id = customer and deleted_at is null
          and not exists (select 1 from pg_catalog.jsonb_array_elements(p_command -> 'phones') as phone
            where (phone ->> 'contactId')::uuid = contact_id);
      insert into app.customer_phones (restaurant_id,customer_id,contact_id,label,display_value,normalized_value,created_at,updated_at,deleted_at)
        select restaurant,customer,(phone ->> 'contactId')::uuid,phone ->> 'label',phone ->> 'displayValue',
          pg_catalog.translate(phone ->> 'displayValue',' ().-',''),observed,observed,null
        from pg_catalog.jsonb_array_elements(p_command -> 'phones') as phone
        on conflict (restaurant_id,customer_id,contact_id) do update set label = excluded.label,
          display_value = excluded.display_value,normalized_value = excluded.normalized_value,
          updated_at = excluded.updated_at,deleted_at = null;
      result_record := pg_catalog.jsonb_build_object('schemaVersion',1,'restaurantId',restaurant::text,'customerId',customer::text,
        'displayName',current_customer.display_name,'phones',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'contactId',phone ->> 'contactId','label',phone ->> 'label','displayValue',phone ->> 'displayValue',
          'normalizedValue',pg_catalog.translate(phone ->> 'displayValue',' ().-','')) order by ordinality)
          from pg_catalog.jsonb_array_elements(p_command -> 'phones') with ordinality as item(phone,ordinality)),'[]'::jsonb),
        'version',current_customer.version,
        'createdAt',pg_catalog.to_char(current_customer.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt',pg_catalog.to_char(current_customer.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'deletedAt',null);
    elsif p_operation = 'customer.address_saved' then
      perform 1 from app.customers where restaurant_id = restaurant and id = customer and deleted_at is null for share;
      if not found then return pg_catalog.jsonb_build_object('status','conflict'); end if;
      if expected = 0 then
        observed := date_trunc('milliseconds',pg_catalog.clock_timestamp());
        insert into app.customer_addresses (id,restaurant_id,customer_id,label,street_line,unit,neighborhood,locality,region,country_code,
          postal_code,references_text,instructions,latitude_e6,longitude_e6,version,created_at,updated_at,created_by,updated_by)
        values (entity,restaurant,customer,p_command #>> '{address,label}',p_command #>> '{address,streetLine}',p_command #>> '{address,unit}',
          p_command #>> '{address,neighborhood}',p_command #>> '{address,locality}',p_command #>> '{address,region}',p_command #>> '{address,countryCode}',
          p_command #>> '{address,postalCode}',p_command #>> '{address,references}',p_command #>> '{address,instructions}',latitude,longitude,
          1,observed,observed,p_actor_id,p_actor_id) returning * into current_address;
      else
        select * into current_address from app.customer_addresses where restaurant_id = restaurant and customer_id = customer and id = entity for update;
        if not found or current_address.version <> expected or current_address.deleted_at is not null
        then return pg_catalog.jsonb_build_object('status','conflict'); end if;
        observed := greatest(date_trunc('milliseconds',pg_catalog.clock_timestamp()),current_address.updated_at);
        update app.customer_addresses set label=p_command #>> '{address,label}',street_line=p_command #>> '{address,streetLine}',
          unit=p_command #>> '{address,unit}',neighborhood=p_command #>> '{address,neighborhood}',locality=p_command #>> '{address,locality}',
          region=p_command #>> '{address,region}',country_code=p_command #>> '{address,countryCode}',postal_code=p_command #>> '{address,postalCode}',
          references_text=p_command #>> '{address,references}',instructions=p_command #>> '{address,instructions}',latitude_e6=latitude,longitude_e6=longitude,
          validation_branch_id=null,validation_event_id=null,validated_by=null,validation_device_id=null,validated_at=null,
          version=expected+1,updated_at=observed,updated_by=p_actor_id
          where restaurant_id=restaurant and customer_id=customer and id=entity returning * into current_address;
      end if;
    else
      select * into current_address from app.customer_addresses where restaurant_id=restaurant and customer_id=customer and id=entity for update;
      if not found or current_address.version <> expected or current_address.deleted_at is not null
        or current_address.street_line is null or current_address.locality is null or current_address.country_code is null
      then return pg_catalog.jsonb_build_object('status','conflict'); end if;
      observed := greatest(date_trunc('milliseconds',pg_catalog.clock_timestamp()),current_address.updated_at);
      update app.customer_addresses set validation_branch_id=branch,validation_event_id=event,validated_by=p_actor_id,
        validation_device_id=device,validated_at=observed,version=expected+1,updated_at=observed,updated_by=p_actor_id
        where restaurant_id=restaurant and customer_id=customer and id=entity returning * into current_address;
    end if;

    if p_operation <> 'customer.profile_saved' then
      result_record := pg_catalog.jsonb_build_object('schemaVersion',1,'restaurantId',restaurant::text,'customerId',customer::text,
        'addressId',entity::text,'address',pg_catalog.jsonb_build_object('label',current_address.label,'streetLine',current_address.street_line,
          'unit',current_address.unit,'neighborhood',current_address.neighborhood,'locality',current_address.locality,'region',current_address.region,
          'countryCode',current_address.country_code,'postalCode',current_address.postal_code,'references',current_address.references_text,
          'instructions',current_address.instructions,'coordinates',case when current_address.latitude_e6 is null then null else
            pg_catalog.jsonb_build_object('latitudeE6',current_address.latitude_e6,'longitudeE6',current_address.longitude_e6) end),
        'validation',case when current_address.validation_branch_id is null then null else pg_catalog.jsonb_build_object(
          'branchId',current_address.validation_branch_id::text,'eventId',current_address.validation_event_id::text,
          'actorId',current_address.validated_by::text,'deviceId',current_address.validation_device_id::text,
          'validatedAt',pg_catalog.to_char(current_address.validated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) end,
        'version',current_address.version,
        'createdAt',pg_catalog.to_char(current_address.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt',pg_catalog.to_char(current_address.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'deletedAt',null);
    end if;

    insert into app.customer_command_events (event_id,restaurant_id,branch_id,customer_id,entity_kind,entity_id,
      actor_id,actor_membership_id,device_id,operation,idempotency_key,command_fingerprint,expected_version,result_version,
      result_record,occurred_at,received_at)
    values (event,restaurant,branch,customer,case when p_operation='customer.profile_saved' then 'profile' else 'address' end,entity,
      p_actor_id,member,device,p_operation,(p_command ->> 'idempotencyKey')::uuid,fingerprint,expected,expected+1,result_record,occurred,observed);
  exception when unique_violation then return pg_catalog.jsonb_build_object('status','conflict');
  end;
  return pg_catalog.jsonb_build_object('status','applied','record',result_record);
end
$function$;

alter function app_private.mutate_customer_directory(uuid,text,jsonb) owner to postgres;
revoke all on function app_private.mutate_customer_directory(uuid,text,jsonb) from public,anon,authenticated,service_role,app_api;
grant execute on function app_private.mutate_customer_directory(uuid,text,jsonb) to app_api;

commit;
