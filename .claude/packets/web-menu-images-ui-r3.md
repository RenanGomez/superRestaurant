# web-menu-images-ui-r3 (addendum; `codex exec review` ronda 2, log `.claude/runs/web-menu-images-ui/review-r2.log`)

## Tarea
web-menu-images-ui-r3 · capa: L2 (Codex, `-Resume`) · nivel C. Base: HEAD actual de `codex/web-menu-images-ui`.

## Hallazgo
- [P2] `menu-catalog-editor.tsx:340-344`: con una subida de foto en curso, «Publicar nueva versión» sigue habilitado y publica el `imagePath` viejo. Corrige: mientras haya cualquier subida pendiente, el botón de publicar queda deshabilitado con el texto «Esperando fotos…» (y un contador si hay varias); al terminar todas, vuelve a habilitarse. Si una subida falla, el botón se habilita y la fila muestra el error, de modo que el operador decide publicar sin esa foto o reintentar. Helper puro `publishDisabledReason(pendingUploads, saving)` con prueba.

## Criterios
- [ ] Puertas `pnpm --filter @super-restaurant/web lint && typecheck && test && build`. Informe de dos líneas. No hagas commit.
