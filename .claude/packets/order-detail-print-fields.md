# order-detail-print-fields · campos congelados que faltan en el detalle para imprimir

## Tarea
order-detail-print-fields · **API nivel B** (`implementer-claude`, razonamiento moderado; contrato aditivo de lectura, sin SQL si los datos ya están en el snapshot/fila). Brecha detectada por Codex en T1 (`web-print-tickets`): `OrderDetailItemV1` no expone `stationId` (P1: la comanda no puede separarse por estación), ni el detalle expone fecha de creación, desglose de impuesto ni la lista de pagos capturados.

## Objetivo
`OrderDetailV1` (aditivo, parser acepta con y sin): `createdAt` (ISO), `shortFolio` (si existe un folio corto; si no, omitir), `taxMinor` y `subtotalMinor` si los totales ya los separan (no recalcular), `payments[]` capturados (`paymentId`, `method`, `amountMinor`, `tipMinor`, `tenderedAmountMinor`, `changeMinor`, `transferReference`, `capturedAt`) sólo con el permiso que ya protege el detalle; `OrderDetailItemV1.stationId: string | null` desde el snapshot congelado (`OrderItemPriceSnapshot.stationId`, `packages/domain/src/order-totals.ts:74`) y `status` si no está.

## Hechos
- `apps/api/src/orders.ts` `projectOrderDetail` (~`detail`/`readDetailForActor`; ver también `courier-order-detail`): proyecta items desde el snapshot codificado (`persistence/order-persistence-codec.ts`: comprobar que `stationId` sobrevive encode/decode; si no, añadirlo como campo opcional del codec sin romper snapshots viejos).
- Pagos: `app.payments` por orden; el lector `read_order` o el contexto financiero (`payments.ts`, `read_order_payments`?) — verificar si ya existe una lectura de pagos por orden usada por caja (`PaymentCollectionSummaryV1`, `remainingMinor`); si no hay lector SQL de la lista, dejar `payments` fuera y documentarlo (no crear SQL en esta unidad).
- Parser estricto de `OrderDetailV1` en `packages/shared-types/src/orders.ts` (hoy rechaza `stationId`).
- Otra rama en paralelo (`claude/order-cancel-and-cancelled-view`) toca `orders.ts` y `packages/shared-types/src/orders.ts`: mantén los cambios pequeños y aditivos para que el merge sea trivial.

## Criterios de aceptación
- [ ] Detalle con `stationId` por línea y `createdAt`; `payments[]` si hay lector existente; parser compatible con respuestas viejas.
- [ ] Pruebas en `orders.test.ts` (fila real `{ result }`), runtime de shared-types; typecheck web/mobile/kds.
- [ ] Puertas: shared-types test/build; api lint/typecheck/test/build. Commits por unidad; **commitear antes de informar**.

## Invariantes
Sólo lo congelado; sin recalcular dinero; sin SQL nuevo; sin push.

## Formato de salida
Resumen, hashes, qué campos quedaron fuera y por qué, puertas, riesgos.
