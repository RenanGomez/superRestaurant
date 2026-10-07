# kds-operable · KDS con tiempos, antigüedad y «Listo» por orden (T4)

## Tarea
kds-operable · **nivel C** (Codex L2, `-Base main`; sólo `apps/kds`). Ritmo: operación (un toque). Fila T4 del bloque «turno completo» (PROJECT_NOTES 2026-10-06).

## Objetivo
- Tiempo transcurrido por ticket desde `queuedAt` con umbrales de color (verde < 10 min, ámbar 10-20, rojo > 20; constantes nombradas), actualizado cada 30 s.
- Tarjetas agrupadas **por orden** (misma `orderId`): encabezado con canal («Mesa 4», «Mostrador», «Para llevar», «Entrega»), hora de llegada y tiempo; dentro, las líneas con cantidad, nombre, modificadores (Mitad A/B), nota.
- Orden: `preparing` y `sent` primero por antigüedad, `ready` al final (ya lo hace `orderTicketsForDisplay`; mantener y probar).
- «Empezar todo» / «Listo todo» por orden: encadena `transitionKdsTicket` línea por línea **en serie**, usando la versión que devuelve cada respuesta para la siguiente (`expectedVersion`), con botón deshabilitado mientras corre y mensaje de resultado («3 líneas listas»); si una falla con 409, refresca y muestra «La orden cambió, vuelve a intentar»; sin acción por lote nueva en el API.
- Filtro de estación persistente en `localStorage` (try/catch) y visible en el encabezado; indicador «Nuevo» en tickets llegados en los últimos 60 s; sonido opcional desactivado por defecto (interruptor en el encabezado); respetar `prefers-reduced-motion`.

## Hechos verificados (researcher 2026-10-06)
- `apps/kds/src/App.tsx:112-218` `KdsBoard` (lectura, Socket.IO `state.changed.v1` → refresh, transición, render; `ageLabel` ~246 refresca cada 30 s; filtro de estación libre sin persistencia en 101).
- `apps/kds/src/kds-client.ts:33-80` `listKdsTickets` (GET `/kds/tickets?restaurantId&branchId&stationId`), `transitionKdsTicket(ticket, "preparing"|"ready")` con `expectedVersion: ticket.orderVersion` (POST `/orders/items/transition`; verificar qué devuelve: versión nueva), `recoverKdsEvents`.
- `apps/kds/src/kds-state.ts:1-19` `orderTicketsForDisplay`, `nextKdsAction`; pruebas `kds-state.test.ts`.
- `KdsTicketV1` (`packages/shared-types/src/realtime.ts:60-72`): `channel`, `tableId`, `orderId`, `orderItemId`, `orderVersion`, `quantity`, `productName`, `status`, `queuedAt`, `modifiers`, `note`; sin folio ni cliente.
- AGENTS §8: KDS filtra estrictamente por sucursal y estación (no relajar); §14 reduced motion y targets 44 px.

## Criterios de aceptación
- [ ] Helpers puros con prueba en `kds-state.ts`: `ageBucket(queuedAt, now)`, `groupTicketsByOrder(tickets)` (orden estable por antigüedad, ready al final), `planBatchTransition(group, target)` (líneas elegibles y orden).
- [ ] «Listo todo» con 3 líneas hace 3 transiciones en serie con versiones encadenadas; un 409 intermedio detiene y refresca.
- [ ] Sin alert/confirm/prompt; 44 px; funciona a 1280×800 y en tablet 1024×768; consola limpia. Puertas: `pnpm --filter @super-restaurant/kds lint && typecheck && test && build` (si no hay lint, typecheck/test/build).

## Invariantes
Sin tocar apps/api, shared-types ni SQL; el servidor valida cada transición; sin push.

## Fuera de alcance
Folio corto y nombre de cliente en el ticket (requieren contrato), impresión, bump bar físico.

## Formato de salida
Resumen (toques), archivos, salida literal, riesgos.

## Ronda 2 (2026-10-06) — corregir y nada más
Tu trabajo está commiteado por L0 en `codex/kds-operable` (`6dfde0c`). `codex exec review` marcó P2 en `apps/kds/src/kds-state.ts:41`: la antigüedad del grupo usa el `queuedAt` más viejo incluyendo líneas `ready`, así que una orden con una línea lista antigua y una línea nueva se muestra vencida y se ordena antes que trabajo pendiente más viejo. Calcula la antigüedad operativa del grupo sólo con líneas `sent|preparing` cuando existan, con respaldo al mínimo global cuando todas están `ready`; añade la prueba en `kds-state.test.ts`. Puertas kds lint/typecheck/test/build. No commitees; deja los archivos modificados e informa archivos y salida literal.
