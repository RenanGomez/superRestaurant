# Brief m3-contracts-fix (nivel A · cierra P1/P2 de la revisión de contratos)

## Objetivo
Endurecer los parsers de inventario: dinero como par indivisible, correcciones con referencia y motivo, signos por tipo, transferencias emparejadas, campos de receta y scope del saldo.

Tiempo estimado: 30 min. Tu worktree ya contiene `m3-contracts` (PR #88).

## Correcciones
### P1 — dinero es un par
`unitCostMinor` y `currency` deben validarse juntos: o ambos `null`, o ambos presentes con entero ≥ 0 y ISO-4217 válido. Lo mismo en `PurchaseOrderLineV1` (añade `currency` al line o elimina el costo del line y ponlo en la orden; elige la opción más simple y documéntala). Pruebas: `{unitCostMinor:12, currency:null}` y `{unitCostMinor:null, currency:"MXN"}` rechazados.

### P1 — correcciones con referencia y motivo
`kind` `sale_reversal` y `adjustment`/`waste`/`count_adjustment` exigen `reason` no vacío; `sale_reversal` exige además `compensatesMovementId` no nulo. Pruebas de rechazo.

### P1 — "sin lanzar" probado
Añade un caso con un objeto con getter que lanza (`{ get name() { throw new Error("boom") } }`) y otro con clave símbolo: los parsers deben devolver `undefined`, no lanzar.

### P2 — signos y transferencias
- `quantityDelta` distinto de 0 y con el signo que corresponde al tipo: `receipt`/`transfer_in`/`sale_reversal` positivos; `sale_consumption`/`transfer_out`/`waste` negativos; `adjustment`/`count_adjustment` cualquiera distinto de 0. Prueba por tipo.
- Añade `transferPairId: string | null` y exige que `transfer_out`/`transfer_in` lo lleven.

### P2 — receta y saldo
- Añade `recipeVersionId: string | null` y `roundingRemainder: number` (entero ≥ 0) al movimiento; prueba de defaults y validación.
- `InventoryBalanceV1` añade `restaurantId` y `branchId` (uuid) al parser.

### P2 — orden de compra
Rechaza `lines: []` y líneas duplicadas por `(itemId, unitCode)`.

### P3 — shims
Mueve `node-test-shims.d.ts` fuera del `include` de `tsconfig.json` de build (deja solo `tsconfig.test.json`), o elimínalo si `@types/node` ya cubre `node:test` en el test build.

## Alcance
- Edita SOLO: `packages/shared-types/src/inventory.ts`, `packages/shared-types/src/inventory.runtime.test.ts`, `packages/shared-types/tsconfig.test.json`, `packages/shared-types/src/node-test-shims.d.ts`.
- Prohibido: `package.json`, `index.ts`, otras apps, dependencias. Sin commit ni push.

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/shared-types build
& $PNPM --filter @super-restaurant/shared-types lint
& $PNPM --filter @super-restaurant/shared-types typecheck
Push-Location packages/shared-types
& $PNPM exec tsc --project tsconfig.test.build.json
node .test-dist/inventory.runtime.test.js
Pop-Location
```

## Hecho cuando
Cada corrección con prueba que falla si se rompe; suite completa en verde con salida real; build/lint/typecheck verdes.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con una línea por hallazgo y bloques comando + salida real.
Aplica Ponytail: cambio más pequeño correcto, sin recortar validación ni pruebas.
