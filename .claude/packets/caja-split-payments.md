# caja-split-payments · corregir el cobro que «falla» pero cobra, y rediseñar el cobro dividido en caja

Nivel A (dinero: acciones de cobro, contrato de pagos, SQL de proyección) · Capa L2 Gemini `-Write` (Codex sin cuota) con revisión doble (Claude + Gemini) · rama `gemini/caja-split-payments` desde `main` (≥ 4238b64). Base: `.agents/reports/caja-split-payments-research.md` (léelo completo; tiene archivo:línea de todo). Archivos: `apps/web/src/app/app/caja/**`, `apps/web/src/lib/orders-view.ts` (sólo lectura/uso), `packages/shared-types/src/orders.ts` (+test), `apps/api/src/orders.ts` (+test), una migración nueva. No tocar `menu/**`, `tables/**`, `capture/**`.

## Hallazgos de Emmanuel (2026-11-02)
1. «Cuenta» sólo muestra el ID de la orden.
2. Cuenta de 130: escribe 70 en «A cobrar», 60 en «Recibido», «Cobrar» → mensaje genérico de error; al volver, total 130, «A cobrar» sólo permite 60 y nada dice que ya se pagaron 70.
3. Quiere «Pagar total» o «Dividir pago» antes del método; al dividir, cobros uno por uno con «Total 130 · Pago 1 −70 · Pendiente 60»; «A cobrar» precargado siempre con el pendiente.
4. «Órdenes por cobrar»: mostrar mesa (nombre) y nombre de cuenta; tocar la tarjeta la expande con las líneas; «Cobrar» lleva al detalle y cobro.

## Causa raíz (investigación)
- `apps/web/src/app/app/caja/actions.ts:180`: `collectPaymentAction` termina con `redirect(receiptHref)`; `payment-panel.tsx:55-58` envuelve la server action en `try/catch` y atrapa `NEXT_REDIRECT` como error → el pago ya quedó en PostgreSQL pero la UI muestra «No se pudo confirmar el cobro». **Ese es el bug de los 70.**
- `quotePaymentAction` (`actions.ts:91-102`) reescribe `amountMinor = received − tip` cuando recibido < requerido, devolviendo una cotización distinta de lo tecleado.
- `page.tsx:181-207` (`OrderSummary`) nunca muestra `detail.payments` ni `remainingBalanceMinor`, aunque `CheckoutOrderSummaryV1` trae `orderTotalMinor`, `capturedAmountMinor`, `remainingBalanceMinor` y `OrderDetailV1.payments` trae cada pago.

## Cambios
1. **Acción de cobro (A)**: `collectPaymentAction` deja de hacer `redirect` dentro del flujo que el cliente envuelve en `try/catch`: devuelve `{ status: "ok", receiptHref }` y el cliente navega con `router.push`; en `payment-panel.tsx` el `catch` distingue `isRedirectError` (re-lanzar) de fallos reales, y tras un `unavailable` relee el detalle antes de mostrar error (si el pago ya aparece en `payments`, es éxito). Mantener idempotencia por intento (mismo `idempotencyKey` en el reintento).
2. **Cotización (A)**: `quotePaymentAction` no reescribe el importe; si recibido < requerido devuelve `{ status: "invalid_amount", requiredMinor }` y la UI muestra «Recibido menor al cobro más propina: faltan $X» y deshabilita «Cobrar». Validación cliente síncrona equivalente (sin calcular dinero nuevo: usa `requiredCashTenderMinor` existente y lo que devuelve el servidor).
3. **Contrato + SQL + API (A)**: `OrderPaymentV1.capturedBy: string | null` opcional en entrada, `null` normalizado; migración nueva `supabase/migrations/20261102000300_order_payments_captured_by.sql` que reemplaza `app_private.read_order_receipt_data` desde su versión vigente (`20261007000600`) añadiendo `'capturedBy', p.captured_by::text` (conservar `security definer`, `search_path`, owner, grants); `apps/api/src/orders.ts:1060` mapea el campo; invariantes `supabase/tests/order_payments_captured_by_invariants.sql` (`begin;` … `rollback;`, sin `commit`): lectura con y sin pagos, aislamiento por sucursal. Verificador `run-order-payments-captured-by-schema-verification.ts` + script `--local-disposable-only`. **No aplicar en remoto.**
4. **UI de caja (C)**:
   - Encabezado de «Cuenta»: `tableLabel(tableId, names, accountLabel)` («Mesa 2 · Juan»), canal, hora de apertura, lista de líneas (nombre, cantidad, total de línea del servidor).
   - Selector «Pagar total» / «Dividir pago» antes del método (botones 44 px, `aria-pressed`). «Pagar total» fija «A cobrar» al `remainingBalanceMinor` y lo bloquea; «Dividir pago» permite editar 1..pendiente, precargado con el pendiente.
   - Bloque «Total de la cuenta 130 · Pago 1 −70 (Efectivo, hh:mm) · Pendiente 60» a partir de `payments` y `remainingBalanceMinor`; tras cada cobro se refresca.
   - «Órdenes por cobrar» (`payable-orders.tsx`): título con `tableLabel` y `accountLabel`; tocar la tarjeta la expande (`aria-expanded`) y carga las líneas con `orderDetailAction(orderId)` bajo demanda, cacheadas en estado; «Cobrar» navega a `/app/caja?orderId=…` y hace scroll al panel de cobro.
5. Textos en español; sin `any`; LF; sin `alert/confirm/prompt`; targets ≥ 44 px; dinero siempre del servidor (`formatMinorUnits`).

## Invariantes
Ningún cálculo monetario nuevo en cliente; `idempotencyKey` por intento; el servidor sigue decidiendo saldo, cambio y estados `paid|partially_paid`; snapshots inmutables; aislamiento por sucursal en la proyección.

## Verificación (Node 24, pnpm vía corepack; en el worktree)
- `pnpm turbo run lint typecheck test build --filter=@super-restaurant/shared-types --filter=@super-restaurant/api --filter=@super-restaurant/web`; `git diff --check`.
- Tests: `caja-helpers.test.ts` (modo total/dividir, mensaje de recibido insuficiente), `orders.runtime.test.ts` (`capturedBy`), test de API de la proyección.
- Verificador local no disponible: brecha; el orquestador ejecuta migración + invariantes en remoto con rollback.

## Formato de salida
Resumen por capa, archivos, salida literal de puertas, hashes, brechas, riesgos. Commits por capa (`fix(caja): …`, `feat(db): …`, `feat(api): …`, `feat(web-caja): …`). Sin merge, push ni aplicar.
