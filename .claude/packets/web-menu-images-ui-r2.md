# web-menu-images-ui-r2 (addendum; `codex exec review` ronda 1, log `.claude/runs/web-menu-images-ui/review-r1.log`)

## Tarea
web-menu-images-ui-r2 · capa: L2 (Codex, `-Resume`) · nivel C. Base: commit de2dc19 en `codex/web-menu-images-ui`. La restricción de no tocar `product-sheet.tsx` ya no aplica (la tarea de captura se integró en main; haz `git merge main` en tu worktree antes de empezar y resuelve conflictos conservando ambos lados).

## Hallazgos
- [P2] `menu-catalog-editor.tsx:304`: la foto de una opción se sube pero `ProductSheet` no la muestra. Renderiza `option.imagePath` en la hoja de armado (miniatura cuadrada ≥44 px junto al nombre, `alt=""`, `loading="lazy"`, mismo fallback que la tarjeta de producto: sin imagen o con error, no se muestra nada o las iniciales).
- [P2] `menu/actions.ts:36-37`: cada reintento acuña una `idempotencyKey` nueva y el API incluye la clave en el nombre del objeto, así que un reintento tras respuesta perdida crea un segundo objeto. Acuña `eventId`/`idempotencyKey`/`occurredAt` en el cliente una vez por archivo seleccionado (al elegirlo) y reutilízalos en cualquier reintento del mismo archivo; cambian sólo al elegir otro archivo. Helper puro con prueba.

## Criterios
- [ ] Ambos puntos; puertas `pnpm --filter @super-restaurant/web lint && typecheck && test && build`. Informe breve. No hagas commit.
