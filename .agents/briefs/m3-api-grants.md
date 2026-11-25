# Brief m3-api-grants (nivel A · SQL inventario: privilegios de `app_api` y mapeo de errores)

## Objetivo
Cerrar el P1 de PR #90: `apps/api/src/inventory/items.service.ts` escribe con DML directo como `app_api`, pero la migración `20261126000100_inventory_catalog.sql` revoca todo a `app_api` y solo concede SELECT a `authenticated`. Crear la migración `supabase/migrations/20261126000600_inventory_api_grants.sql` con los grants y políticas RLS que hacen funcionar la API, más su prueba SQL, y corregir el mapeo de errores y el límite de nombre.

Tiempo estimado: 30 min. Ramos SQL: único escritor de `supabase/migrations/**` en esta tarea.

## Contexto (verificado en el repo; no explores el resto)
- `app_api` existe sin `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `INHERIT`, `REPLICATION` ni `BYPASSRLS` (guard de `20261126000200_inventory_ledger.sql:287-304`). Por tanto **NO tiene BYPASSRLS** y las políticas RLS son obligatorias para que sus escrituras funcionen.
- `20260830000100_create_tenancy_memberships.sql` concede `USAGE ON SCHEMA app_private` a `app_api` y `USAGE ON SCHEMA app` solo a `authenticated`. **Falta `USAGE ON SCHEMA app` para `app_api`.**
- `app.inventory_items` y `app.inventory_warehouses` tienen `ENABLE`+`FORCE ROW LEVEL SECURITY` y solo políticas `FOR SELECT TO authenticated`.
- El servicio (`apps/api/src/inventory/items.service.ts`) hace `select/insert/update` sobre esas dos tablas y **nunca** `delete` (el borrado es `deleted_at`). Filtra siempre por `restaurant_id`/`branch_id` del contexto autorizado del servidor.
- Decisión registrada (documéntala en `COMMENT ON` de la migración): `app_api` es un rol exclusivo del servidor NestJS (sin login de usuario ni exposición por Data API); la API es quien revalida `Restaurant`/`Branch` en cada consulta, así que las políticas de `app_api` son `USING (true)`/`WITH CHECK (true)` para SELECT/INSERT/UPDATE y **sin DELETE**. Ningún cliente recibe esa conexión.

## Qué hacer
1. Crear `supabase/migrations/20261126000600_inventory_api_grants.sql`:
   - `begin;` … `commit;` como el resto de migraciones.
   - `grant usage on schema app to app_api;`
   - `grant select, insert, update on app.inventory_items, app.inventory_warehouses to app_api;`
   - `revoke delete ...` explícito para `app_api` sobre ambas tablas (defensa en profundidad; no confíes en que nunca se concedió).
   - Políticas nuevas **para app_api** (`for select using (true)`, `for insert with check (true)`, `for update using (true) with check (true)`) en ambas tablas, sin tocar las políticas existentes de `authenticated`.
   - `COMMENT ON` documentando la decisión anterior y el hecho de que el filtro por tenant vive en el servidor.
2. Crear `supabase/tests/inventory_api_grants_invariants.sql` (transacción con `rollback;`, estilo de `supabase/tests/inventory_ledger_invariants.sql`) que compruebe de verdad:
   - `has_schema_privilege('app_api','app','USAGE')` y `has_table_privilege('app_api','app.inventory_items','SELECT'/'INSERT'/'UPDATE')` verdaderos, y `'DELETE'` **falso** (lo mismo para `inventory_warehouses`).
   - `set local role app_api;` insertar un insumo y un almacén válidos (restaurante/sucursal fixture), actualizarlos y leerlos ⇒ sin error; `delete from` ⇒ falla con `42501`; volver a `reset role`.
   - La política no rompe a `authenticated`: sin membresía no ve nada (usa `set local role authenticated` y comprueba 0 filas).
3. Registrar el test en `apps/api/src/operations/inventory-schema-verification.ts` (`inventoryApiGrantsInvariantSql()`) y en `apps/api/src/operations/run-inventory-schema-verification.ts` (import, `if (!names.includes("20261126000600_inventory_api_grants.sql")) throw ...`, y la entrada en `invariants` como `["grants", ...]`). El `summary` actual no cambia.
4. `apps/api/src/inventory/items.service.ts`: hoy solo `23505` se traduce a `conflict`; todo lo demás cae en 503. Añade el mapeo de `23514` (check/validación) y `23503` (FK) a errores de aplicación adecuados (400/409 según el patrón del archivo y de `items.controller.ts`), con prueba nueva en `apps/api/src/inventory/items.test.ts`. Mantén el resto del comportamiento y no dupliques utilidades.
5. `packages/shared-types/src/inventory.ts`: el parser acepta `name` de hasta 200 caracteres, pero la tabla exige `1..160` (`inventory_items_name_valid` / `inventory_warehouses_name_valid`). Alinea el parser a **160** (y actualiza la prueba de `packages/shared-types/src/inventory.runtime.test.ts` si asertaba 200).

## Prohibido
- No ejecutes PostgreSQL (el orquestador corre `verify:inventory-schema:rollback` con `LOCAL_POSTGRES_BIN`). No toques `20261126000100…00400` ni `apps/api/src/app.module.ts`.
- Sin dependencias nuevas, sin commit, sin push, sin rutas fuera del repo.

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/shared-types build
& $PNPM --filter @super-restaurant/api typecheck
& $PNPM --filter @super-restaurant/api lint
& $PNPM --filter @super-restaurant/api test
git diff --check
```

## Hecho cuando
- Migración + test + registro en el verificador + correcciones de servicio/contrato aplicadas.
- `typecheck`, `lint`, `test` y `git diff --check` en verde con salida real pegada.
- Informe final con: archivos, decisión RLS (una línea), bloques comando+salida, y `git status --short`.
- Aplica Ponytail: el cambio más pequeño correcto, sin recortar validación, seguridad ni pruebas.
