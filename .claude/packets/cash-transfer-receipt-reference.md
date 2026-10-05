# cash-transfer-receipt-reference · la referencia de transferencia en el recibo

## Tarea
cash-transfer-receipt-reference · **API nivel B** (`implementer-claude`, razonamiento moderado; contrato aditivo `PaymentCollectionSummaryV1`, lectura; sin SQL ni cambio de montos) + **web nivel C** (Codex con `-Base claude/cash-transfer-receipt-reference`). Deuda de `cash-transfer-method` (HANDOFF 2026-10-05).

## Objetivo
Que el resumen de cobro que devuelve `POST /payments/collect` (y su replay) incluya `transferReference` cuando el método es `transfer`, y que el recibo durable de caja y la tarjeta de pago lo muestren («Transferencia · Ref. ABC123»).

## Hechos verificados (sesión 2026-10-05)
- `collect_simple_payment_core` guarda la referencia en `app.payments.manual_reference` (migración `20261007000200`), validada 1..64 sin caracteres de control; la fila de respuesta del cobro ya incluye el pago (ver `payments.ts` normalizador y `payments.test.ts` con fila real `{ result }`).
- `packages/shared-types/src/payments.ts`: `PaymentCollectionSummaryV1` sin referencia; `CollectPaymentCommandV1.transferReference?`.
- Web: `apps/web/src/app/app/caja/page.tsx:169` `ReceiptCard` etiqueta «Transferencia» con monto; `receipt.ts` cookie firmada con `RECEIPT_COOKIE_SECRET` (el recibo persiste en la cookie: añadir el campo de forma compatible con cookies viejas).

## Diseño
1. **Contrato aditivo**: `PaymentCollectionSummaryV1.transferReference: string | null` (opcional en parse ⇒ `null`); pruebas runtime.
2. **API**: el normalizador del cobro proyecta `manual_reference` como `transferReference` sólo cuando `method === "transfer"` (para `card_manual` sigue en su campo actual); replay idéntico devuelve el mismo valor; pruebas con fila real.
3. **Web (Codex)**: recibo durable y tarjeta de pago muestran «Transferencia · Ref. X» cuando existe; cookies de recibo anteriores sin el campo siguen abriéndose; prueba en `receipt.test.ts`/`caja-helpers.test.ts`.

## Criterios de aceptación
- [ ] Cobro por transferencia con referencia → recibo con la referencia; sin referencia → sólo «Transferencia».
- [ ] Puertas: shared-types test; api lint/typecheck/test/build; typecheck web/mobile/kds; web (Codex) lint/typecheck/test/build.
- [ ] Commits por unidad; **commitear antes de cualquier informe**.

## Archivos de entrada
- C:\tmp\sr-wt\cash-transfer-receipt-reference\apps\api\src\payments.ts (normalizador de cobro), payments.test.ts (transfer).
- C:\tmp\sr-wt\cash-transfer-receipt-reference\packages\shared-types\src\payments.ts.
- Web: apps\web\src\app\app\caja\page.tsx (ReceiptCard), receipt.ts, receipt.test.ts, payment-panel.tsx.

## Invariantes
Montos intactos; contrato aditivo; no registrar la referencia en logs; sin SQL; sin push.

## Formato de salida
Resumen, hashes, puertas, riesgos.
