# menu-locked-ingredients-fix4 · las invariantes violan la FK `menu_modifier_groups_product_fk`

Nivel A · Codex (`tools/agentic/codex-task.ps1 -Task menu-locked-ingredients-fix4 -Packet .claude/packets/menu-locked-ingredients-fix4.md -Base codex/menu-locked-ingredients-fix3 -Effort medium`). Sólo `supabase/tests/menu_locked_ingredients_invariants.sql`. No toques la migración (ya pasa en remoto). El orquestador hace el commit si el sandbox no puede.

## Fallo observado
El orquestador ejecutó migración + invariantes contra PostgreSQL con rollback: la migración pasa; las invariantes fallan con `SQLSTATE 23503 insert or update on table "menu_modifier_groups" violates foreign key constraint "menu_modifier_groups_product_fk"`.

## Contexto
- Desde `20261101000200_menu_shared_modifier_groups.sql`, `menu_modifier_groups.product_id` es nullable y su FK compuesta `(restaurant_id, catalog_id, product_id)` apunta a `menu_products`; un trigger asigna el dueño legado en `app.menu_product_modifier_groups` cuando `product_id` no es nulo.
- Un fixture que inserta un grupo con `product_id` antes de insertar ese producto, o con un `product_id`/`catalog_id`/`restaurant_id` que no coincide con una fila existente, dispara exactamente este error.

## Tarea
1. Revisa cada `insert into app.menu_modifier_groups` del archivo: el producto referenciado debe existir ya (orden de inserción) con el mismo `restaurant_id` y `catalog_id`; para grupos compartidos usa `product_id = null` y asígnalos vía `app.menu_product_modifier_groups`.
2. Haz lo mismo para `menu_modifier_options` (FK a su grupo), `menu_product_variants` (FK a producto) y cualquier `menu_product_modifier_groups` (FK a producto y a grupo).
3. Compara los fixtures con `supabase/tests/menu_shared_modifier_groups_invariants.sql` y `catalog_halves_product_level_invariants.sql`, que sí se ejecutan correctamente contra la base, y copia su forma.
4. Mantén `begin;` al inicio, `rollback;` al final, sin `commit`.
5. Commit `test(db): fix modifier group fixtures order and FK in locked ingredients invariants`.

## Salida
Qué inserts cambiaron y por qué; hash o motivo de no commitear.
