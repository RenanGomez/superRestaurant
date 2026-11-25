# Brief m3-sql-catalog (nivel A Ã‚Â· SQL inventario: catÃƒÂ¡logo y almacenes)

## Objetivo
Primera migraciÃƒÂ³n de inventario: unidades, insumos, almacenes por sucursal con RLS+FORCE, mÃƒÂ¡s el andamiaje de verificaciÃƒÂ³n rollback-only del mÃƒÂ³dulo y las invariantes SQL.

Tiempo estimado: 40 min. Carril SQL: eres el ÃƒÂºnico escritor de `supabase/migrations/**` y `supabase/tests/**` en esta tarea.

## Alcance
- Crea: `supabase/migrations/20261126000100_inventory_catalog.sql`, `supabase/tests/inventory_catalog_invariants.sql`, `apps/api/src/operations/inventory-schema-verification.ts`, `apps/api/src/operations/run-inventory-schema-verification.ts`.
- No edites `apps/api/package.json`: el script lo registra el orquestador al fusionar.
- Prohibido: editar migraciones ya aplicadas o integradas, tocar otras apps, `packages/**`, instalar dependencias, aplicar nada en Supabase remoto. Sin commit ni push.
- Temporales en `.harness/state/tmp/`; bÃƒÂ³rralos al terminar.

## Fuente de verdad
`docs/adr/ADR-013.md` Ã‚Â§2.1Ã¢â‚¬â€œÃ‚Â§2.3, Ã‚Â§2.13 y Ã‚Â§3. Convenciones del repo: migraciones SQL de Supabase son la ÃƒÂºnica autoridad; RLS con `FORCE ROW LEVEL SECURITY`; funciones privadas en `app_private` con `SECURITY DEFINER`, `search_path = ''`, `OWNER TO postgres`, `REVOKE ALL`, `GRANT EXECUTE TO app_api`; IDs UUID; `created_at`/`updated_at`/`deleted_at` donde aplique.

## QuÃƒÂ© construir
### MigraciÃƒÂ³n `20261126000100_inventory_catalog.sql`
- `app.inventory_items`: `id uuid pk`, `restaurant_id uuid not null`, `sku text`, `name text not null`, `unit_code text not null check (unit_code in ('g','ml','piece'))`, `purchase_unit_factor integer not null default 1 check (purchase_unit_factor > 0)`, `min_quantity integer not null default 0 check (min_quantity >= 0)`, `active boolean not null default true`, timestamps, `deleted_at`. ÃƒÅ¡nico `(restaurant_id, lower(sku))` cuando `sku is not null and deleted_at is null`.
- `app.inventory_warehouses`: `id`, `restaurant_id`, `branch_id`, `name`, `active`, timestamps. ÃƒÅ¡nico `(restaurant_id, branch_id, lower(name))` activo. FK compuesta a la sucursal si el esquema ya la tiene; si no, `branch_id` con FK simple.
- RLS `ENABLE` + `FORCE` en ambas; polÃƒÂ­ticas de lectura por membresÃƒÂ­a del restaurante y, en almacenes, por sucursal autorizada (reutiliza las funciones de autorizaciÃƒÂ³n existentes: bÃƒÂºscalas con `codegraph explore "authorized"` dentro de `supabase/migrations` y usa la misma que use otra tabla con `branch_id`, p. ej. `app.dining_tables`).
- Sin `GRANT` directo a `anon`/`authenticated`; escrituras solo por funciones privadas futuras.
- Comentarios `COMMENT ON` de una lÃƒÂ­nea por tabla y columna clave.

### Invariantes `supabase/tests/inventory_catalog_invariants.sql`
Sigue exactamente la estructura de `supabase/tests/sync_ledger_invariants.sql` (bloque `begin;` Ã¢â‚¬Â¦ `rollback;`, aserciones con `do $$ ... raise exception ... $$`). Cubre:
1. `unit_code` invÃƒÂ¡lido rechazado; `purchase_unit_factor = 0` rechazado; `min_quantity` negativo rechazado.
2. Un insumo de otro restaurante no es visible para el actor de prueba (aislamiento).
3. Un almacÃƒÂ©n de otra sucursal no es visible.
4. `FORCE ROW LEVEL SECURITY` activo en ambas tablas (`pg_class.relforcerowsecurity`).
5. Sin privilegios directos de escritura para `authenticated` (`has_table_privilege`).
6. Borrado lÃƒÂ³gico: un insumo borrado no rompe el ÃƒÂºnico de SKU.

### Verificador rollback-only
- `apps/api/src/operations/inventory-schema-verification.ts`: `export function inventoryInvariantSql(): string` que lea `supabase/tests/inventory_catalog_invariants.sql`, quite el `rollback;` final y lo devuelva (mismo patrÃƒÂ³n que `sync-schema-verification.ts` con `extractMigrationBody`).
- `run-inventory-schema-verification.ts`: copia el patrÃƒÂ³n de `run-sync-schema-verification.ts` (`LocalPostgres` con `marker: "LOCAL_INVENTORY_SCHEMA_ONLY"`, `databasePrefix: "superrestaurant_inventory"`, `assertLocalConfirmation()`, `applyMigrations(listMigrationNames())`, invariantes dentro de `BEGIN`/`ROLLBACK`, resumen JSON, `local.stop()`), comprobando que la migraciÃƒÂ³n `20261126000100_inventory_catalog.sql` estÃƒÂ¡ en la lista.
- El script `verify:inventory-schema:rollback` (`tsc --project tsconfig.build.json && node dist/operations/run-inventory-schema-verification.js --local-disposable-only`) queda documentado en el informe; no edites `package.json`.

## Puertas (obligatorio, Node 24.19.0)
El binario de PostgreSQL local vive fuera de tu worktree y el sandbox lo rechaza: **no intentes ejecutar el verificador ni accedas a rutas fuera del repo**. El orquestador corre despuÃƒÂ©s `verify:inventory-schema:rollback`.
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/api typecheck
& $PNPM --filter @super-restaurant/api lint
```

## Hecho cuando
- MigraciÃƒÂ³n, invariantes (6 puntos) y verificador escritos y coherentes; `typecheck`, `lint` y `git diff --check` limpios con salida real.
- El informe indica `NO VERIFICADO: PG por orquestador`.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con: archivos, decisiones (funciÃƒÂ³n de autorizaciÃƒÂ³n reutilizada, FKs), y un bloque por puerta con comando y salida real. Sin evidencia = NO VERIFICADO.
Aplica Ponytail: cambio mÃƒÂ¡s pequeÃƒÂ±o correcto, sin recortar validaciÃƒÂ³n, seguridad ni pruebas.
