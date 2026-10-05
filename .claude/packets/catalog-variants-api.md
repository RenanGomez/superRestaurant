# catalog-variants-api · tamaños (variantes) de producto de punta a punta (D7a)

## Tarea
catalog-variants-api · capa: L1 (`implementer-claude`, razonamiento alto) · riesgo: alto · **nivel A** (precio de línea, snapshot congelado, SQL del catálogo y de confirmación, contrato consumido por web y mobile). Fila D7 del «Día operable», primera mitad; las mitades de pizza (D7b) van en un paquete posterior sobre esta base. §19.3: revisión doble, corte en la tercera ronda. **No toques `apps/api/src/payments.ts` ni `packages/domain/src/payment*.ts`** (otra tarea en curso).

## Objetivo
Que un producto pueda tener tamaños («Chica $120», «Mediana $160», «Grande $200») definidos en el editor de menú, que la captura y las órdenes de mesa elijan el tamaño, y que el precio de la línea quede congelado con el tamaño elegido, calculado y validado en el servidor.

## Hechos verificados (researcher 2026-10-03, main 3108ca4)
- `MenuProductV1` (`packages/shared-types/src/index.ts:288-300`) sin variantes; `MenuModifierGroupV1`/`MenuModifierOptionV1` (`:302-325`). `SelectionPlanCommandLineV1.variantId: null` (`apps/web/src/lib/capture-selection.ts:74-81`) y el API rechaza `variantId` no nulo con 409 (PROJECT_NOTES) hasta S5 productivo.
- Dominio: `ProductVariantCatalog` (`packages/domain/src/product-variants.ts:29-44`: id, productId, name, sku, active, displayOrder, unitPrice, modifierGroups, constraints) y `fraction-pricing.ts` (mitades, para D7b) ya existen con pruebas. `createMenuProductPriceSnapshot` (usado por `OrderService.addItem`, `apps/api/src/orders.ts:238-256`) construye el snapshot de precio desde el catálogo.
- SQL: `app.menu_products` (name, sku, unit_price_minor, station_id, unit, active, display_order, tax jsonb, image_path), `app.menu_modifier_groups`, `app.menu_modifier_options`; `save_menu_catalog`/`build_menu_catalog_state` (última redefinición en `20261004000100_catalog_images.sql`); `confirm_capture_draft_v3` (`20261001000100`) materializa líneas desde snapshots construidos por Nest y los revalida; el plan de selección se guarda en `capture_repeat_order_plans` con `plan_kind`.
- Decisiones S5 §7.1 (`docs/architecture/P2_CONFIGURABLE_CATALOG_SLICE.md:205-217`): variante con grupos ordenados; precio por variante.

## Diseño (seguir salvo razón documentada)
1. **Contrato** (aditivo): `MenuProductVariantV1 { variantId, name, unitPriceMinor, active, displayOrder, sku: string|null }`; `MenuProductV1.variants: readonly MenuProductVariantV1[]` (opcional en entrada, siempre presente en salida, `[]` si no hay; igual que `imagePath`). Reglas: nombres únicos por producto, máximo 12, `unitPriceMinor ≥ 0`. `SelectionPlanCommandLineV1.variantId: string | null` pasa a aceptar UUID; `AddOrderItemCommandV1` (mobile y mesas) acepta `variantId: string | null` opcional en entrada. El snapshot de precio de `OrderItem` congela `variantId` y `variantName` (aditivo en `OrderItemPriceSnapshot` y su codec de persistencia; órdenes previas siguen parseando con `null`).
2. **Dominio**: `createMenuProductPriceSnapshot` toma el precio de la variante cuando `variantId` viene y la variante está activa; sin `variantId` en un producto con variantes activas → error de dominio (`variant_required`); `variantId` en producto sin variantes → error. Pruebas unitarias.
3. **SQL** `20261006000300_catalog_variants.sql`: tabla `app.menu_product_variants` (restaurant_id, catalog_id, product_id, id, name, sku, unit_price_minor, active, display_order; únicos por producto; CHECKs como `menu_products`), `save_menu_catalog` y `build_menu_catalog_state` leen/escriben `variants` (acepta ausente = `[]`; replay normaliza como con `imagePath`), `confirm_capture_draft_v3` y la mutación canónica de líneas aceptan `variantId`/`variantName` en el snapshot y validan que la variante exista en el catálogo vigente con ese precio; plan de selección guarda `variantId`. Prueba SQL (guardar y leer variantes, confirmar con variante correcta, rechazar variante inexistente o precio alterado, producto con variantes sin `variantId` rechazado, aislamiento). Sonda local PG17. No editar migraciones aplicadas.
4b. **Nota de línea al agregar a una orden existente (fila D2, mismo archivo)**: `AddOrderItemCommandV1` (`packages/shared-types/src/orders.ts:219-228`) acepta `note?: string | null` (≤ 500, sin caracteres de control) y `OrderService.addItem` la pasa a `addOrderItem` (`OrderItemPricingInput.note` ya existe en dominio y la columna ya se persiste desde `20260930000100`); mobile no la envía y sigue compilando. `ORDER_DETAIL_ACTIONS` añade `addItem`, calculado en servidor para órdenes `draft|open|partially_paid` con `orders.update`. Pruebas.
4. **API**: catálogo (`menu-catalog.ts`) con variantes; selección/plan y confirm de captura con `variantId`; `OrderService.addItem` con `variantId`; `OrderDetailV1.items[]` expone `variantName` (aditivo). Pruebas: snapshot con variante, 409 por variante inválida, detalle con nombre de variante.

## Criterios de aceptación
- [ ] Migración candidata con prueba SQL y sonda local ok; contratos aditivos; mobile/kds/web typecheck y test verdes sin tocar mobile (si mobile tiene fixtures exactas del catálogo que rompan, el campo debe ser opcional en lectura).
- [ ] Puertas: domain, shared-types, api (test/typecheck/lint/build); web/mobile/kds typecheck y test.
- [ ] Commits por unidad (`feat(domain)`, `feat(shared-types)`, `feat(db)`, `feat(api)`); informe parcial a los ~35 turnos; **commitear antes de cualquier informe**. Pruebas de adaptadores con la fila real `{ result }`.

## Archivos de entrada
- C:\tmp\sr-wt\catalog-variants-api\packages\shared-types\src\index.ts (260-400, 980-1120), capture-selection*.ts, orders.ts (snapshot de línea).
- C:\tmp\sr-wt\catalog-variants-api\packages\domain\src\product-variants.ts, menu*.ts (snapshot de precio), order.ts (OrderItemPriceSnapshot).
- C:\tmp\sr-wt\catalog-variants-api\apps\api\src\menu-catalog.ts, captures.ts (plan de selección y confirm), orders.ts (addItem, detail), persistence\order-persistence-codec.ts.
- Migraciones: 20260902000100_create_menu_catalog.sql, 20261004000100_catalog_images.sql, 20260928000100_capture_selection_plan.sql, 20261001000100_capture_payment_intent.sql (confirm v3), 20260930000100_order_item_note.sql (patrón de campo aditivo en OrderItem).

## Invariantes
Precio congelado en el snapshot, nunca recalculado del catálogo actual; servidor valida; contratos aditivos; alcance Restaurant; sin push ni remoto; no tocar pagos.

## Fuera de alcance
Mitades de pizza (D7b, sobre `fraction-pricing.ts`), UI (paquete C: editor con «Añadir tamaño» y hoja de armado con selector de tamaño), fotos por variante.

## Formato de salida
Resumen con la regla de precio por variante en una frase, archivos y hashes, puertas y sonda, riesgos.
