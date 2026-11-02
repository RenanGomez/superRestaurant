# menu-locked-ingredients-fix8 · actualizar la aserción de ida y vuelta de las pruebas antiguas de mitades

Nivel A · Codex (`tools/agentic/codex-task.ps1 -Task menu-locked-ingredients-fix8 -Packet .claude/packets/menu-locked-ingredients-fix8.md -Base codex/menu-locked-ingredients-fix7 -Effort low`). Sólo `supabase/tests/catalog_halves_product_level_invariants.sql` y, si aplica el mismo patrón, `supabase/tests/catalog_halves_invariants.sql` y `supabase/tests/menu_shared_modifier_groups_invariants.sql`. No toques la migración ni `menu_locked_ingredients_invariants.sql` (ambas ya pasan en remoto). El orquestador hace el commit si el sandbox no puede.

## Fallo observado (regresión remota con rollback: migración `20261102000100` + pruebas antiguas)
`P0001 CATALOG_HALVES_PL_STATE_ROUNDTRIP` en `catalog_halves_product_level_invariants.sql:134-137`:
```sql
if save_state#>'{catalog,products,0,fraction}' is distinct from fraction_cfg ...
```
`fraction_cfg` es el payload legado (`enabled`, `flavorGroupId`, `extraGroupId`, `excludableIngredientIds`). Tras la migración, `build_menu_catalog_state` devuelve además `lockedIngredientOptionIds` (derivado por el backfill: opciones del grupo de ingredientes cuyo nombre normalizado no está en las etiquetas). Es el comportamiento buscado, así que la aserción debe actualizarse, no la migración.

## Tarea
1. Sustituir la comparación exacta por: `(save_state#>'{catalog,products,0,fraction}') - 'lockedIngredientOptionIds' is distinct from fraction_cfg` **y** una aserción nueva de que `save_state#>'{catalog,products,0,fraction,lockedIngredientOptionIds}'` es un array JSON cuyo contenido coincide con los ids de las opciones del grupo `g_extra` que **no** figuran en `excludableIngredientIds` (en ese fixture las etiquetas son `cebolla` y `piña`; comprueba qué opciones tiene `g_extra` en el propio archivo y deriva el conjunto esperado; si ninguna opción coincide, el esperado es «todas las opciones del grupo»). Usa `@>` y `<@` entre arrays jsonb para no depender del orden, o `jsonb_array_length` + contención.
2. Repite el barrido en `catalog_halves_invariants.sql` y `menu_shared_modifier_groups_invariants.sql` buscando comparaciones `is distinct from` sobre `fraction` completas y aplica el mismo criterio.
3. Mantén `begin;`/`commit;` o `rollback;` tal como estén en cada archivo (los de mitades terminan en `commit;` y el runner los envuelve). Commit `test(db): halves roundtrip tolerates derived lockedIngredientOptionIds`.

## Salida
Aserciones cambiadas por archivo; hash o motivo de no commitear.
