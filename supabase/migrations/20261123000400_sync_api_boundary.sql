begin;

create function app_private.sync_device_state(p_restaurant uuid, p_branch uuid, p_device text, p_actor uuid)
returns text language sql stable security definer set search_path = '' as $f$
 select coalesce((
  select case when d.revoked_at is null then 'active' else 'revoked' end
  from app.sync_devices d
  where d.restaurant_id = p_restaurant and d.branch_id = p_branch
   and d.device_id = p_device and d.actor_id = p_actor
   and app_private.sync_authorized(p_actor,p_restaurant,p_branch)
 ), 'unknown')
$f$;

create function app_private.sync_write_allowed(p_actor uuid, p_restaurant uuid, p_branch uuid, p_entity text, p_operation text)
returns boolean language sql stable security definer set search_path = '' as $f$
 select app_private.sync_can_write(p_actor,p_restaurant,p_branch,p_entity,p_operation)
$f$;

alter function app_private.sync_device_state(uuid,uuid,text,uuid) owner to postgres;
alter function app_private.sync_write_allowed(uuid,uuid,uuid,text,text) owner to postgres;
revoke all on function app_private.sync_device_state(uuid,uuid,text,uuid), app_private.sync_write_allowed(uuid,uuid,uuid,text,text) from public, anon, authenticated, service_role, app_api;
grant execute on function app_private.sync_device_state(uuid,uuid,text,uuid), app_private.sync_write_allowed(uuid,uuid,uuid,text,text) to app_api;

commit;
