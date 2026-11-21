# Brief menu-photo-crop (M4, nivel C)

## Objetivo
Diálogo de encuadre (zoom y mover) al subir o reemplazar una foto del menú; el recorte se hace en el cliente (smoke menu-cat punto 1).

## Alcance
- Crear `apps/web/src/app/app/menu/photo-crop-dialog.tsx` y la lógica pura en `apps/web/src/lib/menu-photo-crop.ts` + `menu-photo-crop.test.ts` (añade el test al script `test` de `apps/web/package.json` siguiendo el patrón de los demás).
- Integrar en `menu-catalog-editor.tsx` con el cambio mínimo; reutiliza `apps/web/src/lib/menu-image-resize.ts`.
- Prohibido: API, SQL, esquema, git commit/push.

## Contexto mínimo
- Diálogo con zoom (slider y rueda), arrastre para mover, y un marco del aspecto que usa la tarjeta. Canvas en el cliente antes de subir. Teclado: flechas para mover y `+`/`-` para zoom. Respeta `prefers-reduced-motion`. Targets de 44 px; sin `alert/confirm/prompt`.
- La lógica pura que calcula el rectángulo de recorte (zoom, offset, límites para no dejar bordes vacíos) va en `lib/` con tests: zoom mínimo, desplazamiento clamped, aspecto.

## Hecho cuando
- Tests de la lógica pura; lint, typecheck y test web en verde.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Puertas desde `apps/web`: `corepack pnpm lint`, `typecheck`, `test` (tail -40). Informe en `.agents/reports/menu-photo-crop.md` (≤12 líneas) con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
