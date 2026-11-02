# review-tables-accounts-r2 — revisión de sólo lectura (segunda familia) de `codex/tables-accounts-r2`
Agente: Gemini   Nivel de rigor: B   Complejidad: Estándar

## Objetivo
Revisar `git diff main...codex/tables-accounts-r2` (ejecútalo desde la raíz; no edites nada) contra `.claude/packets/tables-accounts-r2.md` y AGENTS.md §8, §10, §14.

## Archivos (sólo lectura)
- apps/web/src/app/app/tables/tables-board.tsx, apps/web/src/app/app/tables/actions.ts, apps/web/src/lib/tables-board.ts y su test, apps/web/src/app/app/orders/order-detail-panel.tsx.
- Para contexto: apps/api/src/orders.ts (acciones `open` y asignación de mesero), packages/shared-types/src/orders.ts.

## Tarea
1. La Server Action de creación llama a `orders/open` con `eventId`/`idempotencyKey` deterministas derivados del intento: comprueba que un reintento del mismo intento no abre dos veces ni crea dos órdenes, y que una respuesta ambigua se reconcilia leyendo el detalle.
2. El diálogo: sin selector de mesero previo; «Abrir cuenta»/«Abrir otra cuenta» crea con `waiterUserId: null` y permanece en el diálogo; cada tarjeta permite asignar, reasignar y quitar («Sin mesero»); `busyOrderId` por tarjeta; mensajes de error por tarjeta.
3. Quitar el botón «Abrir cuenta» del detalle no deja sin salida a una orden que siga en borrador (el envío a cocina abre; confirma que no hay otro camino roto, por ejemplo cobrar en caja un borrador).
4. Accesibilidad: targets ≥ 44 px, foco, `aria-*`, sin `alert/confirm/prompt`, textos en español, sin `any`, LF.
5. Ningún cálculo de dinero ni decisión de permisos en cliente.

## Restricciones
- No modificar archivos, no instalar, no red, no base de datos.

## Formato de salida
Hallazgos P1/P2/P3 con archivo:línea y propuesta; cierre `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR`. Reporte §8 en `.agents/reports/review-tables-accounts-r2.md`, máximo 60 líneas.
