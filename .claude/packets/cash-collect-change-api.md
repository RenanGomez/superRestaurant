# cash-collect-change-api · cobro con monto entregado, cambio y propina; movimientos del corte

## Tarea
cash-collect-change-api · capa: L1 (`implementer-claude`, razonamiento alto) · riesgo: alto · **nivel A** (dinero: Payment y CashMovement, migración, contrato de pagos consumido por web y mobile). Fila D4+D5 del «Día operable». Reglas §19.3: revisión doble, corte en la tercera ronda.

## Objetivo
Que la caja pueda registrar un cobro en efectivo con el monto entregado y devolver el cambio calculado por el servidor, registrar la propina por separado, y que el corte muestre los movimientos de la sesión. La UI (paquete C posterior) sólo pinta lo que devuelve el API.

## Hechos verificados (researcher 2026-10-03, main 9234162)
- `POST /payments/collect` recibe `CollectPaymentCommandV1` (`packages/shared-types/src/payments.ts:32-90`: método `cash|card_manual|transfer`? verificar lista, `amountMinor`, `provider`, `terminalId`, `reference`) y devuelve `PaymentCollectionSummaryV1` (`amountMinor`, `orderStatus`, `remainingBalanceMinor`, `orderVersion`, `cashRegisterVersion`); sin cambio ni propina. `GET /payments/checkout` → `CheckoutOrderSummaryV1` (`totalMinor`, `capturedAmountMinor`, `remainingBalanceMinor`, `currency`).
- Dominio: `buildPaymentIntentQuote` (`packages/domain/src/payment-intent.ts:38-69`) calcula `changeDue = tendered − planned` sólo para `cash` y si `tendered ≥ planned`; `quotePaymentIntent` (`apps/api/src/payments.ts:73-100`) lo envuelve pero no tiene ruta. `Payment` (`packages/domain/src/payment.ts:55-69`) sólo tiene `amount`; `CashMovement` (`cash-register.ts:49-96`) tipos `cash_sale|cash_refund|cash_in|cash_out|cash_adjustment`, sin propina.
- Corte: `GET /cash-registers/report` → `CashRegisterOperationalReportV1` (`cashCapturedMinor`, `cardManualCapturedMinor`, `totalCapturedMinor`, `paymentCount`, `register` con `expectedCashBalanceMinor`, `openingFloatMinor`, `countedClosingBalanceMinor`, `differenceMinor`, `status`); sin lista de movimientos. `POST /cash-registers/close` calcula esperado y diferencia en servidor y exige motivo si hay diferencia.
- Decisiones de producto vigentes (`docs/architecture/P2_CAPTURE_PAYMENT_OPERATION_SLICE.md` §9.1): métodos piloto `cash|card_manual|transfer`; propina separada del total y nunca dentro del Payment de la cuenta; registros financieros inmutables, correcciones por movimientos compensatorios.

## Diseño (seguir salvo razón documentada)
1. **Contrato** (aditivo): `CollectPaymentCommandV1` admite `tenderedAmountMinor?: number` (sólo con `cash`; debe ser ≥ `amountMinor`) y `tipMinor?: number` (≥ 0; con cualquier método; se registra aparte); `PaymentCollectionSummaryV1` devuelve además `tenderedAmountMinor | null`, `changeMinor | null`, `tipMinor`. Nuevo `POST /payments/quote` (`QuoteCashPaymentRequestV1 { scope, orderId, cashRegisterSessionId, method, amountMinor, tenderedAmountMinor | null, tipMinor }` → `PaymentIntentQuoteV1` existente o una respuesta mínima `{ changeMinor | null, remainingAfterMinor }`), sólo lectura, reutilizando `quotePaymentIntent`. `CashRegisterOperationalReportV1` añade `tipsMinor` y `movements[]` (o nuevo `POST /cash-registers/movements` paginado si el reporte crece demasiado; justificar): `movementId, type, direction, amountMinor, occurredAt, source (paymentId|refundId|null), note`.
2. **Dominio**: el cambio no es dinero de la cuenta: `Payment.amount` sigue siendo lo cobrado; se añaden `tenderedAmount: Money | null` y `change: Money | null` como datos de auditoría del Payment en efectivo (inmutables); la caja registra `cash_sale` por `amount` (el cambio sale del mismo efectivo entregado, así que el esperado no cambia). Propina: nuevo tipo de movimiento `tip_in` (efectivo) o registro `tip` asociado al Payment cuando es tarjeta/transferencia, con `tipMinor` fuera del total de la cuenta y sumado en `tipsMinor` del corte; el esperado en efectivo suma las propinas en efectivo sólo si la decisión §9.1 dice que la propina se queda en caja (verificar; si no lo dice, documentar la decisión: **la propina en efectivo entra a caja y se reporta aparte**). Reglas en `packages/domain` con pruebas unitarias.
3. **SQL**: migración candidata `20261006000100_cash_collect_change.sql`: columnas aditivas en la tabla de pagos (`tendered_amount_minor`, `change_minor`, `tip_minor`, con CHECK `change = tendered − amount` cuando no son nulos, y `tendered` sólo con método cash), tipo de movimiento `tip_in` si se usa CashMovement, actualización de las funciones `collect_payment`/`close_cash_register`/`cash_register_report` (localizar nombres reales) para persistir y devolver lo nuevo y la lista de movimientos; prueba SQL (cambio correcto, rechazo de tendered < amount, tip con tarjeta, esperado del corte con y sin propina en efectivo, aislamiento por sucursal, replay idempotente). Sonda local PG17 como las anteriores. No editar migraciones aplicadas.
4. **API**: servicio de pagos con los nuevos campos; validación: `tenderedAmountMinor` sólo con `cash`; idempotencia intacta (el replay devuelve el mismo cambio). Pruebas: cobro exacto, con cambio, tendered insuficiente → request, propina con tarjeta, reporte con movimientos y propinas, aislamiento.

## Criterios de aceptación
- [ ] Migración candidata reproducible con prueba SQL y sonda local ok.
- [ ] Contratos aditivos; web/mobile/kds typecheck verdes (mobile usa pagos: verificar parsers exactos y mantener compatibilidad de lectura).
- [ ] Endpoints con pruebas; ningún cálculo de dinero fuera del dominio; cambio y propina nunca alteran el total de la cuenta.
- [ ] Puertas: domain, shared-types, api (test/typecheck/lint/build); web/mobile/kds typecheck.
- [ ] Commits por unidad (`feat(domain)`, `feat(shared-types)`, `feat(db)`, `feat(api)`); informe parcial a los ~35 turnos; **commitear antes de cualquier informe**.

## Archivos de entrada
- C:\tmp\sr-wt\cash-collect-change-api\packages\domain\src\payment.ts, cash-register.ts, payment-intent.ts.
- C:\tmp\sr-wt\cash-collect-change-api\packages\shared-types\src\payments.ts, payment-intent.ts.
- C:\tmp\sr-wt\cash-collect-change-api\apps\api\src\payments.ts, payments.controller.ts, persistencia de pagos (buscar `collect_payment` en apps/api/src y supabase/migrations).
- Migraciones de pagos/caja en C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\supabase\migrations (grep `cash_register`, `payments`).
- Patrón reciente: `supabase/migrations/20261004000200_table_board.sql` y `apps/api/src/operations/run-table-board-schema-verification.ts`.

## Invariantes
Dinero en minor units + ISO; servidor calcula; Payment y CashMovement inmutables; idempotencia; alcance Restaurant/Branch; sin push ni remoto.

## Fuera de alcance
UI de caja (paquete C), refunds, división de cuenta, intención de pago precargada desde la captura (deuda).

## Formato de salida
Resumen con las reglas de cambio y propina en dos frases, archivos y hashes, resultado final de cada puerta y de la sonda, riesgos.
