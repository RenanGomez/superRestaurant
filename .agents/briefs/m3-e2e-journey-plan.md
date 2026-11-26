# REGLA DURA: no commits, no push, no Playwright, no PostgreSQL. Worktree ya existente; no cambies de rama.

# Brief m3-e2e-journey-plan (nivel B · plan de venta canónico en el journey 13)

Worktree: `C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\.harness\worktrees\m3-e2e-journey-plan`
(rama `harness/m3-e2e-journey`, PR #123). El path del brief anterior está obsoleto: este es el bueno. Archivo único a corregir:
`apps/web/e2e/journeys/journey-13-inventario.spec.ts` (y `journey-api.ts` solo si hace falta).

## Hecho verificado (por el orquestador, contra el stack local)

El journey corre, siembra insumo/almacén/receta y **falla al confirmar**:
`POST /captures/confirm -> 409 CAPTURE_CONFLICT`. El plan que manda el fixture está mal construido
para el catálogo real: el producto elegido («Pizza Personalizada») tiene `fraction.enabled`,
`fraction.flavorGroupId` y va con una selección de modificadores incompleta. El API materializa el
plan contra el catálogo y responde conflicto (correcto). El journey 6 (orden sembrada) pasa, así que
el entorno sí vende.

Además hay una línea `console.log("DIAG", ...)` de diagnóstico: **bórrala**.

## Qué hay que hacer

1. No reimplementes el plan a mano. Usa los constructores canónicos que usa la UI:
   - `apps/web/src/lib/capture-selection.ts`: `buildSelectionPlan(lines, catalogVersion)` y
     `toggleOrStepOption`/`countModifierSelections` si necesitas armar grupos.
   - `apps/web/src/lib/line-halves.ts`: `emptyHalvesDraft`, `pickHalfFlavor`, `buildLineFraction`
     (y `effectiveHalvesSetup`) para productos con `fraction.enabled`/variantes con halves.
   - `apps/web/src/lib/pizza-capture.ts` solo si el producto es `pizzaMode` (V2 con halves de
     pizza); para `fraction` puro lo que se manda es `fraction`, no `pizza`.
   La spec ya importa desde `../../src/lib/...`, así que importar estos módulos es correcto.
2. Elige el producto de forma determinista y completa:
   - preferir un producto cuyo `fraction.enabled` tenga `flavorGroupId` con al menos dos opciones
     activas (o sin fracción, si existiera un producto legacy vendible);
   - llena **todos** los grupos obligatorios (`minimumQuantity`) con `Math.min(min, max)` opciones
     activas y, para productos con halves, elige el primer flavor activo en cada mitad sin extras;
   - arma el plan con `buildSelectionPlan`, que decide `schemaVersion` 1/2.
3. Si tras eso el confirm sigue en 409, **no lo conviertas en skip**: falla con el cuerpo del error y
   añade al informe el producto, el plan y el `catalogVersion` (sin secretos) para diagnosticar.
4. Mantén las correcciones ya hechas (almacén predeterminado, restauración de receta, esperas que
   fallan, sin skips de inventario). Revisa que el `cleanup` siga registrándose antes de escribir.

## Puertas que debes ejecutar

```powershell
. .\tools\agentic\use-node24.ps1
$ErrorActionPreference='Continue'
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/web e2e:typecheck
Push-Location apps/web; & $PNPM exec playwright test e2e/journeys/journey-13-inventario.spec.ts --list --project desktop; Pop-Location
& $PNPM exec eslint --max-warnings=0 --config ../../eslint.config.mjs e2e/journeys/journey-13-inventario.spec.ts e2e/fixtures/journey-api.ts
```

La ejecución real la hace el orquestador. Informe en `.agents/reports/m3-e2e-journey-plan.md` con el
producto y plan elegidos, qué helpers se reutilizan y qué queda por verificar.
