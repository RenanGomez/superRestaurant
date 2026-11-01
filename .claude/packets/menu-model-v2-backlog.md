# Backlog nivel A derivado de la retroalimentación del 2026-11-01 (no lanzar sin paquete completo)

Estos cambios tocan `packages/shared-types`, `supabase/migrations`, `apps/api/src/menu-catalog*` y `apps/web`. Nivel A (§19.2): `implementer-claude`, CodeGraph antes y después, unitarias de dominio, verificador PostgreSQL rollback-only, revisión doble. Se abren **después** de integrar `menu-categories-r1` y `menu-products-ui-r1`, uno a la vez.

## menu-category-appearance
- `MenuCategoryV1` + tabla de categorías: `color: string | null` (paleta cerrada de pasteles definida en shared-types, por ejemplo 8 tokens `pastel-rose|pastel-peach|…`; nunca hex libre) e `imagePath: string | null`.
- `uploadMenuImageAction` acepta `target: "category"`; mismas reglas de bucket y 2 MB.
- UI: el círculo a la izquierda del nombre de la categoría muestra la imagen y abre el selector al tocarlo; selector de color como fila de muestras; el color tiñe el fondo de la tarjeta de categoría y, en la captura (`capture-menu.tsx`), la pestaña de la categoría.

## menu-modifier-model-v2
- Grupos de modificadores **compartidos por restaurante** en vez de por producto: `MenuModifierGroupV1.productId` pasa a opcional/obsoleto y aparece `product.modifierGroupIds: readonly string[]` (multiselección). Migración: cada grupo existente queda asignado a su producto original. El resolver de selección (`configured-catalog`, `menu-catalog-domain`) consume la nueva relación.
- `MenuProductV1.kind: "regular" | "specialty"` («Especialidad»): una pizza con combinación definida y precio fijo. En mitades, el selector de sabores se sustituye por `fraction.specialtyProductIds: readonly string[] | "all"` (una, varias, ninguna o todas las especialidades de la misma categoría). El grupo de ingredientes se mantiene como hoy.
- Ingredientes: `fraction.removableIngredientOptionIds` se sustituye por `fraction.lockedIngredientOptionIds` («ingredientes que no se pueden quitar»); por defecto todo se puede quitar. Migración: los que hoy no están en la lista de removibles pasan a bloqueados. Afecta a especialidades y al `product-sheet` de captura.
- UI: editor independiente «Grupos de modificadores» (sección propia en /app/menu) y, en el producto, un desplegable multiselección de grupos asignados.

## menu-photo-focus
- `imagePath` pasa a `image: { path, focusX, focusY, zoom }` para producto, opción y categoría, con rangos validados en shared-types; la UI permite ajustar posición y zoom en el diálogo de foto y la captura usa `object-position`/`scale` derivados.

## order-account-name (B)
- `Order.accountLabel: string | null` (máx. 60): nombre opcional de a quién pertenece la cuenta de mesa. Comando `set_order_account_label` en API con auditoría; se muestra en bandeja, detalle, comanda y ticket junto al nombre de la mesa.

## orders-tray-table-id (B)
- `BranchOrderWorkItemV1` (`packages/shared-types/src/branch-order-work-tray.ts`) y su lector en `apps/api` añaden `tableId: string | null` para que las tarjetas de la bandeja de `/app/orders` muestren el nombre de la mesa con el mismo mapa que ya usa el detalle (`tableNamesAction`, `tableLabel`). Detectado en `tables-orders-r1` el 2026-11-01.

## menu-photo-copy (B)
- Endpoint en `apps/api` que copia un objeto del bucket de catálogo a la ruta de otra entidad (`{restaurantId}/products/{productId}/{hash}.ext`) y devuelve el nuevo `imagePath`; respeta la restricción `menu_*_image_path_valid` de `20261004000100_catalog_images.sql`. La UI lo usa para «fotos ya usadas» entre productos y para copiar la foto al duplicar. Detectado en `menu-products-ui-r1` el 2026-11-01.
