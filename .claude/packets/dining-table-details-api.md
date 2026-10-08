# dining-table-details-api · editar nombre, capacidad y forma de una mesa

## Tarea
dining-table-details-api · capa L1 `implementer-claude` · **nivel A** (SQL `app_private`, migración, contrato compartido) · riesgo moderado. Rama `claude/dining-table-details-api` desde `main`. Exigido por la pantalla de editor de plano (smoke de Emmanuel 2026-10-07, punto 11: «en el editor de mesa no se puede cambiar la capacidad»).

## Objetivo
Un comando versionado y auditado que cambie `name`, `capacity` y `shape` de una mesa existente, expuesto como `PATCH /api/v1/dining/tables/details`, con el mismo patrón que `update_dining_table_layout`.

## Contrato (la UI se está escribiendo en paralelo contra esto; no cambiarlo)
- Request JSON: `{ schemaVersion: 1, scope: { restaurantId, branchId }, tableId, expectedVersion, eventId, idempotencyKey, deviceId, occurredAt, name, capacity, shape }`.
- Validación: UUIDs; `expectedVersion` ≥ 1; `name` recortado 1..60 (mismas reglas que en creación); `capacity` entero 1..50; `shape` ∈ `round|square|rectangle`; `occurredAt` ISO.
- Respuesta 200: `DiningTableV1` (mismo parser que layout). 400 request inválido, 403 `ACTION_NOT_AUTHORIZED`, 409 `DINING_TABLE_CONFLICT` (versión vieja, nombre duplicado en la sucursal, idempotency key reusada con otros datos), 503.
- `UpdateDiningTableDetailsCommandV1` + `parseUpdateDiningTableDetailsCommandV1` en `packages/shared-types` (junto a `parseUpdateDiningTableLayoutCommandV1`), fail-closed como los demás parsers.

## SQL
- Migración nueva `supabase/migrations/20261008000100_dining_table_details.sql` (no editar migraciones aplicadas): función `app_private.update_dining_table_details(p_actor_id, p_restaurant_id, p_branch_id, p_table_id, p_event_id, p_idempotency_key, p_device_id, p_occurred_at, p_expected_version, p_name, p_capacity, p_shape)` con la misma forma de retorno, validación, autorización por rol (`owner|admin|manager` vigente, restaurante y sucursal activos), `pg_advisory_xact_lock`, replay por idempotency key (comparando todos los campos), `event_id` único, CAS por versión, `deleted_at is null`, y auditoría en `app.dining_table_audit_events` con `operation='details_updated'` (ampliar el CHECK de `operation` si existe; snapshots de nombre/capacidad/forma/layout resultantes). Nombre duplicado → `conflict` (respetar el índice único existente; capturar `unique_violation` sólo de ese índice).
- Grants idénticos a `update_dining_table_layout` (owner `postgres`, EXECUTE sólo al rol de runtime que ya lo tiene, revocado a public/anon/authenticated). Verificar contra la migración `20260901000100_create_dining_tables_layout.sql` y `20260901000200_qualify_dining_table_function_columns.sql`.
- Ejecutar la migración en PostgreSQL 17 desechable/verificador rollback-only existente (ver `supabase/tests` y scripts `verify:*` en `apps/api/package.json`) desde cero dos veces. **No aplicar a Supabase remoto** (lo hace L0 con autorización de Emmanuel).

## API
- `apps/api/src/dining-tables.ts`: `DiningTablePort.updateDetails`, adaptador Postgres, `DiningTableService.updateDetails` con permiso `tables.manage`; `dining-tables.controller.ts`: `@Patch("tables/details")` con el mismo `map`.
- Pruebas en `apps/api/src/dining-tables.test.ts`: request inválido, sin permiso, conflicto, replay, éxito; y contrato del parser en shared-types.

## Invariantes
- Alcance Restaurant/Branch en toda consulta; versión optimista; auditoría append-only; sin tocar layout en este comando.
- Sin cambios en `apps/web` (otra tarea lo hace).

## Verificación
`pnpm --filter @super-restaurant/shared-types test typecheck lint`, `pnpm --filter @super-restaurant/api test typecheck lint build`, verificador SQL desechable/rollback-only; CodeGraph antes y después sobre `DiningTableService`, `parseUpdateDiningTableLayoutCommandV1` y consumidores de `DiningTableV1`.

## Formato de salida
Resumen, archivos, salida literal de las puertas y del verificador SQL (conteos de catálogo antes/después), plan de rollback de la migración, riesgos. Commits convencionales; sin push.
