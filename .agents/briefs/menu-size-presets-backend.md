# menu-size-presets-backend · tamaños reutilizables a nivel carta (Nivel A: contratos, dominio, SQL, API)

Diseño completo y aprobado en `.agents/reports/size-presets-research.md` (§1 inventario archivo:línea, §2 modelo, §3 invariantes, §5 pruebas). Léelo primero; no re-explores el repo.

## Objetivo
Presets de tamaño definidos una vez por carta y referenciados opcionalmente desde las variantes de producto. 100 % retrocompatible: sin backfill, `sizePresetId` y `sizePresets` opcionales.

## Cambios
1. `packages/shared-types`: `MenuSizePresetV1 {id, name, displayOrder, active}`, `MenuCatalogPayloadV1.sizePresets?: MenuSizePresetV1[]` (ausente ⇒ `[]`), `MenuProductVariantV1.sizePresetId?: string | null` (ausente ⇒ `null`). Parsers con keys exactas, UUID canónico, nombre trim 1..80 sin controles, unicidad `lower(name)`, máximo 24 presets. Tests.
2. `packages/domain` (`menu.ts`): `validateMenuCatalog` rechaza variante con `sizePresetId` inexistente o inactivo y fuerza `variant.name === preset.name` cuando hay preset. Los snapshots siguen congelando `variantName` en texto. Tests.
3. Migración NUEVA `supabase/migrations/20261106000100_menu_size_presets.sql`: tabla `app.menu_size_presets` (PK/FK compuestas, check, unique lower(name), RLS habilitado igual que `app.menu_product_variants`, sin grants a `anon/authenticated`), columna nullable `size_preset_id` en `app.menu_product_variants` con FK compuesta `on delete restrict`. `CREATE OR REPLACE` de `app_private.build_menu_catalog_state`, `normalize_menu_catalog_payload` y `save_menu_catalog` **partiendo del texto vigente en `20261102000100_menu_locked_ingredients.sql`** (la última que las redefine; no uses la versión de `20261101000200`): serializar/aceptar `sizePresets` y `sizePresetId`, y en `save_menu_catalog` sincronizar `variant.name` con el preset. Conservar grants (EXECUTE sólo `app_api` en `save_menu_catalog`). No editar migraciones existentes.
4. `supabase/tests/menu_size_presets_invariants.sql`: transacción que termina en `rollback`; casos: guardar con presets, variante con preset de otro catálogo (rechazo), preset duplicado por casing (rechazo), renombrar preset sincroniza variante y NO toca snapshots de `app.order_items`, payload legado sin claves nuevas sigue funcionando.
5. `apps/api`: `menu-catalog.ts`, `menu-catalog-domain.ts` mapean los campos; `operations/tenancy-verification.ts` y `tenancy-fixture-recovery.ts` limpian `app.menu_size_presets` (guard `to_regclass`, como se hizo con `menu_product_modifier_groups`). Test PUT/GET.

## No tocar
`apps/web`, `apps/mobile`, migraciones existentes, Supabase remoto.

## Hecho cuando
`pnpm turbo run lint typecheck test build --filter=@super-restaurant/shared-types --filter=@super-restaurant/domain --filter=@super-restaurant/api` verde (si tu Node no es 24 o el sandbox falla con EPERM, dilo; el orquestador repite). Commits locales `feat(menu): …` en tu rama. Informe con bloque ``` de comandos y salida real; lista de riesgos.

## Reintento 2 (2026-11-06)
El intento anterior agotó el tiempo. En tu worktree ya está commiteado (wip) lo de `packages/shared-types` y `packages/domain`: revísalo, complétalo si falta, y continúa con la migración SQL, `supabase/tests/menu_size_presets_invariants.sql` y `apps/api`. Escribe el informe aunque no termines todo (di qué falta).
