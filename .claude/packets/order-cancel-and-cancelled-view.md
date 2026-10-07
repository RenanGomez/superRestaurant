# order-cancel-and-cancelled-view · cancelar una orden completa y vista «Canceladas» (T2)

## Tarea
order-cancel-and-cancelled-view · **API nivel A** (`implementer-claude`, razonamiento alto; máquina de estados, SQL, autorización, obligación de devolución) + **web nivel C** (Codex, `-Base claude/order-cancel-and-cancelled-view`). Revisión doble en A, una ronda en C. Fila T2 del bloque «turno completo» (PROJECT_NOTES 2026-10-06) y decisión de Emmanuel 2026-10-01 («Sin venta» = «Cancelar»; vista «Canceladas» con capturas cerradas y órdenes canceladas).

## Objetivo
Un gerente o supervisor cancela una orden completa con motivo (1..200) desde el detalle; las líneas enviadas reciben corrección en KDS; si hay dinero capturado, la orden se cancela igual y queda una **obligación de devolución pendiente** visible (decisión S6 §5.1 punto 6, 2026-09-26; no existe refund aún); una orden con entrega activa (`assigned|en_route`) no se cancela hasta marcarla «No se pudo» o liquidarla. Pestaña «Canceladas» en `/app/orders` lista órdenes canceladas y capturas cerradas con motivo, actor y hora.

## Hechos verificados (researcher 2026-10-06)
- Decisiones S6 aprobadas: `docs/architecture/P2_ORDER_CHANGE_CANCELLATION_SLICE.md:1-115` §5.1 (motivo obligatorio, autorización server-side supervisor/gerente, `refundObligation: pending` no bloqueante con pago capturado, auditoría inmutable).
- `packages/domain/src/order-state.ts:1-239`: Order `draft|open|partially_paid|paid|closed|cancelled`; el validador (66-73) **no** permite `partially_paid|paid → cancelled`; OrderItem con `OrderItemCancellationAudit`. `order-item-change-impact.ts:55-67` `assessOrderItemChangeImpact` deriva `refundObligation: pending` si hay capturado o status pagado.
- `apps/api/src/orders.ts:340-906`: `cancelItem` sólo en draft/open (445); `computeAvailableActions` (867-899) sin `cancelOrder`; permisos `orders.cancel.pending` y `orders.cancel.sent` existen a nivel línea; no existe `orders.cancel.order`.
- `supabase/migrations/20260929000100_capture_no_sale.sql:1-119` `close_capture_no_sale` (motivo 1..500, `capture_command_events` `capture.no_sale`): patrón a replicar. `20261003000100` `send_order_to_kitchen` + `order_command_events`: idempotencia por comando y corrección KDS.
- `branch-order-work-tray.ts:1-204` `list_branch_order_work_items` sólo `draft|open|partially_paid|paid`; no hay lector de canceladas.
- Entregas: `order_deliveries` estados `assigned|en_route|delivered|failed|settled` (`20261006000200`).

## Diseño (seguir salvo razón documentada)
1. **Dominio**: `transitionOrder` admite `partially_paid|paid → cancelled` **sólo** con `audit.refundObligation === "pending"` y motivo; `closed → cancelled` sigue prohibido; función pura `assessOrderCancellation(order, delivery, capturedMinor)` → `{ eligible, blockReason: delivery_active|closed|already_cancelled, refundObligation: none|pending, itemsToCancel, itemsNeedingKitchenCorrection }`. Pruebas unitarias.
2. **SQL** `20261007000400_cancel_order.sql`: tabla `app.order_cancellations` (restaurant, branch, order, version, reason, actor, device, occurred_at, refund_obligation_status `none|pending`, captured_minor, inmutable) y `app_private.cancel_order(p_actor, p_command jsonb)`: valida scope, membresía con permiso, CAS por `expectedVersion`, estados permitidos, entrega activa → conflict `DELIVERY_ACTIVE`, cancela todas las líneas no canceladas con auditoría (y marca corrección KDS para `sent|preparing|ready` como hace `cancel_item`), pone Order `cancelled`, inserta `order_cancellations`, `order_command_events` para replay idéntico/409 divergente; `list_kds_tickets` deja de mostrar la orden o la marca cancelada (según cómo trate hoy líneas canceladas). Lector `app_private.list_cancelled_work_items(p_actor, p_request)` = unión de órdenes `cancelled` (con motivo/actor/hora de `order_cancellations`, total y capturado, `refundObligationStatus`) y capturas `no_sale` (motivo/actor/hora de `capture_command_events`), cursor durable, alcance sucursal, PII sólo con `customers.read`. EXECUTE sólo `app_api`; security definer; search_path ''. Prueba SQL (cancelar draft/open/partially_paid con obligación pendiente, paid, bloqueo con entrega activa, closed, replay, aislamiento) y verificador rollback-only local.
3. **RBAC**: permiso `orders.cancel.order` para `manager` y `supervisor` (verificar nombres de rol en `rbac-policy.ts`).
4. **Contratos**: `CancelOrderCommandV1` (scope, orderId, expectedVersion, eventId, idempotencyKey, deviceId, occurredAt, reason), `CancelOrderResultV1` (status, order, refundObligation), `CancelledWorkTrayV1` (ítems con `kind: order|capture`, motivo, actor, hora, total, capturado, `refundObligationStatus`, cursor); parsers fail-closed con pruebas. `OrderDetailV1.availableActions` += `cancelOrder` y, si existe, `refundObligation` en el detalle (aditivo).
5. **API**: `POST /orders/cancel`, `POST /orders/cancelled` (lector); `computeAvailableActions` ofrece `cancelOrder` con permiso y estado; pruebas con fila real `{ result }`, replay, 409 `DELIVERY_ACTIVE`, 403, contract test HTTP.
6. **Web (Codex, nivel C, después)**: en `/app/orders` detalle → «Cancelar orden» (sólo si está en `availableActions`) → diálogo in-app con motivo obligatorio → resultado; si hay capturado, aviso «Queda pendiente devolver $X en caja»; pestaña «Canceladas» con la lista (orden/captura, motivo, quién, cuándo, «Devolución pendiente $X»); la captura «Cancelar» (hoy «Sin venta») usa la misma copia; sin alert/confirm; 44 px.

## Criterios de aceptación
- [ ] Cancelación completa con motivo, auditada, idempotente; obligación pendiente visible; entrega activa bloquea con mensaje.
- [ ] Puertas: domain test; shared-types test/build; api lint/typecheck/test/build; typecheck web/mobile/kds; kds test si cambia el ticket; prueba SQL + sonda local.
- [ ] Commits por unidad (domain, db, shared-types, api); **commitear antes de cualquier informe**; informe parcial a ~35 turnos.

## Archivos de entrada
- C:\tmp\sr-wt\order-cancel-and-cancelled-view\packages\domain\src\order-state.ts, order-item-change-impact.ts, order.ts (cancelOrderItem).
- C:\tmp\sr-wt\order-cancel-and-cancelled-view\supabase\migrations\20260929000100_capture_no_sale.sql, 20261003000100_send_order_to_kitchen.sql (cancel_item y KDS), 20261006000200_order_deliveries.sql (estados), 20261002000100 + 20261007000100 (lector de bandeja).
- C:\tmp\sr-wt\order-cancel-and-cancelled-view\apps\api\src\orders.ts (340-906), orders.controller.ts, branch-order-work-tray.ts, auth\rbac-policy.ts, orders.test.ts.
- docs\architecture\P2_ORDER_CHANGE_CANCELLATION_SLICE.md §5.1.

## Invariantes
Registros financieros inmutables (la devolución será un movimiento compensatorio futuro, aquí sólo se registra la obligación); auditoría con actor, motivo, dispositivo; servidor autoriza; alcance Restaurant/Branch; no editar migraciones aplicadas; sin push.

## Fuera de alcance
Refund/void real, reapertura, cancelación parcial post-cocina con reemplazo.

## Formato de salida
Resumen con las reglas en tres frases, archivos y hashes, puertas y sonda, riesgos.
