I'll review the SQL branch per the brief. Since this is a read-only review task and plan mode is active, I'll gather evidence and produce the report.
VEREDICTO: APROBAR

P3 `supabase/migrations/20261126001400_inventory_purchasing_reads.sql:314-316` — reasigna `owner to postgres` pero omite el bloque `do $owner$` de `20261126001000_inventory_purchasing_api.sql` que validaba `postgres` (rolbypassrls) y `app_api` restringido; no cambia privilegios efectivos, solo resta defensa en profundidad.
P3 `supabase/migrations/20261126001000_inventory_purchasing_api.sql:571,579,581` — los `comment on function` siguen diciendo "manage-only" para las tres lecturas ahora abiertas a `catalog.read`; `create or replace` conserva el comentario (mismo OID) y `01400` no lo reescribe, así que la BD queda documentando lo contrario.
P3 `20261126001400...:47,125,235` vs `apps/api/src/auth/rbac-policy.ts` — la lista de 8 roles duplica la matriz y nada falla si cambia `catalog.read`: `rbac-policy.test.ts` solo cubre TS y el invariante re-hardcodea la lista. Desvío fail-closed (TS niega, o SQL `42501`→`authorization` en `purchasing.service.ts:409`), pero es deuda sin guard automatizado.
P3 `supabase/tests/inventory_purchasing_api_invariants.sql:143` — `owner`/`admin`/`supervisor` no se ejercen en positivo (solo manager, cashier, viewer, waiter, auditor); comparten la misma ruta, riesgo bajo.

Verificación (solo lectura; no ejecuté migraciones ni E2E):
```
# Paridad de cuerpos (normalizando solo la lista de roles)
=== list_inventory_suppliers IDENTICAL (normalized) ===
=== list_inventory_purchase_orders IDENTICAL (normalized) ===
=== read_inventory_purchase_order IDENTICAL (normalized) ===

$ git show origin/harness/o4-compras-reads:apps/api/src/auth/rbac-policy.ts | Select-String catalog.read
    "catalog.read",   # allPermissions → owner/admin/manager; luego supervisor, cashier, waiter
  viewer: permissions("branch.select", "catalog.read", "tables.read", ...),
  auditor: permissions("branch.select", "catalog.read", "tables.read", ...),
  courier: permissions("branch.select", "deliveries.read", "deliveries.update.own"),
  kitchen: permissions("branch.select", "orders.read", "kds.read", "kds.transition"),
# SQL: 'owner','admin','manager','supervisor','cashier','waiter','viewer','auditor' → coincide; courier/kitchen excluidos.

$ git show origin/harness/o4-compras-reads:...01400... | Select-String "comment on|do \$owner|pg_roles|alter function"
314: alter function ... owner to postgres;   (sin `comment on` ni `do $owner$`)
# Privilegios 01400:316-329: SECURITY DEFINER + set search_path='', revoke a public/anon/authenticated/service_role/app_api, grant solo app_api; sin DML.
# Invariantes: fixtures 2 proveedores (activo+dormant) y 1 orden → aserciones 2/1 no vacuas; kitchen/courier son miembros activos y fallan con 42501 real; escrituras, totales 75000 y foreign-invisible se conservaron.
```
NO VERIFICADO: no ejecuté `verify:inventory-schema:rollback` ni `test:http:local` ni Playwright (prohibido por el brief/modo lectura); dependo de tu reporte 91 migraciones ok y 9/9. Este archivo nunca tuvo prueba de replay (solo `idempotencyKey`), así que no hay regresión ahí.