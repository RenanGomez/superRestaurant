# Brief m3-ledger-fix (nivel A · corrige 3 P1 de la revisión del ledger)

## Objetivo
Cerrar los P1 del ledger: alcance Restaurant/Branch, motivo+actor obligatorios en `sale_reversal`, y deduplicación por `id`/`idempotencyKey` que impida duplicar saldo.

Tiempo estimado: 25 min. Tu worktree ya contiene `m3-dom-ledger` (PR #82).

## Correcciones obligatorias
### P1 — alcance por sucursal
`InventoryMovement` debe declarar `restaurantId` y `branchId`, y `validateMovement` debe rechazar un movimiento cuyo `warehouseId` no esté declarado en ese scope. Añade a la API un registro mínimo de scope:
```ts
export interface InventoryScope { readonly restaurantId: string; readonly branchId: string; readonly warehouseIds: readonly string[] }
export function validateMovementInScope(m: InventoryMovement, scope: InventoryScope): void; // error INVENTORY_SCOPE_MISMATCH
```
No inventes validación de UUID en dominio si no existe ya en `packages/domain`; si no existe, valida solo no-vacío y documenta la brecha en el informe. Añade prueba de aislamiento: un movimiento de otro restaurante/sucursal es rechazado.

### P1 — `sale_reversal` exige motivo y actor
Incluye `sale_reversal` en los tipos que exigen `reason` no vacío y `actorId` no vacío (junto con waste/adjustment/count_adjustment/transfer). Prueba: reverso con `reason:null` o `actorId:"  "` falla con el código correspondiente.

### P1 — deduplicación
`sumBalances` y `applyMovement` deben ignorar movimientos ya vistos por `id` o `idempotencyKey` (el primero gana; si el mismo `idempotencyKey` aparece con payload distinto → error `INVENTORY_IDEMPOTENCY_CONFLICT`). Añade prueba de replay: aplicar dos veces el mismo movimiento deja el saldo una sola vez y `reconcileBalances` sigue `ok`.

## P2 baratos (si el tiempo alcanza, con prueba)
- Validar `occurredAt` como ISO UTC no vacío (`INVALID_MOVEMENT_TIMESTAMP`).
- Guarda de entero seguro en la acumulación de saldos.
- `reconcileBalances` exige enteros (rechaza float/NaN).

## Alcance
- Edita SOLO: `packages/domain/src/inventory/stock-ledger.ts`, `packages/domain/src/inventory/stock-ledger.test.ts`.
- Prohibido: `units.ts`, `index.ts`, `package.json`, otras apps, dependencias. Sin commit ni push.

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/domain typecheck
& $PNPM --filter @super-restaurant/domain lint
& $PNPM --filter @super-restaurant/domain exec tsc --project tsconfig.test.build.json
Push-Location packages/domain
node .test-dist/inventory/stock-ledger.test.js
node .test-dist/inventory/units.test.js
Pop-Location
```

## Hecho cuando
Cada P1 tiene prueba que falla si se rompe; suite del ledger completa en verde (salida real); typecheck, lint y `git diff --check` limpios.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con una línea por hallazgo y bloques comando + salida real.
Aplica Ponytail: cambio más pequeño correcto, sin recortar validación ni pruebas.
