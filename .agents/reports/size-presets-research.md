# size-presets-research — hecha
Cambios: Investigación de sólo lectura para paquetes A/C de presets de tamaño de menú.
Archivos: .agents/reports/size-presets-research.md
Verificación: git diff --check (sólo lectura, sin cambios de código).
Riesgos/pendientes: Ninguno bloqueante; aislar FK compuestas y validar borrado de presets en uso.
Notas: Dividir en Paquete 1 (Backend/SQL Nivel A) y Paquete 2 (UI Web Nivel C).

## 1. Inventario archivo:línea (lectores y escritores de variantes y tamaños)
- **Contratos (`packages/shared-types`)**:
  - `src/index.ts:355-364, 366, 382`: `MenuProductVariantV1`, `MENU_PRODUCT_MAX_VARIANTS = 12`, `MenuProductV1.variants`.
  - `src/index.ts:424-430`: `MenuCatalogPayloadV1` (transporta productos con variantes).
  - `src/index.ts:1285-1326`: `parseMenuProductVariantsV1` y `parseMenuProductVariantV1` (valida keys exactas, unicidad de ID y `lower(name)`).
  - `src/orders.ts:339, 595-601, 621, 640`: `OrderDetailItemV1.variantName` en detalle de orden.
  - `src/configured-catalog.ts:80-93, 257-288`: `ConfiguredProductVariantV2` (grafo de variantes V2).
- **Dominio (`packages/domain`)**:
  - `src/menu.ts:70-78, 110, 138-139`: `MenuProductVariantCatalog`, `variants` en producto, `variantId` en selección.
  - `src/menu.ts:235-259, 281`: `validateMenuCatalog` (unicidad de ID y nombre case-insensitive, precios).
  - `src/menu.ts:351-360, 448, 468`: selección obligatoria/activa de variante; congela `variantId` y `variantName` en snapshot.
  - `src/menu.ts:477-482, 491-540, 590-593, 629-641`: puente con mitades y normalización de catálogo.
  - `src/fraction-pricing.ts:57-70, 98, 149, 163-200, 337, 344, 360-422`: `FractionPricingVariant` congela `name` y `variantId`.
  - `src/order-totals.ts:87, 388-392, 411, 646-647, 667`: `variantName` en `OrderItemPriceSnapshot`.
- **SQL / Migraciones (`supabase/migrations`)**:
  - `20261006000300:12-36`: crea `app.menu_product_variants` (PK `restaurant_id, catalog_id, product_id, id`, unique `sku` y `lower(name)`).
  - `20261006000400:15-25`, `20261008000200:47-73`: añade y migra columnas de mitades en variantes.
  - `20261101000200:200-215`: `build_menu_catalog_state` serializa `variants` en JSON.
  - `20261101000200:516-534`: `save_menu_catalog` inserta en `app.menu_product_variants`.
  - `20261101000200:835-850, 1045, 1058-1060`: `confirm_capture_draft_v3` valida y congela `variantId` y `variantName` en snapshot.
- **API (`apps/api`)**:
  - `src/menu-catalog.ts:162, 221-231`: traduce y valida variantes en `saveMenuCatalog`.
  - `src/menu-catalog-domain.ts:81-90`: `toDomainCatalog` mapea variantes.
  - `src/orders.ts:45-47, 507, 522-524, 1020`: `addItem` valida variantes; proyecta `variantName: item.snapshot.variantName ?? null`.
  - `src/persistence/order-persistence-codec.ts:117-118, 433, 459`: encode/decode de `variantName` en snapshots persistidos.
  - `src/operations/tenancy-verification.ts:84, 110`: aislamiento multi-tenant de `menu_product_variants`.
- **Web (`apps/web`)**:
  - `src/lib/menu-variants.ts:1-53`: helpers `variantValidationError`, `variantNameFor`, `menuProductPriceLabel`.
  - `src/app/app/menu/menu-catalog-editor.tsx:68-69, 192, 433-510`: UI de edición de tamaños (lista, inputs de texto, precio, activo).
  - `src/app/app/capture/product-sheet.tsx:57-63, 95-106, 170-185`: selector de variantes en toma de orden.
  - `src/app/app/capture/capture-ticket.tsx:7, 40`, `order-detail-panel.tsx:536`, `caja/page.tsx:194`, `deliveries/courier-order-detail.tsx:114`, `print-documents.ts:38, 58`: renderizan `variantName`.
- **Mobile (`apps/mobile`)**:
  - `src/order-intents.test.ts:292`: consumo fixture de tipos de variante. Sin UI de variantes aún.

## 2. Modelo mínimo y consulta de dry-run
- **Tabla `app.menu_size_presets`**:
  `restaurant_id uuid`, `catalog_id uuid`, `id uuid`, `name text`, `display_order int`, `active boolean default true`.
  PK: `(restaurant_id, catalog_id, id)`. FK: `(restaurant_id, catalog_id) references app.menu_catalogs on delete cascade`.
  Check: `name` trim y length 1..80, sin caracteres de control. Unique index: `(restaurant_id, catalog_id, lower(name))`.
- **En `app.menu_product_variants`**:
  Columna nullable `size_preset_id uuid`.
  FK compuesta: `(restaurant_id, catalog_id, size_preset_id) references app.menu_size_presets (restaurant_id, catalog_id, id) on delete restrict`.
  Cuando existe, `save_menu_catalog` asigna/valida `variant.name = preset.name`.
- **¿Hace falta backfill?**:
  NO en base de datos. Mantener `size_preset_id` nullable garantiza 100% retrocompatibilidad con variantes existentes (que operan como "tamaño personalizado"). No se deben mutar catálogos históricos inmutables. Opcionalmente, la UI puede sugerir poblar presets al editar el draft si detecta variantes sin preset.
- **Consulta SQL de dry-run (SELECT pura, conteos y colisiones por restaurante)**:
```sql
with active_heads as (
  select restaurant_id, catalog_id from app.menu_catalog_heads
),
variants as (
  select v.restaurant_id, v.catalog_id, v.product_id, v.id as variant_id,
         v.name, lower(trim(v.name)) as norm_name, v.active
  from app.menu_product_variants v
  join active_heads h on h.restaurant_id = v.restaurant_id and h.catalog_id = v.catalog_id
),
preset_candidates as (
  select restaurant_id, catalog_id, norm_name,
         count(distinct name) as distinct_casings,
         min(name) as sample_name, count(*) as variant_count
  from variants
  group by restaurant_id, catalog_id, norm_name
)
select
  r.id as restaurant_id,
  r.name as restaurant_name,
  coalesce(count(v.variant_id), 0) as total_variantes,
  coalesce(count(distinct v.norm_name), 0) as presets_candidatos,
  coalesce(count(distinct case when pc.distinct_casings > 1 then pc.norm_name end), 0) as colisiones_casing,
  coalesce(jsonb_agg(jsonb_build_object(
    'preset', pc.sample_name, 'usos', pc.variant_count, 'casings_distintos', pc.distinct_casings
  ) order by pc.variant_count desc, pc.sample_name) filter (where pc.norm_name is not null), '[]'::jsonb) as detalle_presets
from app.restaurants r
left join variants v on v.restaurant_id = r.id
left join preset_candidates pc on pc.restaurant_id = r.id
group by r.id, r.name
order by r.name;
```

## 3. Invariantes del dominio y aislamiento
1. **Snapshots de OrderItem inmutables**: `app.order_items.snapshot` congela `variantName` en texto (`variant_record.name`). Nunca depende de joins futuros ni cambia si el preset cambia.
2. **Renombrar preset no muta ventas**: La inmutabilidad de releases y snapshots garantiza que tickets históricos conserven el nombre exacto de venta.
3. **Aislamiento multi-tenant y multi-release**: La FK compuesta `(restaurant_id, catalog_id, size_preset_id)` impide que variantes apunten a presets de otro restaurante o de otra versión de catálogo.
4. **Compatibilidad con clientes legacy**: `sizePresetId` y `sizePresets` son opcionales en contratos. Si vienen ausentes, se guardan como `NULL` / `[]` sin alterar el comportamiento previo.

## 4. Impacto en UI
- **Pestaña «Tamaños» en editor (`menu-catalog-editor.tsx`)**: CRUD de presets a nivel carta (nombre, orden con `DragReorderList`, switch activo). Diálogo de confirmación para borrado con conteo de usos.
- **Tarjeta de producto (`ProductEditor`)**: Desplegable para seleccionar preset existente (fijando el nombre de forma no editable) o «Tamaño personalizado» (permite campo de texto libre). Precio, SKU y activo siguen por producto.
- **Toma de orden (`ProductSheet`)**: Sin cambios de UX ni de contrato; sigue leyendo `variant.name` y `unitPriceMinor`.

## 5. Pruebas por capa, riesgos y división en paquetes
- **Pruebas necesarias**:
  - `shared-types`: parseo de `MenuSizePresetV1`, parseo de `sizePresetId` opcional, rechazo de duplicados `lower(name)` en presets.
  - `domain`: `validateMenuCatalog` valida coincidencia de presets y variante; `resolveMenuProductPriceSnapshot` preserva snapshot.
  - `SQL / DB`: test rollback-only verificando FK compuesta, unique index, `build_menu_catalog_state` y `save_menu_catalog`.
  - `API`: `menu-catalog.test.ts` con ciclo PUT/GET, verificación de aislamiento multi-tenant.
  - `Web`: helpers de `menu-variants.ts` y verificación visual en navegador de pestaña y selector.
- **Riesgos**: Borrado en UI de un preset asignado a productos (debe advertir o desvincular); desincronización de nombre al editar preset (resolver sincronizando en `save_menu_catalog`).
- **Propuesta de división en 2 paquetes**:
  - **Paquete 1 (Nivel A · Backend & Contratos - `menu-size-presets-backend`)**: SQL (tabla, FK, funciones catalog), shared-types, domain, API y tests SQL rollback-only.
  - **Paquete 2 (Nivel C · Web UI - `menu-size-presets-ui`)**: Pestaña «Tamaños», selector en tarjeta de producto, helpers y verificación visual.
