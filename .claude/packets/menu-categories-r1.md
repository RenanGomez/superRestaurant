# menu-categories-r1 · arrastre con vista fantasma, asidero angosto, sin botones subir/bajar

## Tarea
menu-categories-r1 · capa L1 `implementer-claude` · nivel C (`apps/web/src/app/app/menu/reorder-controls.tsx`, `apps/web/src/app/app/menu/menu-catalog-editor.tsx` sólo la sección de categorías, líneas ~150–215, y `apps/web/src/lib/menu-reorder.ts` si hace falta un helper puro) · riesgo bajo. Rama `claude/menu-categories-r1` desde `main`. No tocar `apps/api`, `packages/*`, SQL ni la sección de productos del editor (otro paquete la cambia después).

## Hallazgos de Emmanuel (2026-11-01, /app/menu)
1. Arrastrar categorías funciona pero no hay **vista previa**: al arrastrar la tercera sobre la segunda, la segunda debería desplazarse hacia abajo y aparecer un hueco «fantasma» donde quedaría la arrastrada. Al soltar sobre el hueco se aplica el orden; `Escape` o clic derecho cancelan y se restaura el orden original; si se vuelve al lugar de origen y se suelta, no cambia nada.
2. El **asidero** ⋮⋮ es demasiado ancho.
3. Los botones **subir/bajar** de categorías sobran: ya existe el arrastre.

## Cambios
1. En `reorder-controls.tsx` (o un hook nuevo en el mismo archivo) implementar el arrastre con placeholder: mientras se arrastra, la lista se renderiza con el orden tentativo (elemento arrastrado quitado de su sitio e insertado en el índice de hover) y en ese índice se pinta un hueco con borde discontinuo y la misma altura que la fila; la fila original viaja semitransparente. Usar Pointer Events (funciona con mouse y táctil) y `setPointerCapture`; nada de librerías nuevas. `Escape` y `contextmenu` cancelan y restauran. Al soltar sobre un índice distinto se llama al `onMove(from, to)` que ya existe. Respetar `prefers-reduced-motion` (sin transiciones si está activo).
2. El asidero se reduce a ~24 px de ancho manteniendo 44 px de alto como target táctil y `aria-label`. Mantener el reordenamiento por teclado que ya exista en `ReorderHandle` (flechas con el asidero enfocado) porque sustituye a los botones.
3. Quitar `ReorderButtons` de la fila de categoría. Si `ReorderButtons` queda sin otros usos (comprobar con grep; productos lo usa en `onMoveProduct`), dejarlo: la sección de productos se ajusta en otro paquete.
4. El layout de la fila de categoría deja un hueco circular de 40 px a la izquierda del nombre, vacío por ahora (`aria-hidden`), donde otro paquete pondrá la imagen de la categoría. Sin cambiar textos.

## Invariantes
Sin `any`, LF, sin `alert/confirm/prompt`, targets de 44 px, textos en español. No cambiar el `draft` que se envía a `saveMenuCatalogAction`.

## Verificación (Node 24 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; pnpm vía `node "<node24>\node_modules\corepack\dist\pnpm.js"`)
- `pnpm --filter @super-restaurant/web lint`, `typecheck`, `test`, `build`.
- Unitarias para el helper puro que calcule el orden tentativo (`from`, `hoverIndex`) → lista reordenada; casos: mismo índice, primero→último, último→primero, cancelación.
- Navegador si `http://localhost:8082` responde y hay `apps/web/playwright/.auth/user.json` en el checkout principal (copiar al worktree y borrar al final): arrastrar con mouse en 1366×800 y con touch emulado en 390×844; comprobar que el hueco aparece y que `Escape` restaura. Documentar la brecha si no se pudo.

## Formato de salida
Resumen, archivos, salida literal de las puertas, brecha de verificación, riesgos. Commit local `feat(web-menu): ...`. Sin merge ni push.
