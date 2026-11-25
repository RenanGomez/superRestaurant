# Brief m3-sql-catalog (nivel A · SQL inventario: catálogo y almacenes)

## Objetivo
Primera migración de inventario: unidades, insumos, almacenes por sucursal con RLS+FORCE, más el andamiaje de verificación rollback-only del módulo y las invariantes SQL.

Tiempo estimado: 40 min. Carril SQL: eres el único escritor de `supabase/migrations/**` y `supabase/tests/**` en esta tarea.

## Alcance
- Crea: `supabase/migrations/20261126000100_inventory_catalog.sql`, `supabase/tests/inventory_catalog_invariants.sql`, `apps/api/src/operations/inventory-schema-verification.ts`, `apps/api/src/operations/run-inventory-schema-verification.ts`.
- Edita: `apps/api/package.json` (solo añadir el script `verify:inventory-schema:rollback`).
- Prohibido: editar migraciones ya aplicadas o integradas, tocar otras apps, `packages/**`, instalar dependencias, aplicar nada en Supabase remoto. Sin commit ni push.
- Temporales en `.harness/state/tmp/`; bórralos al terminar.

## Fuente de verdad
`docs/adr/ADR-013.md` §2.1–§2.3, §2.13 y §3. Convenciones del repo: migraciones SQL de Supabase son la única autoridad; RLS con `FORCE ROW LEVEL SECURITY`; funciones privadas en `app_private` con `SECURITY DEFINER`, `search_path = ''`, `OWNER TO postgres`, `REVOKE ALL`, `GRANT EXECUTE TO app_api`; IDs UUID; `created_at`/`updated_at`/`deleted_at` donde aplique.

## Qué construir
### Migración `20261126000100_inventory_catalog.sql`
- `app.inventory_items`: `id uuid pk`, `restaurant_id uuid not null`, `sku text`, `name text not null`, `unit_code text not null check (unit_code in ('g','ml','piece'))`, `purchase_unit_factor integer not null default 1 check (purchase_unit_factor > 0)`, `min_quantity integer not null default 0 check (min_quantity >= 0)`, `active boolean not null default true`, timestamps, `deleted_at`. Único `(restaurant_id, lower(sku))` cuando `sku is not null and deleted_at is null`.
- `app.inventory_warehouses`: `id`, `restaurant_id`, `branch_id`, `name`, `active`, timestamps. Único `(restaurant_id, branch_id, lower(name))` activo. FK compuesta a la sucursal si el esquema ya la tiene; si no, `branch_id` con FK simple.
- RLS `ENABLE` + `FORCE` en ambas; políticas de lectura por membresía del restaurante y, en almacenes, por sucursal autorizada (reutiliza las funciones de autorización existentes: búscalas con `codegraph explore "authorized"` dentro de `supabase/migrations` y usa la misma que use otra tabla con `branch_id`, p. ej. `app.dining_tables`).
- Sin `GRANT` directo a `anon`/`authenticated`; escrituras solo por funciones privadas futuras.
- Comentarios `COMMENT ON` de una línea por tabla y columna clave.

### Invariantes `supabase/tests/inventory_catalog_invariants.sql`
Sigue exactamente la estructura de `supabase/tests/sync_ledger_invariants.sql` (bloque `begin;` … `rollback;`, aserciones con `do $$ ... raise exception ... $$`). Cubre:
1. `unit_code` inválido rechazado; `purchase_unit_factor = 0` rechazado; `min_quantity` negativo rechazado.
2. Un insumo de otro restaurante no es visible para el actor de prueba (aislamiento).
3. Un almacén de otra sucursal no es visible.
4. `FORCE ROW LEVEL SECURITY` activo en ambas tablas (`pg_class.relforcerowsecurity`).
5. Sin privilegios directos de escritura para `authenticated` (`has_table_privilege`).
6. Borrado lógico: un insumo borrado no rompe el único de SKU.

### Verificador rollback-only
- `apps/api/src/operations/inventory-schema-verification.ts`: `export function inventoryInvariantSql(): string` que lea `supabase/tests/inventory_catalog_invariants.sql`, quite el `rollback;` final y lo devuelva (mismo patrón que `sync-schema-verification.ts` con `extractMigrationBody`).
- `run-inventory-schema-verification.ts`: copia el patrón de `run-sync-schema-verification.ts` (`LocalPostgres` con `marker: "LOCAL_INVENTORY_SCHEMA_ONLY"`, `databasePrefix: "superrestaurant_inventory"`, `assertLocalConfirmation()`, `applyMigrations(listMigrationNames())`, invariantes dentro de `BEGIN`/`ROLLBACK`, resumen JSON, `local.stop()`), comprobando que la migración `20261126000100_inventory_catalog.sql` está en la lista.
- `apps/api/package.json`: `"verify:inventory-schema:rollback": "tsc --project tsconfig.build.json && node dist/operations/run-inventory-schema-verification.js --local-disposable-only"`.

## Puertas (obligatorio, Node 24.19.0 + PG17 local)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$env:LOCAL_POSTGRES_BIN = 'C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\.cache\postgres-local\pgsql\bin'
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/api typecheck
& $PNPM --filter @super-restaurant/api lint
& $PNPM --filter @super-restaurant/api verify:inventory-schema:rollback
```
La última debe imprimir `"status":"ok"` y `"local_cleanup"` `"stopped":true`. Si el binario de Postgres no está en esa ruta, busca `pg_ctl.exe` bajo `.cache/postgres-local` y usa su carpeta `bin`; si no existe, informa `NO VERIFICADO: LOCAL_PG17_REQUIRED` con la ruta comprobada (no inventes éxito).

## Hecho cuando
- Migración reproducible desde cero y verificador rollback-only en verde (salida real).
- Invariantes cubren los 6 puntos.
- `typecheck`, `lint` y `git diff --check` limpios.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con: archivos, decisiones (función de autorización reutilizada, FKs), y un bloque por puerta con comando y salida real. Sin evidencia = NO VERIFICADO.
Aplica Ponytail: cambio más pequeño correcto, sin recortar validación, seguridad ni pruebas.
