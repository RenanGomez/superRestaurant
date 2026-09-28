# web-active-orders

## Tarea
web-active-orders · capa: L1 (`implementer-claude`; Codex sin cuota fiable) · riesgo: moderado · nivel B (API: proyección de lectura, sin dinero nuevo ni SQL) + nivel C (web `/app/orders`).

## Objetivo
Que el operador vea en la web las órdenes activas de su sucursal después de confirmar una captura (domicilio, recoger, mostrador y mesa), con lo necesario para operar: folio/hora, canal y cumplimiento, cliente y dirección resumidos, estado de preparación, total cobrable (con envío), intención de pago y nota de líneas; con paginación por cursor y refresco al volver el foco. Acciones: sólo navegación («Cobrar en caja» hacia `/app/caja` con la orden preseleccionada por query, y «Ver captura» si sigue en borrador). Transiciones de estado quedan para otro corte.

## Hechos verificados (main `a5e0d2e`)
- SQL `app_private.list_branch_active_orders(uuid,jsonb)` (`20260926000100`): órdenes activas por sucursal con cursor `(updatedAt desc, orderId desc)`, autorización en SQL; reader `apps/api/src/branch-order-tray.ts` (`PostgresBranchOrderTray.listActive`, `BranchActiveOrder`, `BranchOrderCursor`). Respuesta mínima sin PII ni importes.
- Bandeja operativa: `apps/api/src/operational-work-tray.ts` (`OperationalWorkTrayService.list`, proyectores `projectCaptureOperationalWorkItem` y `projectActiveTableOrderOperationalWorkItem`, éste sólo para mesa); contrato `packages/shared-types/src/operational-work-tray.ts` (`OperationalWorkItemV1`, `OperationalWorkTrayV1`, `itemType: "capture"|"order"`); endpoint `POST /operational-work/tray` (autoriza `captures.read` y `orders.read`).
- Order persistida: agregado con `items[].note`, `deliveryCharge`, estados; `calculateOrderAggregateTotals` en dominio; snapshot de cumplimiento V2 en `app.order_fulfillment_snapshots.snapshot` (`partySnapshot`, `fulfillmentSnapshot`, `deliveryInstructions`, `deliveryQuote`, `paymentIntent`) creado al confirmar.
- Web: patrón de página `apps/web/src/app/app/delivery-zones` / `caja`; navegación `apps/web/src/app/app/app-nav.tsx`; `FocusRevalidate`.

## Criterios de aceptación
- [ ] API (nivel B): proyector `projectBranchOrderOperationalWorkItem` (o extensión de `OperationalWorkItemV1` con un `itemType: "order"` para toda orden activa de la sucursal, no sólo mesa) que combine `BranchActiveOrder` + agregado Order + snapshot de cumplimiento V2 y exponga, por orden: `orderId`, `channel`, `fulfillmentChannel`, `createdAt/updatedAt`, `status`, `preparation` (derivada de estados de líneas como en el proyector de mesa), `customerLabel` (nombre y teléfono enmascarado del `partySnapshot`, nunca PII completa), `addressLabel` (etiqueta + calle abreviada), `totals { currency, itemsTotalMinor, deliveryChargeMinor, totalMinor }` desde `calculateOrderAggregateTotals` (nunca recalculado del catálogo), `paymentIntent` (método/timing/tendered/tip del snapshot), `lineCount`, `hasNotes`. Contrato aditivo en shared-types con parser exacto (nueva `OperationalWorkTrayV2` o campos opcionales versionados; no romper V1 ni Mobile). `OperationalWorkTrayService.list` pagina también órdenes de sucursal con cursor combinado durable (documenta el cursor). Pruebas unitarias del proyector (mesa, domicilio con envío e intención, mostrador sin cliente) y de scope (orden de otra sucursal nunca se lista).
- [ ] Web (nivel C): página `/app/orders` (roles operativos como capture): lista con tarjetas/filas, filtros por cumplimiento y estado, cursor «Cargar más», refresco por foco, estados vacío/carga/error; en teléfono tarjetas apiladas; entrada «Órdenes» en `app-nav.tsx` con ruta activa; botones «Cobrar en caja» (`/app/caja?orderId=`) y «Ver captura» (si `itemType: "capture"`). Sin alert/confirm/prompt; targets ≥44 px; importes con `Intl.NumberFormat("es-MX")` desde minor units.
- [ ] Puertas: shared-types, api, web (lint/typecheck/test/build); mobile typecheck (consume el tray V1).

## Invariantes que NO deben cambiar
- Lectura pura: ningún cambio de estado, dinero ni SQL; totales desde snapshots congelados.
- Scope Restaurant/Branch en SQL y API; PII mínima en la lista.
- Contratos existentes (`OperationalWorkTrayV1`) intactos para Mobile/KDS.

## Fuera de alcance
- Transiciones de estado desde la lista, despacho/repartidor (S7.2), cobro real (S8.3), tiempo real por WebSocket (basta refresco por foco y «Actualizar»).

## Verificación
```bash
pnpm --filter @super-restaurant/shared-types test && pnpm --filter @super-restaurant/shared-types typecheck && pnpm --filter @super-restaurant/shared-types lint && pnpm --filter @super-restaurant/shared-types build
pnpm --filter @super-restaurant/api test && pnpm --filter @super-restaurant/api typecheck && pnpm --filter @super-restaurant/api lint && pnpm --filter @super-restaurant/api build
pnpm --filter @super-restaurant/web lint && pnpm --filter @super-restaurant/web typecheck && pnpm --filter @super-restaurant/web test && pnpm --filter @super-restaurant/web build
pnpm --filter @super-restaurant/mobile typecheck
```

## Entorno
Worktree `C:\tmp\sr-wt\web-active-orders` (rama `claude/web-active-orders` desde `main`). Node 24/pnpm 11 en `%LOCALAPPDATA%\Programs\node24`; `pnpm install --prefer-offline`, construir packages/domain y packages/shared-types. Commits: shared-types → api → web. Informe parcial a los ~35 turnos. Sin push, sin remoto.

## Formato de salida
Resumen y decisiones (forma del cursor combinado, versión del contrato), archivos y commits, salida literal de puertas, interacción que reproduce cada criterio, riesgos.
