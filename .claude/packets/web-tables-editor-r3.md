# web-tables-editor-r3 · tercera ronda del smoke: editor de plano

## Tarea
web-tables-editor-r3 · capa L1 `implementer-claude` (Codex intermitente por el sandbox elevado) · **nivel C** (sólo `apps/web`, sin API ni SQL) · riesgo bajo-moderado. Rama `claude/web-tables-editor-r3` desde `main`.

## Objetivo
Que el editor de plano (`/app/tables/edit`, `apps/web/src/app/app/dining-zone.tsx`, 452 líneas) se use como un editor normal: lienzo que no roba la rueda del mouse, selección evidente, controles de tamaño claros, forma visible, panel completo y centrado, y cambios que se guardan o se cancelan explícitamente. Reglas: PROJECT_NOTES «Veredicto de la prueba visual 2026-10-01», AGENTS §14; sin `alert/confirm/prompt`; targets de 44 px.

## Hallazgos de Emmanuel (2026-10-10) → cómo deben quedar
1. **Panel de la mesa recortado y la rueda queda atrapada en el lienzo.** Hoy el lienzo es `h-[360px] overflow-auto` (línea ~206) y el panel «Mesa seleccionada» va debajo y se corta. Debe quedar:
   - El lienzo no tiene scroll con rueda ni barras: `overflow: hidden` y la rueda pasa a la página (no llamar `preventDefault` en `wheel`).
   - Se desplaza (pan) **sólo arrastrando con clic izquierdo sobre el fondo vacío** del lienzo (Pointer Events con captura; cursor `grab`/`grabbing`; con dedo también). Arrastrar una mesa sigue moviendo la mesa, no el lienzo. Helper puro `clampPan(offset, viewport, content)` con prueba.
   - En ≥ 1024 px el panel va a la derecha del lienzo (columna fija ~340 px, `sticky top`), en móvil debajo; nunca recortado, la página hace scroll normal.
2. **No se sabe qué mesa está seleccionada** (la muesca del asidero no se ve en mesas redondas). Mesa seleccionada con **borde amarillo** de 3 px (token nuevo en `globals.css`, p. ej. `--color-selected: oklch(80% 0.17 85)`, con su variante oscura si el tema la tiene) más `box-shadow` del mismo color, visible en redonda, cuadrada y rectangular. El asidero de redimensionar se coloca dentro del área visible también en mesas redondas.
3. **Botones de tamaño agrupados por eje.** Dos grupos con título: «Ancho» → «Más angosta» / «Más ancha»; «Largo» → «Más corta» / «Más larga». Mantener los límites 2..8 y la cuadrícula 24×100 (deshabilitar el botón en el límite).
4. **La forma no cambia nada.** Hoy `TableCard` sólo distingue `round` (`rounded-full`) del resto (`rounded-lg`), y hay que confirmar si además el valor guardado no se refleja en el plano. Debe quedar: redonda → círculo/elipse (`rounded-full`); cuadrada → esquinas casi rectas (`rounded-sm`) y, al elegir «Cuadrada», el alto se iguala al ancho en el borrador; rectangular → `rounded-md`. Al cambiar la forma en el panel, la mesa del plano se ve con la forma nueva de inmediato (como borrador) y queda así después de guardar y al volver a Mesas. El plano operativo (`tables/tables-board.tsx`) usa el mismo mapeo (helper puro compartido `tableShapeClass(shape)` en `src/lib`, con prueba).
5. **Opciones del panel centradas** en su contenedor (campos, grupos de tamaño y botones alineados al centro, ancho máximo ~320 px).
6. **Mesa nueva seleccionada al crearla.**
7. **Cancelar.** Cambia el modelo de guardado del editor: ya **no** se autoguarda al soltar. Todo cambio de la mesa seleccionada (posición, tamaño, nombre, capacidad, forma) es un borrador local marcado «Cambios sin guardar». Debajo de «Guardar cambios» (renombrar «Guardar datos») va «Cancelar»:
   - Mesa existente: «Guardar cambios» envía primero el layout si cambió (`updateDiningTableLayout` con `expectedVersion`) y luego los datos si cambiaron (`updateDiningTableDetails` con la versión devuelta); «Cancelar» restaura la mesa a como estaba al seleccionarla (sin llamadas al servidor).
   - Mesa nueva: «Nueva mesa» ya no crea en el servidor. Abre el diálogo actual (Nombre, Capacidad, Forma) y al aceptar agrega al plano una mesa **borrador** en el primer hueco libre, seleccionada (punto 6), con aviso «Mesa nueva sin guardar». Se puede mover, redimensionar y editar. «Guardar cambios» la crea con `createDiningTable` (layout incluido; un solo intento idempotente, `tableId` fijo del borrador). «Cancelar» la quita del plano. **No existe endpoint de borrado: la mesa nueva nunca debe llegar al servidor hasta «Guardar cambios».**
   - Con cambios sin guardar, seleccionar otra mesa o crear otra nueva no descarta nada en silencio: se muestra dentro del panel «Guarda o cancela los cambios de {mesa} antes de continuar» y la selección no cambia.
   - Conflicto de versión al guardar: mensaje «La mesa cambió en otro dispositivo; se recargó» y se restaura la versión del servidor (como hoy). Error de red: se conserva el borrador y el mismo intento para reintentar.
   - Quitar el texto de ayuda que dice que se guarda solo; describir «Arrastra para mover, usa la esquina para cambiar el tamaño y pulsa Guardar cambios».

## Criterios de aceptación
- [ ] Rueda del mouse sobre el lienzo desplaza la página; arrastrar el fondo desplaza el lienzo; arrastrar una mesa la mueve.
- [ ] Panel completo y centrado, a la derecha en escritorio y debajo en 390×844.
- [ ] Selección amarilla visible en las tres formas; las tres formas se distinguen en el editor y en Mesas.
- [ ] Botones Ancho (Más angosta/Más ancha) y Largo (Más corta/Más larga).
- [ ] Guardar cambios / Cancelar para mesa existente y mesa nueva; mesa nueva seleccionada; nada se crea en el servidor sin «Guardar cambios».
- [ ] Helpers puros con prueba: `clampPan`, `tableShapeClass`, borrador (diff de cambios de layout/datos y restauración).
- [ ] Puertas: `pnpm --filter @super-restaurant/web lint`, `typecheck`, `test`, `build` con Node 24.19.0 (`C:\Users\Emmanuel G\AppData\Local\Programs\node24`; invocar `node "<node24>\node_modules\corepack\dist\pnpm.js"` con la ruta entre comillas).

## Archivos de entrada
- `apps/web/src/app/app/dining-zone.tsx` (452; editor completo)
- `apps/web/src/app/app/actions.ts` (server actions de crear/layout/detalles que devuelven resultado)
- `apps/web/src/lib/dining-editor.ts`, `table-position.ts`, `floor-plan.ts`, `dining-layout.ts` y sus pruebas
- `apps/web/src/app/app/tables/tables-board.tsx` (sólo para el mapeo de forma)
- `apps/web/src/app/globals.css` (token de selección)

## Invariantes
- Sin cambios en `apps/api`, `supabase/**`, `packages/**`, `app/app/menu/**`.
- Concurrencia por `expectedVersion`; un intento = un `eventId` + `idempotencyKey`; reintentos reusan el intento.
- Coordenadas en cuadrícula 24×100, ancho/alto 2..8; nombre 1..40 recortado; capacidad 1..50.
- El servidor revalida todo; las server actions siguen pasando por `getAuthorizedContext` y relanzan redirects (`unstable_rethrow`).

## Formato de salida
Resumen por hallazgo (1-7), archivos, salida literal de las puertas, riesgos. Commits convencionales; sin push. Retira nada: el orquestador integra y retira el worktree.
