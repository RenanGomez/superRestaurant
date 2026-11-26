VEREDICTO: CAMBIOS

P1 packages/domain/src/inventory/recipe-explosion.ts:140 `modifierIds` se recorre sin deduplicar: un id repetido aplica su contribución dos veces (sobreconsumo). Traza: `modifierIds:["extra-cheese","extra-cheese"]`, 30 g, quantity 1 → 60 g; no hay test de ids duplicados pese a que `DuplicateModifierSelectionError` (errors.ts:661) prohíbe repetir modificadores.
P2 packages/domain/src/inventory/recipe-explosion.ts:128 solo se valida `line.quantity * soldQuantity`, no `RecipeLine.quantity`: 0.5 g × 2 = 1 pasa como entero y 0.5 × 1 falla; el invariante entero depende de las unidades vendidas. No hay test de `line.quantity` no entera.
P2 packages/domain/src/inventory/recipe-explosion.ts:127 `applyFraction` se aplica por línea antes de acumular: dos líneas de 1 g con fraction 1/2 dan 1+1=2 g en vez de 1 g. El test de suma solo usa quantity 1 sin fracción; no cubre fracción + insumo repetido.
P3 packages/domain/src/inventory/units.ts:112 `remainder` es una bandera (siempre 1), no el residuo real; al sumarse en recipe-explosion.ts:97 no permite auditar cuánto se redondeó (`applyFraction(10,1,3)` → `{3,1}`).
P3 packages/domain/src/inventory/recipe-explosion.ts:122 un `modifierContributions` con id repetido se sobrescribe en el `Map` (last-wins) sin error; sin test.
P3 packages/domain/src/inventory/recipe-explosion.ts:15 ni `RecipeVersion` ni `ConsumptionRequest` llevan restaurantId/branchId, así que la función no puede detectar receta de otro tenant (queda al caller; sin test de aislamiento).

Evidencia (lectura real del branch, no del diff pegado):
```
PS> git show harness/m3-dom-recipe:packages/domain/src/inventory/recipe-explosion.ts
140	  for (const modifierId of request.modifierIds ?? []) {
128	    const base = assertInventoryQuantity(line.quantity * soldQuantity);
PS> git show harness/m3-dom-recipe:packages/domain/src/inventory/units.ts
107	  const rounded = residual >= denominator - residual ? whole + 1 : whole;
112	  return { quantity: rounded, remainder: 1 };
```
NO VERIFICADO: no ejecuté la suite (modo read-only, sin escribir `.harness/state/tmp`); los hallazgos salen de la traza estática de esas líneas.