# p2-locked-ingredients-research — hecha
Cambios: Investigación exhaustiva de P2 (sustitución de `excludableIngredientIds` por `lockedIngredientOptionIds`). Mapeo, SQL dry-run, migración 2 pasos, tests y riesgos.
Archivos: .agents/reports/p2-locked-ingredients-research.md
Verificación: Ninguna (sólo lectura).
Riesgos/pendientes: Aprobación humana para dry-run remoto; riesgo de inversión semántica; retrocompatibilidad de snapshots históricos.
Notas: Sin cambios de código; listo para redacción de brief de implementación.

## 1. Inventario de lecturas y escrituras de `excludableIngredientIds` y viaje al snapshot
- **Contratos (`packages/shared-types`)**:
  - `src/index.ts:347, 352`: campo `excludableIngredientIds: readonly string[]` en `MenuVariantFractionV1` y alias `MenuProductFractionV1`.
  - `src/index.ts:1222, 1229-1236, 1241`: `parseMenuVariantFractionV1` valida max 40 strings <=80 carácteres, sin duplicados; lo invocan `parseMenuProductV1` (:1143) y `parseMenuProductVariantV1` (:1205).
  - `src/line-fraction.ts:14, 43, 68, 73, 79, 84, 119, 124, 127, 131`: `LineFractionSlotV1` y `FractionHalfProjectionV1` transportan `excludedIngredientIds: readonly string[]` en la línea.
- **Dominio (`packages/domain`)**:
  - `src/menu.ts:64, 67`: `MenuVariantFractionConfig.excludableIngredientIds: readonly string[]`.
  - `src/menu.ts:646-648, 667-674`: `parseFractionConfig` y `validateFractionConfig` validan unicidad y congelan array.
  - `src/menu.ts:527`: `toFractionPricingVariant` mapea a `includedIngredients: config.excludableIngredientIds.map(label => ({ ingredientId: label, name: label }))`.
  - `src/fraction-pricing.ts:77, 204, 273-288`: `resolveFractionPricing` valida exclusiones contra `ingredientsById`. Genera `ModifierPriceSnapshot` con `groupId: "fraction-exclusion"`, `groupName: "exclude:<half>"`, `modifierId: "exclude:<half>:<label>"`, `name: "Sin <label>"`, `unitPrice: 0`.
- **SQL / Migraciones (`supabase/migrations`)**:
  - `20261006000400:19, 20261008000200:27`: columna `fraction_excludable_ingredient_ids text[]` en `menu_product_variants` y `menu_products`.
  - `20261101000100:216-224, 239-247`: `normalize_menu_catalog_payload` valida array de texto <=40 elementos.
  - `20261101000100:333, 346, 354, 364, 409-411, 430-432`: `save_menu_catalog` inserta y valida `MENU_FRACTION_LABEL_DUPLICATE`.
  - `20261101000100:55-60, 68-73`: `build_menu_catalog_state` serializa la columna a JSON como `excludableIngredientIds`.
  - `20261008000200:710, 715, 855-868`: `confirm_capture_draft_v3` valida `label_text = any(fr_labels)` y genera modificadores `exclude:<fraction>:<label_text>`.
- **API (`apps/api`)**:
  - `src/menu-catalog-domain.ts:96-103`: `toDomainFraction` copia `excludableIngredientIds: [...fraction.excludableIngredientIds]`.
  - `src/captures.ts:1226`: proyecta mitades con `describeHalvesWithIds(snapshot, line.fraction)`.
  - `src/fraction-halves.ts:14-35, 43-58, 65-80`: `describeHalves` extrae exclusiones cortando el prefijo `exclude:<half>:`; `describeHalvesFromSnapshot` y `describeHalvesWithIds` pueblan `excludedIngredientIds` en `fractionBreakdown`.
  - `src/orders.ts`: proyecta el detalle de orden con `describeHalvesFromSnapshot` en `fractionBreakdown`.
- **Web (`apps/web`)**:
  - `src/app/app/menu/menu-catalog-editor.tsx:538-545, 579`: input texto libre `addIngredient`, chips `{ingredient} ✕`.
  - `src/app/app/capture/product-sheet.tsx:190, 278, 292, 341-352`: `HalfColumn` renderiza "Sin {ingredient}", toggles en `excludedIngredientIds`.
  - `src/lib/line-halves.ts:233`: `restoreLineFraction` valida `excludedIngredientIds.every(id => setup.excludableIngredientIds.includes(id))`.
  - `src/lib/menu-fraction.ts:5, 14, 60`: `EMPTY_PRODUCT_FRACTION`, `sameSetup`, `migrateLegacyFraction`.
  - `src/lib/menu-duplicate.ts:17`: duplica array `excludableIngredientIds`.
- **Mobile (`apps/mobile`)**:
  - `src/order-draft.ts`: sin soporte activo de fracciones aún; consume contratos donde `fraction` viaja en productos.

## 2. Regla de mapeo etiqueta → option_id y consulta SQL dry-run
- **Regla exacta**: Coincidencia unívoca `lower(trim(option.name)) = lower(trim(label))` dentro del grupo `app.menu_modifier_options` donde `group_id = fraction_extra_group_id` y mismo `(restaurant_id, catalog_id)`.
- **Etiquetas huérfanas (sin opción)**: No mapean a ningún `option_id`. Se reportan como `etiquetas_no_mapeadas`. Al no existir como opción del grupo, no pueden bloquearse ni excluirse por ID; permanecen en la columna legacy sin inventar UUIDs.
- **Nombres duplicados en el grupo**: Si hay >1 opción con el mismo `lower(trim(name))`, el mapeo es ambiguo (`etiquetas_duplicadas`). Bloquea la asignación automática determinista y exige resolución manual previa.
- **Consulta SQL de dry-run (SELECT pura, agrupada por restaurante)**:
```sql
with fractions as (
  select p.restaurant_id, p.catalog_id, p.id as product_id, null::uuid as variant_id,
         p.fraction_extra_group_id as ingredient_group_id, p.fraction_excludable_ingredient_ids as labels
  from app.menu_products p where cardinality(p.fraction_excludable_ingredient_ids) > 0
  union all
  select v.restaurant_id, v.catalog_id, v.product_id, v.id as variant_id,
         v.fraction_extra_group_id as ingredient_group_id, v.fraction_excludable_ingredient_ids as labels
  from app.menu_product_variants v where cardinality(v.fraction_excludable_ingredient_ids) > 0
),
unrolled as (
  select f.restaurant_id, f.catalog_id, f.product_id, f.variant_id, f.ingredient_group_id,
         lbl.label, lower(trim(lbl.label)) as norm_label
  from fractions f cross join lateral unnest(f.labels) as lbl(label)
),
matches as (
  select u.restaurant_id, u.catalog_id, u.product_id, u.variant_id, u.ingredient_group_id, u.label,
         count(o.id) as match_count
  from unrolled u
  left join app.menu_modifier_options o
    on o.restaurant_id = u.restaurant_id and o.catalog_id = u.catalog_id
   and o.group_id = u.ingredient_group_id and lower(trim(o.name)) = u.norm_label
  group by u.restaurant_id, u.catalog_id, u.product_id, u.variant_id, u.ingredient_group_id, u.label
)
select
  m.restaurant_id,
  count(distinct (m.product_id::text || ':' || coalesce(m.variant_id::text, 'prod'))) as fracciones_afectadas,
  count(*) as total_etiquetas,
  count(*) filter (where m.ingredient_group_id is not null and m.match_count = 1) as etiquetas_mapeadas,
  count(*) filter (where m.ingredient_group_id is null or m.match_count = 0) as etiquetas_no_mapeadas,
  count(*) filter (where m.ingredient_group_id is not null and m.match_count > 1) as etiquetas_duplicadas,
  count(distinct (m.product_id::text || ':' || coalesce(m.variant_id::text, 'prod')))
    filter (where m.ingredient_group_id is null) as fracciones_sin_grupo_ingredientes
from matches m group by m.restaurant_id order by m.restaurant_id;
```

## 3. Definición de la migración en dos pasos e invariantes de rollback
- **Paso 1: Esquema aditivo (DDL)**:
  - `add column fraction_locked_ingredient_option_ids uuid[] not null default '{}'::uuid[]` en `app.menu_products` y `app.menu_product_variants`.
  - CHECK constraints: `cardinality <= 40`, `array_position(..., null) is null`.
  - Conservar `fraction_excludable_ingredient_ids text[]` sin modificar ni borrar.
- **Paso 2: Backfill y funciones (DML)**:
  - Backfill determinista: para cada producto/variante con `fraction_extra_group_id is not null`:
    `locked = array_agg(o.id)` de opciones de ese grupo cuyo `lower(trim(o.name))` NO coincida con ninguna etiqueta en `fraction_excludable_ingredient_ids`.
    Si `fraction_excludable_ingredient_ids` estaba vacío, todas las opciones del grupo pasan a locked.
    Si `fraction_extra_group_id is null`, locked queda `'{}'::uuid[]`.
  - Actualizar `normalize_menu_catalog_payload`, `save_menu_catalog`, `build_menu_catalog_state` y `confirm_capture_draft_v3` soportando ambas claves.
- **Invariantes en rollback**:
  - `DROP COLUMN fraction_locked_ingredient_option_ids` deja el catálogo y funciones legadas intactas sin pérdida de datos.
  - Idempotencia del backfill: ejecutar N veces produce el mismo estado.
  - Pertenencia e integridad: todo UUID en `fraction_locked_ingredient_option_ids` existe en `app.menu_modifier_options` con `group_id = fraction_extra_group_id`.

## 4. Tests existentes que cambian de semántica y nuevos requeridos
- **Dominio**:
  - Cambian: `packages/domain/src/menu-halves.test.ts:186, 205` y `menu-halves-product-level.test.ts:21, 168, 181, 208, 215` (fixtures migran de etiquetas a UUIDs). `fraction-pricing.test.ts:44-47`.
  - Nuevos: rechazar exclusión de opción bloqueada (`exclusion_locked`); permitir exclusión de opción no bloqueada; rechazar UUIDs que no pertenezcan al `extraGroupId`; rechazar duplicados en `lockedIngredientOptionIds`.
- **Contratos (`shared-types`)**:
  - Cambian: `packages/shared-types/src/menu.runtime.test.ts:291, 300, 318` (pruebas de duplicados y forma del fraction config).
  - Nuevos: validar parsing de `lockedIngredientOptionIds` (UUIDs v4 canonical); tolerancia opcional/dual de `excludableIngredientIds`.
- **API**:
  - Cambian: `apps/api/src/captures.test.ts:856, 873`, `menu-catalog.test.ts:303`, `fraction-halves.test.ts:51-60`, `http-flow-halves*.ts`.
  - Nuevos: rechazo 409 en `line-quote` y confirmación al excluir opción locked; `describeHalves` formateando exclusiones a partir de `optionId`.
- **Web**:
  - Cambian: `apps/web/src/lib/line-halves.test.ts:35`, `menu-fraction.test.ts:10`, `menu-duplicate.test.ts:15`.
  - Nuevos: `menu-catalog-editor.tsx` UI selector por chip/checkbox de opciones del grupo; `product-sheet.tsx` deshabilitando o excluyendo botones de ingredientes locked; `restoreLineFraction` validando `!setup.lockedIngredientOptionIds.includes(id)`.
- **Mobile**:
  - Pruebas de compatibilidad hacia adelante en el deserializador de catálogo.

## 5. Señalamiento de riesgos
1. **Snapshots históricos**: Órdenes pasadas tienen modificadores `exclude:<fraction>:<texto>` en JSONB inmutable. `describeHalves` debe conservar compatibilidad dual para leer tickets antiguos sin romper `OrderDetailV1`.
2. **Clientes móviles y web atrasados**: Despliegues intermedios donde la app envíe `excludableIngredientIds` romperían con 400 si la API no mantiene dual-read durante la transición.
3. **Pizzas sin grupo de ingredientes (`extraGroupId = null`)**: Mitad y mitad habilitada solo con sabores debe aceptar `lockedIngredientOptionIds: []` sin exigir grupo ni fallar en backfill.
4. **Inversión semántica**: Antes, lo excluible era una allowlist explícita (lo no listado estaba bloqueado). Ahora, todo ingrediente del grupo es excluible por defecto salvo que esté en `lockedIngredientOptionIds`. Al agregar un nuevo ingrediente al grupo, queda removible automáticamente.
5. **Aislamiento multi-tenant (AGENTS §10)**: La API y SQL deben validar que los UUIDs de `lockedIngredientOptionIds` pertenezcan estrictamente al mismo `restaurant_id`, `catalog_id` y `fraction_extra_group_id`.
