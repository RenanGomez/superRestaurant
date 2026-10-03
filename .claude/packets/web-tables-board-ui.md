# web-tables-board-ui · plano de mesas operativo

## Tarea
web-tables-board-ui · capa: L2 (Codex) · riesgo: moderado · nivel C (`apps/web`: página nueva `/app/tables`, server actions que sólo llaman al API, nav). Ritmo: **operación** (dos o tres toques). Sin cambios en `apps/api`, `packages/*` ni SQL. Lote `lote-feedback-20261001` #1.

## Objetivo
Que el operador vea el plano de la sucursal con cada mesa libre u ocupada, toque una mesa libre y abra una cuenta en dos toques («Abrir cuenta» → confirmación con mesero opcional), toque una mesa ocupada para ver sus cuentas y entrar al detalle de la orden, y asigne o cambie mesero con un toque. El editor arrastrable actual queda sólo para administradores, bajo «Editar plano».

## Hechos verificados (main 9e3b44b, migración `20261004000200` aplicada, API local en 3000)
- `POST /tables/board` (permiso `tables.read`) devuelve `TableBoardV1`: `tables[]` con `tableId, name, zoneId, zoneName, capacity, layout {x,y,w,h}, status: "free"|"occupied", activeOrders[{orderId, status, version, waiterUserId, openedAt}]` y `unassignedOrders[]` (órdenes activas de mesas borradas). Sin totales ni nombre de mesero (contrato en `packages/shared-types/src/orders.ts`, buscar `TableBoardV1`/`parseTableBoardV1`). El total de una cuenta se obtiene con `POST /orders/detail` (`OrderDetailV1.totals`) como ya hace `/app/orders`.
- Abrir cuenta: `POST /orders` con `CreateOrderCommandV2` (`channel: "table"`, `tableId`, `shiftId: null` → el servidor resuelve el turno abierto; `conflict` si no hay turno). Si no hay turno, `POST /shifts/open` (`OpenOperationalShiftCommandV1`, permiso `cash-register.manage`) lo abre; contrato en `packages/shared-types/src/shifts.ts`.
- Mesero: `POST /orders/assign-waiter` (`AssignOrderWaiterCommandV1 { orderId, expectedVersion, waiterUserId | null, audit }`, permiso `orders.update`). La lista de meseros de la sucursal sale de las membresías (`apps/web/src/lib/memberships.ts`; buscar cómo se listan miembros por sucursal y rol `waiter`; si no hay lector de miembros de la sucursal, reportarlo como hallazgo y permitir sólo «asignarme a mí» con el actor actual).
- Layout actual: `apps/web/src/app/app/dining-zone.tsx` (editor de admin, grid 24 columnas), página `/app` (`apps/web/src/app/app/page.tsx`). Nav en `apps/web/src/app/app/*` (ver cómo se añadió «Órdenes»). Detalle de orden: `/app/orders` con `OrderDetailPanel` (`apps/web/src/app/app/orders/order-detail-panel.tsx`), se puede abrir con `?orderId=`.
- Patrón de server action con comando versionado: `apps/web/src/app/app/orders/actions.ts`.

## Criterios de aceptación (verificables)
- [ ] Página `/app/tables` en el nav principal como «Mesas»: plano por zona con las mesas en su posición (misma geometría que el editor), color por estado (libre/ocupada; tokens de `globals.css`, no colores sueltos), nombre, capacidad y, si está ocupada, hora de apertura y mesero (iniciales o «Sin mesero»). Refresco por foco y botón «Actualizar». Barra superior con sucursal y turno («Turno abierto desde 10:42» o «Sin turno abierto» con botón «Abrir turno» si el rol lo permite).
- [ ] Toque en mesa libre → hoja inferior con «Abrir cuenta» (primario) y selector opcional de mesero; al confirmar, `POST /orders` y navegación al detalle (`/app/orders?orderId=`) o apertura del panel. Si `conflict` por turno: mensaje «No hay turno abierto» y botón «Abrir turno» (si permiso). Toques: mesa → Abrir cuenta (2).
- [ ] Toque en mesa ocupada → hoja con sus cuentas (estado, hora, mesero, total cargado con `/orders/detail`), «Ver cuenta», «Cambiar mesero» (lista o «Asignarme») y «Abrir otra cuenta». Órdenes de `unassignedOrders` en un bloque «Mesas eliminadas» para que nada quede oculto.
- [ ] Toda acción muestra «Guardando…» y resultado; `conflict` recarga el tablero.
- [ ] El editor arrastrable existente se mueve a «Editar plano» (sólo roles con permiso de gestión de mesas); el plano operativo es la vista por defecto.
- [ ] Helpers puros con prueba: colocación en grid, agrupación por zona, etiqueta de estado, iniciales de mesero.
- [ ] Sin `alert/confirm/prompt`; targets ≥44 px; 390×844 (plano con scroll horizontal controlado dentro de su contenedor, no de la página); consola limpia.

## Invariantes
El servidor decide turno, permisos y transiciones; la web no calcula dinero (totales de `/orders/detail`); contratos intactos; no tocar `apps/web/src/app/app/capture/*` ni `menu/*` (otras tareas en paralelo).

## Fuera de alcance
Dividir o juntar cuentas, cobro desde la mesa, impresión, API y SQL.

## Verificación
```bash
pnpm --filter @super-restaurant/web lint
pnpm --filter @super-restaurant/web typecheck
pnpm --filter @super-restaurant/web test
pnpm --filter @super-restaurant/web build
```

## Formato de salida esperado
Resumen (incluye cuántos toques tiene cada flujo), archivos tocados, salida literal, hallazgos del API (p. ej. lector de meseros) y riesgos. No hagas commit.
