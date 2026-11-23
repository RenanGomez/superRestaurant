begin;

do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('app_private.confirm_capture_draft_v3(uuid,jsonb,jsonb,jsonb)'::regprocedure);
  old_groups constant text := 'array[product.base_group_id] || product.extra_group_ids, null';
  new_groups constant text := 'product.base_group_ids || coalesce((
          select pg_catalog.array_agg(distinct pizza_extra_option.group_id)
          from app.menu_modifier_options pizza_extra_option
          where pizza_extra_option.restaurant_id=restaurant and pizza_extra_option.catalog_id=catalog
            and pizza_extra_option.id = any (product.extra_option_ids)
        ), ''{}''::uuid[]), null';
  old_removal constant text := 'removed_option.group_id=removed_product.base_group_id';
  new_removal constant text := 'removed_option.group_id = any (removed_product.base_group_ids)';
begin
  if pg_catalog.strpos(definition, old_groups) = 0 or pg_catalog.strpos(definition, old_removal) = 0 then
    raise exception 'M0-7: unexpected confirm_capture_draft_v3 definition';
  end if;
  definition := pg_catalog.replace(pg_catalog.replace(definition, old_groups, new_groups), old_removal, new_removal);
  execute definition;
end
$migration$;

commit;
