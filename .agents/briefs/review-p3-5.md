# Brief review-p3-5 (revisión nivel B, SIN escritura)

## Objetivo
Revisar la proyección `pizza` del plan de selección: packages/shared-types/src/capture-selection-plan.ts (+runtime test), apps/api/src/captures.ts (`priceSelectionPlan`), apps/web/src/lib/line-halves.ts (+test) y su uso en apps/web/src/lib/capture-workspace.ts (`draftLinesFromProjection`); la sección 14 de docs/runbooks/guia-de-pruebas-operador.md.

## Criterios
Aditivo y retrocompatible, parser estricto, no filtra datos entre restaurantes/sucursales, no calcula dinero en cliente, tests suficientes, qué sobra.

## Alcance
Solo lectura; prohibido git commit/push. Informe con APROBAR/CORREGIR y hallazgos P1/P2/P3 con archivo:línea.
