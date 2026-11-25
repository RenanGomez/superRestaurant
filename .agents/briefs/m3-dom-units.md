# Brief m3-dom-units (nivel A · dominio inventario: unidades)

## Objetivo
Unidades de inventario y conversiones enteras en el dominio puro, con errores tipados y pruebas.

Tiempo estimado: 20 min.

## Alcance
- Crea SOLO: `packages/domain/src/inventory/units.ts`, `packages/domain/src/inventory/units.test.ts`.
- Prohibido: `packages/domain/src/index.ts` (lo cablea `m3-dom-wire`), `errors.ts`, otras apps, migraciones, dependencias, `package.json`. Sin commit ni push.
- Temporales en `.harness/state/tmp/`; bórralos al terminar.

## Contexto y firmas reales
- Reglas: `docs/adr/ADR-013.md` §2.1, §2.2, §2.10. Cantidades SIEMPRE enteras; sin floats.
- Estilo del dominio: errores que heredan de `DomainError` (`packages/domain/src/errors.ts`) con `code` en MAYÚSCULAS y campo público; pruebas con `node:test` + `node:assert/strict`.
- Las pruebas importan relativas (`./units.js`) para no depender de `index.ts`.

## Qué construir (`units.ts`)
```ts
export type InventoryUnit = "g" | "ml" | "piece";
export function parseInventoryUnit(value: string): InventoryUnit;              // error INVALID_INVENTORY_UNIT
export function assertInventoryQuantity(value: number): number;                // entero >= 0, error INVALID_INVENTORY_QUANTITY
export function convertPurchaseQuantity(quantity: number, factor: number): number; // entero*factor entero positivo, error INVALID_INVENTORY_FACTOR
export function applyFraction(quantity: number, numerator: number, denominator: number): { quantity: number; remainder: number };
export function unitsAreCompatible(left: InventoryUnit, right: InventoryUnit): boolean;
```
`applyFraction` con aritmética entera, redondeo medio hacia arriba y `remainder` (0 o 1) para auditoría; `denominator <= 0`, `numerator <= 0` o no enteros → error tipado.
Añade las clases de error dentro de `units.ts` (no en `errors.ts`), exportadas.

## Pruebas (`units.test.ts`)
- unidad válida e inválida; cantidad negativa, decimal y `NaN` rechazadas;
- factor 0/negativo/decimal rechazado; conversión exacta (12 × 800 = 9600);
- `applyFraction(150, 1, 2)` = 75 resto 0; `applyFraction(151, 1, 2)` = 76 resto 1; `(1,3)` rechazado;
- compatibilidad de unidades (g/g sí, g/ml no).

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/domain lint
& $PNPM --filter @super-restaurant/domain typecheck
& $PNPM --filter @super-restaurant/domain exec tsc --project tsconfig.test.build.json
Push-Location packages/domain
node .test-dist/inventory/units.test.js
Pop-Location
```
`pnpm exec` corre en el directorio del paquete: el test se lanza desde `packages/domain`, no desde la raíz del worktree.

## Hecho cuando
Todas las pruebas pasan (salida real), lint y typecheck verdes, `git diff --check` limpio.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con bloques de comando + salida real. Sin evidencia = NO VERIFICADO.
Aplica Ponytail: el cambio más pequeño correcto, sin recortar validación ni pruebas.
