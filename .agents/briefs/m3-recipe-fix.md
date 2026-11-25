# Brief m3-recipe-fix (nivel A · corrige P1/P2 de la revisión de recetas)

## Objetivo
Cerrar el sobreconsumo por modificadores duplicados y las trampas de fracción/acumulación en la explosión de recetas.

Tiempo estimado: 20 min. Tu worktree ya contiene `m3-dom-recipe` (PR #83).

## Correcciones
### P1 — modificadores duplicados
`recipe-explosion.ts:140` recorre `modifierIds` sin deduplicar: `["extra-cheese","extra-cheese"]` aplica 30 g dos veces. Deduplica por id (primer ocurrencia) y añade prueba que falle si se quita la deduplicación. Si `modifierContributions` trae un id repetido, lanza `RECIPE_MODIFIER_CONFLICT` (error propio) en vez de last-wins silencioso, con prueba.

### P2 — cantidad de línea entera
Valida `RecipeLine.quantity` como entero positivo independientemente de las unidades vendidas (`0.5 g` debe fallar aunque `soldQuantity` sea 2). Prueba con `0.5` y con `2`.

### P2 — orden de la fracción
Aplica la fracción **después** de acumular líneas por insumo, no por línea: dos líneas de 1 g del mismo insumo con `fraction {1,2}` deben dar 1 g (no 2). Prueba explícita con insumo repetido + fracción.

## Nota
`applyFraction` devuelve `remainder` como resto real; no toques `units.ts`. Los P3 de aislamiento por tenant quedan en deuda (el scope lo aporta el caller).

## Alcance
- Edita SOLO: `packages/domain/src/inventory/recipe-explosion.ts`, `packages/domain/src/inventory/recipe-explosion.test.ts`.
- Prohibido: `units.ts`, `stock-ledger.ts`, `index.ts`, `package.json`, otras apps, dependencias. Sin commit ni push.

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/domain typecheck
& $PNPM --filter @super-restaurant/domain lint
& $PNPM --filter @super-restaurant/domain exec tsc --project tsconfig.test.build.json
Push-Location packages/domain
node .test-dist/inventory/recipe-explosion.test.js
node .test-dist/inventory/units.test.js
Pop-Location
```

## Hecho cuando
Las tres correcciones tienen prueba que falla si se rompen; suite completa en verde con salida real; typecheck, lint y `git diff --check` limpios.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con una línea por hallazgo y bloques comando + salida real.
Aplica Ponytail: cambio más pequeño correcto, sin recortar validación ni pruebas.
