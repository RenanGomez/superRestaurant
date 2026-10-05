# web-menu-variants-ui · tamaños en el editor y en la hoja de armado (D7a UI)

## Tarea
web-menu-variants-ui · capa: L2 (Codex) · riesgo: bajo · nivel C (`apps/web`: editor de menú, hoja de armado de captura, helpers). Ritmo: **configuración** en el editor (formulario claro) y **operación** en la hoja (un toque para el tamaño). Fila D7 del «Día operable». Una ronda de revisión. Base: rama `claude/catalog-variants-api` (verificar `MenuProductVariantV1` y `MenuProductV1.variants` en `packages/shared-types/src/index.ts`, `variantId` en `SelectionPlanCommandLineV1`/`AddOrderItemCommandV1`, `variantName` en `OrderDetailItemV1`; si faltan, detente e informa).

## Objetivo
Que el administrador defina tamaños de un producto («Chica $120», «Mediana $160», «Grande $200») en `/app/menu` con pocos toques, y que en la captura y al agregar a una cuenta el operador elija el tamaño con un toque; el precio lo fija el servidor con el tamaño elegido.

## Hechos verificados
- Contrato: `MenuProductVariantV1 { variantId, name, unitPriceMinor, active, displayOrder, sku: string|null }`; `variants` opcional en entrada y siempre presente en salida; nombres únicos por producto, máximo 12. Un producto con variantes activas exige `variantId` en la línea (409 `variant_required` si falta); un producto sin variantes rechaza `variantId`.
- Editor: `apps/web/src/app/app/menu/menu-catalog-editor.tsx` (`ProductEditor`, `MoneyInput` en pesos, `addProduct` crea `variants: []`? verificar y añadir).
- Hoja de armado: `apps/web/src/app/app/capture/product-sheet.tsx` (tamaño debe elegirse antes de modificadores), `lib/capture-selection.ts` (`SelectionPlanLineDraft.variantId`, `estimateSelectionMinor` debe usar el precio de la variante elegida como base cuando hay tamaño), `capture-workspace.tsx` (envía el plan de selección), `orders/*` (agregar producto a cuenta, si `web-order-add-items` ya está integrado; si no, deja el punto de extensión).
- Detalle de orden y ticket: mostrar «Pizza · Grande» usando `variantName`.

## Criterios de aceptación (verificables)
- [ ] Editor: sección «Tamaños» en cada producto con filas (nombre, precio en pesos, activo, orden) y «Añadir tamaño» (≥44 px); validaciones en cliente (nombre único, ≤ 12); al guardar, `variants` viaja en el catálogo. Crear un tamaño: «Añadir tamaño» → nombre → precio (3 toques más teclado).
- [ ] Hoja de armado: si el producto tiene tamaños activos, un segmento de botones grandes con nombre y precio («Chica $120 · Mediana $160 · Grande $200») aparece primero y es obligatorio (sin tamaño, «Agregar» deshabilitado con «Elige un tamaño»); el estimado usa el precio del tamaño como base; la línea enviada lleva `variantId`; al editar una línea, el tamaño queda preseleccionado.
- [ ] Tarjeta del menú táctil: si hay tamaños, el precio mostrado es «desde $120».
- [ ] Ticket de captura y detalle de orden muestran `variantName` junto al nombre.
- [ ] Helpers puros con prueba: validación de tamaños, precio base por tamaño, etiqueta «desde».
- [ ] Sin `alert/confirm/prompt`; 390×844 sin scroll horizontal; consola limpia.

## Invariantes
Precio final del servidor; estimado sólo visual; contratos intactos; no tocar `caja/*`, `tables/*`, `deliveries/*`.

## Fuera de alcance
Mitades (D7b), fotos por tamaño, API.

## Verificación
```bash
pnpm --filter @super-restaurant/web lint
pnpm --filter @super-restaurant/web typecheck
pnpm --filter @super-restaurant/web test
pnpm --filter @super-restaurant/web build
```

## Formato de salida esperado
Resumen (toques por flujo), archivos tocados, salida literal, riesgos. No hagas commit.
