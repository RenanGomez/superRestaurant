# capture-payment-intent

## Tarea
capture-payment-intent · capa: L1 (`implementer-claude`) · riesgo: alto · nivel A (dinero, SQL de captura y confirm, contrato compartido web/API). Referencia visual aprobada: paso «Cobro» de `docs/prototypes/captura-telefonica-menu-tactil.html`.

## Objetivo
Que el borrador de captura registre la **intención de pago** del cliente antes de confirmar: método `cash | card_manual | transfer`, monto con el que pagará en efectivo (para calcular cambio) y propina separada. El servidor calcula todo contra el total autoritativo; la intención se persiste en la captura con CAS e idempotencia, se expone en el workspace y se congela en el snapshot de la Order al confirmar. No se crea Payment ni CashMovement (eso es S8.3+).

## Decisiones del orquestador (S8 §9.1 aprobado el 2026-09-26)
- «Pagará con» nunca es dinero: es intención; `pending|ambiguous` no cierran la Order.
- Total autoritativo de la captura = `selectionProjection.subtotalMinor` (líneas cotizadas por el servidor) + `fee` de la cotización de entrega congelada cuando `fulfillment = delivery` y hay quote. Si la materialización de la Order en `confirm_capture_draft_v3`/`create_operational_order` no incluye hoy el cargo de envío, NO lo añadas a la Order en esta tarea: guarda en el snapshot de intención los componentes por separado (`itemsSubtotalMinor`, `deliveryFeeMinor`, `orderTotalMinor`) y documenta la brecha (S7.2 traerá el cargo como línea/obligación). Reporta explícitamente qué encontraste.
- Propina: `tipMinor ≥ 0`, separada, no entra en `orderTotalMinor` ni en el cambio; se guarda en la intención.
- Efectivo: `tenderedAmountMinor` opcional; si existe debe ser ≥ `orderTotalMinor` (si no, `rejected` tipado, no cambio negativo); `changeDueMinor` lo calcula el servidor con `buildPaymentIntentQuote`. `timing = on_fulfillment` para delivery/pickup, `now` para mostrador/mesa (derivado del fulfillment, no elegido por el cliente).
- `card_manual`: sin referencia en captura (la referencia ≥6 caracteres se registra al liquidar, S8.3); `transfer`: intención pendiente de evidencia.
- Al cambiar líneas, cumplimiento o quote después de fijar la intención, la intención NO se borra: se recalcula el cambio en la proyección y, si `tendered < total`, el workspace la marca `stale` y confirm exige refrescarla (409 tipado).

## Hechos verificados (main `770f88f`)
- Dominio: `packages/domain/src/payment-intent.ts` (`buildPaymentIntentQuote`, métodos y timings), `payment-obligation.ts`; contratos `packages/shared-types/src/payment-intent.ts` (`QuotePaymentIntentRequestV1`, `PaymentIntentQuoteV1`, sin propina) y `payment-obligation.ts`; adaptadores puros `apps/api/src/payments.ts:74-128` sin ruta HTTP.
- Captura: `CaptureDraft` sin intención; `app.capture_drafts` sin jsonb de pago (`20260916000100`); hechos del borrador se guardan con funciones `app_private.set_capture_*` (customer, fulfillment, delivery instructions) y el workspace V4 los expone (`packages/shared-types/src/capture-selection-plan.ts:112`). Confirm: `confirm_capture_draft_v3` (última versión en `20260930000100`) construye `frozen_snapshot` con party/fulfillment/deliveryInstructions y lo inserta en `app.order_fulfillment_snapshots`.
- Cotización de entrega congelada: localiza dónde se guarda (`delivery quote` en captura, S7.1b) con CodeGraph.

## Subunidades (un commit cada una; informe parcial a los ~35 turnos)
1. **Contrato + dominio**: `CapturePaymentIntentV1 { schemaVersion:1, method, tenderedAmountMinor: int|null, tipMinor: int≥0 }` (comando `SetCapturePaymentIntentCommandV1` versionado como `fulfillment`, con `attentionLeaseId`); proyección `CapturePaymentIntentProjectionV1 { method, timing, currency, itemsSubtotalMinor, deliveryFeeMinor, orderTotalMinor, tenderedAmountMinor, changeDueMinor|null, tipMinor, status: "ready"|"stale"|"insufficient" }`; `CaptureWorkspaceV5` aditivo (V4 + `paymentIntent: CapturePaymentIntentV1|null` + `paymentProjection: …|null`), parsers exactos y pruebas. Dominio: extender `buildPaymentIntentQuote`/nuevo helper puro para derivar timing y validar `tendered ≥ total`; pruebas.
2. **SQL** (`supabase/migrations/20261001000100_capture_payment_intent.sql`, candidata): tabla `app.capture_payment_intents` (una fila por captura; PK scope+captura; jsonb del contrato exacto con CHECK de claves; `applied_capture_version`, actor, dispositivo, `occurred_at`, `idempotency_key` + fingerprint) o columna en `capture_drafts` si el patrón de la casa lo prefiere (justifica); `app_private.set_capture_payment_intent(actor, command)` con scope/membership/lease/CAS/idempotencia/replay/advisory lock y evento `capture.payment_intent_set` (añadir al CHECK del journal); `read_capture_workspace_v5` = V4 + intención; `confirm_capture_draft_v3` (`create or replace`) añade `paymentIntent` al `frozen_snapshot` (o `null`) sin relajar nada; trigger de salida de `draft` limpia la fila. Pruebas SQL (aislamiento, CAS, replay, lease ajeno, confirm congela) y verificador local PG17; sonda `probe:migration:rollback` sólo local.
3. **API**: `POST /captures/payment-intent` (autoriza `captures.update`; carga workspace V4, calcula total autoritativo, valida con dominio, persiste, devuelve V5 con proyección), `POST /captures/workspace` sirve V5, confirm exige intención `ready` si existe (si `stale`/`insufficient` → 409 `CAPTURE_PAYMENT_INTENT_STALE`) y la pasa al snapshot; pruebas unitarias/controlador (idempotencia, replay, 409s).
4. **Web** (nivel C): paso «Cobro» en `/app/capture` antes de «Convertir captura en orden» según el prototipo: métodos como botones grandes, denominaciones sugeridas (exacto, redondeos a 100/200/500 calculados en cliente sólo como atajos de entrada; el cambio lo pinta la proyección del servidor), propina en chips, resumen con subtotal/envío/total/cambio del servidor, aviso por método (efectivo contra entrega, tarjeta al liquidar, transferencia pendiente de evidencia); botón «Confirmar orden» deshabilitado si la intención está `stale`. `lib/capture-workspace.ts` lee V5 y añade operación `paymentIntent`. Puertas web.
5. Puertas globales y CodeGraph de consumidores de `CaptureWorkspaceV4`, `confirm_capture_draft_v3`, `renderHandoffTicket` (el ticket impreso muestra «Pagará con: …» y cambio si aplica; prueba byte a byte).

## Invariantes
- Ningún importe viene del cliente salvo `tenderedAmountMinor` y `tipMinor` (enteros en minor units validados); totales, cambio y timing los calcula el servidor.
- No se crea Payment, CashMovement ni se toca caja; la Order confirmada sólo lleva la intención congelada.
- Scope/membership en SQL y API; parsers exactos; no editar migraciones aplicadas.

## Entorno
Worktree `C:\tmp\sr-wt\capture-payment-intent` (rama `claude/capture-payment-intent` desde `main`). Node 24/pnpm 11 en `%LOCALAPPDATA%\Programs\node24`; PG17 en `.cache/postgres-local/pgsql`. Nunca conectes al remoto. Sin push.

## Formato de salida
Resumen y decisiones (en particular: si la Order incluye o no el cargo de envío hoy; dónde persististe la intención), archivos y commits, salida literal de puertas y del verificador PG local, riesgos.
