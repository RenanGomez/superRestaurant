# menu-locked-ingredients-fix2 — correcciones de la revisión nivel A (escribe código)
Agente: Gemini   Nivel de rigor: A   Complejidad: Compleja

## Objetivo
Corregir en la rama `gemini/menu-locked-ingredients` (worktree `C:\tmp\sr-wt\menu-locked-ingredients-g`; no edites el checkout principal) los hallazgos de la revisión. Lee antes `.claude/packets/menu-locked-ingredients.md` y la versión vigente de las funciones en `supabase/migrations/20261101000200_menu_shared_modifier_groups.sql`.

## Hallazgos a corregir (todos en `supabase/migrations/20261102000100_menu_locked_ingredients.sql` salvo indicación)
1. **P1 `save_menu_catalog` (~269-278 y ~292-301)**: la validación de `fraction` usa `jsonb_has_exact_keys(..., array['enabled','flavorGroupId','extraGroupId','excludableIngredientIds'])`, que rechaza la clave `lockedIngredientOptionIds` (siempre la emite shared-types y la web) y también rechaza payloads nuevos sin `excludableIngredientIds`. Debe quedar: `jsonb_has_exact_keys(entry.value->'fraction' - 'lockedIngredientOptionIds' - 'excludableIngredientIds', array['enabled','flavorGroupId','extraGroupId'])` y, para cada clave opcional **si existe**: `jsonb_typeof = 'array'`, longitud ≤ 40, elementos string; UUID válidos y únicos para `locked`. En la rama de producto y en la de variante.
2. **P1 re-etiquetado (~482-540)**: hoy, si `locked = []` y `excludable` trae etiquetas, el guardado recalcula `locked` desde las etiquetas y vuelve a bloquear todo; y el segundo `update` recalcula `excludable` desde `locked`. Debe quedar: distinguir «clave ausente» de «`[]`»: el backfill desde etiquetas sólo se aplica cuando `lockedIngredientOptionIds` **no viene** en el payload (productor viejo). Si viene, `locked` manda y `excludable` se conserva tal cual llegó (o ausente → se deja la columna como estaba) sin recalcularla. Quita el segundo `update`. Prueba SQL: «desbloquear todo» (`locked: []` con etiquetas presentes) deja `locked = '{}'`.
3. **P2 `normalize_menu_catalog_payload`**: reemplázala desde su versión vigente (`20261101000200`) para que rellene `lockedIngredientOptionIds` y `excludableIngredientIds` con `[]` cuando falten, de modo que un replay con payload viejo frente a uno nuevo no dé `IDEMPOTENCY_CONFLICT`. Prueba SQL de replay viejo↔nuevo.
4. **P2 dominio vs web**: `packages/domain/src/menu.ts` (`catalogVariantToFractionVariant` / derivación de quitables) incluye opciones inactivas; `apps/web/src/app/app/capture/product-sheet.tsx:110-121` filtra por `active`. Deben coincidir: filtra por `active` también en dominio (y en SQL si allí se derivan) y añade un test de dominio con una opción inactiva.
5. **P3** `apps/api/src/fraction-halves.ts:25-27`: resolver el nombre primero por el id de opción del `modifierId` cuando exista, y sólo como fallback quitar el prefijo «Sin ». `packages/domain/src/menu.ts`: validar `lockedIngredientOptionIds` como UUID (no sólo texto). Comentario en shared-types: `excludableIngredientIds` es legado de sólo lectura.
6. Añade a `supabase/tests/menu_locked_ingredients_invariants.sql` los casos: payload viejo sin `locked` (válido), payload nuevo sin `excludable` (válido), desbloquear todo, replay viejo↔nuevo idempotente. El archivo sigue `begin;` … `rollback;` sin `commit`.

## Verificación (en el worktree)
- `& "<node24>\node.exe" "<node24>\node_modules\corepack\dist\pnpm.js" turbo run lint typecheck test build --filter=@super-restaurant/shared-types --filter=@super-restaurant/domain --filter=@super-restaurant/api --filter=@super-restaurant/web --filter=@super-restaurant/mobile` y `git diff --check`.
- Balance de `if/end if`, `begin/end`, `$function$` en la migración.
- Commits en la misma rama: `fix(db): …`, `fix(domain): …`, `fix(api): …`.

## Restricciones
No aplicar en remoto, no push, no merge. No tocar `apps/web/src/app/app/menu/**` salvo que el punto 2 exija dejar de reenviar `excludable` (si lo haces, dilo).

## Formato de salida: reporte §8 en .agents/reports/menu-locked-ingredients-fix2.md
Por hallazgo: qué cambió y dónde; salida de puertas; hashes. Máximo 60 líneas.
