I'll start by reading the project's operational docs and understanding the existing SQL patterns.
Now I'll write the migration.
## Estado
done — migración `00500`, invariantes 1–6 y verificador registrado. NO VERIFICADO: PG/rollback (binario local fuera del worktree; lo ejecuta el orquestador).

## Qué hice
- `app.inventory_consumptions`: único `(restaurant_id,order_id,order_item_id,cause)`, FKs a `app.orders`/`inventory_warehouses`, RLS ENABLE+FORCE, solo SELECT a `authenticated`.
- `inventory_consume_order`: explota el aggregate persistido contra la receta activa; `geometry='halves'` con `pizzaHalves.halves[]` usa `ceil(receta/2)` por mitad y **agrega por insumo** (la clave se cierra con `:item_id` porque `inventory_movements_idempotency_unique` es por restaurante+clave); sin receta = sin movimiento; almacén nulo se salta, almacén ajeno/inactivo falla.
- `inventory_reverse_order_item`: un `sale_reversal` por consumo previo con `compensates_movement_id`, fila `cause='cancel'`, idempotente.
- **Decisión: envoltorios, no triggers** — `confirm_capture_draft_v3_with_inventory(uuid,jsonb,jsonb,jsonb,uuid)` consume solo si el resultado es `applied`, y `cancel_order_with_inventory(uuid,jsonb,jsonb)` revierte solo las líneas con `cancellationAudit.eventId` del comando; ambas con `COMMENT ON FUNCTION` que obliga a la API a usarlas. No se editaron las funciones vigentes.
- Verificador: entrada `sale-consumption` añadida sin tocar las existentes.

## Archivos tocados
- `supabase/migrations/20261126000500_inventory_sale_consumption.sql`, `supabase/tests/inventory_sale_consumption_invariants.sql` (nuevos)
- `apps/api/src/operations/inventory-schema-verification.ts`, `apps/api/src/operations/run-inventory-schema-verification.ts`

## Verificación
```powershell
. .\tools\agentic\use-node24.ps1; node -v; $PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"; & $PNPM --filter @super-restaurant/api typecheck; & $PNPM --filter @super-restaurant/api lint; git diff --check -- apps/api/src/operations/inventory-schema-verification.ts apps/api/src/operations/run-inventory-schema-verification.ts
```
```text
v24.19.0
$ tsc --noEmit --project tsconfig.json
TYPE_EXIT=0
$ eslint --max-warnings=0 --config ../../eslint.config.mjs src
LINT_EXIT=0
DIFF_CHECK_SCOPE_EXIT=0
```
Sin espacios finales en los dos archivos nuevos (`Select-String '[ \t]+$'` sin coincidencias). `git diff --check` global solo reporta `docs/agentic/backlog.json`, cambio ajeno en curso, no de esta tarea.

## Riesgos / dudas
- El test ejercita los núcleos y el cortocircuito de los envoltorios ante resultados `rejected/conflict`; no arma una captura completa, así que el camino `applied` del envoltorio de confirmación no tiene E2E aquí (queda para el orquestador con PG).
- Órdenes canceladas por `cancel_order` sin el envoltorio no tendrán reverso (gap de migración de históricos, documentado en el comentario).
- Halves con `fractionBreakdown` legado caen a la receta base; las recetas de modificador no se consumen (deuda explícita).