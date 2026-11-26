I'll review the SQL migration and test files as instructed.
VEREDICTO: APROBAR

Sin hallazgos P1/P2. P3:
1. P3 `supabase/tests/inventory_api_functions_invariants.sql:37` — el comentario "…but not the raw ledger writer" es falso: `20261126000200_inventory_ledger.sql:317-319` concede EXECUTE a `app_api` y la prueba no lo verifica. Fix: corregir el comentario (el grant se conserva a propósito, `20261126000600…:587-589`).
2. P3 `20261126000600_inventory_api_functions.sql:256-257` y `:519` — el UPDATE final autoriza con `v_restaurant_id` leído en un statement previo pero filtra solo por `id`. Fix: añadir `and i.restaurant_id = v_restaurant_id` (warehouse: `+ w.branch_id = v_branch_id`) como defensa en profundidad (TOCTOU si `restaurant_id` fuese mutable).
3. P3 `…invariants.sql:96-124` — se prueba cashier en create/read pero no en `update_item`/`update_warehouse`, ni un actor sin membresía. Fix: añadir ambos casos (42501 / 0 filas).
4. P3 `…invariants.sql` — no se asserta en `pg_proc` que las 8 sean `prosecdef`, `proowner=postgres`, `proconfig search_path=''` ni su volatilidad; solo se infiere al ejecutar como `app_api`. Fix opcional: chequeo de catálogo.
5. P3 `20261126000600…:5-6` — el comentario "a leaked app_api credential cannot enumerate another restaurant's catalog" exagera: `p_actor_id` es parámetro de confianza del servidor; con userId+restaurantId conocidos devolvería el catálogo. Fix: reformular el modelo de confianza.

Verificación (correcto en #1–#3): las 8 funciones verifican membresía (restaurant o branch según entidad); `read_..._for_manage` devuelve vacío para ajeno e inexistente y 42501 solo para miembro no-manager (no distingue ajeno de inexistente → sin fuga); `security definer`, `stable`/`volatile` y formas `returns table`/`return query` coherentes; `revoke all … from public,anon,authenticated,service_role,app_api` + `grant execute … to app_api`; `inventory_warehouses` no tiene `deleted_at` (por eso no se filtra, correcto).

```text
$ Select-String 20261126000200_inventory_ledger.sql -Pattern "grant|revoke"
310: revoke all on app.inventory_movements, app.inventory_balances
314: revoke all on function app_private.inventory_record_movement(
317: grant execute on function app_private.inventory_record_movement(
$ Select-String 20260830000100_create_tenancy_memberships.sql -Pattern "usage on schema"
285: grant usage on schema app_private to app_api;
$ read 20261126000100_inventory_catalog.sql (32-44): app.inventory_warehouses (id, restaurant_id, branch_id, name, active, created_at, updated_at)  <- sin deleted_at
$ read tenancy_memberships_post_*_catalog.sql: ... or pg_catalog.has_schema_privilege(app_api_oid,'app','USAGE') -> no debe tenerlo; la prueba lo asserta en invariants.sql:28
```