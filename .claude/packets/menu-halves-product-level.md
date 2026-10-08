## Tarea
menu-halves-product-level (lote-smoke-20261007, Menú punto 4 + reglas de pizza) · capa: L1 implementer-claude · riesgo: alto · nivel A (dinero, `packages/domain` precios, `supabase/migrations`, contrato `packages/shared-types` consumido por api y web)

## Objetivo
Mover la configuración «Permitir mitades» del tamaño (variant) al producto, para que un producto SIN tamaños también se pueda vender mitad y mitad, y permitir que una mitad sea «armada ingrediente por ingrediente» en vez de un sabor. Sin romper la web actual (contrato compatible hacia atrás); la pantalla nueva es otra tarea (U3).

## Reglas de negocio dictadas por Emmanuel (2026-10-07)
- Tamaño: mini, mediana, grande, familiar (variants existentes).
- Sabores: combinación predefinida de ingredientes a precio predeterminado; no modificable (opciones del grupo de sabores).
- Ingredientes: se puede armar la pizza ingrediente por ingrediente (grupo de ingredientes).
- Mitades: una mitad de un sabor y la otra de otro, **o** una mitad de un sabor y la otra hecha ingrediente por ingrediente.
- Decisión del 2026-10-07 (opción B): la configuración vive en el producto, no en cada tamaño.

## Decisiones de L0 (asumidas, Emmanuel ratifica; registrar en PROJECT_NOTES el orquestador)
1. `MenuProductCatalog.fraction?: MenuProductFractionConfig` con `{ enabled, flavorGroupId, extraGroupId, excludableIngredientIds }` (mismo shape que hoy). `extraGroupId` pasa a significar «grupo de ingredientes»: sirve como extras de una mitad de sabor y como ingredientes de una mitad armada. Aplica a todos los tamaños del producto y al producto sin tamaños (`variantId = null`).
2. Mitad armada: `MenuFractionSlotSelection.flavorOptionId: string | null`. `null` = mitad armada; sólo válida si `extraGroupId !== null`. Al menos una de las dos mitades debe tener sabor (dos mitades armadas = pizza entera armada, que ya existe con modificadores normales) → error de selección `fraction_both_custom`.
3. Precio (mantener la regla vigente «mayor mitad + extras de media al 50 % ceil» de D7b, `6ed7e0a`): precio base de una mitad de sabor = precio de la opción de sabor, o si es 0 el precio del tamaño elegido (o del producto si no hay tamaños). Precio base de mitad armada = precio del tamaño elegido (o del producto). Ingredientes de cualquier mitad se cobran con la regla existente de extras de media. Snapshot congelado con desglose; una mitad armada aparece en el desglose sin sabor (nombre «Armada» o el que defina el snapshot actual; no recalcular históricos).
4. Compatibilidad: el parser/normalizador sigue aceptando `variant.fraction` (legado). Si un producto tiene `fraction` a nivel producto, ésa manda; si no, se usa la del variant elegido como hoy. Al guardar un catálogo nuevo que trae `product.fraction`, se rechaza que además traiga `variant.fraction` habilitado (una sola fuente). Snapshots ya congelados con `flavorOptionId` string siguen parseando.
5. Regla existente que se conserva: flavorGroupId ≠ extraGroupId; ambos grupos pertenecen al producto.

## Criterios de aceptación (verificables)
- [ ] Dominio: producto sin tamaños con `product.fraction.enabled` se cotiza mitad y mitad; producto con tamaños usa el precio del tamaño elegido; mitad armada válida/ inválida (sin grupo de ingredientes, ambas armadas); precio = mayor base + ingredientes al 50 % ceil; legado `variant.fraction` sigue funcionando. Unitarias en `packages/domain` (`menu-halves.test.ts` o nuevo).
- [ ] `packages/shared-types`: `MenuProductV1.fraction?` y `LineFractionV1` slot con `flavorOptionId: string | null`, parsers estrictos, pruebas runtime; los consumidores web existentes compilan sin cambios (campos opcionales/compatibles).
- [ ] SQL: nueva migración (no editar `20261006000400_catalog_halves.sql`) que persista la config a nivel producto y acepte mitad armada en la línea/KDS por mitad; migración de datos de `variant.fraction` existente a producto si es necesario (primera variante habilitada) sin borrar la columna legada. Verificador rollback-only local (`operations/local-postgres.ts`) en verde; reproducible desde cero.
- [ ] API: guardar/leer catálogo y cotizar/guardar una captura con mitad armada y con producto sin tamaños; prueba HTTP/contract en `apps/api`.
- [ ] Revisión de impacto con CodeGraph antes y después (lectores/escritores de `MenuVariantFractionConfig`, `resolveFractionPricing` o equivalente, KDS por mitad, `describeHalvesFromSnapshot`, `print-documents`, `line-halves.ts` web).
- [ ] Puertas globales: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` (ver memoria: Node 24 en `%LOCALAPPDATA%\Programs\node24`).

## Archivos de entrada
- packages/domain/src/menu.ts (líneas 51-90 tipos; ~340-500 precio de mitades; 600-650 normalización de fraction)
- packages/domain/src/menu-halves.test.ts
- packages/shared-types/src/index.ts (MenuProductV1, MenuVariantFractionV1, LineFractionV1 y sus parsers)
- apps/api/src/menu-catalog-domain.ts (~línea 99 mapping de fraction), apps/api/src/menu-catalog.ts, apps/api/src/captures.ts
- supabase/migrations/20261006000400_catalog_halves.sql (referencia; no editar)
- apps/web/src/lib/line-halves.ts, apps/web/src/lib/menu-variants.ts (sólo para confirmar que siguen compilando)

## Invariantes que NO deben cambiar
- dinero en enteros minor + ISO; nunca float; ceil documentado;
- el cliente nunca envía montos; el servidor cotiza;
- alcance Restaurant/Branch en toda consulta;
- snapshots históricos no se recalculan; migraciones aplicadas no se editan;
- Order/Payment sólo vía NestJS.

## Fuera de alcance
- UI del editor y de la hoja de captura (U3); tooltips, unidad, fotos (U2 Codex).
- Aplicar la migración en Supabase remoto (requiere aprobación de Emmanuel; L0 la pide).
- push/merge.

## Verificación
- pnpm --filter @super-restaurant/domain test
- pnpm --filter @super-restaurant/shared-types test
- pnpm --filter @super-restaurant/api test
- verificador SQL rollback-only local de la migración nueva
- puertas globales lint/typecheck/test/build

## Formato de salida esperado
1. Resumen (3-6 líneas) incluyendo la forma final del contrato.
2. Archivos tocados y commits (conventional commits, rama `claude/menu-halves-product-level`).
3. Salida literal de las verificaciones.
4. Riesgos/dudas (en especial la migración de datos y la regla de precio).
