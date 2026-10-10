# web-tables-editor-r4 · separar guardado del plano (posiciones) del panel de la mesa

## Tarea
web-tables-editor-r4 · capa L1 `implementer-claude` · **nivel C** (sólo `apps/web`) · riesgo moderado (modelo de borradores y concurrencia). Rama `claude/web-tables-editor-r4` desde `main`.

## Hallazgo de Emmanuel (2026-10-10)
Hoy, al mover una mesa, no se puede seleccionar ni mover otra hasta guardar la actual. Debe haber dos guardados independientes: uno del plano (posición de muchas mesas) y otro del panel de la mesa seleccionada (tamaño, nombre, capacidad, forma). Emmanuel aprobó la propuesta de L0 con estas decisiones:

1. **Plano = posición.** Arrastrar mesas (y flechas de teclado) sólo cambia `x,y` en un borrador **del plano** que acumula varias mesas. Barra visible sobre el lienzo cuando hay cambios: «N mesa(s) movida(s) · Guardar plano · Cancelar». Seleccionar otras mesas nunca está bloqueado por posiciones pendientes. «Cancelar» devuelve todas a su posición guardada. «Guardar plano» envía un `updateDiningTableLayout` por mesa movida (secuencial, cada una con su intento idempotente y su `expectedVersion` = versión base de esa mesa; tamaño = el guardado). Resultado parcial: las que fallan siguen pendientes con su motivo («cambió en otro dispositivo» → esa mesa se restaura a la versión del servidor; error de red → se conserva el intento para reintentar); las exitosas salen del borrador.
2. **Panel = tamaño y datos de UNA mesa.** Ancho/largo (botones y asidero de esquina, aunque se arrastre en el lienzo), nombre, capacidad y forma forman el borrador **del panel**. «Guardar cambios» / «Cancelar» del panel no tocan el borrador del plano. Guardar envía layout sólo si cambió el tamaño (con la posición **guardada** de la mesa, no la pendiente) y luego detalles si cambiaron, encadenando versiones. Si el panel tiene cambios sin guardar y se toca otra mesa (o «Nueva mesa»), se muestra en el panel «Guarda o cancela los cambios de {mesa} antes de continuar» y la selección no cambia. Las posiciones pendientes no bloquean nada.
3. **Mesa nueva** se crea desde el panel como ahora: aparece en el primer hueco libre, seleccionada, «Mesa nueva sin guardar»; «Guardar cambios» la crea (`createDiningTable` con su posición y tamaño actuales), «Cancelar» la quita. Mientras no esté creada, moverla cambia su posición dentro de su propio borrador (no entra a «Guardar plano»). Ya creada, se mueve como cualquier otra.
4. **Una mesa con ambos borradores** (posición pendiente en el plano + tamaño/datos en el panel): se dibuja con la posición pendiente y el tamaño del panel. Al guardar el panel, la versión del servidor sube por un cambio propio: el borrador del plano de esa mesa se **rebasa** a la versión nueva (conserva su `x,y` pendiente) en vez de marcarse como conflicto. Lo mismo al revés: al guardar el plano, el borrador del panel de esa mesa se rebasa. Sólo un cambio ajeno (versión distinta a la base que no viene de un guardado propio) es conflicto. Clamp: si el tamaño nuevo no cabe en la posición pendiente dentro de 24×100, ajustar la posición pendiente.
5. Se conservan de r3: selección amarilla, formas, cuadrada con tamaño único, pan del lienzo sólo arrastrando el fondo, rueda a la página, panel a la derecha y centrado, `unstable_rethrow` en catches de server actions.

## Criterios de aceptación
- [ ] Mover 3 mesas seguidas sin guardar; «Guardar plano» guarda las 3; «Cancelar» las regresa.
- [ ] Con posiciones pendientes se puede seleccionar cualquier mesa y editar su panel; guardar el panel no pierde las posiciones pendientes y no produce conflicto.
- [ ] Guardar parcial del plano muestra qué mesas fallaron y por qué.
- [ ] Indicadores claros: mesas con posición pendiente marcadas (p. ej. borde punteado), contador en la barra; panel con «Cambios sin guardar».
- [ ] Helpers puros con prueba en `src/lib/dining-editor.ts` (o módulo nuevo `plan-draft.ts`): acumular/cancelar posiciones, construir los comandos de guardado del plano, aplicar resultado parcial, rebase tras guardado propio, detección de conflicto ajeno, clamp de posición pendiente al cambiar tamaño.
- [ ] Guarda `class-conflicts` sigue verde (usar variantes de `src/lib/ui-classes.ts`).
- [ ] Puertas `pnpm --filter @super-restaurant/web lint`, `typecheck`, `test`, `build` con Node 24.19.0 (`C:\Users\Emmanuel G\AppData\Local\Programs\node24`; `node "<node24>\node_modules\corepack\dist\pnpm.js"` con la ruta entre comillas). Si falta `node_modules`: `pnpm install --frozen-lockfile --offline` y build de `shared-types`; nunca `Remove-Item -Recurse` sobre node_modules.

## Archivos de entrada
- `apps/web/src/app/app/dining-zone.tsx` (editor; principal)
- `apps/web/src/lib/dining-editor.ts`, `table-position.ts`, `table-shape.ts`, `ui-classes.ts` y pruebas
- `apps/web/src/app/app/actions.ts` (server actions de crear/layout/detalles; no deberían requerir cambios)

## Invariantes
Sin API, SQL ni `packages/**`; concurrencia por `expectedVersion` con versión base por borrador; un intento = `eventId` + `idempotencyKey`, reusado en reintentos; cuadrícula 24×100, tamaño 2..8; nombre 1..40 recortado; capacidad 1..50; sin `alert/confirm/prompt`; 44 px.

## Formato de salida
Resumen por decisión (1-5), archivos, salida literal de las puertas, riesgos. Commits convencionales; sin push.
