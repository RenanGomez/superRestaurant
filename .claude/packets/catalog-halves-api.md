# catalog-halves-api · mitad y mitad de pizza (D7b)

## Tarea
catalog-halves-api · capa: L1 (`implementer-claude`, razonamiento alto) · riesgo: alto · **nivel A** (precio congelado por fracción, snapshot, SQL de catálogo y confirmación). Fila D7 del «Día operable», segunda mitad. §19.3: revisión doble, corte en la tercera ronda. **Arranca después de integrar `catalog-variants-api`** (misma base de variantes y mismos archivos).

## Objetivo
Que un tamaño de pizza admita «mitad y mitad»: el operador elige dos sabores (y extras o exclusiones por mitad), el servidor fija el precio con la regla aprobada (mayor precio entre mitades, extras de media pizza al 50 % redondeado al centavo) y lo congela con el desglose por mitad; cocina ve cada mitad por separado.

## Hechos verificados (researcher 2026-10-04)
- `packages/domain/src/fraction-pricing.ts` (1-310) ya implementa `resolveFractionPricing(variant, input, context)`: entrada `FractionPricingVariant` (flavors, extras, includedIngredients, comboSlots, tax), `ResolveFractionPricingInput` (`geometry: whole|halves`, `slots[{fraction, flavorOptionId, extraOptionIds, excludedIngredientIds}]`), salida `FractionOrderItemPriceSnapshot extends OrderItemPriceSnapshot { variantId, geometry, fractionBreakdown[{fraction, flavorOptionId, amountMinor}] }`; `unitPrice = max(fracciones) + extras` (línea 294-307), extras de mitad `multiplyRatio(1n,2n,"ceil")` (226), modificadores con ids `extra:half-a:<optionId>` / `exclude:half-a:<ingredientId>`; límite 5 extras por fracción con override de gerente. Pruebas existentes.
- Snapshot persistido `PersistedOrderItemPriceSnapshotV1` (`apps/api/src/persistence/order-persistence-codec.ts:105-115`, encode 405-416, decode 419-431 con `exactRecord(..., obligatorias, opcionales ["sku","tax"])`); patrón de campos opcionales ya usado para `note`/`lineDiscount`.
- `ProductVariantCatalog` (`packages/domain/src/product-variants.ts:29-44`) sin flavors/extras. Decisiones §7.1 (`P2_CONFIGURABLE_CATALOG_SLICE.md`): sabores dentro del producto, no productos independientes.

## Diseño (seguir salvo razón documentada)
1. **Contrato** (aditivo sobre `MenuProductVariantV1` de D7a): `fraction: { enabled: boolean, flavorGroupId: string|null, extraGroupId: string|null, excludableIngredientIds: readonly string[] } | null` (opcional en entrada ⇒ `null`); los sabores son las opciones del grupo `flavorGroupId` (precio de la opción = precio del sabor para ese tamaño; 0 ⇒ usa el precio de la variante), los extras las del grupo `extraGroupId`. Línea de selección: `SelectionPlanCommandLineV1`/`AddOrderItemCommandV1` aceptan `fraction: { geometry: "halves", slots: [{ fraction: "half-a"|"half-b", flavorOptionId, extraOptionIds[], excludedIngredientIds[] }] } | null`. `OrderDetailItemV1` expone `fractionBreakdown` y `geometry` (aditivo) para ticket y KDS; `KdsTicket` líneas muestran «Mitad A: <sabor>» / «Mitad B: <sabor>» con sus modificadores (contrato aditivo del ticket si hace falta).
2. **Dominio**: `catalogVariantToFractionVariant(variant, catalog)` construye `FractionPricingVariant` desde el catálogo (puro, con pruebas); `createMenuProductPriceSnapshot` delega en `resolveFractionPricing` cuando la línea trae `fraction`; `OrderItemPriceSnapshot` admite `variantId?, geometry?, fractionBreakdown?`.
3. **Persistencia y SQL**: codec con los tres campos opcionales; migración `20261006000400_catalog_halves.sql`: columnas `fraction_enabled`, `fraction_flavor_group_id`, `fraction_extra_group_id`, `fraction_excludable_ingredient_ids uuid[]` en `menu_product_variants` con CHECK de coherencia (grupos del mismo producto), `save_menu_catalog`/`build_menu_catalog_state` con `fraction`, validación de `confirm_capture_draft_v3` y de la mutación canónica para snapshots con fracción (flavors existentes, `unitPrice` = recomputado por Nest; el SQL valida consistencia estructural y precios de opciones vigentes). Prueba SQL (guardar y leer config, confirmar mitad y mitad con precio correcto, rechazar sabor inexistente o de otro producto, aislamiento). Sonda local PG17.
4. **API**: plan de selección y confirm con `fraction`; `addItem` con `fraction`; detalle y KDS con desglose. Pruebas: precio = mayor + extras, extras de mitad al 50 % con redondeo, replay idempotente, 409 por sabor inválido.

## Criterios de aceptación
- [ ] Migración candidata con prueba SQL y sonda local ok; contratos aditivos; mobile/kds/web typecheck y test verdes.
- [ ] Puertas: domain, shared-types, api (test/typecheck/lint/build); kds typecheck y test (si cambia el ticket).
- [ ] Commits por unidad; informe parcial a los ~35 turnos; **commitear antes de cualquier informe**; pruebas de adaptadores con la fila real `{ result }`.

## Archivos de entrada
- C:\tmp\sr-wt\catalog-halves-api\packages\domain\src\fraction-pricing.ts (completo), product-variants.ts, menu*.ts (snapshot), order-totals.ts (3-27, 88-100).
- C:\tmp\sr-wt\catalog-halves-api\apps\api\src\persistence\order-persistence-codec.ts (100-120, 400-435), menu-catalog.ts, captures.ts (plan/confirm), orders.ts (addItem, detail), kds ticket reader.
- Migraciones: la de `catalog-variants-api` (20261006000300), 20260902000100, 20260928000100, 20261001000100, 20260930000100.

## Invariantes
Precio congelado con desglose, nunca recalculado; redondeo exacto en `Money`; servidor valida; contratos aditivos; alcance Restaurant; sin push ni remoto; no tocar pagos.

## Fuera de alcance
UI (paquete C: editor con «Permitir mitades» y hoja de armado con «Entera / Mitad y mitad»), combos (`comboSlots`), tercios.

## Formato de salida
Resumen con la regla de precio en una frase, archivos y hashes, puertas y sonda, riesgos.
