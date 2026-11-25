# Brief m3-dom-ledger (nivel A · dominio inventario: ledger inmutable)

## Objetivo
Modelo puro del ledger de inventario: movimientos tipados, saldo como suma, validación de motivo/actor y reconciliación. Nunca se edita: solo se compensa.

Tiempo estimado: 25 min.

## Alcance
- Crea SOLO: `packages/domain/src/inventory/stock-ledger.ts`, `packages/domain/src/inventory/stock-ledger.test.ts`.
- Prohibido: `packages/domain/src/index.ts`, `units.ts` (lo escribe otra tarea; si necesitas `InventoryUnit`, impórtalo de `./units.js` y no lo modifiques), otras apps, migraciones, `package.json`. Sin commit ni push.
- Temporales en `.harness/state/tmp/`; bórralos al terminar.

## Contexto y firmas reales
- `docs/adr/ADR-013.md` §2.4, §2.5, §2.11.
- `./units.js` ya existe (lo entrega `m3-dom-units`, tu dependencia): importa `InventoryUnit` de ahí. No modifiques `units.ts`.
- Errores propios que hereden de `DomainError` (`../../errors.js`) con `code` en MAYÚSCULAS, definidos en el mismo archivo.

## Qué construir (`stock-ledger.ts`)
```ts
export type MovementKind = "receipt" | "sale_consumption" | "sale_reversal" | "waste" | "adjustment" | "transfer_out" | "transfer_in" | "count_adjustment";
export interface InventoryMovement {
  id: string; warehouseId: string; itemId: string; kind: MovementKind;
  quantityDelta: number;              // entero con signo
  unit: InventoryUnit;
  occurredAt: string; actorId: string; reason: string | null;
  idempotencyKey: string; compensatesMovementId?: string | null;
  unitCostMinor?: number | null; currency?: string | null;
}
export function validateMovement(m: InventoryMovement): void;   // errores: cantidad 0, decimal, unidad inválida, motivo/actor ausente donde la ADR lo exige, transferencia sin par
export function applyMovement(balances: Record<string, number>, m: InventoryMovement): Record<string, number>; // clave `${warehouseId}:${itemId}`
export function sumBalances(movements: readonly InventoryMovement[]): Record<string, number>;
export function reconcileBalances(stored: Record<string, number>, movements: readonly InventoryMovement[]): { ok: boolean; diffs: Array<{ key: string; stored: number; expected: number }> };
```
Reglas: `waste`, `adjustment`, `count_adjustment`, `transfer_out/in` exigen `reason` y `actorId`; `sale_consumption` exige `idempotencyKey`; `sale_reversal` exige `compensatesMovementId`; cantidades enteras distintas de 0; nunca mutar el objeto de entrada (devuelve copia).

## Pruebas (`stock-ledger.test.ts`)
- saldo = suma de deltas; entrada y salida se cancelan;
- `waste` sin motivo falla con su código; `sale_consumption` sin key falla;
- reverso sin `compensatesMovementId` falla;
- transferencia `out` + `in` conserva el total entre almacenes;
- `reconcileBalances` detecta una diferencia y `ok: true` cuando coincide;
- inmutabilidad de entrada (el objeto original no cambia).

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/domain lint
& $PNPM --filter @super-restaurant/domain typecheck
& $PNPM --filter @super-restaurant/domain exec tsc --project tsconfig.test.build.json
node .test-dist/inventory/stock-ledger.test.js
```

## Hecho cuando
Pruebas en verde con salida real, lint/typecheck verdes, `git diff --check` limpio.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con bloques comando + salida real. Sin evidencia = NO VERIFICADO.
Aplica Ponytail: cambio más pequeño correcto, sin recortar validación ni pruebas.
