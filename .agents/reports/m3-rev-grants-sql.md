VEREDICTO: CORREGIR

P1 `apps/api/src/operations/app-api-recovery.ts:267-269,293-308,338` — el predicado `safe` exige `not has_schema_privilege(app_api,'app','usage')` y cero privilegios de tabla en `app`; como la migración concede ambos, `readAppApiLifecycleTarget` lanza en precheck y rompe `recover:app-api:remote` y `verify:app-api-state:remote` (no se puede deshabilitar/rotar la credencial de un `app_api` comprometido). Además `tenancy_memberships_runtime_catalog.sql:235-259` fija el mismo invariante y quedaría inservible tras migrar. Corrección: ampliar predicado+allowlist+SHA pineado a exactamente `USAGE(app)` + `SELECT/INSERT/UPDATE` en `app.inventory_items|inventory_warehouses`, o usar `app_private` SECURITY DEFINER (patrón del repo) en vez de DML directo.
P2 `apps/api/src/inventory/items.service.ts:31-32,208-210,240-242` — `readItem/readWarehouse` leen por `id` sin `restaurant_id`; con `USING(true)` eso ya no falla y permite oráculo de existencia 403 vs 404 entre tenants, y read/write cross-tenant si se filtra la credencial `app_api`. Corrección: filtrar por el scope autorizado en el SELECT o mover la consulta a una función SECURITY DEFINER.
P2 `supabase/tests/inventory_catalog_invariants.sql:37-39` — la aserción positiva usa `'SELECT,INSERT,UPDATE'` en una sola llamada (no distingue cuál de los tres existe); la prueba dedicada `inventory_api_grants_invariants.sql:25-33` sí los comprueba, pero conviene desdoblarla.
P3 `supabase/migrations/20261126000600_inventory_api_grants.sql:13-49` — `create policy` sin `drop policy if exists` no es re-ejecutable (consistente con migraciones one-shot del repo); `revoke delete` es redundante (ya revocado en `20261126000100:53`).
Respuestas: 1) sí, solo `app_api`; `anon/authenticated/service_role/public` intactos (revocados en 00100). 2) sí, las 6 políticas son `to app_api` y el test prueba que un `authenticated` no-miembro ve 0. 3) sí, prueba DML real (insert/update/select) y rechazo DELETE, y sin la migración falla el `has_schema_privilege`. 4) sí: CI aplica todas las migraciones antes de los tests (`.github/workflows/ci.yml:116-164` y `:165-180`) y el verificador aplica todos los nombres antes de las invariantes (`run-inventory-schema-verification.ts:16,21-25`). 5) ver P1/P2.
```powershell
PS> Select-String -Path apps/api/src/operations/app-api-recovery.ts -Pattern "not pg_catalog.has_schema_privilege\(roles.oid, 'app'|privileges\(privilege_name\)|state\?\.safe !== true"
268:and not pg_catalog.has_schema_privilege(roles.oid, 'app', 'usage')
300:) as privileges(privilege_name)
338:|| state?.safe !== true
PS> Select-String -Path supabase/migrations/20261126000600_inventory_api_grants.sql -Pattern "^grant|^revoke|^create policy"
8:grant usage on schema app to app_api;
10:grant select, insert, update on app.inventory_items, app.inventory_warehouses to app_api;
13:create policy inventory_items_api_read
PS> "migrations=" + (Get-ChildItem supabase/migrations/*.sql).Count
migrations=80
```
NO VERIFICADO: no ejecuté PostgreSQL ni la suite (el brief lo prohíbe); no reproduje el `baseline policies:10` ni el veredicto verde del orquestador.