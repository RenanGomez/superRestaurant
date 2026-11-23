# Brief review2-p3-4-5 (segunda ronda, SIN escritura)

## Objetivo
Segunda revisión del estado final de pizza V2 UI y proyección: apps/web/src/app/app/capture/{pizza-section,product-sheet,capture-workspace}.tsx, apps/web/src/app/app/menu/pizza-v2-editor.tsx, apps/web/src/lib/{menu-pizza,pizza-capture,focus-trap,line-halves,capture-selection,capture-quote}.ts, packages/shared-types/src/capture-selection-plan.ts, apps/api/src/captures.ts (`priceSelectionPlan`).

## Criterios
Cliente no calcula dinero, fail-closed, accesibilidad (foco, 44 px, sin alert/confirm/prompt), no fuga entre tenants, tests suficientes, fixes de la ronda 1 realmente aplicados.

## Alcance
Solo lectura; prohibido git commit/push. Informe APROBAR/CORREGIR con hallazgos P1/P2/P3 archivo:línea.
