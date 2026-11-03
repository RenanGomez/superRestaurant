# menu-locked-ingredients — hecha

## Resumen por capa
1. **Contratos y Dominio (`packages/shared-types`, `packages/domain`)**:
   - `MENU_VARIANT_MAX_LOCKED_INGREDIENTS = 40`.
   - `lockedIngredientOptionIds: readonly string[]` añadido al contrato `MenuVariantFractionV1` (y opcional `excludableIngredientIds?: readonly string[]` como fallback legado).
   - `toFractionPricingVariant` deriva los ingredientes incluibles/excluibles como las opciones activas del `extraGroup` restando `lockedIngredientOptionIds`, fusionando etiquetas legadas no solapadas.
2. **SQL, Invariantes, Verificador y Dry-Run (`supabase`, `apps/api`)**:
   - Migración `20261102000100_menu_locked_ingredients.sql`: columnas `fraction_locked_ingredient_option_ids uuid[] not null default '{}'` en `app.menu_products` y `app.menu_product_variants` (cardinalidad <= 40, sin nulos). Bloque DO determinista e idempotente para backfill inverso desde `excludable_ingredient_ids` si coinciden nombres/opciones.
   - `save_menu_catalog` valida pertenencia de UUIDs de locked al extraGroup, rechaza duplicados y propaga compatibilidad bidireccional.
   - `confirm_capture_draft_v3` valida exclusiones por UUID contra opciones del extraGroup asegurando que no estén en `fraction_locked_ingredient_option_ids` (con fallback a etiquetas de texto para capturas previas).
   - Invariantes en `supabase/tests/menu_locked_ingredients_invariants.sql`: `begin;` ... `rollback;` (cero `commit;`).
   - Verificador rollback-only `run-menu-locked-ingredients-schema-verification.ts` y dry-run de sólo lectura `dryrun-menu-locked-ingredients.ts`.
3. **API (`apps/api`)**:
   - `toDomainFraction` conserva `lockedIngredientOptionIds` y fallback legado `excludableIngredientIds`.
   - `describeHalves` y `describeHalvesFromSnapshot` en `fraction-halves.ts` derivan nombre de exclusión quitando prefijo "Sin ", y recuperan IDs de opciones desde `exclude:<half>:<optionId>` con fallback a etiquetas legadas.
4. **Web y Mobile (`apps/web`, `apps/mobile`)**:
   - `FractionEditor`: reemplazó la entrada de texto libre por checkboxes accesibles de 44 px bajo «Ingredientes que no se pueden quitar», podando locked al cambiar de grupo.
   - `product-sheet.tsx`: deriva ingredientes excluibles (`extraGroup.options` menos bloqueados + legados) y despacha chips "Sin {nombre}" con el UUID del modificador.
   - Helpers y tests en `line-halves.ts`, `menu-fraction.ts`, `menu-duplicate.ts` actualizados y probados.

## Archivos editados y creados (worktree C:\tmp\sr-wt\menu-locked-ingredients-g)
- `packages/shared-types/src/index.ts`
- `packages/shared-types/src/line-fraction.runtime.test.ts`
- `packages/shared-types/src/menu.runtime.test.ts`
- `packages/domain/src/fraction-pricing.ts`
- `packages/domain/src/fraction-pricing.test.ts`
- `packages/domain/src/menu.ts`
- `packages/domain/src/menu-halves.test.ts`
- `supabase/migrations/20261102000100_menu_locked_ingredients.sql`
- `supabase/tests/menu_locked_ingredients_invariants.sql`
- `apps/api/package.json`
- `apps/api/src/operations/run-menu-locked-ingredients-schema-verification.ts`
- `apps/api/src/operations/dryrun-menu-locked-ingredients.ts`
- `apps/api/src/menu-catalog-domain.ts`
- `apps/api/src/fraction-halves.ts`
- `apps/api/src/fraction-halves.test.ts`
- `apps/api/src/captures.test.ts`
- `apps/api/src/menu-catalog.test.ts`
- `apps/api/src/orders.test.ts`
- `apps/web/src/lib/menu-fraction.ts`
- `apps/web/src/lib/menu-fraction.test.ts`
- `apps/web/src/lib/menu-duplicate.ts`
- `apps/web/src/lib/menu-duplicate.test.ts`
- `apps/web/src/lib/line-halves.ts`
- `apps/web/src/lib/line-halves.test.ts`
- `apps/web/src/lib/line-halves-built.test.ts`
- `apps/web/src/lib/menu-removal.test.ts`
- `apps/web/src/app/app/menu/menu-catalog-editor.tsx`
- `apps/web/src/app/app/capture/product-sheet.tsx`

## Salida literal de las puertas
- **turbo run lint typecheck test build (@super-restaurant/shared-types, domain, api, web, mobile)**:
  `Tasks: 24 successful, 24 total. Time: 2m7.345s`
- **git diff --check**:
  `Exit status 0 (limpio, sin errores de formato ni espacios al final)`

## Commits en gemini/menu-locked-ingredients
- `affa3e3` feat(domain,shared-types): locked ingredient option ids in fraction configuration
- `b655048` feat(db): menu locked ingredients migration, invariants and verification
- `46f3ade` feat(api): adapt menu catalog domain and fraction halves for locked ingredient ids
- `f77c2ee` feat(web): locked ingredients ui in catalog editor and product sheet

## Brechas y riesgos
- **Brecha**: Host de desarrollo no cuenta con daemon local de PostgreSQL; `run-menu-locked-ingredients-schema-verification.ts` y las invariantes SQL están estructuradas de forma estrictamente rollback-only para ejecución remota segura por el orquestador.
- **Riesgos y lectura de snapshots antiguos**: Mitigado. Los snapshots históricos y proyecciones con formato de etiqueta previa (`exclude:half-a:cebolla` o nombres en `excludable_ingredient_ids`) mantienen compatibilidad en cascada: tanto en SQL (`confirm_capture_draft_v3`), dominio (`toFractionPricingVariant`), API (`describeHalvesFromSnapshot`) y Web (`restoreLineFraction`), se reconocen tanto los UUIDs de opciones de `extraGroup` como las etiquetas legadas.
