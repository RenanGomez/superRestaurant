# menu-locked-ingredients-fix5 · «column reference "catalog_id" is ambiguous» en el bloque DO de las invariantes

Nivel A · Codex (`tools/agentic/codex-task.ps1 -Task menu-locked-ingredients-fix5 -Packet .claude/packets/menu-locked-ingredients-fix5.md -Base codex/menu-locked-ingredients-fix4 -Effort low`). Sólo `supabase/tests/menu_locked_ingredients_invariants.sql`. No toques la migración (pasa en remoto). El orquestador hace el commit si el sandbox no puede.

## Fallo observado (ejecución remota con rollback por el orquestador)
`SQLSTATE 42702 column reference "catalog_id" is ambiguous` — `PL/pgSQL function inline_code_block line 108 at SQL statement`, en el `update app.menu_products p set fraction_locked_ingredient_option_ids = coalesce((select pg_catalog.array_agg(opt.id order by opt.id) from app.menu_modifier_options opt where opt.restaurant_id = p.restaurant_id and opt.catalog_id = p.catalog_id and opt.group_id = p.fraction_extra_group_id and not exists (select 1 from pg_catalog.unnest(p.fraction_excludable_ingre…` (posición interna 610). Es la simulación del backfill dentro de un bloque `do $$ … $$` del archivo de invariantes: una variable PL/pgSQL del bloque se llama `catalog_id` (o `restaurant_id`, `product_id`, etc.) y colisiona con las columnas del mismo nombre dentro de la consulta.

## Tarea
1. En ese bloque `do $$`, renombra las variables locales que coincidan con nombres de columna (por ejemplo `catalog_id` → `v_catalog_id`, `restaurant_id` → `v_restaurant_id`, `product_id` → `v_product_id`, `group_id` → `v_group_id`) y actualiza todas sus referencias. Alternativa aceptable: añadir `#variable_conflict use_column` al inicio del bloque si la intención en esa consulta es siempre la columna, pero el renombrado es preferible.
2. Revisa los demás bloques `do $$` del archivo buscando el mismo patrón (variables con nombre de columna usadas en consultas con alias) y corrígelo preventivamente.
3. Mantén `begin;` al inicio, `rollback;` al final, sin `commit`.
4. Commit `test(db): disambiguate plpgsql variables in locked ingredients invariants`.

## Salida
Variables renombradas por bloque; hash o motivo de no commitear.
