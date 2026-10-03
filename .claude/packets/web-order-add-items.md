# web-order-add-items · agregar productos a una cuenta existente (D2)

## Tarea
web-order-add-items · capa: L2 (Codex) · riesgo: moderado · nivel C (`apps/web/src/app/app/orders/*`, reutilizando `capture/capture-menu.tsx` y `capture/product-sheet.tsx`). Ritmo: **operación** (mesa → cuenta → producto → Agregar). Fila D2 del «Día operable». Una ronda de revisión. Base: `main` con `catalog-variants-api` integrado (verificar que `AddOrderItemCommandV1` acepta `note` y `variantId`, que `ORDER_DETAIL_ACTIONS` incluye `addItem` y que `MenuProductV1.variants` existe; si no, detente e informa).

## Objetivo
Desde el detalle de una orden (abierto desde `/app/orders` o desde una mesa en `/app/tables`), el operador toca «Agregar producto», elige del menú táctil, arma modificadores, tamaño y nota, y la línea entra a la cuenta; luego «Enviar a cocina» como ya existe.

## Hechos verificados (researcher 2026-10-03)
- `POST /orders/items` con `AddOrderItemCommandV1` (`orderId, orderItemId` generado por el cliente, `productId, quantity, modifierGroups, expectedVersion` + auditoría; tras el paquete API también `note` y `variantId`). `OrderService.addItem` congela el snapshot de precio en servidor.
- `CaptureMenu` (`capture-menu.tsx:37`, props `catalog, currency, lineQuantities, busy, searchInputRef, onSelectProduct`; usa `useMenuImageBaseUrl`) y `ProductSheet` (`product-sheet.tsx:32`, `onAdd(quantity, modifierGroups, note)`, `initialLine`) son reutilizables fuera de la captura si se provee `MenuImageBaseUrlContext`.
- El catálogo se obtiene con `getMenuCatalog(accessToken, apiBaseUrl, scope)` (`apps/web/src/lib/menu-catalog.ts:9-21`, `GET /catalog/menu`), ya sin dependencia de la captura.
- Panel de detalle: `order-detail-panel.tsx` (`OrderDetailActions`, `nextAttempt()` para ids de intento, `runAction` sin reintento automático salvo envío a cocina).

## Criterios de aceptación (verificables)
- [ ] En el panel de detalle, si `availableActions` incluye `addItem`, aparece «Agregar producto» (≥44 px). Al tocarlo se abre una hoja a pantalla completa en móvil (lateral en escritorio) con `CaptureMenu` (catálogo cargado una vez por sesión de panel con una server action que llama `getMenuCatalog`) y, al tocar un producto, `ProductSheet` con tamaño (si hay `variants`), modificadores, cantidad y nota.
- [ ] «Agregar» llama a una server action `addOrderItemAction` que construye `AddOrderItemCommandV1` (nuevo `orderItemId`, `eventId`, `idempotencyKey`, `occurredAt` acuñados una vez por intento, `deviceId` de `captureDeviceId`), con `variantId` y `note`; estados «Agregando…», éxito (la línea aparece en el detalle recargado y la hoja permite seguir agregando) y error claro; `conflict` recarga el detalle y conserva la selección para reintentar con la versión nueva (un toque).
- [ ] Desde `/app/tables`, «Ver cuenta» y «Abrir cuenta» aterrizan en el detalle con «Agregar producto» visible; abrir cuenta nueva + agregar primer producto son ≤ 4 toques (mesa → Abrir cuenta → producto → Agregar).
- [ ] Helpers puros con prueba: construcción del comando desde la selección (`buildAddOrderItemCommand`), reutilizando `capture-selection.ts` sin duplicar.
- [ ] Sin `alert/confirm/prompt`; 390×844 sin scroll horizontal; consola limpia.

## Invariantes
Precio y permisos en servidor; el estimado de la hoja sigue siendo «Estimado»; contratos intactos; no tocar `capture-workspace.tsx`, `menu/*`, `caja/*`.

## Fuera de alcance
Editar o quitar líneas ya agregadas (cancelar línea ya existe), descuentos, mitades de pizza (D7b), API.

## Verificación
```bash
pnpm --filter @super-restaurant/web lint
pnpm --filter @super-restaurant/web typecheck
pnpm --filter @super-restaurant/web test
pnpm --filter @super-restaurant/web build
```

## Formato de salida esperado
Resumen (toques por flujo), archivos tocados, salida literal, riesgos. No hagas commit.
