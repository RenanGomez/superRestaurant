# capture-halves-ids-projection · ids de sabor y extras por mitad en la proyección

## Tarea
capture-halves-ids-projection · **API nivel B** (`implementer-claude`, razonamiento moderado; contrato aditivo de la proyección del plan, sin dinero ni SQL) + **web nivel C** (Codex con `-Base claude/capture-halves-ids-projection`). Deuda de D7b (HANDOFF 2026-10-05: «la proyección no expone ids de sabores/extras por mitad; la UI los resuelve por nombre único»).

## Objetivo
Que la proyección del plan de selección (`CaptureSelectionPlanProjection`/workspace V5) exponga por línea partida los ids de sabor, extras y exclusiones de cada mitad, y que la web deje de reconstruirlos por nombre.

## Hechos verificados (sesión 2026-10-05)
- `apps/api/src/captures.ts` `priceSelectionPlan` (~1176-1237) arma la proyección por línea; para mitades usa `describeHalves` (misma función que alimenta `fractionBreakdown` del quote en `capture-line-quote`) que hoy devuelve nombres (`flavorName`, extras y exclusiones como texto).
- `packages/shared-types/src/capture-selection-plan.ts`: `SelectionPlanCommandLineV1.fraction: LineFractionV1 | null` (slots half-a/half-b con `flavorOptionId`, `extraOptionIds`, `excludedIngredientIds`); proyección de línea con `halves[]` de nombres.
- Web: `apps/web/src/lib/line-halves.ts` `restoreLineFraction` (resuelve ids por nombre único entre opciones activas; falla → `draftLinesFromProjection` aborta con «No se pudo conservar la división…»); `capture-workspace.tsx` `selectionDraftLines`.

## Diseño
1. **Contrato aditivo**: en la proyección de línea, cada elemento de `halves[]` añade `flavorOptionId`, `extraOptionIds: string[]`, `excludedIngredientIds: string[]` (opcionales en parse para proyecciones viejas; el API siempre los emite). Igual en `CaptureLineQuoteResultV1.fractionBreakdown` si comparte `describeHalves`. Pruebas runtime.
2. **API**: `describeHalves` emite los ids desde el `fraction` de la línea del plan almacenado (no desde nombres); pruebas en `captures.test.ts` y `capture-line-quote` (ids presentes, orden half-a/half-b).
3. **Web (Codex)**: `restoreLineFraction` usa los ids de la proyección cuando existen y sólo cae a la resolución por nombre si faltan (proyección vieja); valida que los ids sigan existiendo en el catálogo actual (si no, mismo fallo visible de hoy). Pruebas actualizadas en `line-halves.test.ts`.

## Criterios de aceptación
- [ ] Reenviar el plan (cambiar cantidad de otra línea) conserva la pizza partida aunque un sabor haya sido renombrado.
- [ ] Puertas: shared-types test; api lint/typecheck/test/build; typecheck web/mobile/kds; web (Codex) lint/typecheck/test/build.
- [ ] Commits por unidad; **commitear antes de cualquier informe**.

## Archivos de entrada
- C:\tmp\sr-wt\capture-halves-ids-projection\apps\api\src\captures.ts (1150-1260 y `describeHalves`), fraction-halves.ts, captures.test.ts (mitades).
- C:\tmp\sr-wt\capture-halves-ids-projection\packages\shared-types\src\capture-selection-plan.ts, capture-line-quote.ts, line-fraction.ts.
- Web: apps\web\src\lib\line-halves.ts, line-halves.test.ts, app\app\capture\capture-workspace.tsx (selectionDraftLines).

## Invariantes
Contrato aditivo; precio intacto; sin SQL; sin push.

## Formato de salida
Resumen, hashes, puertas, riesgos.
