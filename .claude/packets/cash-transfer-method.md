# cash-transfer-method · cobrar por transferencia en caja

## Tarea
cash-transfer-method · capa: L1 (`implementer-claude`, razonamiento alto) · riesgo: alto · **nivel A** (pagos inmutables, CHECK de `payments`, funciones `app_private` de cobro y reporte, contrato `SimplePaymentMethodV1` consumido por web y API). §19.3: revisión doble (Sonnet; Codex si hay cuota), corte en la tercera ronda. Deuda de D4 (TODO/HANDOFF 2026-10-05).

## Objetivo
Que la caja cobre una cuenta por **transferencia** como tercer método: sin cambio, sin terminal, con referencia opcional, con propina opcional, sin movimiento de efectivo, y que el corte X la reporte aparte. La intención de captura (`CapturePaymentIntentV1`) ya declara `transfer`; hoy el cobro real lo rechaza.

## Hechos verificados (researcher 2026-10-05)
- `supabase/migrations/20260903000200_create_cash_registers_simple_payments.sql:64-105`: tabla `app.payments`, `payments_method_valid` (`cash|card_manual`), `payments_card_manual_shape_valid`, `payments_tender_valid`.
- `20261006000100_cash_collect_change.sql:64-150`: `app_private.collect_simple_payment` vigente; valida método en la línea 119; regla cambio = entregado − cobro − propina; propina en efectivo crea `tip_in`; idempotencia por clave.
- `20260903000300_create_cash_register_operational_reporting.sql:42-51`: `read_cash_register_operational_report` suma `cash` y `card_manual` (44-45); el corte X de la pantalla lee ese reporte.
- `packages/shared-types/src/payments.ts:4-6` `SIMPLE_PAYMENT_METHODS` sin `transfer`; `CollectPaymentCommandV1` (32) consumido por `quotePaymentAction`/`collectPaymentAction` (web) y `POST /payments/collect`; `CashRegisterOperationalReportV1` (125-140) sin campo de transferencias. `capture-payment-intent.ts:43` ya incluye `transfer`.
- Web: `apps/web/src/app/app/caja/payment-panel.tsx:14, 86-88` (botón «Transferencia» deshabilitado con promesa), `caja-helpers.ts` (métodos disponibles), `receipt.test.ts`.
- Pruebas: `supabase/tests/cash_collect_change_invariants.sql:7-87` (fixtures cash/card_manual), pruebas de `apps/api` de pagos (`payments*.test.ts`) con fila real `{ result }`.
- Guard de entregas (`20261006000200`): transferencia sólo tras `delivered` salvo prepago; no cambiar.

## Diseño (seguir salvo razón documentada)
1. **Migración nueva** `20261007000200_payments_transfer_method.sql`: recrear los tres CHECK de `app.payments` admitiendo `transfer` con forma: `manual_provider` y `manual_terminal_id` nulos, `manual_reference` **opcional** (texto 1..64, referencia bancaria), `tendered_amount_minor` y `change_minor` nulos, `tip_minor >= 0`. `create or replace` de `collect_simple_payment` aceptando `transfer` (sin movimiento de caja; la propina por transferencia **no** crea `tip_in`, se reporta aparte como propina no efectivo, igual que tarjeta; confirmar cómo trata hoy la propina de `card_manual` y seguir ese patrón) y de `read_cash_register_operational_report` con `transferCapturedMinor` (y propinas por método si el reporte ya las separa). Conservar grants (`EXECUTE` sólo `app_api`), `security definer`, `search_path = ''`; no editar migraciones aplicadas. Prueba SQL: cobro por transferencia total y parcial, replay idempotente, rechazo de `tendered` con transfer, referencia opcional, reporte con el campo nuevo, aislamiento entre restaurantes. Sonda local PG17.
2. **Contrato**: `SIMPLE_PAYMENT_METHODS` += `transfer`; `CollectPaymentCommandV1` con `reference?` para transfer (si `card_manual` ya lleva `manualReference`, reutilizar el mismo campo); `CashRegisterOperationalReportV1.transferCapturedMinor` (parse con default 0 para compatibilidad); pruebas runtime.
3. **Dominio/API**: `POST /payments/quote` para transfer devuelve cambio 0 y exige `tendered` nulo; `collect` pasa el método; pruebas con fila real `{ result }`, idempotencia, 409 por forma inválida.
4. **Web**: `payment-panel.tsx` habilita «Transferencia» (sin terminal; campo opcional «Referencia»), `caja-helpers.ts` la admite, recibo muestra «Transferencia», corte X muestra «Transferencias» en pesos. Sin `alert/confirm/prompt`; targets 44 px.

## Criterios de aceptación
- [ ] Cobro por transferencia total y parcial desde la pantalla; sin cambio; propina opcional; corte X lo reporta aparte; esperado de efectivo no cambia.
- [ ] Migración candidata con prueba SQL y sonda local ok; contratos compatibles con snapshots y reportes viejos; typecheck web/mobile/kds verde.
- [ ] Puertas: shared-types test; domain test si se toca; api lint/typecheck/test/build; web lint/typecheck/test/build.
- [ ] Commits por unidad (db, shared-types, api, web); **commitear antes de cualquier informe**.

## Archivos de entrada
- C:\tmp\sr-wt\cash-transfer-method\supabase\migrations\20260903000200_create_cash_registers_simple_payments.sql (60-110), 20261006000100_cash_collect_change.sql (completo), 20260903000300_create_cash_register_operational_reporting.sql (1-80).
- C:\tmp\sr-wt\cash-transfer-method\packages\shared-types\src\payments.ts (completo).
- C:\tmp\sr-wt\cash-transfer-method\apps\api\src\payments*.ts y sus pruebas.
- C:\tmp\sr-wt\cash-transfer-method\apps\web\src\app\app\caja\payment-panel.tsx, caja-helpers.ts, receipt*.ts(x), actions.

## Invariantes
Pagos inmutables (correcciones por compensación); dinero en enteros; idempotency key; sin PAN/CVV; el servidor decide cambio y propina; no tocar el guard de entregas; no editar migraciones aplicadas; sin push.

## Fuera de alcance
Evidencia/adjunto de la transferencia, conciliación bancaria, refunds.

## Formato de salida
Resumen con la regla en una frase, archivos y hashes, puertas y sonda, riesgos.
