Now I'll rewrite the migration with the required corrections.
Now let me run the static gates.
**Reporte m3-sale-sql-fix**

- **Estado:** done (sin commit/push; único escritor de los 2 archivos).
- **Archivos:** `supabase/migrations/20261126000500_inventory_sale_consumption.sql`, `supabase/tests/inventory_sale_consumption_invariants.sql`.
- **Cambios 1–6:** `is_default`+índice parcial; `inventory_consume_order(uuid,uuid,uuid,uuid)` resuelve almacén y hace skip `no_default_warehouse`; wrapper confirm de 4 args toma ids de `record.detail.scope`/`confirmedOrderId` y lanza `55000`; helper `inventory_cancellation_event_ids` (command + `steps[i].audit.eventId`) y reverso por conjunto con lock único `inventory-consumption:<orderId>`; filas `sale`/`cancel` solo con movimientos; replay con `compensates_movement_id is not null`.
- **Pruebas nuevas:** skip sin default, ceil 121→61, mitades que comparten harina (1 movimiento −160), asilamiento por sucursal, fila real r2 + RLS, cancelación real por wrapper con línea `sent` (paso propio) y `pending` (paso orden) → `saved`, saldo restaurado, reverso con `compensates_movement_id`, fila `cancel` solo para la línea consumida, replay del comando.
- **Decisiones:** forma real de `v_result` = `{record:{detail:{scope:{restaurantId,branchId},confirmedOrderId}}}` (leída en `20260922000200` y `20260924000100`); helper devuelve array jsonb de textos.

```powershell
. .\tools\agentic\use-node24.ps1; $PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"; & $PNPM --filter @super-restaurant/api typecheck; & $PNPM --filter @super-restaurant/api lint; git diff --check
```
```text
Node activo: v24.19.0
$ tsc --noEmit --project tsconfig.json
TYPECHECK_EXIT=0
$ eslint --max-warnings=0 --config ../../eslint.config.mjs src
LINT_EXIT=0
docs/agentic/backlog.json:1420: trailing whitespace.   (ajeno, ya modificado antes de esta tarea)
DIFFCHECK_EXIT=2
```
- **NO VERIFICADO:** ejecución PostgreSQL/rollback (el brief prohíbe correr PG; lo ejecuta el orquestador con `verify:inventory-schema:rollback`). Espacios finales en mis 2 archivos: `CLEAN`.
- **Riesgo/siguiente:** camino `applied` del wrapper de confirmación queda para `m3-int-sale-to-stock`; ejecutar la puerta rollback.