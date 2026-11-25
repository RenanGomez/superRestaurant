# Brief m3-sql-ledger-fix2 (nivel A · correcciones de la revisión del ledger SQL)

## Objetivo
Cerrar los P1 de la revisión: reversos one-shot con scope, aislamiento de saldos, idempotencia con scope completo y pruebas de alcance/privilegios.

Tiempo estimado: 30 min. Tu worktree ya contiene el ledger SQL (PR #86) con el verificador funcionando.

## Alcance
- Edita: `supabase/migrations/20261126000200_inventory_ledger.sql`, `supabase/tests/inventory_ledger_invariants.sql`.
- No edites `20261126000100_inventory_catalog.sql` ni `run-inventory-schema-verification.ts` (ya funciona). Sin commit ni push. Sin acceder fuera del worktree.

## Correcciones
### P1 — reverso único y válido
- `sale_reversal` debe cumplir: `compensates_movement_id` referencia un movimiento existente del mismo `restaurant_id`, `branch_id`, `warehouse_id` y `item_id`, de kind `sale_consumption`; el par `(compensates_movement_id)` es único (un solo reverso por consumo); `quantity_delta` debe ser el inverso exacto (`-compensated.quantity_delta`).
- La función debe validarlo y lanzar `INVENTORY_REVERSAL_INVALID` (SQLSTATE `22000`) si no se cumple.
- Añade pruebas: reverso válido, segundo reverso del mismo consumo rechazado, reverso con signo distinto rechazado, reverso que apunta a otro almacén rechazado.

### P1 — idempotencia con scope completo
El conflicto por `idempotency_key` debe comparar también `warehouse_id`, `branch_id`, `item_id` y `source_type`/`source_id`: misma key con distinto almacén/sucursal debe devolver `INVENTORY_IDEMPOTENCY_CONFLICT`, nunca `duplicate` silencioso. Prueba explícita.

### P1 — aislamiento de saldos
`app.inventory_balances` debe tener RLS con FORCE y prueba de aislamiento: el actor de otro restaurante/sucursal no ve ni actualiza saldos ajenos (`set local role authenticated` + `request.jwt.claims` como en el test del catálogo). Añade la prueba.

### P1 — pruebas de alcance y privilegios
- Usa los fixtures `foreign_item` y `foreign_warehouse` que hoy no se usan: movimiento con insumo de otro restaurante → `INVENTORY_ITEM_SCOPE_INVALID`; con almacén de otra sucursal → `INVENTORY_WAREHOUSE_SCOPE_INVALID`.
- Añade `has_table_privilege`/`has_function_privilege` para `authenticated`, `anon`, `service_role` y `public`: no pueden escribir tablas ni ejecutar `inventory_record_movement` (solo `app_api`).

### P2 (si alcanza, con prueba)
- Rechazar movimientos sobre insumo `deleted_at` no nulo o almacén `active = false`.
- Prueba de `inventory_movements_source_unique` (mismo `source_type`/`source_id` con otra key → 23505 o error mapeado).
- Corregir la prueba de `delta = 0` para que use `reason` válido y falle por el check correcto.

## Puertas (obligatorio, Node 24.19.0)
No puedes ejecutar PostgreSQL (binario fuera del worktree). Compila y revisa el SQL:
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/api typecheck
```
El orquestador ejecuta `verify:inventory-schema:rollback`.

## Hecho cuando
Cada corrección tiene prueba SQL; el informe pega la salida real de `typecheck` y el diff de las funciones tocadas, y marca `NO VERIFICADO: PG por orquestador`.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe.
Aplica Ponytail: cambio más pequeño correcto, sin recortar validación, seguridad ni pruebas.
