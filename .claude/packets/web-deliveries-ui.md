# web-deliveries-ui · despachar y liquidar entregas (D6)

## Tarea
web-deliveries-ui · capa: L2 (Codex) · riesgo: moderado · nivel C (`apps/web`: página nueva `/app/deliveries`, server actions que sólo llaman al API, nav). Ritmo: **operación** (dos o tres toques). Fila D6 del «Día operable». Una ronda de revisión. Base: rama `claude/order-deliveries-api` (API ya implementado; verificar en `packages/shared-types/src/deliveries.ts` los contratos exactos y en `apps/api/src/deliveries.controller.ts` las rutas; si faltan, detente e informa).

## Objetivo
Que el encargado vea las entregas pendientes, asigne repartidor con un toque, marque «Salió», registre «Entregada» o «No se pudo» con motivo, y liquide en caja el efectivo contra entrega viendo el cambio y la propina; que el repartidor (rol `courier`) vea sólo sus entregas y las mueva.

## Hechos verificados (implementador 2026-10-04)
- `POST /deliveries/list` (permiso `deliveries.read`; el courier ve sólo las suyas) → entregas activas con estado `assigned|en_route|delivered|failed|settled`, repartidor, horas, cliente y dirección abreviada **sólo con `customers.read`**, total e intención de pago congelada (método, recibido, propina).
- `POST /deliveries/assign` (orden delivery `open|partially_paid`, repartidor con rol `courier` activo en la sucursal), `/deliveries/dispatch`, `/deliveries/complete`, `/deliveries/fail` (motivo; máximo 2 intentos antes de no poder reasignar), `/deliveries/settle` (exige `delivered`; cobra efectivo por el saldo completo con `tenderedAmountMinor`/`tipMinor` de la intención salvo que el comando los sobrescriba; si la intención es tarjeta o transferencia responde `conflict` y se cobra en `/app/caja`). Todas con `expectedVersion` de la entrega y auditoría (`eventId`, `idempotencyKey`, `deviceId`, `occurredAt`).
- `POST /access/branch-members` (`memberships.read`; `{ scope, roles?: ["courier"] }` → `{ members: [{ userId, displayName | null, roles }] }`).
- `OrderDetailV1.fulfillment` ahora trae cliente, dirección, intención y cotización (con `customers.read`) y `delivery` con el estado.
- La caja cobra con `POST /payments/quote` y `/payments/collect` (`web-caja-cobro-corte`); la liquidación de entregas usa su propio endpoint `settle`.

## Criterios de aceptación (verificables)
- [ ] Página `/app/deliveries` en el nav como «Entregas», con columnas o pestañas por estado: «Por asignar» (órdenes delivery activas sin entrega: obtenerlas de `/branch-orders/tray` filtrando `channel = delivery` y cruzando con la lista), «Asignadas», «En ruta», «Entregadas por liquidar», «Fallidas». Cada tarjeta: cliente y dirección abreviada (o «—» sin permiso), hora prometida, total, «Pagará con» (método y, si efectivo, «Recibe $X · Cambio $Y»), repartidor con iniciales.
- [ ] Toques: «Por asignar» → tocar repartidor (lista de `branch-members` con rol courier; si no hay, mensaje «No hay repartidores activos; asigna el rol en Accesos») → asignada (2). «Salió» (1). «Entregada» (1) o «No se pudo» → motivo (2). «Liquidar» → hoja con saldo, recibido (precargado desde la intención, editable, botones rápidos), propina, cambio del servidor (`/payments/quote` si está disponible para esa orden o el cálculo que devuelve `settle` al confirmar) → «Liquidar» (2-3). Con tarjeta o transferencia la hoja dice «Cóbrala en Caja» y enlaza a `/app/caja?orderId=`.
- [ ] Rol `courier`: la página muestra sólo sus entregas con «Salió», «Entregada», «No se pudo»; sin asignar ni liquidar.
- [ ] Toda acción muestra «Guardando…» y resultado; `conflict` recarga la lista; refresco por foco y botón «Actualizar».
- [ ] Helpers puros con prueba: agrupación por estado, etiqueta de método de pago, iniciales de repartidor, precarga de recibido.
- [ ] Sin `alert/confirm/prompt`; targets ≥44 px; 390×844 sin scroll horizontal; consola limpia.

## Invariantes
El servidor decide permisos, estados, cambio y saldo; la web no calcula dinero; contratos intactos; no tocar `caja/*`, `capture/*`, `menu/*`, `tables/*`, `orders/*` salvo añadir el enlace de nav.

## Fuera de alcance
Mapa, notificaciones, reembolsos, mobile, API.

## Verificación
```bash
pnpm --filter @super-restaurant/web lint
pnpm --filter @super-restaurant/web typecheck
pnpm --filter @super-restaurant/web test
pnpm --filter @super-restaurant/web build
```

## Formato de salida esperado
Resumen (toques por flujo), archivos tocados, salida literal, hallazgos del API, riesgos. No hagas commit.
