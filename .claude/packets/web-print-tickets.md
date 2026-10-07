# web-print-tickets · comanda y ticket imprimibles desde el navegador (T1)

## Tarea
web-print-tickets · **nivel C** (Codex L2, `-Base main`). Ritmo: operación (un toque para imprimir). Fila T1 del bloque «turno completo» (PROJECT_NOTES 2026-10-06). Sin hardware: `window.print()` con `@media print` a 80 mm (y 58 mm como variante CSS), sin ESC/POS todavía.

## Objetivo
- **Comanda de cocina**: desde el detalle de orden (`/app/orders`) y desde la pantalla de captura tras «Enviar a cocina», botón «Imprimir comanda» que imprime una hoja por estación (agrupa `items` por `snapshot.stationId`, sólo líneas no canceladas; cantidad × nombre, tamaño, «Mitad A/B» con extras y exclusiones, nota, canal/mesa/cliente y hora).
- **Ticket de cliente**: en caja tras cobrar (recibo durable) y desde el detalle de orden, «Imprimir ticket»: encabezado con restaurante y sucursal, folio corto y fecha, líneas con precio congelado, subtotal, IVA si aplica, envío, propina, total, pagos por método (efectivo recibido y cambio, tarjeta, transferencia con referencia), saldo, y pie «Gracias».
- Vista previa en pantalla igual a lo impreso; «Imprimir» abre el diálogo del navegador; sin alert/confirm.

## Hechos verificados (researcher 2026-10-06)
- Dinero congelado: `packages/domain/src/order-totals.ts:68-90` `OrderItemPriceSnapshot` (con `stationId` histórico en 74); `packages/printing/src/handoff-ticket.ts:13-19` `formatMinor` y `57-101` `renderHandoffTicket` (ESC/POS; **no usar aquí**, pero reutilizar la misma lógica de composición si está en un helper puro exportable; si no, crear `apps/web/src/lib/print-documents.ts`).
- Datos: `OrderDetailV1` (`packages/shared-types/src/orders.ts:395-417`: items, totales, fulfillment/dirección con permiso, delivery, pagos si los expone; verificar qué trae de pagos y, si no trae la lista, usar `PaymentCollectionSummaryV1` del recibo de caja `apps/web/src/app/app/caja/receipt.ts:5-31`); encabezado: `BranchMembershipSummaryV1.restaurantName/branchName` (`packages/shared-types/src/index.ts:192-196`, ya en `caja/page.tsx:100`).
- Web: detalle `apps/web/src/app/app/orders/order-detail-panel.tsx`, captura `capture-workspace.tsx` (resultado de «Enviar a cocina»), caja `caja/page.tsx` (`ReceiptCard`), ticket en pantalla de captura (`capture-ticket.tsx`).

## Criterios de aceptación
- [ ] Helpers puros con prueba en `apps/web/src/lib/print-documents.ts`: `buildKitchenDocuments(order)` (una por estación, sin canceladas, mitades y notas) y `buildCustomerTicket(order, payments, header)` (totales en pesos sin float; sin recálculo: suma sólo lo que el servidor ya dio).
- [ ] Componente `PrintPreview` con `@media print` (80 mm por defecto, clase para 58 mm), fuente monoespaciada legible, cortes de página por estación; el resto de la página oculto al imprimir.
- [ ] Botones «Imprimir comanda» (detalle y tras enviar a cocina) e «Imprimir ticket» (caja tras cobrar y detalle); 44 px; atajo P en el detalle.
- [ ] Sin API ni SQL; sin alert/confirm/prompt; 390×844; consola limpia. Puertas: `pnpm --filter @super-restaurant/web lint && typecheck && test && build`.

## Invariantes
Imprimir lo congelado; cliente no calcula dinero; PII sólo si el detalle la trae; sin push.

## Fuera de alcance
ESC/POS, Bluetooth, impresión automática, logo.

## Formato de salida
Resumen (toques), archivos, salida literal, riesgos.

## Ronda 2 (2026-10-06) — corregir y nada más
Tu trabajo está commiteado por L0 en `codex/web-print-tickets` (`80df622`). `codex exec review` marcó en `apps/web/src/lib/print-documents.ts`: **P1** (29-30) `OrderDetailItemV1` no trae `stationId` y la prueba lo enmascara con un cast: una unidad de API en paralelo lo añadirá como campo opcional `stationId: string | null`; deja el código preparado para usarlo cuando exista (ya lo haces) y **corrige la prueba** para no castear: usa un fixture que pase por `parseOrderDetailV1` real con `stationId` ausente y verifica el agrupado «Sin estación asignada», más un caso de helper puro que reciba items ya tipados con estación. **P2** (27-29) la comanda incluye líneas `pending` no enviadas: filtra a estados ya enviados a cocina (`sent|preparing|ready|delivered`) y excluye `pending` y `cancelled`; añade prueba. **P2** (64-66) el ticket omite la propina capturada: imprime «Propina» por pago desde `tipMinor` y ajusta «Recibido»/«Cambio» para que cuadren (cambio = recibido − cobro − propina, ya lo da el servidor). Puertas web lint/typecheck/test/build. No commitees; deja los archivos modificados e informa archivos y salida literal.
