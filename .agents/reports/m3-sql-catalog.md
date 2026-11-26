Now I have enough context. Let me create the migration.
## Estado
done — migración de catálogo de inventario, invariantes (6 puntos) y verificador rollback-only escritos; PG **NO VERIFICADO: PG por orquestador**.

## Qué hice
- `inventory_items` (scope restaurante) y `inventory_warehouses` (scope sucursal): checks `unit_code ∈ {g,ml,piece}`, factor>0, mínimo≥0, únicos activos de SKU/nombre, timestamps y `deleted_at` donde aplica.
- RLS `ENABLE`+`FORCE` y políticas de lectura reutilizando `app_rls.has_active_restaurant_membership` (insumos) y `app_rls.has_active_branch_membership` (almacenes). Sin privilegios de escritura para `authenticated`/`app_api`; `SELECT` a `authenticated` para que la RLS sea efectiva. Sin GRANT a `anon`.
- FKs: `inventory_items.restaurant_id → app.restaurants(id)`; `inventory_warehouses (restaurant_id,branch_id) → app.branches(restaurant_id,id)` (la FK compuesta ya existe en el esquema).
- Invariantes siguen `begin; … rollback;`; en el clúster local se sustituye `auth.uid()` solo dentro de la transacción para probar aislamiento.

## Archivos tocados
- `supabase/migrations/20261126000100_inventory_catalog.sql` — tablas, índices, RLS, comentarios.
- `supabase/tests/inventory_catalog_invariants.sql` — 6 invariantes.
- `apps/api/src/operations/inventory-schema-verification.ts` — extractor de invariantes.
- `apps/api/src/operations/run-inventory-schema-verification.ts` — verificador local.

## Verificación
```
node -v
v24.19.0
& $PNPM --filter @super-restaurant/api typecheck
$ tsc --noEmit --project tsconfig.json   EXIT=0
& $PNPM --filter @super-restaurant/api lint
$ eslint --max-warnings=0 --config ../../eslint.config.mjs src   EXIT=0
git add -N <4 archivos>; git diff --check
(sin salida) DIFFCHECK_EXIT=0
node -e "…inventoryInvariantSql()…"
LEN 4920  HEAD:"-- The disposable local cluster stubs auth.uid()…"  TAIL:"…end $test$;"
```

## Riesgos / dudas
- El `grant select` a `authenticated` es imprescindible para que existan lecturas filtradas por RLS; no se otorgó ningún privilegio de escritura. PG real queda **NO VERIFICADO: PG por orquestador** (`verify:inventory-schema:rollback`).

## Notas propuestas
- Ninguna.