# Brief debt-historical-verifiers-r2

NO escribas archivos fuera del repo ni en `$env:TEMP`: usa `.harness/state/tmp/` y bórralo. NO ejecutes PostgreSQL, psql ni Playwright (el orquestador los corre). NO commitees, NO hagas push, NO instales dependencias. Trabajas sobre el árbol de trabajo actual (rama `harness/o4-historical-verifiers`), no en worktrees.

## Objetivo
Cerrar los dos fallos que quedan en los verificadores históricos, que ya no son de forma sino de **fixtures desactualizados frente a migraciones posteriores**. El orquestador ya ejecutó los tres: `verify:capture-schema:rollback` pasa; estos dos no.

Tiempo estimado: 20 min · Nivel B

## Alcance (únicos archivos que puedes editar/crear)
- `apps/api/src/operations/run-menu-shared-modifier-groups-schema-verification.ts`
- `apps/api/src/operations/run-menu-locked-ingredients-schema-verification.ts`
- `supabase/tests/catalog_halves_invariants_pre_20261102000100.sql` (nuevo, pineado)
- `supabase/tests/catalog_halves_product_level_invariants_pre_20261102000100.sql` (nuevo, pineado)

Prohibido: `supabase/migrations/**`, los fixtures vigentes (`catalog_halves_invariants.sql`, `catalog_halves_product_level_invariants.sql`, `menu_shared_modifier_groups_invariants.sql`, `menu_locked_ingredients_invariants.sql`), `apps/api/package.json`, y todo lo demás.

## Fallo A — `verify:menu-shared-modifier-groups-schema:rollback`
Salida real (tras el arreglo de forma que ya está en el árbol):
`{"stage":"migrated","status":"failed","code":"LOCAL_MENU_SHARED_GROUPS_FAILED","sqlState":"P0001","invariant":"CATALOG_HALVES_LOCKED_INGREDIENT_OPTIONS"}`

Causa: el runner ejecuta como regresión los fixtures **vigentes** `catalog_halves_invariants.sql` y `catalog_halves_product_level_invariants.sql`, que en el commit `5ac39cb3` (para `20261102000100_menu_locked_ingredients.sql`) empezaron a exigir `lockedIngredientOptionIds`. Ese comportamiento no existe en el conjunto histórico de este verificador (candidato `20261101000200`).

Arreglo:
1. Crea los dos ficheros pineados con el contenido de la versión **anterior** a ese cambio:
   `git show 322e2f45:supabase/tests/catalog_halves_invariants.sql` y `git show 322e2f45:supabase/tests/catalog_halves_product_level_invariants.sql` (comprueba con `git log --oneline -- <ruta>` que `5ac39cb3` es el commit que añadió las aserciones; si el padre correcto es otro, usa ese y dilo en el reporte).
2. Añade una cabecera de 3–4 líneas a cada fichero pineado explicando por qué está congelado.
3. En `run-menu-shared-modifier-groups-schema-verification.ts` usa esos dos ficheros en `regressionSql` en lugar de los vigentes. No toques el runner de locked ingredients para esto: ahí el candidato **sí** incluye `20261102000100` y debe seguir usando los vigentes.

## Fallo B — `verify:menu-locked-ingredients-schema:rollback`
Salida real:
`{"stage":"migrated","status":"failed","code":"LOCAL_MENU_LOCKED_INGREDIENTS_FAILED","sqlState":"23514","constraint":"menu_modifier_options_name_valid","detail":"...  cebolla , ...","message":"new row for relation \"menu_modifier_options\" violates check constraint \"menu_modifier_options_name_valid\""}`

Causa: el `SEED_LEGACY_SQL` del runner (línea ~89) inserta una opción con nombre `' cebolla '` (con espacios). El CHECK `menu_modifier_options_name_valid` de `20260902000100_create_menu_catalog.sql:116` exige `name = btrim(name)` y existe desde el catálogo base, así que ese seed nunca pudo insertarse.

Arreglo: usa una variante de mayúsculas (`'CEBOLLA'`) que conserve la intención (ambigüedad al mapear `array['Cebolla']` contra dos opciones activas que sólo difieren en mayúsculas). Revisa el resto del seed y del fixture para que ninguna aserción dependa del literal con espacios; no relajes la aserción de ambigüedad ni la borres.

## Hecho cuando
- Los tres comandos (que corro yo) quedan listos: `verify:menu-shared-modifier-groups-schema:rollback`, `verify:menu-locked-ingredients-schema:rollback` y `verify:capture-schema:rollback`, sin variables remotas y sin tolerancias.
- `pnpm --filter @super-restaurant/api run typecheck` y `lint` en 0 (puedes correrlos).
- `git -c core.whitespace=cr-at-eol diff --check` limpio.

## Reporte
`.agents/reports/debt-historical-verifiers-r2.md`: causa de cada fallo, commit del que pineaste cada fixture, comandos con salida real (bloque ```) y qué queda al orquestador. Aplica Ponytail.
