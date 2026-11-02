# menu-locked-ingredients-fix3 — las invariantes SQL usan columnas inexistentes (escribe código)
Agente: Gemini   Nivel de rigor: A   Complejidad: Estándar

## Objetivo
En la rama `gemini/menu-locked-ingredients` (worktree `C:\tmp\sr-wt\menu-locked-ingredients-g`; no edites el checkout principal), el orquestador ejecutó la migración `20261102000100_menu_locked_ingredients.sql` contra PostgreSQL con rollback: la migración ya pasa, pero `supabase/tests/menu_locked_ingredients_invariants.sql` falla con `SQLSTATE 42703 column "state" of relation "operational_shifts" does not exist` (línea 57: `insert into app.operational_shifts(id, restaurant_id, branch_id, opened_by, opened_at, state)`).

## Tarea
1. Corrige todos los `insert` de fixtures del archivo de invariantes para que usen las columnas reales. `app.operational_shifts` (migración `20260905000100`) tiene `id, restaurant_id, branch_id, name, status, version, opened_at, opened_by, closed_at, closed_by, created_at, updated_at`; copia la forma exacta que ya usa `supabase/tests/catalog_halves_product_level_invariants.sql` (línea ~240: `insert into app.operational_shifts(id,restaurant_id,branch_id,name,status,opened_at,opened_by)`). Revisa de la misma manera cada tabla que el archivo siembra (restaurants, branches, memberships, menu_catalogs, menu_categories, menu_products, menu_product_variants, menu_modifier_groups, menu_modifier_options, menu_product_modifier_groups, capture drafts, etc.) comparando columna por columna con su `create table` vigente y con los fixtures de `catalog_halves_product_level_invariants.sql` y `menu_shared_modifier_groups_invariants.sql`, que sí se ejecutan correctamente.
2. Verifica que las funciones que el archivo invoca existen con esa firma en el estado post-migración (`save_menu_catalog`, `confirm_capture_draft_v3`, `replace_capture_selection_plan` o las que uses) y que los `set local role app_api` están en la forma `execute 'set local role app_api';` como en los otros archivos (el runner remoto los elimina).
3. El archivo sigue empezando con `begin;` y terminando con `rollback;`, sin `commit`.
4. No toques la migración salvo que una invariante demuestre un error real en ella; si lo haces, dilo explícitamente porque habría que repetir la sonda.
5. Commit en la misma rama: `test(db): fix locked ingredients invariants fixtures`.

## Nota
Si `menu-locked-ingredients-fix2` todavía está modificando la rama cuando empieces, espera a que su commit exista (`git log -1`) antes de editar, y parte de su resultado.

## Formato de salida: reporte §8 en .agents/reports/menu-locked-ingredients-fix3.md
Tablas corregidas, columnas cambiadas, hash. Máximo 40 líneas.
