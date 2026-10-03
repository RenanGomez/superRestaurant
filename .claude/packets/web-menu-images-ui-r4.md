# web-menu-images-ui-r4 (integración con main)

## Tarea
web-menu-images-ui-r4 · capa: L2 (Codex, `-Resume`) · nivel C. Worktree `C:\tmp\sr-wt\web-menu-images-ui`, rama `codex/web-menu-images-ui`.

## Objetivo
La rama no se puede integrar: al hacer `git merge main` (main está en `80e67b5`, con la captura ya integrada) hay conflictos en `apps/web/package.json` (cadena `test`) y en `apps/web/src/app/app/capture/product-sheet.tsx` (la hoja de armado de main ahora tiene control de cantidad «− n +» para modificadores repetibles, props `initialLine`/`error`, `estimateSelectionMinor`, `toggleOrStepOption`; tu rama añade `OptionPhoto` con `useMenuImageBaseUrl`/`menuImagePublicUrl`).

## Criterios
- [ ] Ejecuta `git merge main` en el worktree y resuelve conservando **ambas** funcionalidades: en `product-sheet.tsx` mantén intacta la lógica de main (cantidades, estimado, edición de línea, imports) y añade la miniatura `OptionPhoto` dentro de la etiqueta `label` que main usa tanto para la variante repetible como para el interruptor; en `package.json` la cadena `test` debe ser la unión de ambos lados (todos los `.test.js` de main más los tuyos, y el `rmSync` de limpieza al final).
- [ ] Sin marcadores de conflicto; `git diff --check` limpio.
- [ ] Puertas `pnpm --filter @super-restaurant/web lint && typecheck && test && build`.
- [ ] Haz el commit de merge tú mismo (`git commit` con el mensaje por defecto del merge) para que el orquestador pueda revisar la rama resultante; no hagas otros commits.
- [ ] Informe de tres líneas: qué conservaste de cada lado en `product-sheet.tsx` y resultado de las puertas.
