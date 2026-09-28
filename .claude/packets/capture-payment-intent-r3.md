# capture-payment-intent · ronda 3 de revisión

## Tarea
capture-payment-intent-r3 · capa: L1 (`implementer-claude`) · riesgo: alto · nivel A. Rama `claude/capture-payment-intent`, worktree `C:\tmp\sr-wt\capture-payment-intent`, HEAD `bc643e5`. Paquete padre: `.claude/packets/capture-payment-intent.md`.

## Objetivo
Cerrar los tres hallazgos de `codex exec review --base main` sobre la rama: un P1 web (la operación `selectionPlan` responde V4 y la rehidratación sólo acepta V5, así que agregar una línea deja menú y cobro sin actualizar) y dos P2 de API (idempotencia de `setPaymentIntent` evaluada después de repreciar; la huella de lectura no incluye la identidad de la cotización).

## Criterios de aceptación (verificables)
- [ ] H1: `POST /captures/selection-plan` responde `CaptureWorkspaceV5` (vía `readCaptureWorkspaceV5WithProjections`) igual que workspace, delivery-quote y payment-intent; el cliente `apps/web/src/lib/capture-workspace.ts` parsea V5 en esa operación; la rehidratación en `capture-workspace.tsx` acepta V4 o V5 (campos de pago nulos si llega V4). Pruebas: api (selection-plan devuelve `schemaVersion: 5` y, si había intención, `paymentProjection.status === "stale"`); web lib (parseo V5 de la respuesta de selection-plan).
- [ ] H2: `app_private.probe_capture_payment_intent_set(actor, command)` en la migración candidata `20261001000100` (patrón de `probe_capture_delivery_quote_set`); `setPaymentIntent` llama al probe ANTES de repreciar y en `replayed` devuelve el workspace V5 actual sin repreciar; verificador `run-capture-payment-intent-schema-verification.ts` actualizado (delta de funciones +5) y fixture con caso de replay; `pnpm run verify:capture-payment-intent-schema:rollback` en verde. Prueba unitaria: reintento con la misma `idempotencyKey` tras cambio de líneas → 200 con el estado almacenado, nunca 409.
- [ ] H3: `computeCapturePaymentIntentBasisFingerprint` incluye la identidad de la cotización (`deliveryQuote.quoteId`, o su `applied_capture_version` si V5 lo expone) tanto al fijar la intención como en la lectura V5, de modo que recotizar con la misma tarifa produzca `stale` en lectura igual que SQL rechaza por versión de quote. Prueba unitaria: misma tarifa, quoteId distinto → `stale`.
- [ ] Puertas: `pnpm --filter @super-restaurant/api test|typecheck|lint|build`, `pnpm --filter @super-restaurant/web lint|typecheck|test|build`, `pnpm --filter @super-restaurant/shared-types test|typecheck|lint|build` si tocas contratos.

## Archivos de entrada
- `C:\tmp\sr-wt\capture-payment-intent\apps\web\src\app\app\capture\capture-workspace.tsx` (~170-200: rama de `selectionPlan` y `rehydrateCaptureWorkspace`).
- `C:\tmp\sr-wt\capture-payment-intent\apps\web\src\lib\capture-workspace.ts` (operaciones `selectionPlan`, `paymentIntent`, `deliveryQuote`, parseo V4/V5).
- `C:\tmp\sr-wt\capture-payment-intent\apps\api\src\captures.ts` (`CaptureSelectionPlanService.replace` ~700-800; `setPaymentIntent` ~1400-1460; `computeCapturePaymentIntentBasisFingerprint` ~1150-1170; `readCaptureWorkspaceV5WithProjections`).
- `C:\tmp\sr-wt\capture-payment-intent\supabase\migrations\20261001000100_capture_payment_intent.sql` (probe de quote como patrón; funciones `set_capture_payment_intent`).
- `C:\tmp\sr-wt\capture-payment-intent\supabase\tests\capture_payment_intent_invariants.sql`, `apps\api\src\operations\run-capture-payment-intent-schema-verification.ts`.

## Símbolos relevantes
| Archivo | Símbolo | Por qué importa |
|---|---|---|
| apps/api/src/captures.ts | `readCaptureWorkspaceV5WithProjections` | única fuente del V5 con proyecciones |
| apps/api/src/captures.ts | `CaptureSelectionPlanService.replace` | debe responder V5 |
| apps/api/src/captures.ts | `CapturePaymentIntentService.setPaymentIntent` | orden probe → repreciar |
| apps/api/src/captures.ts | `computeCapturePaymentIntentBasisFingerprint` | debe incluir identidad de quote |
| supabase/migrations/20261001000100 | `probe_capture_delivery_quote_set` | patrón para el probe de intención |
| apps/web/src/lib/capture-workspace.ts | `requestCaptureSelectionPlan`, `rehydrateCaptureWorkspace` | parseo V4/V5 |

## Invariantes que NO deben cambiar
- Ningún importe viene del cliente salvo `tenderedAmountMinor`/`tipMinor`; totales, cambio y timing los calcula el servidor.
- Scope/membership/lease/CAS/idempotencia en SQL y API; parsers exactos; V3/V4 intactos.
- La migración `20261001000100` sigue siendo candidata (no aplicada): editarla es legítimo; no tocar migraciones aplicadas.

## Fuera de alcance
- UI nueva; cambios de contrato distintos a los necesarios; Payment/CashMovement.

## Verificación
```bash
pnpm --filter @super-restaurant/api test && pnpm --filter @super-restaurant/api typecheck && pnpm --filter @super-restaurant/api lint && pnpm --filter @super-restaurant/api build
pnpm --filter @super-restaurant/web lint && pnpm --filter @super-restaurant/web typecheck && pnpm --filter @super-restaurant/web test && pnpm --filter @super-restaurant/web build
cd apps/api && pnpm run verify:capture-payment-intent-schema:rollback
```
Node 24/pnpm 11 en `%LOCALAPPDATA%\Programs\node24`; PG17 en `.cache/postgres-local/pgsql` del worktree.

## Formato de salida esperado
1. Resumen por hallazgo. 2. Archivos y commits (uno por hallazgo). 3. Salida literal de puertas y del verificador PG. 4. Riesgos. Informe parcial a los ~35 turnos. Sin push, sin remoto.
