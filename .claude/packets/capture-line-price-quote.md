# capture-line-price-quote · estimado del servidor mientras se arma un producto

## Tarea
capture-line-price-quote · dos unidades: **API nivel B** (`implementer-claude`, razonamiento moderado; endpoint de lectura sin SQL ni persistencia que reutiliza el mismo precio del dominio) y **web nivel C** (Codex con `-Base claude/capture-line-price-quote`). §19.3: B dos rondas, C una. Deuda del lote-feedback (f) #16 y «Precio tentativo visible» de PROJECT_NOTES 2026-10-01.

## Objetivo
`POST /captures/line-quote`: una línea en armado (producto, tamaño, modificadores, mitades, cantidad) → precio unitario, modificadores y total **calculados por el mismo `createMenuProductPriceSnapshot` del servidor**, sin efectos. La hoja de armado muestra «Estimado del servidor» con debounce y cae al estimado local si el servidor no responde.

## Hechos verificados (researcher 2026-10-05)
- `packages/domain/src/menu.ts:151-217` `createMenuProductPriceSnapshot(catalog, {restaurantId, productId, variantId, currency, fraction}, modifierGroups)` → `OrderItemPriceSnapshot` (unitPrice, modifiers, geometry?, fractionBreakdown?); `order-totals.ts` `calculateOrderItemTotals`.
- Uso real: `apps/api/src/orders.ts:353-363` (addItem) y `captures.ts:1170-1237` `priceSelectionPlan` (valida `catalogVersion` exacta → 409 en 1170; excluye modificadores de mitades duplicados en 1204 con `isFractionModifier`).
- Patrón de cotización sin efectos: `POST /payments/quote` (`payments.controller.ts:43-47`, `payments.ts:510-546`: parse, `authorizeBranch`, 400/403/409, sin mutación).
- Web: `apps/web/src/lib/capture-workspace.ts:409-425` `requestCaptureSelectionPlan` (fetch con bearer y mapeo de errores); server action `apps/web/src/app/app/capture/actions.ts:14-27`; estimadores locales `capture-selection.ts:58-79` `estimateSelectionMinor` y `line-halves.ts:80-103` `estimateHalvesUnitMinor`; hoja `product-sheet.tsx`.
- Permiso: el que ya use `POST /captures/selection-plan` para lectura (`captures.read` o equivalente; verificar en captures.ts).

## Diseño (seguir salvo razón documentada)
1. **Contrato** (shared-types, aditivo, archivo nuevo `capture-line-quote.ts`): `CaptureLineQuoteRequestV1 { schemaVersion: 1, scope, catalogVersion, productId, variantId: string|null, modifierGroups, fraction: LineFractionV1|null, quantity }` y `CaptureLineQuoteResultV1 { schemaVersion: 1, catalogVersion, currency, unitPriceMinor, lineTotalMinor, modifiers[{groupId, optionId, name, quantity, unitPriceMinor}], geometry, fractionBreakdown }`; parsers fail-closed con pruebas (cantidad entera 1..99, dinero entero).
2. **API**: `CaptureService.quoteLinePrice(principal, body)`: parse → `authorizeBranch` con el permiso de lectura de captura → `readCatalog` → 409 `catalog_version_mismatch` si difiere → `createMenuProductPriceSnapshot` + `calculateOrderItemTotals` → proyección. Errores de dominio (variante inexistente, producto inactivo, mitades inválidas) → 409 con código; sin escritura alguna. `@Post("line-quote")` en el controller de captures. Pruebas: entera con modificadores, con tamaño, mitad y mitad (mayor sabor + extras de media al 50 % ceil), 409 por versión de catálogo, 409 por variante inválida, 403 sin permiso, y una prueba que compara el resultado con `priceSelectionPlan` para la misma línea (misma cifra). Contract test HTTP del DTO.
3. **Web (Codex, nivel C)**: cliente `quoteLinePrice` en `apps/web/src/lib/capture-quote.ts` (parse + fetch + mapeo) y server action; en `product-sheet.tsx` debounce 300 ms sobre selección/cantidad: muestra «Estimado del servidor $X» y, mientras llega o si falla, «Estimado $X» local; nunca bloquea «Agregar»; helper puro que elige qué estimado mostrar con prueba; sin alert/confirm; targets 44 px.

## Criterios de aceptación
- [ ] Mismo precio que el plan de selección para la misma línea (prueba).
- [ ] Puertas: shared-types test; api lint/typecheck/test/build; typecheck web/mobile/kds. Web (Codex): lint/typecheck/test/build.
- [ ] Commits por unidad; **commitear antes de cualquier informe**.

## Archivos de entrada
- C:\tmp\sr-wt\capture-line-price-quote\packages\domain\src\menu.ts (140-220), order-totals.ts.
- C:\tmp\sr-wt\capture-line-price-quote\apps\api\src\captures.ts (1150-1240), captures.controller.ts, payments.ts (500-550), payments.controller.ts, captures.test.ts (patrón de pruebas).
- C:\tmp\sr-wt\capture-line-price-quote\packages\shared-types\src\capture-selection-plan.ts, line-fraction.ts.
- Web: apps\web\src\lib\capture-workspace.ts (400-430), capture-selection.ts, line-halves.ts, app\app\capture\product-sheet.tsx, actions.ts.

## Invariantes
Precio final sólo al agregar/plan (el quote no congela nada); dinero en enteros; `catalogVersion` exacta; servidor revalida; alcance Restaurant/Branch; sin SQL; sin push.

## Fuera de alcance
Descuentos, impuestos distintos del snapshot, cotización de la cuenta completa.

## Formato de salida
Resumen, archivos y hashes, puertas, riesgos.

## Ronda 2 (web, 2026-10-05) — adaptar al contrato corregido
Tu trabajo ya está commiteado por L0 en `codex/web-capture-line-quote` (`e4b5a56`) y la rama recibió el merge `6158d75` con el fix de la API `59c69ad` (P1 de revisión: con impuesto excluido el total era el subtotal). Contrato nuevo de `CaptureLineQuoteResultV1` (`packages/shared-types/src/capture-line-quote.ts`): `lineTotalMinor` es ahora el **monto cobrable con impuesto**, y se añadieron `subtotalMinor` y `taxMinor` obligatorios (`subtotalMinor + taxMinor = lineTotalMinor`); el límite de cantidad es `CAPTURE_SELECTION_LINE_MAX_QUANTITY` (1 000). Ajusta `apps/web/src/lib/capture-quote.ts` y la hoja: «Estimado del servidor» muestra `lineTotalMinor` (cobrable) y, si `taxMinor > 0`, una línea pequeña «Incluye IVA $X»; actualiza las pruebas del helper (fixture con impuesto excluido: subtotal 10 000, impuesto 1 600, total 11 600). Verifica que el estimado local siga etiquetado «Estimado» y que una respuesta `409 catalog_version_mismatch` dispare recarga del catálogo o muestre «El menú cambió, recarga» sin bloquear «Agregar». Puertas web lint/typecheck/test/build. No commitees; deja los archivos modificados e informa archivos y salida literal.
