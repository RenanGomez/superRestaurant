begin;

create or replace function app_private.create_dining_table(
  p_actor_id uuid, p_restaurant_id uuid, p_branch_id uuid, p_table_id uuid, p_zone_id uuid,
  p_event_id uuid, p_idempotency_key uuid, p_device_id uuid, p_occurred_at timestamptz,
  p_name text, p_capacity integer, p_shape text, p_x integer, p_y integer, p_width integer, p_height integer
) returns table (
  status text, schema_version integer, restaurant_id uuid, branch_id uuid, table_id uuid, zone_id uuid,
  table_name text, capacity integer, shape text, layout_x integer, layout_y integer, layout_width integer,
  layout_height integer, table_version bigint, updated_at timestamptz, updated_by uuid
) language plpgsql volatile security definer set search_path = '' as $function$
declare existing_audit app.dining_table_audit_events%rowtype; current_table app.dining_tables%rowtype;
begin
  if p_actor_id is null or p_restaurant_id is null or p_branch_id is null or p_table_id is null or p_zone_id is null
    or p_event_id is null or p_idempotency_key is null or p_device_id is null or p_occurred_at is null
    or p_name is null or p_name <> pg_catalog.btrim(p_name) or pg_catalog.char_length(p_name) not between 1 and 40 or p_name ~ '[[:cntrl:]]'
    or p_capacity not between 1 and 50 or p_shape not in ('round','square','rectangle')
    or p_x not between 0 and 23 or p_y not between 0 and 99 or p_width not between 2 and 8 or p_height not between 2 and 8
    or p_x + p_width > 24 or p_y + p_height > 100
  then return query select 'conflict', null::integer, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::integer, null::text, null::integer, null::integer, null::integer, null::integer, null::bigint, null::timestamptz, null::uuid; return; end if;
  if not exists (
    select 1 from app.memberships m join app.membership_role_grants rg on rg.membership_id=m.id and rg.revoked_at is null and rg.role_code in ('owner','admin','manager')
    join app.restaurants r on r.id=m.restaurant_id and r.disabled_at is null
    join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id and b.disabled_at is null
    where m.user_id=p_actor_id and m.restaurant_id=p_restaurant_id and m.branch_id=p_branch_id and m.revoked_at is null
  ) then return query select 'forbidden', null::integer, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::integer, null::text, null::integer, null::integer, null::integer, null::integer, null::bigint, null::timestamptz, null::uuid; return; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dining-table:' || p_table_id::text, 0));
  select audit.* into existing_audit from app.dining_table_audit_events as audit
    where audit.actor_id=p_actor_id and audit.restaurant_id=p_restaurant_id and audit.branch_id=p_branch_id and audit.idempotency_key=p_idempotency_key;
  if found then
    if existing_audit.event_id<>p_event_id or existing_audit.table_id<>p_table_id or existing_audit.zone_id<>p_zone_id or existing_audit.device_id<>p_device_id
      or existing_audit.operation<>'created' or existing_audit.occurred_at<>p_occurred_at or existing_audit.name_snapshot<>p_name
      or existing_audit.capacity_snapshot<>p_capacity or existing_audit.shape_snapshot<>p_shape or existing_audit.layout_x_snapshot<>p_x
      or existing_audit.layout_y_snapshot<>p_y or existing_audit.layout_width_snapshot<>p_width or existing_audit.layout_height_snapshot<>p_height
    then return query select 'conflict', null::integer, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::integer, null::text, null::integer, null::integer, null::integer, null::integer, null::bigint, null::timestamptz, null::uuid; return; end if;
    select dining_table.* into strict current_table from app.dining_tables as dining_table
      where dining_table.restaurant_id=p_restaurant_id and dining_table.branch_id=p_branch_id and dining_table.id=p_table_id;
    return query select 'replayed',1,current_table.restaurant_id,current_table.branch_id,current_table.id,existing_audit.zone_id,existing_audit.name_snapshot,existing_audit.capacity_snapshot,existing_audit.shape_snapshot,existing_audit.layout_x_snapshot,existing_audit.layout_y_snapshot,existing_audit.layout_width_snapshot,existing_audit.layout_height_snapshot,existing_audit.result_version,existing_audit.result_updated_at,existing_audit.actor_id; return;
  end if;
  if exists(select 1 from app.dining_table_audit_events as audit where audit.event_id=p_event_id) then return query select 'conflict', null::integer, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::integer, null::text, null::integer, null::integer, null::integer, null::integer, null::bigint, null::timestamptz, null::uuid; return; end if;

  insert into app.dining_tables(id,restaurant_id,branch_id,zone_id,name,capacity,shape,layout_x,layout_y,layout_width,layout_height,created_by,updated_by)
    values(p_table_id,p_restaurant_id,p_branch_id,p_zone_id,p_name,p_capacity,p_shape,p_x,p_y,p_width,p_height,p_actor_id,p_actor_id)
    on conflict do nothing returning * into current_table;
  if not found then return query select 'conflict', null::integer, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::integer, null::text, null::integer, null::integer, null::integer, null::integer, null::bigint, null::timestamptz, null::uuid; return; end if;
  insert into app.dining_table_audit_events(event_id,idempotency_key,restaurant_id,branch_id,table_id,zone_id,actor_id,device_id,operation,expected_version,result_version,result_updated_at,name_snapshot,capacity_snapshot,shape_snapshot,layout_x_snapshot,layout_y_snapshot,layout_width_snapshot,layout_height_snapshot,occurred_at)
    values(p_event_id,p_idempotency_key,p_restaurant_id,p_branch_id,p_table_id,p_zone_id,p_actor_id,p_device_id,'created',null,1,current_table.updated_at,p_name,p_capacity,p_shape,p_x,p_y,p_width,p_height,p_occurred_at);
  return query select 'created',1,current_table.restaurant_id,current_table.branch_id,current_table.id,current_table.zone_id,current_table.name,current_table.capacity,current_table.shape,current_table.layout_x,current_table.layout_y,current_table.layout_width,current_table.layout_height,current_table.version,current_table.updated_at,current_table.updated_by;
end $function$;

create or replace function app_private.update_dining_table_layout(
  p_actor_id uuid, p_restaurant_id uuid, p_branch_id uuid, p_table_id uuid, p_event_id uuid,
  p_idempotency_key uuid, p_device_id uuid, p_occurred_at timestamptz, p_expected_version bigint,
  p_x integer, p_y integer, p_width integer, p_height integer
) returns table (
  status text, schema_version integer, restaurant_id uuid, branch_id uuid, table_id uuid, zone_id uuid,
  table_name text, capacity integer, shape text, layout_x integer, layout_y integer, layout_width integer,
  layout_height integer, table_version bigint, updated_at timestamptz, updated_by uuid
) language plpgsql volatile security definer set search_path = '' as $function$
declare existing_audit app.dining_table_audit_events%rowtype; current_table app.dining_tables%rowtype;
begin
  if p_actor_id is null or p_restaurant_id is null or p_branch_id is null or p_table_id is null
    or p_event_id is null or p_idempotency_key is null or p_device_id is null or p_occurred_at is null
    or p_expected_version is null or p_expected_version < 1
    or p_x not between 0 and 23 or p_y not between 0 and 99 or p_width not between 2 and 8 or p_height not between 2 and 8
    or p_x + p_width > 24 or p_y + p_height > 100
  then return query select 'conflict', null::integer, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::integer, null::text, null::integer, null::integer, null::integer, null::integer, null::bigint, null::timestamptz, null::uuid; return; end if;
  if not exists (
    select 1 from app.memberships m join app.membership_role_grants rg on rg.membership_id=m.id and rg.revoked_at is null and rg.role_code in ('owner','admin','manager')
    join app.restaurants r on r.id=m.restaurant_id and r.disabled_at is null
    join app.branches b on b.id=m.branch_id and b.restaurant_id=m.restaurant_id and b.disabled_at is null
    where m.user_id=p_actor_id and m.restaurant_id=p_restaurant_id and m.branch_id=p_branch_id and m.revoked_at is null
  ) then return query select 'forbidden', null::integer, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::integer, null::text, null::integer, null::integer, null::integer, null::integer, null::bigint, null::timestamptz, null::uuid; return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dining-table:' || p_table_id::text, 0));
  select audit.* into existing_audit from app.dining_table_audit_events as audit
    where audit.actor_id=p_actor_id and audit.restaurant_id=p_restaurant_id and audit.branch_id=p_branch_id and audit.idempotency_key=p_idempotency_key;
  if found then
    if existing_audit.event_id<>p_event_id or existing_audit.table_id<>p_table_id or existing_audit.device_id<>p_device_id or existing_audit.operation<>'layout_updated'
      or existing_audit.occurred_at<>p_occurred_at or existing_audit.expected_version<>p_expected_version or existing_audit.layout_x_snapshot<>p_x
      or existing_audit.layout_y_snapshot<>p_y or existing_audit.layout_width_snapshot<>p_width or existing_audit.layout_height_snapshot<>p_height
    then return query select 'conflict', null::integer, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::integer, null::text, null::integer, null::integer, null::integer, null::integer, null::bigint, null::timestamptz, null::uuid; return; end if;
    return query select 'replayed',1,existing_audit.restaurant_id,existing_audit.branch_id,existing_audit.table_id,existing_audit.zone_id,existing_audit.name_snapshot,existing_audit.capacity_snapshot,existing_audit.shape_snapshot,existing_audit.layout_x_snapshot,existing_audit.layout_y_snapshot,existing_audit.layout_width_snapshot,existing_audit.layout_height_snapshot,existing_audit.result_version,existing_audit.result_updated_at,existing_audit.actor_id; return;
  end if;
  if exists(select 1 from app.dining_table_audit_events as audit where audit.event_id=p_event_id) then return query select 'conflict', null::integer, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::integer, null::text, null::integer, null::integer, null::integer, null::integer, null::bigint, null::timestamptz, null::uuid; return; end if;
  update app.dining_tables as dining_table
    set layout_x=p_x,layout_y=p_y,layout_width=p_width,layout_height=p_height,version=dining_table.version+1,updated_at=pg_catalog.clock_timestamp(),updated_by=p_actor_id
    where dining_table.restaurant_id=p_restaurant_id and dining_table.branch_id=p_branch_id and dining_table.id=p_table_id and dining_table.version=p_expected_version and dining_table.deleted_at is null
    returning dining_table.* into current_table;
  if not found then return query select 'conflict', null::integer, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::integer, null::text, null::integer, null::integer, null::integer, null::integer, null::bigint, null::timestamptz, null::uuid; return; end if;
  insert into app.dining_table_audit_events(event_id,idempotency_key,restaurant_id,branch_id,table_id,zone_id,actor_id,device_id,operation,expected_version,result_version,result_updated_at,name_snapshot,capacity_snapshot,shape_snapshot,layout_x_snapshot,layout_y_snapshot,layout_width_snapshot,layout_height_snapshot,occurred_at)
    values(p_event_id,p_idempotency_key,p_restaurant_id,p_branch_id,p_table_id,current_table.zone_id,p_actor_id,p_device_id,'layout_updated',p_expected_version,current_table.version,current_table.updated_at,current_table.name,current_table.capacity,current_table.shape,p_x,p_y,p_width,p_height,p_occurred_at);
  return query select 'updated',1,current_table.restaurant_id,current_table.branch_id,current_table.id,current_table.zone_id,current_table.name,current_table.capacity,current_table.shape,current_table.layout_x,current_table.layout_y,current_table.layout_width,current_table.layout_height,current_table.version,current_table.updated_at,current_table.updated_by;
end $function$;

alter function app_private.create_dining_table(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text,integer,integer,integer,integer) owner to postgres;
alter function app_private.update_dining_table_layout(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,integer,integer,integer,integer) owner to postgres;

commit;
