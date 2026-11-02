# size-presets-research — investigación de sólo lectura para el paquete A `menu-size-presets`
Agente: Gemini   Nivel de rigor: A (la implementación)   Complejidad: Estándar

## Objetivo
Emmanuel quiere definir los tamaños (Chica, Mediana, Grande…) una sola vez por restaurante y elegirlos en cada producto desde un desplegable, en lugar de escribirlos producto por producto. Hoy los tamaños viven como `variants` dentro de cada producto (`MenuProductVariantV1`, tabla `app.menu_product_variants`, migración `20261006000300_catalog_variants.sql`), con precio por variante y nombre congelado en la línea (`variantName`).

## Archivos (sólo lectura)
- packages/shared-types/src/index.ts (`MenuProductVariantV1`, `parseMenuProductVariantV1`, `MenuCatalogPayloadV1`), packages/shared-types/src/configured-catalog.ts (`ConfiguredProductVariantV2`, `ConfiguredVariantGroupV2`)
- packages/domain/src/menu.ts, configured-catalog.ts, fraction-pricing.ts
- supabase/migrations/20261006000300_catalog_variants.sql, 20261006000400_catalog_halves.sql, 20261008000200_catalog_halves_product_level.sql, 20261101000100_menu_category_appearance.sql, 20261101000200_menu_shared_modifier_groups.sql
- apps/api/src/menu-catalog-domain.ts, orders.ts (cómo se congela `variantName` en OrderItem)
- apps/web/src/app/app/menu/menu-catalog-editor.tsx (sección de tamaños), apps/web/src/lib/menu-variants.ts, apps/web/src/app/app/capture/product-sheet.tsx

## Tarea
1. Inventario archivo:línea de todo lo que lee o escribe variantes/tamaños (contratos, dominio, SQL, API, web, mobile).
2. Propón el modelo mínimo: tabla `app.menu_size_presets` (restaurant_id, catalog_id, id, name, display_order, active) y en `menu_product_variants` un `size_preset_id` nullable que, cuando existe, fija el nombre de la variante al del preset (el precio sigue por producto). ¿Hace falta backfill? (crear presets a partir de los nombres distintos de variantes existentes por restaurante, asignándolos por `lower(trim(name))`): da la consulta de dry-run (sólo select) con conteos por restaurante de variantes, nombres distintos y colisiones.
3. Invariantes: snapshots de OrderItem no cambian (`variantName` congelado); renombrar un preset no reescribe ventas; aislamiento por restaurante/catálogo en FK compuestas; compatibilidad con productores viejos (campo opcional).
4. Impacto en UI: desplegable de presets en la tarjeta de producto (+ «Tamaño personalizado» para mantener el caso libre), pestaña «Tamaños» del editor para crear/ordenar/activar presets.
5. Tests necesarios por capa y riesgos. Propón si conviene partirlo en 2 paquetes.

## Restricciones
- No modificar archivos, no instalar, no red, no base de datos.

## Formato de salida
Reporte §8 en `.agents/reports/size-presets-research.md`, máximo 140 líneas, con la consulta de dry-run completa.
