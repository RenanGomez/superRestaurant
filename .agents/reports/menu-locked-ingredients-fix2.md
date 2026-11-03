# menu-locked-ingredients-fix2 — hecha

## Hallazgos corregidos
1. **P1 `save_menu_catalog` claves de fracción**: en `supabase/migrations/20261102000100_menu_locked_ingredients.sql`, validación de claves con `jsonb_has_exact_keys(entry.value->'fraction' - 'lockedIngredientOptionIds' - 'excludableIngredientIds', array['enabled','flavorGroupId','extraGroupId'])`. Claves opcionales si existen: array, longitud <= 40, strings, UUIDs válidos/únicos en `locked`. Aplicado en producto y variante.
2. **P1 re-etiquetado y backfill**: el backfill desde etiquetas sólo se ejecuta si `lockedIngredientOptionIds` no viene en el payload (`not (prod.value->'fraction' ? 'lockedIngredientOptionIds')`). Se eliminó el segundo `update` que recalculaba `excludable` desde `locked`. Desbloquear todo (`locked: []`) no se sobreescribe y deja `fraction_locked_ingredient_option_ids = '{}'::uuid[]`.
3. **P2 `normalize_menu_catalog_payload`**: función reemplazada con la versión base de `20261101000200` rellenando `lockedIngredientOptionIds` y `excludableIngredientIds` con `[]` cuando falten en productos y variantes, garantizando replay idempotente sin conflicto.
4. **P2 dominio vs web opciones inactivas**: `catalogVariantToFractionVariant` en `packages/domain/src/menu.ts` y SQL `confirm_capture_draft_v3` filtran por `option.active` (y `and active` en SQL) al derivar quitables. Añadido test unitario en `packages/domain/src/menu-halves.test.ts`.
5. **P3 resolución de nombres y UUIDs**: `apps/api/src/fraction-halves.ts` resuelve nombre por id de opción si no es UUID y fallback a prefijo "Sin ". `packages/domain/src/menu.ts` valida `lockedIngredientOptionIds` como UUID canónico (`assertUuid`). En `packages/shared-types/src/index.ts` se documentó `excludableIngredientIds` como legado de sólo lectura.
6. **SQL invariants**: en `supabase/tests/menu_locked_ingredients_invariants.sql`, añadidos los 4 casos: payload viejo sin `locked` (válido, backfill pobla `locked`), payload nuevo sin `excludable` (válido, guarda y preserva `locked`), desbloquear todo (`locked: []` deja `{}` sin re-bloquear), y replay viejo↔nuevo idempotente (`replayed`). Se mantiene `begin;` ... `rollback;` sin `commit;`.

## Archivos modificados
- `packages/shared-types/src/index.ts`
- `packages/domain/src/menu.ts`
- `packages/domain/src/menu-halves.test.ts`
- `packages/domain/src/menu-halves-product-level.test.ts`
- `apps/api/src/fraction-halves.ts`
- `supabase/migrations/20261102000100_menu_locked_ingredients.sql`
- `supabase/tests/menu_locked_ingredients_invariants.sql`

## Verificación de puertas
- `turbo run lint typecheck test build --filter=@super-restaurant/shared-types --filter=@super-restaurant/domain --filter=@super-restaurant/api --filter=@super-restaurant/web --filter=@super-restaurant/mobile --force` → Pasa (24 exitosas, 0 cacheadas).
- `git diff --check` → Pasa limpio (0 errores de formato).
- Balances SQL en migración: `$backfill$=2`, `$function$=8`, IF/END IF diff=0, LOOP/END LOOP diff=0.
- Balances SQL en invariants: IF/END IF diff=0, `begin;` ... `rollback;` sin `commit;`.

## Hashes de commits (rama `gemini/menu-locked-ingredients` en `C:\tmp\sr-wt\menu-locked-ingredients-g`)
- `2c974a5`: `fix(domain): validate lockedIngredientOptionIds as UUIDs and exclude inactive options`
- `5abeed2`: `fix(api): resolve half exclusions by modifierId optionId fallback to Sin prefix`
- `f1ce2f4`: `fix(db): support modern fraction keys, selective backfill, payload normalization, and invariants`
