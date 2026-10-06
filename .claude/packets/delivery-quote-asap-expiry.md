# delivery-quote-asap-expiry · la cotización ASAP vence al instante (bug)

## Tarea
delivery-quote-asap-expiry · **nivel A** (`implementer-claude`, razonamiento alto; dominio de entrega, contrato compartido, confirm SQL por lectura). Bug detectado por el flujo HTTP local el 2026-10-05 y confirmado por researcher. Revisión doble.

## Veredicto y evidencia
- `packages/domain/src/delivery-quote.ts:190-191` `resolvePromiseStartMs` devuelve `quotedAtMs` cuando `scheduledFor === null`; línea 145 `expiresAt = promiseStart`; línea 30 `DELIVERY_QUOTE_EXPIRY_POLICY = "promise_start"`. ⇒ ASAP: `expiresAt = quotedAt`.
- `packages/shared-types/src/delivery-quote.ts:145-148` exige `expiresAt === promiseStart`.
- `apps/web/src/app/app/capture/capture-workspace.tsx:690-701` envía `scheduledFor: null` para ASAP.
- `supabase/migrations/20261001000100_capture_payment_intent.sql:995-997` (`confirm_capture_draft_v3`): `expiresAt <= clock_timestamp()` ⇒ 409 `delivery_quote_expired`.
- Impacto: ninguna captura telefónica a domicilio ASAP se puede confirmar. El flujo HTTP de entrega programó 45 min para esquivarlo.

## Decisión (L0, 2026-10-05; registrar en PROJECT_NOTES)
Una cotización **ASAP** es válida **15 minutos desde `quotedAt`** (`expiresAt = quotedAt + 15 min`); su ventana prometida pasa a ser `[quotedAt + tiempo de preparación, + 15 min]` donde el tiempo de preparación es el `cutoff` de 30 min ya existente (si el dominio ya tiene un lead time por zona, usar ese). Una cotización **programada** conserva `expiresAt = promiseStart` (política `promise_start`). El SQL no cambia: sólo compara `expiresAt`.

## Diseño
1. **Dominio**: `quoteDelivery` calcula para ASAP `promiseStart = quotedAt + 30 min`, `promiseEnd = promiseStart + 15 min`, `expiresAt = quotedAt + 15 min`; para programadas sin cambios. Constantes nombradas y exportadas. Pruebas: ASAP confirmable 14 min después, vencida a los 16; programada igual que antes; DST intacto.
2. **Contrato**: `packages/shared-types/src/delivery-quote.ts` relaja la validación a `expiresAt <= promiseStart` (y `> quotedAt`); pruebas runtime con ambos casos.
3. **API**: `quoteForCapture` y `matchAddress` (delivery-zones-match) sin cambios salvo pruebas que afirmen los nuevos tiempos ASAP; `apps/api/src/captures.ts` confirm no cambia (valida contra `expiresAt`). Añadir prueba de API: cotización ASAP + confirm con reloj +5 min → ok; +20 min → 409 `delivery_quote_expired`.
4. **Web**: sin cambios obligatorios (lee `promiseStart/End`); si `formatDeliveryQuote` muestra «expira», verificar que siga coherente.
5. Documentar la decisión en `PROJECT_NOTES.md` (lo hace L0).

## Criterios de aceptación
- [ ] Captura ASAP cotizada y confirmada en el flujo HTTP local sin programar (ajustar `http-flow-delivery.ts` cuando se integre la rama `claude/api-http-flow-iteration-2`; si esa rama no está en main al implementar, dejar nota).
- [ ] Puertas: domain test; shared-types test/build; api lint/typecheck/test/build; typecheck web/mobile/kds.
- [ ] Commits por unidad; **commitear antes de cualquier informe**.

## Archivos de entrada
- C:\tmp\sr-wt\delivery-quote-asap-expiry\packages\domain\src\delivery-quote.ts (completo), delivery-quote.test.ts.
- C:\tmp\sr-wt\delivery-quote-asap-expiry\packages\shared-types\src\delivery-quote.ts (120-170), delivery-quote.runtime.test.ts.
- C:\tmp\sr-wt\delivery-quote-asap-expiry\apps\api\src\delivery-zones.ts (260-300), delivery-zones.test.ts, captures.ts (confirm, búsqueda `delivery_quote_expired`).

## Invariantes
Sin SQL; sin push; dinero intacto; cotización congelada en la orden; servidor decide la expiración.

## Formato de salida
Resumen, hashes, puertas, riesgos.
