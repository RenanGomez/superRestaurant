# Brief m3-api-recipes (nivel B · API de recetas versionadas)

## Objetivo
Exponer recetas: publicar una versión (líneas) y listar/consultar las versiones activas e históricas por producto.

Tiempo estimado: 30 min. Escritor único de los archivos listados.

## Contexto
- SQL: `20261126000300_inventory_recipes.sql` ya tiene `app_private.publish_inventory_recipe(p_actor_id uuid, p_restaurant_id uuid, p_payload jsonb)` (payload `{productId, modifierId?, notes?, lines:[{itemId,quantity,unitCode}]}`, publica versión y desactiva la anterior). `app.inventory_recipes` y `app.inventory_recipe_lines` solo tienen SELECT para `authenticated`.
- Contratos en `packages/shared-types/src/inventory.ts`: `RecipeLineV1`, `RecipeVersionV1` (restaurantId, recipeId, productId, version, lines). Si falta un parser de comando de receta, añádelo en ese archivo **con su prueba** (nivel B, consumido solo por el API).
- Patrón de módulo: `apps/api/src/inventory/items.*` y `movements.*` (registro directo en `AppModule`, sin `imports`).

## Qué hacer
1. **Migración** `supabase/migrations/20261126000900_inventory_recipe_api.sql`:
   - `app_private.list_inventory_recipes(p_actor_id uuid, p_restaurant_id uuid, p_product_id uuid, p_include_inactive boolean) returns table (recipe_id uuid, restaurant_id uuid, product_id uuid, modifier_id uuid, version integer, active boolean, notes text, created_at timestamptz)` — membresía activa en el restaurante; orden `product_id, version desc`.
   - `app_private.read_inventory_recipe(p_actor_id uuid, p_restaurant_id uuid, p_recipe_id uuid) returns table (recipe_id uuid, restaurant_id uuid, product_id uuid, modifier_id uuid, version integer, active boolean, notes text, item_id uuid, quantity integer, unit_code text)` — una fila por línea; membresía activa; 0 filas si no existe.
   - Patrón `app_private` (SECURITY DEFINER, `search_path=''`, dueño `postgres`, `revoke all` + `grant execute` solo a `app_api`).
2. **API** `apps/api/src/inventory/recipes.{service,controller,test}.ts`:
   - `POST /api/v1/inventory/recipes` con `{restaurantId, productId, modifierId?, notes?, lines:[{itemId, quantity, unitCode}]}` → `publish_inventory_recipe`; permiso `catalog.manage`; devuelve la versión publicada (recipeId, version, líneas).
   - `GET /api/v1/inventory/recipes?restaurantId&productId&includeInactive?` → lista de versiones; `GET /api/v1/inventory/recipes/:id` → versión con líneas; permiso `catalog.read`.
   - Mapeo `22000/23514→400`, `23503→409`, `42501→403`, resto 503.
   - Registra controlador y servicio en `AppModule` y añade la prueba a `scripts.test` de `apps/api/package.json`; añade asserts 401 en `app.smoke.test.ts`.
3. **Pruebas**:
   - SQL `supabase/tests/inventory_recipe_api_invariants.sql`: publicar dos versiones deja una activa, lista por producto, lectura por id con líneas, aislamiento entre restaurantes y `42501` para actor sin membresía.
   - API: validación, permisos, una llamada a `publish_inventory_recipe` con los parámetros correctos y errores mapeados.
   - Registra migración y prueba en `apps/api/src/operations/inventory-{schema-,}verification.ts` sin tocar las entradas existentes.

## Prohibido
Editar `20261126000300`, otros módulos, dependencias, commit/push. No ejecutes PostgreSQL.

## Puertas (Node 24.19.0)
`. .\tools\agentic\use-node24.ps1`; `$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"`; `& $PNPM --filter @super-restaurant/shared-types build`; `& $PNPM --filter @super-restaurant/api typecheck`; `lint`; `test`.

## Hecho cuando
Migración, API, pruebas y registros aplicados; puertas verdes con salida real; informe con archivos, decisiones y `git status --short`. Aplica Ponytail.
