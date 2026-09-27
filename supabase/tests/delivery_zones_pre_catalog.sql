-- Test-only pre-migration baseline audit for the delivery-zones rollback verifier.
-- Never apply as a migration. Asserts none of the candidate's objects exist yet.
do $delivery_zones_pre_catalog$
begin
  if pg_catalog.to_regclass('app.delivery_zones') is not null
    or pg_catalog.to_regclass('app.delivery_zone_postal_codes') is not null
    or pg_catalog.to_regclass('app.delivery_zone_command_events') is not null
    or pg_catalog.to_regprocedure('app_private.list_delivery_zones(uuid,jsonb)') is not null
    or pg_catalog.to_regprocedure('app_private.list_active_delivery_zones_for_quote(uuid,uuid)') is not null
    or pg_catalog.to_regprocedure('app_private.upsert_delivery_zone(uuid,jsonb)') is not null
  then raise exception using errcode = '55000', message = 'DELIVERY_ZONES_PRE_CATALOG_UNEXPECTED_OBJECT'; end if;
end
$delivery_zones_pre_catalog$;
