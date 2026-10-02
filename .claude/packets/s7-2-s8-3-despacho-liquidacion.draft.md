# BORRADOR (researcher 2026-10-01, no delegable todavía) · S7.2 + S8.3 despacho y liquidación

Estado: investigación L1 (researcher, haiku) a partir de main 637e7a9 y rama claude/web-order-actions. Falta contrastar las propuestas contra el código y partir en paquetes por subunidad antes de delegar. Las rutas propuestas (orders-detail.service.ts, /app/entregas, etc.) son sugerencias, no archivos existentes.

## Hechos verificados por el researcher
- Dominio: payment-intent.ts (buildPaymentIntentQuote, PAYMENT_INTENT_METHODS cash|card_manual|transfer), capture-payment-intent.ts (proyección total + envío, timing now|on_fulfillment), payments.ts (createPayment, transitionPayment), cash-register.ts (open/close/appendCashMovement).
- Shared-types: payment-intent.ts, capture-payment-intent.ts (CapturePaymentIntentV1, SetCapturePaymentIntentCommandV1), payments.ts (CheckoutOrderQueryV1, CheckoutOrderSummaryV1 con ~10 consumidores).
- SQL: 20260917000300 snapshots de fulfillment; 20261001000100 capture_delivery_quotes, capture_payment_intents, confirm_capture_draft_v3; 20261002000100 list_branch_order_work_items. No existe journal de fulfillment, repartidor, asignación, incidencias ni obligaciones persistidas.
- API: payments.controller.ts:30-46 (POST /cash-registers/open, POST /payments/collect, POST /cash-registers/close, GET /cash-registers/report, GET /payments/checkout); payments.ts:73-128 quotePaymentIntent, projectPaymentObligation; FinancialService open/collect/close/checkout/report.
- Web: /app/caja consume /payments/checkout; /app/orders consume /branch-orders/tray; OrderDetailV1 y POST /orders/detail viven sólo en la rama web-order-actions.

## Qué falta (propuesta)
1. Contratos: AssignDeliveryCommandV1, DispatchDeliveryCommandV1, MarkDeliveredCommandV1, LiquidateDeliveryCommandV1 (efectivo contra entrega → Payment capturado al liquidar); OrderDetailV1 con fulfillment y obligación de pago.
2. SQL: order_fulfillments (estado, versión, repartidor, snapshot), order_fulfillment_events (journal append-only), delivery_incidents, funciones SECURITY DEFINER assign/dispatch/deliver/liquidate.
3. API: mutaciones de asignar/despachar/entregar (nivel B si no tocan dinero) y liquidar (nivel A, Payment + CashMovement en una transacción con la caja abierta); lectura de detalle con obligación.
4. Web: pantalla de entregas (asignar, despachar, liquidar) y cobro card_manual/transfer desde /app/caja con la intención.

## División sugerida
| # | Unidad | Nivel |
|---|---|---|
| 1 | Contratos de entrega y liquidación | A |
| 2 | Migración de fulfillment + journal + funciones | A |
| 3 | Lectura: detalle con fulfillment y obligación | B |
| 4 | Mutaciones asignar/despachar/entregar | B |
| 5 | Liquidación con Payment/CashMovement | A |
| 6 | Web entregas y caja | C |

Invariantes: intención ≠ Payment; diferencias de efectivo como CashMovement, nunca editando Payment; reintentos no duplican cobro; alcance Restaurant/Branch; journal inmutable.
