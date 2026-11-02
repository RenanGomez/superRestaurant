# caja-split-payments-research — hecha
Cambios: Investigación de sólo lectura para rediseño de cobro en caja (pagos divididos y cuentas).
Archivos: .agents/reports/caja-split-payments-research.md
Verificación: Inspección estática de contratos, dominio, API, migraciones SQL y componentes web.
Riesgos/pendientes: Error genérico al cobrar por NEXT_REDIRECT en try/catch; omisión visual de pagos y mesa en OrderSummary.
Notas: Dividir en Paquete A (Backend/Contrato/Acción Nivel A) y Paquete C (UI Web Nivel C).

## 1. Flujo actual de cobro parcial
- **Validación en cliente (`payment-panel.tsx:27-31, 51-64`, `caja-helpers.ts:51-78`)**:
  - `paymentAmountBounds`: verifica `1 <= amountMinor <= remainingBalanceMinor`.
  - `canCollectPayment`: exige cotización vigente (`quote !== null`), coincidencia estricta de `amountMinor`, `tipMinor` y `method`.
  - En efectivo: `requiredCashTenderMinor = amountMinor + tipMinor`. Exige `receivedMinor >= required`, `quote.tenderedAmountMinor === receivedMinor` y `quote.changeMinor !== null`.
  - En tarjeta externa: terminal no vacío y referencia >= 6 caracteres. En transferencia: sin recibido ni cambio.
- **Validación en servidor (`actions.ts:135-141`, `payments.ts:384-405`, `20261007000200:101-199`)**:
  - `collectPaymentAction`: valida `tenderedAmountMinor >= required`; si es menor devuelve `{ status: "invalid_amount" }`.
  - `prepareCollection`: recalcula saldo autoritativo (`total - captured`). Si `amountMinor <= remaining`, asigna estado `paid` o `partially_paid`.
  - SQL `collect_simple_payment_core`: toma locks FOR UPDATE en orden y sesión. Recalcula `sum(amount_minor)` de `app.payments`. Si `v_tendered < v_amount + v_tip` retorna `{ status: "conflict" }`.
- **Respuesta cuando recibido < cobro**:
  - En cotización (`payments.ts:510`, `payment-intent.ts:47`): la API falla con HTTP 400. `quotePaymentAction` (`actions.ts:91-102`) esquiva esto mutando la petición a `amountMinor = received - tipMinor` y `tenderedAmountMinor = null`, retornando una cotización que difiere del cobro typed.
  - En cobro (`actions.ts:141`): `collectPaymentAction` retorna `{ status: "invalid_amount" }` sin llamar a la API ni persistir.
- **Proyección de pagos capturados**:
  - Viven en `app.payments`. SQL `app_private.read_order_receipt_data` (`20261007000600:30-49`) los proyecta por orden cronológico.
  - `apps/api/src/orders.ts:1060` los inyecta en `OrderDetailV1.payments`.
  - **Brecha en UI**: `apps/web/src/app/app/caja/page.tsx:181-207` (`OrderSummary`) nunca itera ni muestra `detail.payments`.

## 2. Diagnóstico del bug
- **¿El pago de $70 se capturó pese al error?**:
  - Un cobro en efectivo con recibido menor al cobro ($70 cobro, $60 recibido) **nunca se persiste** (rechazado en `actions.ts:141` y SQL línea 101).
  - No obstante, en la prueba de Emmanuel los $70 **SÍ se capturaron** en la base de datos (por eso al volver el saldo pendiente es $60 y "A cobrar" se limita a 60).
- **Causa raíz del mensaje genérico de error (`archivo:línea`)**:
  - `apps/web/src/app/app/caja/actions.ts:180`: al capturar con éxito, `collectPaymentAction` ejecuta `redirect(receiptHref)`.
  - `apps/web/src/app/app/caja/payment-panel.tsx:55-58`: la función cliente envuelve la Server Action en `try { await collectPaymentAction(formData); } catch { setCollectError("No se pudo confirmar el cobro..."); }`.
  - En Next.js App Router, `redirect()` lanza la excepción interna `NEXT_REDIRECT`. El bloque `catch` en `payment-panel.tsx:58` la atrapa como error, aborta la navegación y despliega el banner: *"No se pudo confirmar el cobro. Actualiza la caja antes de volver a intentar."*, pese a que el pago ya se guardó en PostgreSQL.
  - Causa secundaria (`page.tsx:43-49, 150-155`): si la cookie de recibo falla al decodificarse, `receiptUnavailable` muestra *"Recibo no disponible"*.
- **Por qué la cuenta sigue diciendo $130 y falta el desglose**:
  - `page.tsx:203-206`: `OrderSummary` sólo renderiza `checkout.orderTotalMinor` ($130), omitiendo pagos capturados y saldo restante.

## 3. Diseño mínimo para «Pagar total / Dividir pago»
- **Lo existente reutilizable**: `CheckoutOrderSummaryV1` ya provee `orderTotalMinor`, `capturedAmountMinor` y `remainingBalanceMinor`. `OrderDetailV1.payments` ya expone los pagos capturados (`paymentId`, `method`, `amountMinor`, `tipMinor`, `changeMinor`, `capturedAt`). Reglas de dominio ya soportan `partially_paid` y movimientos compensatorios/caja.
- **Faltante en Contrato (`packages/shared-types/src/orders.ts:454-463`)**:
  - Agregar `capturedBy?: string | null` a `OrderPaymentV1` y parsearlo en `parseOrderPaymentV1`.
- **Faltante en SQL (`supabase/migrations/`)**:
  - En `app_private.read_order_receipt_data`: agregar `'capturedBy', p.captured_by::text`.
- **Faltante en API (`apps/api/src/orders.ts:1060`)**:
  - Mapear `capturedBy` desde el row de recibo hacia `OrderDetailV1.payments`.
- **Faltante en Acciones Server (`apps/web/src/app/app/caja/actions.ts:95, 172-181`)**:
  - `collectPaymentAction`: retornar `{ status: "ok", receiptHref }` en lugar de invocar `redirect()` dentro del `try/catch` cliente.
  - `quotePaymentAction`: remover la reescritura de `amountMinor` cuando `received < required`.
- **Cambios exclusivos de UI (`payment-panel.tsx`, `page.tsx`)**:
  - Selector de modo: «Pagar total» (fija «A cobrar» al saldo restante) vs «Dividir pago» (permite editar importe 1..saldo).
  - Validación cliente síncrona: alerta inmediata si `recibido < a cobrar + propina` deshabilitando «Cobrar».
  - En `OrderSummary`: encabezado con Total ($130), lista de pagos capturados (−$70) y Saldo pendiente ($60).

## 4. Datos para «Órdenes por cobrar»
- **Qué trae hoy `BranchOrderWorkItemV1` (`packages/shared-types/src/branch-order-work-tray.ts:54-75`)**:
  - Ya incluye `tableId`, `accountLabel`, `customerLabel`, `channel`, `createdAt`, `totals` y `lineCount`.
- **Mostrar Mesa (nombre) y Cuenta en tarjeta**:
  - Invocar `tableNamesAction()` (`apps/web/src/app/app/orders/actions.ts:198`) en `page.tsx` para obtener mapa `tableId -> name`.
  - Usar `tableLabel(item.tableId, names, item.accountLabel)` (`apps/web/src/lib/orders-view.ts:31-43`) en el título de la tarjeta.
- **Expansión de líneas bajo demanda**:
  - `BranchOrderWorkItemV1` sólo contiene `lineCount`. Para no sobrecargar la consulta general de la bandeja:
  - En `payable-orders.tsx`: al tocar la tarjeta, llamar a `orderDetailAction(item.orderId)` (`apps/web/src/app/app/orders/actions.ts:70`), almacenar en estado local (`Record<string, OrderDetailV1>`) y listar productos, variantes y notas inline. El botón «Cobrar» enlaza directo a `/app/caja?orderId=...#cobrar`.

## 5. Partición de paquetes, pruebas y riesgos
- **Paquete A (Rigor A — Crítico: Contrato, SQL, API y Acciones Server)**:
  - Archivos: `packages/shared-types/src/orders.ts`, nueva migración SQL para `read_order_receipt_data`, `apps/api/src/orders.ts`, `apps/web/src/app/app/caja/actions.ts`.
  - Criterios: `OrderPaymentV1.capturedBy` en contrato, SQL y API; corrección de `collectPaymentAction` (retorno limpio sin NEXT_REDIRECT en catch) y normalización de `quotePaymentAction`.
  - Pruebas: unitarias de contratos (`orders.test.ts`), integración PostgreSQL para `read_order_receipt_data`, aislamiento tenant e idempotencia.
  - Riesgos: duplicación de cobro por reintentos no idempotentes; desincronización de secuencias locales en `financial_device_sequences`.
- **Paquete C (Rigor C — Producto: UI de Caja)**:
  - Archivos: `apps/web/src/app/app/caja/page.tsx`, `payment-panel.tsx`, `payable-orders.tsx`, `caja-helpers.ts`.
  - Criterios: selector «Pagar total / Dividir pago», historial de pagos y saldo en `OrderSummary`, nombre de mesa/cuenta y acordeón de líneas en `payable-orders.tsx`.
  - Pruebas: unitarias de helpers en `caja-helpers.test.ts`, verificación en navegador real desktop y móvil 390×844, targets táctiles >= 44px, sin alert/confirm/prompt.
  - Riesgos: desfase de estado al conmutar entre órdenes; bloqueo indebido de botón por cotizaciones desfasadas.
