begin;

create function app_private.enforce_menu_modifier_group_command_limit()
returns trigger
language plpgsql
volatile
set search_path = ''
as $function$
declare
  required_group_count bigint;
begin
  if not new.active or new.minimum_quantity = 0 then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    select pg_catalog.count(*)
    into required_group_count
    from app.menu_modifier_groups as modifier_group
    where modifier_group.restaurant_id = new.restaurant_id
      and modifier_group.catalog_id = new.catalog_id
      and modifier_group.product_id = new.product_id
      and modifier_group.active
      and modifier_group.minimum_quantity > 0
      and not (
        modifier_group.restaurant_id = old.restaurant_id
        and modifier_group.catalog_id = old.catalog_id
        and modifier_group.id = old.id
      );
  else
    select pg_catalog.count(*)
    into required_group_count
    from app.menu_modifier_groups as modifier_group
    where modifier_group.restaurant_id = new.restaurant_id
      and modifier_group.catalog_id = new.catalog_id
      and modifier_group.product_id = new.product_id
      and modifier_group.active
      and modifier_group.minimum_quantity > 0;
  end if;

  if required_group_count >= 50 then
    raise check_violation using
      constraint = 'menu_modifier_groups_command_limit',
      message = 'MENU_MODIFIER_GROUP_COMMAND_LIMIT_EXCEEDED';
  end if;
  return new;
end
$function$;

alter function app_private.enforce_menu_modifier_group_command_limit() owner to postgres;
revoke all on function app_private.enforce_menu_modifier_group_command_limit()
  from public, anon, authenticated, service_role, app_api;

create trigger menu_modifier_groups_command_limit
before insert or update of restaurant_id, catalog_id, product_id, active, minimum_quantity
on app.menu_modifier_groups
for each row execute function app_private.enforce_menu_modifier_group_command_limit();

do $validation$
begin
  if exists (
    select 1
    from app.menu_modifier_groups as modifier_group
    where modifier_group.active and modifier_group.minimum_quantity > 0
    group by modifier_group.restaurant_id, modifier_group.catalog_id, modifier_group.product_id
    having pg_catalog.count(*) > 50
  ) then
    raise check_violation using
      constraint = 'menu_modifier_groups_command_limit',
      message = 'EXISTING_MENU_MODIFIER_GROUP_COMMAND_LIMIT_EXCEEDED';
  end if;
end
$validation$;

comment on function app_private.enforce_menu_modifier_group_command_limit() is
  'Keeps every product within the modifier-group capacity of AddOrderItemCommandV1.';
comment on trigger menu_modifier_groups_command_limit on app.menu_modifier_groups is
  'Rejects a 51st active required modifier group for one catalog product.';

commit;
