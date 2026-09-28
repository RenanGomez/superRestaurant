# capture-payment-intent · ronda 6 de revisión

## Tarea
capture-payment-intent-r6 · capa: L1 (`implementer-claude`) · riesgo: alto · nivel A. Rama `claude/capture-payment-intent`, worktree `C:\tmp\sr-wt\capture-payment-intent`, HEAD `f2bdc39`. Paquetes previos: `.claude/packets/capture-payment-intent.md`, `-r3.md`.

## Objetivo
Cerrar los tres hallazgos de `codex exec review --base main` sobre HEAD `f2bdc39`.

## Criterios de aceptación (verificables)
- [ ] H10 [P1] `supabase/migrations/20261001000100_capture_payment_intent.sql` ~960-968 (`confirm_capture_draft_v3`): para `fulfillment_channel = 'delivery'` exigir una cotización congelada válida antes de confirmar: presente, `coverageStatus`/estado cubierto (no `not_covered`), y `expiresAt` posterior a `occurredAt` del comando (misma referencia temporal que usa la función); si no → `conflict` con `reason` tipado `delivery_quote_missing` / `delivery_quote_expired` / `delivery_quote_not_covered`. Sin relajar nada. Fixture SQL con los cuatro casos (sin quote, expirada, no cubierta, válida). Verificador `verify:capture-payment-intent-schema:rollback` en verde. En la API, mapear esas razones a 409 con código `CAPTURE_DELIVERY_QUOTE_INVALID` y mensaje claro; en la web, motivo visible y botón «Cotizar entrega».
- [ ] H11 [P1] `apps/web/src/app/app/capture/capture-workspace.tsx` ~220-227: el guard `quoteRequestedForDiffers` es estado local y `applyWorkspace` lo limpia tras cualquier mutación (p. ej. fijar intención), habilitando confirmar con una promesa vieja. Derivar el guard de hechos del servidor: comparar el `scheduledFor` solicitado en la quote congelada (`deliveryQuote.requestedFor`/campo equivalente de `DeliveryQuoteV1`; si no existe, añadirlo al jsonb que construye el API y al contrato V1 de forma aditiva) con el valor actual del campo; no depender de estado que se limpie. Prueba del helper puro (`quoteMatchesRequestedTime(quote, scheduledFor)`) con node:test.
- [ ] H12 [P2] `apps/web/src/lib/capture-payment.ts` ~17-20: `parseMoneyInputToMinor("10")` devuelve NaN por fracción vacía. Tratar fracción ausente como 0; la prueba «10 → 1000» debe pasar de verdad (revisa por qué no falló antes y corrige la prueba si estaba mal).
- [ ] Puertas: `pnpm --filter @super-restaurant/api test|typecheck|lint|build`; `pnpm --filter @super-restaurant/web lint|typecheck|test|build`; shared-types si tocas contratos; verificador PG.

## Archivos de entrada
- `supabase/migrations/20261001000100_capture_payment_intent.sql` (confirm ~940-1020), `supabase/tests/capture_payment_intent_invariants.sql`.
- `packages/shared-types/src/delivery-quote.ts` (`DeliveryQuoteV1`: `coverageStatus`, `expiresAt`, `promiseStart/End`; ver si lleva la hora solicitada).
- `apps/api/src/captures.ts` (`CaptureDeliveryQuoteService.requestQuote`, `confirmationResult`).
- `apps/web/src/app/app/capture/capture-workspace.tsx` (~200-240 `applyWorkspace`; ~900-940 campo de hora programada; `quoteBlocksConfirm`).
- `apps/web/src/lib/capture-payment.ts` y `.test.ts`.

## Símbolos relevantes
| Archivo | Símbolo | Por qué |
|---|---|---|
| migración candidata | `confirm_capture_draft_v3` | validez de la quote en confirm |
| apps/api/src/captures.ts | `confirmationResult` | mapeo de razones a 409 |
| apps/web capture-workspace.tsx | `applyWorkspace`, `quoteBlocksConfirm` | guard derivado del servidor |
| apps/web lib/capture-payment.ts | `parseMoneyInputToMinor` | fracción vacía |

## Invariantes que NO deben cambiar
- Ningún importe ni tarifa del cliente; el servidor decide validez de la quote.
- La migración `20261001000100` sigue candidata; no tocar migraciones aplicadas.
- Parsers exactos; V3/V4 intactos.

## Fuera de alcance
- Programación/despacho S7.2; cambios de UI más allá de los motivos visibles.

## Verificación
```bash
cd apps/api && pnpm run verify:capture-payment-intent-schema:rollback
pnpm --filter @super-restaurant/api test && pnpm --filter @super-restaurant/api typecheck && pnpm --filter @super-restaurant/api lint && pnpm --filter @super-restaurant/api build
pnpm --filter @super-restaurant/web lint && pnpm --filter @super-restaurant/web typecheck && pnpm --filter @super-restaurant/web test && pnpm --filter @super-restaurant/web build
```
Node 24/pnpm 11 en `%LOCALAPPDATA%\Programs\node24`; PG17 en `.cache/postgres-local/pgsql` del worktree.

## Formato de salida esperado
Resumen por hallazgo; archivos y commits (uno por hallazgo); salida literal de puertas y verificador; riesgos. Informe parcial a los ~35 turnos. Sin push, sin remoto.
