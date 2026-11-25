# Brief m3-dom-recipe (nivel A · dominio inventario: explosión de receta)

## Objetivo
Explosión de receta producto + modificadores → consumos enteros, con mitades de pizza y sin receta = sin consumo (no error).

Tiempo estimado: 25 min.

## Alcance
- Crea SOLO: `packages/domain/src/inventory/recipe-explosion.ts`, `packages/domain/src/inventory/recipe-explosion.test.ts`.
- Prohibido: `packages/domain/src/index.ts`, `units.ts`, `stock-ledger.ts`, `costing.ts`, otras apps, migraciones, `package.json`. Sin commit ni push.
- Temporales en `.harness/state/tmp/`; bórralos al terminar.

## Contexto y firmas reales
- `docs/adr/ADR-013.md` §2.9, §2.10.
- `./units.js` existe (dependencia): valida cantidades con `assertInventoryQuantity` y usa `applyFraction` para fracciones. No lo modifiques.
- Errores propios con `code` en MAYÚSCULAS, heredando de `DomainError` (`../../errors.js`).

## Qué construir (`recipe-explosion.ts`)
```ts
export interface RecipeLine { itemId: string; quantity: number; unit: InventoryUnit; }
export interface RecipeVersion { recipeId: string; productId: string; version: number; lines: readonly RecipeLine[]; }
export interface RecipeModifierContribution { modifierId: string; lines: readonly RecipeLine[]; }
export interface ConsumptionRequest {
  productId: string; quantity: number;                 // líneas vendidas (entero >= 1)
  fraction?: { numerator: number; denominator: number } | null;   // media pizza = {1,2}
  modifierIds?: readonly string[];
}
export interface ConsumptionLine { itemId: string; quantity: number; unit: InventoryUnit; remainder: number; }
export function explodeRecipe(request: ConsumptionRequest, recipes: readonly RecipeVersion[], modifierContributions?: readonly RecipeModifierContribution[]): ConsumptionLine[];
```
Reglas:
- producto sin receta → `[]` (NO lanzar error);
- varias versiones del mismo producto → usa la de `version` más alta; documenta la elección;
- suma líneas del mismo `itemId` y unidad; unidades incompatibles del mismo insumo → error;
- `fraction` multiplica con `applyFraction` y acumula `remainder`;
- modificadores aportan líneas extra por unidad vendida;
- cantidades finales enteras; si una línea queda en 0, se omite.

## Pruebas (`recipe-explosion.test.ts`)
- receta simple ×2 líneas vendidas duplica cantidades;
- media pizza (1/2) de una receta de 200 g de queso = 100 g;
- modificador extra queso suma su aporte;
- producto sin receta devuelve `[]`;
- dos versiones → gana la mayor;
- líneas del mismo insumo en dos componentes se suman;
- fracción con resto (151 g × 1/2) deja `remainder: 1` y 76 g.

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/domain lint
& $PNPM --filter @super-restaurant/domain typecheck
& $PNPM --filter @super-restaurant/domain exec tsc --project tsconfig.test.build.json
node .test-dist/inventory/recipe-explosion.test.js
```

## Hecho cuando
Pruebas en verde con salida real, lint/typecheck verdes, `git diff --check` limpio.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con bloques comando + salida real. Sin evidencia = NO VERIFICADO.
Aplica Ponytail: cambio más pequeño correcto, sin recortar validación ni pruebas.
