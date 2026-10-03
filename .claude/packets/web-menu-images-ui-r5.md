# web-menu-images-ui-r5 (resolver conflictos ya materializados)

## Tarea
web-menu-images-ui-r5 · capa: L2 (Codex, `-Resume`) · nivel C. Worktree `C:\tmp\sr-wt\web-menu-images-ui`.

## Situación
El orquestador ya ejecutó `git merge main` en este worktree. Hay marcadores de conflicto (`<<<<<<< HEAD` = tu rama, `>>>>>>> main` = main) en exactamente dos archivos: `apps/web/package.json` (cadena `test`) y `apps/web/src/app/app/capture/product-sheet.tsx`. **No ejecutes ningún comando `git`** (no tienes permiso de escritura en el directorio Git); edita sólo los archivos. El orquestador hará el commit del merge.

## Criterios
- [ ] `product-sheet.tsx`: conservar íntegra la lógica de main (control «− n +» para modificadores repetibles, `estimateSelectionMinor`, `toggleOrStepOption`, props `initialLine`/`error`, imports) y añadir tu `OptionPhoto` (con `useMenuImageBaseUrl`/`menuImagePublicUrl`) dentro de la etiqueta `label` que main usa tanto en la variante repetible como en el interruptor. Sin marcadores de conflicto.
- [ ] `package.json`: cadena `test` = unión de todos los `.test.js` de ambos lados, con el paso `rmSync` de limpieza al final; JSON válido.
- [ ] Puertas `pnpm --filter @super-restaurant/web lint && typecheck && test && build` y `git diff --check` (lectura; permitido).
- [ ] Informe de tres líneas con qué conservaste de cada lado.
