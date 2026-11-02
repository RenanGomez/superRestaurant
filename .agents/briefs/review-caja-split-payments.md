# review-caja-split-payments — revisión de sólo lectura (segunda familia) de `gemini/caja-split-payments`
Agente: Gemini   Nivel de rigor: A   Complejidad: Compleja

## Objetivo
Revisar `git diff main...gemini/caja-split-payments` (ejecútalo desde la raíz; no edites nada) contra `.claude/packets/caja-split-payments.md`, `.agents/reports/caja-split-payments-research.md` y AGENTS.md §9 (dinero), §10, §12, §14. Revisa con ojos nuevos: no asumas que la implementación es correcta por venir de la misma familia.

## Tarea
1. `apps/web/src/app/app/caja/actions.ts` y `payment-panel.tsx`: ya no hay `redirect()` atrapado por un `try/catch` del cliente; el cliente distingue error de redirección de fallo real; tras `unavailable` relee el detalle y, si el pago ya aparece, lo trata como éxito; el reintento conserva el mismo `idempotencyKey`; no hay forma de cobrar dos veces desde la UI.
2. `quotePaymentAction`: ya no reescribe `amountMinor`; con recibido < requerido devuelve un estado explícito y la UI deshabilita «Cobrar» con el mensaje de faltante calculado por el servidor (no por el cliente).
3. Modo «Pagar total» / «Dividir pago»: «Pagar total» fija el importe al `remainingBalanceMinor` del servidor; «Dividir» permite 1..pendiente; el desglose «Total · Pago n · Pendiente» sale de `payments[]` y `remainingBalanceMinor`, sin sumas en cliente que decidan nada.
4. Migración `supabase/migrations/20261102000300_order_payments_captured_by.sql`: reemplaza `app_private.read_order_receipt_data` desde su versión vigente (`20261007000600`) añadiendo sólo `capturedBy`, con `security definer`, `set search_path = ''`, owner postgres y grants iguales; sin otros cambios. Invariantes `begin;` … `rollback;` sin `commit`, con lectura con/sin pagos y aislamiento por sucursal.
5. Contrato `OrderPaymentV1.capturedBy` opcional en entrada y `null` normalizado; consumidores compilan.
6. `payable-orders.tsx`: tarjeta con `tableLabel` y `accountLabel`, `aria-expanded`, carga de líneas bajo demanda cacheada, «Cobrar» navega al panel correcto; targets ≥ 44 px; sin `any`, LF, español, sin `alert/confirm/prompt`.

## Restricciones
- No modificar archivos, no instalar, no red, no base de datos.

## Formato de salida
Hallazgos P1/P2/P3 con archivo:línea y propuesta; cierre `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR`. Reporte §8 en `.agents/reports/review-caja-split-payments.md`, máximo 70 líneas.
