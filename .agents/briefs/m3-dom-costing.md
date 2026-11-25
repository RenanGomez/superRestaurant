# Brief m3-dom-costing (nivel A · dominio inventario: costo promedio y margen)

## Objetivo
Costo promedio ponderado entero, reproducible desde el ledger, y margen por platillo sin floats.

Tiempo estimado: 25 min.

## Alcance
- Crea SOLO: `packages/domain/src/inventory/costing.ts`, `packages/domain/src/inventory/costing.test.ts`.
- Prohibido: `packages/domain/src/index.ts`, `units.ts`, `stock-ledger.ts` (otras tareas), otras apps, migraciones, `package.json`. Sin commit ni push.
- Temporales en `.harness/state/tmp/`; bórralos al terminar.

## Contexto y firmas reales
- `docs/adr/ADR-013.md` §2.6: costo promedio = `valueMinor / quantityOnHand` con aritmética entera, redondeo medio hacia arriba al valorar una salida.
- `./units.js` existe (dependencia): úsalo para validar cantidades enteras (`assertInventoryQuantity`). No lo modifiques.
- `./stock-ledger.js` existe (dependencia): puedes importar `InventoryMovement`/`MovementKind` para `recomputeFromLedger`. No lo modifiques.
- Errores propios que hereden de `DomainError` (`../../errors.js`), `code` en MAYÚSCULAS, en el mismo archivo. Dinero en enteros de unidad menor + código ISO de moneda.

## Qué construir (`costing.ts`)
```ts
export interface WeightedCostState { quantityOnHand: number; valueMinor: number; currency: string; }
export function emptyCostState(currency: string): WeightedCostState;
export function applyReceipt(state: WeightedCostState, receipt: { quantity: number; totalCostMinor: number }): WeightedCostState;
export function applyConsumption(state: WeightedCostState, quantity: number): { state: WeightedCostState; costMinor: number };
export function applyAdjustment(state: WeightedCostState, delta: number): WeightedCostState;  // ajuste sin cambiar valueMinor salvo que quede 0
export function recomputeFromLedger(movements: readonly InventoryMovement[], currency: string): WeightedCostState;
export function marginBps(revenueMinor: number, costMinor: number): number;   // entero, redondeo medio arriba; revenue 0 → error
```
Reglas: `applyConsumption` con `quantity > quantityOnHand` → error `INVENTORY_INSUFFICIENT_STOCK` (fail-closed); monedas distintas → error; nada de `Math.round` sobre floats del dinero (usa aritmética entera con cociente y resto).

## Pruebas (`costing.test.ts`)
- recibo 10 @ 1000 → estado 10/10000; segundo recibo 10 @ 2000 → 20/30000 y costo promedio 1500;
- consumir 5 cuesta 7500 y deja 15/22500;
- consumir más de lo disponible falla;
- `recomputeFromLedger` reproduce el estado incluyendo waste y adjustment;
- redondeo: 3 unidades por 1000 → consumo de 1 = 333 (medio arriba desde 333.33), y 2 consumos de 1 dejan el valor consistente (documenta la regla en el test);
- moneda distinta falla; `marginBps(10000, 4000)` = 6000.

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/domain lint
& $PNPM --filter @super-restaurant/domain typecheck
& $PNPM --filter @super-restaurant/domain exec tsc --project tsconfig.test.build.json
node .test-dist/inventory/costing.test.js
```

## Hecho cuando
Pruebas en verde con salida real, lint/typecheck verdes, `git diff --check` limpio.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con bloques comando + salida real. Sin evidencia = NO VERIFICADO.
Aplica Ponytail: cambio más pequeño correcto, sin recortar validación ni pruebas.
