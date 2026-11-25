# Brief m3-contracts (nivel A · contratos de inventario en shared-types)

## Objetivo
DTOs y parsers exact-key de inventario, base de la API y de la UI de M3.

Tiempo estimado: 30 min.

## Alcance
- Crea: `packages/shared-types/src/inventory.ts`, `packages/shared-types/src/inventory.runtime.test.ts`.
- Edita: `packages/shared-types/package.json` (solo añadir la suite al script `test`, y el export si el paquete usa `index.ts` como barril: revisa `src/index.ts` y sigue su patrón).
- Prohibido: `packages/domain/**`, apps, migraciones, dependencias nuevas. Sin commit ni push; sin salir del worktree.

## Contexto y convenciones
- Sigue el estilo de `packages/shared-types/src/sync.ts`: tipos `readonly`, validadores `parseX(input: unknown): X | undefined` con **exact keys** (rechazan claves desconocidas), sin lanzar, sin `any`.
- Dinero: `{ amountMinor: number; currency: string }` (entero + ISO). Cantidades: enteras en unidad mínima (`g`/`ml`/`piece`).
- Reglas de `docs/adr/ADR-013.md`.

## Qué construir (`inventory.ts`)
1. `InventoryUnitV1 = "g" | "ml" | "piece"`.
2. `InventoryItemV1`: `id`, `restaurantId`, `sku: string | null`, `name`, `unitCode`, `purchaseUnitFactor`, `minQuantity`, `active`.
3. `InventoryWarehouseV1`: `id`, `restaurantId`, `branchId`, `name`, `active`.
4. `InventoryMovementV1`: `id`, `restaurantId`, `branchId`, `warehouseId`, `itemId`, `kind` (los 8 de la ADR), `quantityDelta`, `unitCode`, `occurredAt` (ISO), `actorId`, `reason: string | null`, `idempotencyKey`, `compensatesMovementId: string | null`, `unitCostMinor: number | null`, `currency: string | null`.
5. `InventoryBalanceV1`: `warehouseId`, `itemId`, `quantity`, `updatedAt`.
6. `RecipeVersionV1` + `RecipeLineV1` (quantity entera > 0, unit).
7. `InventoryMovementRequestV1` (lo que envía la UI: sin `id` ni `occurredAt` del servidor).
8. `PurchaseOrderV1` mínimo: `id`, `restaurantId`, `branchId`, `supplierId`, `status` (`draft|sent|received|cancelled`), `lines: { itemId, quantity, unitCode, unitCostMinor }[]`.
9. Parsers exact-key para cada uno: `parseInventoryItemV1`, `parseInventoryWarehouseV1`, `parseInventoryMovementV1`, `parseInventoryBalanceV1`, `parseRecipeVersionV1`, `parseInventoryMovementRequestV1`, `parsePurchaseOrderV1`. Rechazan: claves extra/faltantes, cantidades no enteras, importes no enteros, moneda inválida, `unitCode` desconocido, `kind` desconocido, timestamps no ISO.
10. `INVENTORY_MOVEMENT_KINDS` y `INVENTORY_UNITS` como constantes `Object.freeze`.

## Pruebas (`inventory.runtime.test.ts`)
`node:test` + `node:assert/strict`: un caso válido y uno inválido por parser (clave extra, cantidad decimal, moneda inválida, kind desconocido, timestamp no ISO), más `INVENTORY_MOVEMENT_KINDS` con los 8 valores exactos.

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
Las puertas en verde con salida real; `git diff --check` limpio. Nota: `pnpm test` completo del paquete lo dispara CI; si lo corres, incluye la suite en el script.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con archivos, decisiones y bloques comando + salida real.
Aplica Ponytail: solo los contratos y parsers necesarios.
