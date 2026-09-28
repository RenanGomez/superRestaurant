# capture-payment-intent · ronda 7: cargo de envío en la Order, expiración por reloj del servidor, rehidratación de hora

## Tarea
capture-payment-intent-r7 · capa: L1 (`implementer-claude`) · riesgo: alto · nivel A (dominio Order/dinero, SQL de confirm, checkout). Rama `claude/capture-payment-intent`, worktree `C:\tmp\sr-wt\capture-payment-intent`, HEAD `4b3ae90`. Paquetes previos: `capture-payment-intent.md`, `-r3.md`, `-r6.md`.

## Objetivo
Cerrar los tres hallazgos de `codex exec review` sobre HEAD `4b3ae90`. Decisión del orquestador: el cargo de envío pasa a formar parte del total cobrable de la Order en esta rama (se retira la brecha «S7.2 traerá el cargo»), porque la intención de pago ya lo presenta como parte del total y caja debe cobrarlo.

## Criterios de aceptación (verificables)
- [ ] H13 [P1] Cargo de envío en la Order. Dominio (`packages/domain/src/order.ts` y totales): `Order.deliveryCharge: { amount: Money, quoteId: string } | null` (o nombre coherente con el dominio existente), fijado en `createOrder` (inmutable después), incluido en el total cobrable (`calculateOrderTotals` o equivalente) sin impuestos nuevos (decisión S8: envío separado de venta, sin impuesto); pruebas unitarias. Contratos: `OrderV1`/detalle de orden y KDS si exponen totales → campo aditivo `deliveryChargeMinor` (nullable). Persistencia: codec del agregado con compatibilidad hacia atrás (`null`). API: la materialización de la Order en confirm (`materializeCaptureOrder`/`materializeCaptureSelectionOrder`) toma el cargo de la quote congelada leída del servidor; `PaymentService.checkout` y `derivePaymentObligation` usan el total con envío. SQL (misma migración candidata `20261001000100`): `confirm_capture_draft_v3` valida que `p_order.deliveryCharge.amountMinor` sea exactamente `stored_quote.quote.feeMinor` y `quoteId` coincida (o `null` si no es delivery), sin relajar nada; `create_operational_order`/funciones que validan la forma de `p_order` aceptan la clave nueva. Printing: `renderHandoffTicket` imprime «Envío» antes del total (byte a byte). Fixture SQL: confirm con quote → Order con cargo igual a la tarifa; cargo distinto → conflict.
- [ ] H14 [P1] `20261001000100` ~985-989: la expiración de la quote se compara con `occurredAt` del comando. Compara contra `clock_timestamp()`/`now()` del servidor (patrón que use el repo para leases: busca `attention_lease_expires_at` y usa la misma referencia temporal). Fixture: quote expirada con `occurredAt` anterior a `expiresAt` → conflict `delivery_quote_expired`.
- [ ] H15 [P2] `capture-workspace.tsx` ~229-233: al rehidratar una captura con quote programada, el campo `scheduledFor` queda vacío y `quoteMatchesRequestedTime` bloquea confirmar. En `applyWorkspace`, si `deliveryQuote.scheduledFor` no es null y el campo está vacío, poblar el campo desde la quote (formato del input existente); si el operador ya escribió otra hora, no sobrescribir. Prueba del helper puro que derive el valor del input desde la quote.
- [ ] Puertas: domain, shared-types, api, printing, web (lint/typecheck/test/build) y verificador `verify:capture-payment-intent-schema:rollback`; `pnpm -w run lint typecheck test build` al final.

## Archivos de entrada
- `packages/domain/src/order.ts`, `order-totals.ts` (totales), `packages/domain/src/payment-obligation.ts`.
- `apps/api/src/persistence/order-persistence-codec.ts`, `apps/api/src/capture-repeat-order-plan.ts`, `apps/api/src/captures.ts` (confirm y materialización), `apps/api/src/payments.ts` (`PaymentService.checkout`).
- `supabase/migrations/20261001000100_capture_payment_intent.sql` (confirm ~940-1020), `supabase/tests/capture_payment_intent_invariants.sql`; funciones previas que validan `p_order` (`create_operational_order`, `confirm_capture_draft` base en `20260922000200`, `20260930000100`).
- `packages/printing/src/handoff-ticket.ts`; `apps/web/src/app/app/capture/capture-workspace.tsx` (~200-240), `apps/web/src/lib/capture-payment.ts`.

## Símbolos relevantes
| Archivo | Símbolo | Por qué |
|---|---|---|
| packages/domain/src/order.ts | `createOrder`, `Order` | cargo inmutable en la Order |
| packages/domain | `calculateOrderTotals`/equivalente | total cobrable con envío |
| apps/api/src/captures.ts | `CaptureConfirmationService.confirm` | materializa cargo desde quote congelada |
| apps/api/src/payments.ts | `PaymentService.checkout` | saldo cobrable con envío |
| migración candidata | `confirm_capture_draft_v3` | valida cargo = tarifa congelada; expiración por reloj |
| apps/web capture-workspace.tsx | `applyWorkspace` | rehidratar hora desde la quote |

## Invariantes que NO deben cambiar
- Dinero en minor units; snapshots congelados; ningún importe del cliente (el cargo viene de la quote congelada por el servidor).
- Registros financieros inmutables; el cargo no se edita tras crear la Order.
- Parsers exactos; contratos aditivos; V3/V4 intactos; migraciones aplicadas intactas.

## Fuera de alcance
- Despacho/repartidor (S7.2), refunds, división de cuenta.

## Verificación
```bash
pnpm --filter @super-restaurant/domain test && pnpm --filter @super-restaurant/shared-types test && pnpm --filter @super-restaurant/printing test
cd apps/api && pnpm run verify:capture-payment-intent-schema:rollback
pnpm -w run lint && pnpm -w run typecheck && pnpm -w run test && pnpm -w run build
```
Node 24/pnpm 11 en `%LOCALAPPDATA%\Programs\node24`; PG17 en `.cache/postgres-local/pgsql` del worktree.

## Formato de salida esperado
Resumen por hallazgo (para H13: dónde vive el cargo y cómo se valida); archivos y commits (uno por hallazgo, H13 puede ir en varios por paquete); salida literal de puertas y verificador; riesgos. Informe parcial a los ~35 turnos. Sin push, sin remoto.
