# Brief menu-hide-locked-ingredients (M0, nivel C)

## Objetivo
Quitar de la UI del editor de menú la opción «Ingredientes que no se pueden quitar» (smoke menu-locked).

## Alcance
- Editar SOLO `apps/web/src/app/app/menu/menu-catalog-editor.tsx` (bloque ~856-902; ubica por el texto «no se pueden quitar» / `lockedIngredientOptionIds`).
- Prohibido: borrar o vaciar `lockedIngredientOptionIds` (el editor conserva lo que venga del servidor y lo envía tal cual al guardar), tocar API/SQL/otros archivos, git commit/push.

## Contexto mínimo
Solo se oculta la UI. Antes de dar por terminado, lee `apps/web/src/app/app/capture/product-sheet.tsx` y `apps/web/src/lib/line-halves.ts` y reporta qué pasa en captura con un producto cuya lista de bloqueados está vacía o es legada (regla vigente «lista vacía legada ⇒ todo bloqueado»). Si con la UI oculta el operador ya no podría quitar ingredientes que antes sí, NO cambies reglas: **para y repórtalo** (invertir la regla sería una migración de nivel A).

## Hecho cuando
- Bloque quitado sin warnings de variables sin usar; lint, typecheck y test web en verde; informe con el análisis de la regla legada.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Puertas desde `apps/web`: `corepack pnpm lint`, `typecheck`, `test` (tail -40). Informe en `.agents/reports/menu-hide-locked-ingredients.md` (≤12 líneas) con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
