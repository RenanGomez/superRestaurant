VEREDICTO: CAMBIOS
P1 apps/api/src/inventory/items.service.ts:29-62 — hace SELECT/INSERT/UPDATE directos a app.inventory_items/app.inventory_warehouses conectando como app_api, pero 20261126000100_inventory_catalog.sql:53 revoca todo a app_api, :54 solo concede SELECT a authenticated y las políticas RLS (:61-70) son solo `to authenticated`; todo GET/POST/PATCH fallará con 42501 y el catch (:316-319) lo vuelve 503. Evidencia: apps/api/.env.example:3 usa `postgresql://app_api...`; el patrón del repo es app_private (delivery-zones.ts:133).
P2 apps/api/src/inventory/items.service.ts:318 — solo 23505 se traduce a 409; checks/FKs (23514/23503) caen en `unavailable` 503. Ejemplo: `name` de 161-200 chars pasa `isBoundedText(name,200)` (packages/shared-types/src/inventory.ts) pero la constraint admite 1..160, así que un POST válido por contrato devuelve 503.
P3 apps/api/src/inventory/items.service.ts:301-304 — `authorizeBranchScope` traduce cualquier fallo (incluida caída de BD/autorización) a 403, mientras `authorizeRestaurant` (:286) sí devuelve 503.
P3 apps/api/src/inventory/items.service.ts:31-32,208-210 — `findItemSql`/`findWarehouseSql` no llevan scope y devuelven `missing` (404) antes de autorizar, permitiendo distinguir ids ajenos de inexistentes.
P3 apps/api/src/inventory/items.test.ts:71,258 — FakeDatabase no cubre grants/RLS ni 23514/23503; por eso el P1 pasa inadvertido (las pruebas solo prueban la lógica con SQL simulado).

Verificación (lectura, sin ejecutar pruebas por modo solo lectura):
```
$ git show harness/m3-api-items:supabase/migrations/20261126000100_inventory_catalog.sql | Select-String "app_api|to authenticated"
revoke all on app.inventory_items, app.inventory_warehouses from public, anon, authenticated, service_role, app_api;
grant select on app.inventory_items, app.inventory_warehouses to authenticated;
create policy inventory_items_active_member_read ... for select to authenticated ...
```
NO VERIFICADO: no ejecuté `tsc` ni `items.test.js` (modo plan de solo lectura); no hay base local para probar el 42501 en runtime.