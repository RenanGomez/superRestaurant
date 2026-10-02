# web-order-actions

## Tarea
web-order-actions · capa: L1 (`implementer-claude`) · riesgo: moderado · nivel B (API: endpoint de lectura del detalle de una orden; sin SQL nuevo si el puerto de persistencia basta) + nivel C (web: acciones y detalle en `/app/orders`).

## Objetivo
Que el operador actúe sobre una orden activa desde `/app/orders`: ver el detalle (líneas con estado y nota, totales, cliente, entrega, intención de pago), abrir/enviar a cocina, marcar líneas listas/entregadas, y cancelar líneas con motivo (S6.1b), reutilizando las rutas y la máquina de estados existentes; el servidor revalida permisos y transiciones.

## Hechos verificados (main `94932c1`)
- Rutas: `POST /orders/open`, `POST /orders/items/transition`, `POST /orders/items/cancel` (`apps/api/src/orders.controller.ts:37-53`; servicios en `orders.ts:258-288` con permisos `orders.update`, `kds.transition`, `orders.cancel.pending|sent`). Contratos en `packages/shared-types/src/orders.ts` (verificar nombres exactos de `OpenOrderCommandV1`, `TransitionOrderItemCommandV1`, `CancelOrderItemCommandV1`).
- Estados (`packages/domain/src/order-state.ts:12-82`): Order `draft→open→partially_paid→paid→closed`; OrderItem `pending→sent→preparing→ready→delivered` (+ `cancelled`). `transitionOrderItemStatus`, `cancelOrderItem` con auditoría, `assertOrderAllowsItemMutation` (`order.ts:605-614`). No existe cancelación de orden completa en dominio (fuera de alcance: se cancelan líneas; una orden sin líneas activas queda visible como tal).
- Lectura: no hay endpoint de detalle; `OrderPersistencePort.read()` devuelve el agregado (`StoredOrder`) con líneas y snapshot. El snapshot de cumplimiento V2 vive en `order_fulfillment_snapshots` (leído por el lector de la bandeja `list_branch_order_work_items`).
- Web: `/app/orders` (`orders-tray.tsx`, `OrderCard` ~107-133 sólo con «Cobrar en caja»); patrón de server action con comando versionado en `capture/actions.ts`; helpers en `lib/branch-order-work-tray.ts`.
- KDS marca `ready` con `/orders/items/transition` (`kds.transition`); no duplicar lógica.

## Criterios de aceptación
- [ ] API (nivel B): `POST /orders/detail` (o `GET /orders/:orderId` si el patrón del controlador lo admite) que autorice `orders.read` en el scope y devuelva `OrderDetailV1` (contrato aditivo en shared-types, parser exacto): `orderId, status, channel, tableId, currency, timeZone, createdAt, updatedAt, version, items[{ orderItemId, status, name, quantity, unitPriceMinor, lineTotalMinor, note, modifiers[] }], totals { itemsTotalMinor, deliveryChargeMinor, tipMinor, totalMinor }, fulfillment (snapshot V1/V2 resumido: canal, cliente enmascarado y dirección abreviada sólo si `customers.read`, deliveryQuote, paymentIntent), availableActions` calculadas por el servidor desde estado + roles (`open`, `sendToKitchen`, `markReady`, `markDelivered`, `cancelItem`, `checkout`). Reutiliza `calculateOrderAggregateTotals` y el codec; sin recalcular del catálogo. Pruebas: scope ajeno → denied; roles sin `customers.read` → sin PII; `availableActions` por estado/rol.
- [ ] Web (nivel C): en `OrderCard` botón «Detalle» que abre un panel/hoja in-app con `OrderDetailV1`; acciones visibles sólo si están en `availableActions`: «Enviar a cocina» (open + transición de líneas `pending→sent` en lote, una petición por línea con `idempotencyKey` propia y reintento único en unavailable), «Marcar lista»/«Entregada» por línea y «Todas», «Cancelar línea» con diálogo in-app de motivo obligatorio (y aviso de que requiere supervisor si la línea ya fue enviada; el servidor decide), «Cobrar en caja» (ya existente). Tras cada acción se relee el detalle y se refresca la bandeja. Sin alert/confirm/prompt; targets ≥44 px; estados de carga/error por acción; 390×844 sin scroll horizontal.
- [ ] Helpers puros con pruebas node:test: `deriveOrderActions(detail)` (sólo si el servidor no las manda; preferible consumir `availableActions`), `groupItemsByStatus(items)`.
- [ ] Puertas: shared-types, api, web (lint/typecheck/test/build); mobile y kds typecheck (contratos de orders compartidos).

## Invariantes
- Transiciones y permisos los decide el servidor; la UI nunca infiere permisos más allá de `availableActions` recibido.
- Sin dinero nuevo: totales desde el agregado; cancelaciones auditadas con motivo; registros inmutables.
- Contratos existentes intactos (Mobile/KDS).

## Fuera de alcance
- Cancelación de orden completa, reembolsos, despacho/repartidor (S7.2), checkout real (S8.3), tiempo real.

## Verificación
```bash
pnpm --filter @super-restaurant/shared-types test && pnpm --filter @super-restaurant/shared-types typecheck && pnpm --filter @super-restaurant/shared-types lint && pnpm --filter @super-restaurant/shared-types build
pnpm --filter @super-restaurant/api test && pnpm --filter @super-restaurant/api typecheck && pnpm --filter @super-restaurant/api lint && pnpm --filter @super-restaurant/api build
pnpm --filter @super-restaurant/web lint && pnpm --filter @super-restaurant/web typecheck && pnpm --filter @super-restaurant/web test && pnpm --filter @super-restaurant/web build
pnpm --filter @super-restaurant/mobile typecheck && pnpm --filter @super-restaurant/kds typecheck
```

## Entorno
Worktree `C:\tmp\sr-wt\web-order-actions` (rama `claude/web-order-actions` desde `main`). Node 24/pnpm 11 en `%LOCALAPPDATA%\Programs\node24`; `pnpm install --prefer-offline`, construir packages/domain y packages/shared-types. Commits: shared-types → api → web. Si descubres que hace falta SQL nuevo (p. ej. leer el snapshot por orden), justifícalo en dos líneas y hazlo como migración candidata con verificador local. Informe parcial a los ~35 turnos. Sin push, sin remoto.

## Formato de salida
Resumen y decisiones, archivos y commits, salida literal de puertas, interacción por criterio, riesgos.
