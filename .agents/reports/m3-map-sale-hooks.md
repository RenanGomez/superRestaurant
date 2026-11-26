## Estado
done — mapa de ganchos de venta verificado por lectura; solo lectura, sin cambios.

## Qué hice
**1. Confirmación.** `app_private.confirm_capture_draft_v3(p_actor_id uuid, p_command jsonb, p_order jsonb, p_order_audit jsonb) returns jsonb`, última definición `supabase/migrations/20261123000500_confirm_pizza_v2_and_zone_coverage.sql:14` (v1 en `20260922000200_confirm_capture_order.sql:59`). Escribe `app.orders` vía `app_private.persist_order_mutation` (`20261123000500...:700`; helper `20260902000200_create_orders_realtime.sql:169` → `app.orders`, `app.order_audit_events`, `app.kds_events`), más `app.order_fulfillment_snapshots` y `app.capture_command_events`. API: `apps/api/src/captures.ts:560` `confirmDraft` y `:517` `probeConfirmation`.

**2. Ítems/modificadores.** No existe tabla `app.order_items`; todo está en `app.orders.aggregate` JSONB (`20260902000200_create_orders_realtime.sql:3`), ruta `aggregate->'items'`. Cada línea (`OrderItemPricingInput`, `packages/domain/src/order-totals.ts:128`): `orderItemId`, `snapshot.productId/stationId/unitPrice`, `snapshot.modifiers[]` (`:109`), halves en `snapshot.geometry ('whole'|'halves')` + `fractionBreakdown` + `pizzaHalves` (`:119-125`), `quantity`. Cantidad entera: `Number.isSafeInteger(quantity) && >0` (`order-totals.ts:806-810`).

**3. Cancelación.** Orden: `app_private.cancel_order(uuid,jsonb,jsonb)` `20261007000400_cancel_order.sql:75`, API `apps/api/src/orders.ts:92`; escribe aggregate (status cancelled), `order_audit_events`, `kds_events` y `app.order_cancellations` (`:367`). Línea: `app_private.persist_order_item_cancellation(uuid,bigint,jsonb,jsonb)` `20260905000300_enable_order_item_cancellations.sql:35`; rastro en `item.cancellationAudit` + `order_audit_events` + `kds_events` (no hay tabla aparte).

**4. Reembolso.** No existe tabla `refunds` ni función de reembolso. Solo obligación: `app.order_cancellations.refund_obligation_status ('none'|'pending'), captured_minor, captured_tip_minor` (`20261007000400...:35-38`); `app.payments.state` solo `'captured'` (`20260903000200...:87`). Se referencia la orden por `order_id` (FK a `app.orders`); el cobro original en `app.payments.order_id`.

**5. Caja.** Punto único de todo cobro: `app_private.collect_simple_payment(...)` (`20260903000200...:388`; cuerpo vigente `20261006000100_cash_collect_change.sql:64`, core `20261007000200_payments_transfer_method.sql:36`), API `apps/api/src/payments.ts:66`. Inserta `app.payments` (cash/card_manual/transfer) y, solo `method='cash'`, `app.cash_movements` `'cash_sale'` con `source_payment_id` (`20261006000100:273-288`); actualiza sesión y `app.orders`. No hay writer de `cash_refund`.

**6. Idempotencia.** confirm → `app.capture_command_events` unique `(actor_id,restaurant_id,branch_id,idempotency_key)` + lock `'capture-command:...'` (`20260922000200...:124-128`); orden → `app.order_audit_events` misma unique (`20260902000200...:60`); cancel → `app.order_command_events` + `command_kind='cancel_order'` (`20261003000100...:26`); cobro → `app.financial_audit_events` unique (`20260903000200...:189`) y `app.cash_movements` unique `(...,idempotency_key)` + `(restaurant,branch,device,local_sequence)` (`:139-140`).

**7. Riesgos M3.** (a) Ítems solo JSONB: hay que explotar `aggregate->'items'` (productId/quantity/modifiers/halves) tras `persist_order_mutation`; no hay `order_items`. (b) Reusar idempotency por `order_item_id+eventId`; el replay de confirm v3 devuelve `replayed` y duplicaría consumo fuera de la tx. (c) Dos rutas de cancelación mutan el aggregate: reverso desde `cancellationAudit`/`order_cancellations`, nunca catálogo. (d) Pagos parciales/N cobros: consumir en confirmación, no en cobro. (e) Reembolsos solo obligación `pending`: no hay gancho de reposición.

## Archivos tocados
- ninguno (solo lectura).

## Verificación
```powershell
Select-String -Path supabase/migrations/*.sql -Pattern 'confirm_capture_draft' | Select-Object -First 5
```
```text
supabase\migrations\20260922000200_confirm_capture_order.sql:59:create function app_private.confirm_capture_draft(
supabase\migrations\20260924000100_confirm_capture_repeat_order.sql:60:create function app_private.confirm_capture_draft_v3(
supabase\migrations\20260928000100_capture_selection_plan.sql:875:create or replace function app_private.confirm_capture_draft_v3(
supabase\migrations\20261123000500_confirm_pizza_v2_and_zone_coverage.sql:14:create or replace function app_private.confirm_capture_draft_v3(
```
```powershell
Select-String -Path apps/api/src/captures.ts,apps/api/src/payments.ts,apps/api/src/orders.ts -Pattern 'confirm_capture_draft_v3|collect_simple_payment|cancel_order'
```
```text
captures.ts:560:      "select app_private.confirm_capture_draft_v3($1::uuid, $2::jsonb, $3::jsonb, $4::jsonb) as result",
payments.ts:66: const collectPaymentSql = "select app_private.collect_simple_payment($1::uuid,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6::bigint,$7::bigint) as result";
orders.ts:92: const cancelWholeOrderSql = "select app_private.cancel_order($1::uuid, $2::jsonb, $3::jsonb) as result";
```

## Riesgos / dudas
- Todo verificado en archivos/grep; NO VERIFICADO contra DB viva. Confirmar `\d app.orders`/`\d app.payments` antes de escribir la migración M3.

## Notas propuestas
- Enganchar consumo a la tx de confirm v3 y reverso por `cancellationAudit`; no existen tablas normalizadas de líneas ni de reembolsos.