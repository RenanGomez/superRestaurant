# web-capture-feedback-r3 (addendum; `codex exec review` ronda 2, log `.claude/runs/web-capture-feedback/review-r2.log`)

## Tarea
web-capture-feedback-r3 · capa: L2 (Codex, `-Resume`) · nivel C (`apps/web/src/app/app/capture/product-sheet.tsx`, `lib/capture-selection.ts`). Base: HEAD actual de `codex/web-capture-feedback`.

## Hallazgos
- **Estimado en cliente** (`capture-selection.ts:35-43`): decisión del orquestador ya registrada, se mantiene; no lo cambies. Queda anotado como desviación aceptada hasta que exista la cotización previa en servidor.
- **[P2] Cantidades de modificadores repetidos al editar** (`product-sheet.tsx:32-34`): una opción con cantidad > 1 se expande en IDs repetidos pero la hoja la trata como interruptor: un toque quita todas las copias y otro restaura sólo una. Corrígelo: para opciones de grupos que permiten varias unidades (`maximumQuantity` > 1 o nulo), mostrar un control de cantidad «−  n  +» (botones ≥44 px) tanto al agregar como al editar, inicializado con la cantidad de la línea; el plan de selección enviado conserva la cantidad por opción como ya lo hace el contrato. Para grupos de una sola unidad, interruptor como hoy. Helper puro `toggleOrStepOption(selection, optionId, delta, maximumQuantity)` con pruebas (sumar, restar a cero, respetar el máximo, inicializar desde la línea).

## Criterios
- [ ] Control de cantidad funcional en agregar y editar; pruebas del helper.
- [ ] Puertas `pnpm --filter @super-restaurant/web lint && typecheck && test && build`. Informe breve. No hagas commit.
