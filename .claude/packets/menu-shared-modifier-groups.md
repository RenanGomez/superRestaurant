# menu-shared-modifier-groups (P1 de menu-modifier-model-v2) · grupos de modificadores compartidos por restaurante con asignación múltiple

Nivel A · Capa L1 `implementer-claude` · riesgo alto · rama `claude/menu-shared-modifier-groups` desde `main` (≥ 9f2b179) · 2026-11-01. Pedido explícito de Emmanuel (retroalimentación /app/menu): «los grupos de modificadores deben crearse separados a los productos» y «un drop down multiselección para asignar grupos al producto». P2 (ingredientes bloqueados) y P3 (especialidades) vienen después y **no** se tocan aquí.

## Objetivo
Un grupo de modificadores pertenece al catálogo del restaurante y puede asignarse a varios productos. `MenuProductV1.modifierGroupIds: readonly string[]` (ya existe como allowlist en `packages/domain/src/menu.ts:108`) pasa a ser la relación canónica; `MenuModifierGroupV1.productId` queda como legado opcional durante la transición. Editor con sección propia «Grupos de modificadores» y, en el producto, un desplegable multiselección.

## Hallazgos de la investigación (researcher, CodeGraph 2026-11-01)
- La restricción «un producto por grupo» vive en tres sitios: dominio `validateMenuCatalogCanonical` (`packages/domain/src/menu.ts:298-316`, `ModifierGroupProductMismatchError`), FK `(restaurant_id, catalog_id, product_id)` en `app.menu_modifier_groups` (`20260902000100:82-93`) y el CHECK del resolver de mitades «grupo del mismo producto» (`20261006000400:352-359`).
- `validateVariants` (`packages/domain/src/configured-catalog.ts:133-163`) exige `groupId` único entre variantes: choca con grupos compartidos en la ruta V2 de captura; hay que relajarla a «único por variante».
- Mobile filtra grupos por `group.productId` (`apps/mobile/src/order-draft.ts:377-400`): debe leer `product.modifierGroupIds ?? [grupos con productId === product.id]`.
- Web: `menu-catalog-editor.tsx` (136-190 copiar/añadir grupo; 300 filtro por `productId`; 438 quitar grupos; 614 sección de grupo), `product-sheet.tsx` (52-130), `lib/menu-removal.ts`, `menu-duplicate.ts`, `menu-variants.ts`, `line-halves.ts`, `menu-fraction.ts`.
- SQL vigente: `build_menu_catalog_state` (27) / `normalize_menu_catalog_payload` (122) / `save_menu_catalog` (173) en `20261101000100_menu_category_appearance.sql`; `confirm_capture_draft_v3` en `20261008000200:498`.
- API: `apps/api/src/menu-catalog-domain.ts` (24 `toDomainMenuCatalog`, 96-103 `toDomainFraction`), `menu-catalog.ts` (48 adaptador).
- Verificador modelo: `apps/api/src/operations/run-catalog-halves-product-level-schema-verification.ts` (+ `supabase/tests/catalog_halves_product_level_invariants.sql`), script con `--local-disposable-only`. En esta máquina no hay Postgres local: el orquestador corre la sonda rollback-only remota de la migración; el implementador deja el verificador listo y documenta la brecha.

## Alcance por archivo
- **shared-types `index.ts`**: `MenuProductV1.modifierGroupIds?: readonly string[]` (opcional en entrada; normalizado: si falta, se deriva de los grupos cuyo `productId` coincide, para no romper productores viejos); `MenuModifierGroupV1.productId: string | null` opcional en entrada (si falta → `null`). Parser: ids UUID únicos, todo `modifierGroupId` debe existir en `modifierGroups` del payload. Tests.
- **domain `menu.ts`**: `validateMenuCatalogCanonical` acepta grupos sin `productId` y valida la relación por `product.modifierGroupIds` (grupo inexistente → error tipado; grupo con `productId` legado distinto del producto que lo lista → error). `configured-catalog.ts` `validateVariants`: unicidad de `groupId` por variante, no global. Tests de dominio nuevos y ajuste de los existentes.
- **Migración nueva `supabase/migrations/20261101000200_menu_shared_modifier_groups.sql`** (aditiva + backfill determinista): tabla `app.menu_product_modifier_groups (restaurant_id, catalog_id, product_id, group_id, display_order, PK compuesta, FK compuestas con restaurant_id a productos y a grupos)`; `menu_modifier_groups.product_id` pasa a `null`able y su FK se conserva; backfill `insert … select … from menu_modifier_groups where product_id is not null on conflict do nothing` (conteo antes/después igual, registrado con `raise notice`). `build_menu_catalog_state` emite `modifierGroupIds` por producto y `productId` (legado) en el grupo; `normalize_menu_catalog_payload` y `save_menu_catalog` aceptan y persisten la relación (claves opcionales, mismas reglas de `jsonb_has_exact_keys` menos las nuevas); el CHECK «grupo del mismo producto» del resolver de mitades pasa a «grupo asignado al producto». `owner to postgres`, `security definer`, `search_path` y grants como en la versión vigente. **Sin eliminar columnas legacy** (fase 2).
- **`supabase/tests/menu_shared_modifier_groups_invariants.sql`** (empieza `begin;`, termina `rollback;`, sin `commit`): backfill idempotente y conteos; grupo compartido por dos productos se guarda y se lee; grupo de otro restaurante rechazado; save antiguo (grupos con `productId`, productos sin `modifierGroupIds`) sigue válido y su replay coincide; cotización/confirmación de una línea con mitades que usa un grupo compartido sigue dando el mismo precio.
- **`apps/api/src/operations/run-menu-shared-modifier-groups-schema-verification.ts`** + script `verify:menu-shared-modifier-groups-schema:rollback` (`--local-disposable-only`), modelado en halves-product-level.
- **API** `menu-catalog-domain.ts`, `menu-catalog.ts`, tests (`menu-catalog.test.ts`, `fraction-halves.test.ts`, `captures.test.ts`, `orders.test.ts`): snapshots de OrderItem no cambian de forma.
- **Mobile** `order-draft.ts` (`activeProductGroups`, `orderableGroups`) y tests: lee `modifierGroupIds` con fallback a `productId`.
- **Web**: sección propia «Grupos de modificadores» en `/app/menu` (crear, editar, duplicar, quitar; quitar un grupo asignado pide confirmación con `RemovalDialog` y lo desasigna de todos los productos); en la tarjeta de producto la casilla «Grupos de modificadores» abre un desplegable multiselección (lista con casillas, 44 px, `aria-checked`) de los grupos del catálogo; «Duplicar producto» copia la lista de ids, no los grupos; `menu-removal.ts` y `menu-duplicate.ts` ajustados; `product-sheet.tsx`, `line-halves.ts`, `menu-fraction.ts` y `capture-selection.ts` usan la relación nueva con fallback. Textos en español, sin `any`, LF (respetar CRLF donde ya exista).

## Invariantes
- Dinero: el precio de media pizza sigue siendo el máximo de sus opciones (`fraction-pricing.ts`); ningún cambio de precios ni impuestos.
- Snapshots de OrderItem inmutables; un snapshot antiguo se decodifica igual.
- Aislamiento: todas las FK compuestas incluyen `restaurant_id`; un producto no puede referenciar un grupo de otro restaurante o catálogo.
- `packages/domain` sin frameworks.
- Compatibilidad: productores viejos (sin `modifierGroupIds`) y móviles atrasados (que leen `productId`) siguen funcionando durante la transición.
- Migraciones: nueva, aditiva, nunca editar aplicadas; **no aplicar en remoto** (el backfill es paso de datos y requiere autorización explícita de Emmanuel).

## Criterios de aceptación
1. Un grupo puede asignarse a dos productos; ambos lo muestran en captura y en la cotización.
2. Catálogo existente: tras el backfill, cada producto lista exactamente los grupos que tenía; conteos iguales.
3. Un payload antiguo se guarda y su replay es idempotente.
4. Grupo de otro restaurante/catálogo rechazado por parser, dominio y SQL.
5. Mobile y web compilan y sus tests pasan con el fallback.
6. UI: sección de grupos independiente y multiselección en el producto; sin `alert/confirm/prompt`.

## Verificación (Node 24, pnpm vía corepack)
- `pnpm turbo run lint typecheck test build --filter=@super-restaurant/shared-types --filter=@super-restaurant/domain --filter=@super-restaurant/api --filter=@super-restaurant/web`; `pnpm --filter @super-restaurant/mobile typecheck test`.
- Verificador rollback-only local si existe Postgres; si no, brecha documentada (el orquestador hará la sonda remota).
- CodeGraph antes y después; `git diff --check`.

## Formato de salida
Resumen, archivos, CodeGraph después, salida literal de puertas, brecha del verificador, riesgos. Commit(s) locales `feat(menu): …`. Sin merge, push ni aplicar migración.
