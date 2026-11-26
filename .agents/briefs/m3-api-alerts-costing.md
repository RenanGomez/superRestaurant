# Brief m3-api-alerts-costing (nivel B · alertas de stock, costo promedio y margen estimado)

## Objetivo
Exponer alertas de stock mínimo, costo promedio ponderado por almacén/insumo y un margen estimado por producto, calculados siempre desde el ledger (sin floats ni valores del cliente).

Tiempo estimado: 40 min. Escritor único de los archivos listados.

## Contexto
- Ledger: `app.inventory_movements` (`quantity_delta integer`, `unit_cost_minor bigint`, `currency`, `kind`), saldo en `app.inventory_balances` (derivado). `app.inventory_items.min_quantity` es el mínimo por insumo (restaurante). Recetas: `app.inventory_recipes`/`lines` (activas). Catálogo: `app.menu_products.unit_price_minor` con `catalog_id` publicado.
- ADR-013 §6: costo promedio = `value_minor / quantity_on_hand` con aritmética entera y redondeo medio hacia arriba; nunca floats; la tabla es caché, la fuente es el ledger.
- Patrón `app_private` y registro en `AppModule` como `items`/`movements`/`recipes`/`purchasing`.

## Qué hacer
1. **Migración** `supabase/migrations/20261126001100_inventory_costing_api.sql`:
   - `list_inventory_alerts(p_actor_id, p_restaurant_id, p_branch_id) returns table (item_id uuid, item_name text, unit_code text, warehouse_id uuid, warehouse_name text, quantity integer, min_quantity integer, deficit integer)` — membresía activa; `quantity` = saldo del almacén; incluye solo `quantity < min_quantity` (mínimo > 0); orden por déficit desc, nombre.
   - `inventory_average_cost(p_actor_id, p_restaurant_id, p_branch_id, p_warehouse_id uuid, p_item_id uuid) returns table (quantity integer, value_minor bigint, unit_cost_minor bigint, currency text, rounding_remainder integer)` — costo = `round((sum(delta*unit_cost) sobre receipts) / sum(delta) )` con redondeo medio hacia arriba en enteros; `rounding_remainder` guarda el resto; 0 si no hay receipts. Solo movimientos con `unit_cost_minor` no nulo.
   - `list_inventory_product_costs(p_actor_id, p_restaurant_id, p_product_id uuid) returns table (item_id uuid, item_name text, unit_code text, quantity integer, purchase_unit_factor integer, unit_cost_minor bigint, line_cost_minor bigint, currency text)` — explota la receta activa del producto y multiplica por el costo medio del último almacén con costo (elige el almacén por defecto de la sucursal; si no hay, el primero con saldo) — documenta la elección en `COMMENT`.
   - `read_inventory_product_margin(p_actor_id, p_restaurant_id, p_branch_id, p_product_id uuid) returns table (product_id uuid, price_minor bigint, cost_minor bigint, margin_minor bigint, currency text)` — precio del catálogo publicado vigente, coste de la receta activa y margen = precio − costo (documenta que es estimado con catálogo/receta actuales).
   - Todas `SECURITY DEFINER`, `search_path=''`, dueño postgres, `revoke all` + `grant execute` solo a `app_api`.
2. **API** `apps/api/src/inventory/costing.{service,controller,test}.ts`:
   - `GET /api/v1/inventory/alerts?restaurantId&branchId` (`catalog.read`).
   - `GET /api/v1/inventory/costs?restaurantId&branchId&warehouseId&itemId` (`catalog.read`).
   - `GET /api/v1/inventory/product-costs?restaurantId&productId` y `GET /api/v1/inventory/margins?restaurantId&branchId&productId` (`catalog.read`).
   - DTOs con enteros y moneda; sin cálculos de dinero en el servicio (los da SQL). Mapeo `22000/23514/22003→400`, `23503/23505→409`, `42501→403`, resto 503.
   - Registra controlador y servicio en `AppModule`, prueba en `scripts.test` y 401 en `app.smoke.test.ts`.
3. **Pruebas**:
   - SQL `supabase/tests/inventory_costing_api_invariants.sql`: dos receipts con costos distintos dan el promedio correcto con redondeo (caso impar); alerta aparece solo bajo el mínimo; coste de receta multiplica cantidades; margen = precio − coste; aislamiento entre restaurantes y `42501` sin membresía.
   - API: permisos, validación de query, una llamada por endpoint y mapeo de errores.
   - Registra migración y prueba en `apps/api/src/operations/inventory-{schema-,}verification.ts` sin tocar entradas existentes.

## Prohibido
Editar migraciones previas, otras apps, dependencias, commit/push. No ejecutes PostgreSQL.

## Puertas (Node 24.19.0)
`. .\tools\agentic\use-node24.ps1`; `$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"`; `& $PNPM --filter @super-restaurant/api typecheck`; `lint`; `test`.

## Hecho cuando
Migración, API, pruebas y registros aplicados; puertas verdes con salida real; informe con archivos, decisiones (almacén del costo, margen estimado) y `git status --short`. Aplica Ponytail.
