# Brief review-p3-4 (revisión nivel C, SIN escritura)

## Objetivo
Revisar la UI pizza V2 sin commitear en el checkout: apps/web/src/app/app/menu/{pizza-v2-editor.tsx,menu-catalog-editor.tsx}, apps/web/src/app/app/capture/{pizza-section.tsx,product-sheet.tsx,capture-workspace.tsx,actions.ts}, apps/web/src/lib/{menu-pizza,pizza-capture,capture-quote,capture-selection,capture-workspace,line-halves}.ts, apps/mobile/src/order-draft.ts. Contrato: docs/architecture/PIZZA_MODEL_V2.md.

## Criterios
Bugs, el cliente nunca calcula dinero ni decide permisos, accesibilidad (foco, aria, targets 44 px, teclado), sin alert/confirm/prompt, estados carga/error, restauración tras recargar, tests que falten, qué sobra.

## Alcance
Solo lectura; prohibido git commit/push.

## Cierre
Informe con veredicto APROBAR/CORREGIR, hallazgos P1/P2/P3 con archivo:línea y fix. Aplica Ponytail.
