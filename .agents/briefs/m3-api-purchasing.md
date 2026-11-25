# Brief m3-api-purchasing (nivel A · API de proveedores, órdenes de compra y recepción)

## Objetivo
Exponer proveedores, órdenes de compra y recepción con las funciones SQL ya existentes, sin duplicar sus validaciones y con pruebas de dinero/aislamiento.

Tiempo estimado: 50 min. Escritor único de los archivos listados.

## Contexto
- `20261126000400_inventory_purchasing.sql`: tablas `app.inventory_suppliers`, `..._purchase_orders` (con `idempotency_key`, `received_by`, `received_device_id`) y `..._purchase_order_lines`; funciones `app_private.inventory_create_purchase_order(p_actor_id, p_restaurant_id, p_branch_id, p_payload)` (payload exact-key `{supplierId, currency, idempotencyKey, orderedAt?, lines:[{itemId, quantity, unitCode, unitCostMinor}]}`, replay con `replayed:true` o conflicto), `app_private.inventory_receive_purchase_order(p_actor_id, p_order_id, p_payload)` (payload `{warehouseId, occurredAt?, receivedAt?, deviceId?}`).
- Solo hay SELECT de esas tablas para `authenticated`; `app_api` no puede leerlas directo → necesitas funciones de lectura.
- Patrón: `apps/api/src/inventory/items.*`, `movements.*`, `recipes.*` (registro directo en `AppModule`).

## Qué hacer
1. **Migración** `supabase/migrations/20261126001000_inventory_purchasing_api.sql` (patrón `app_private`, SECURITY DEFINER, `search_path=''`, dueño postgres, `revoke all` + `grant execute` solo `app_api`):
   - `list_inventory_suppliers(p_actor, p_restaurant, p_include_inactive boolean)` → filas con `id, restaurant_id, name, contact, active, created_at`.
   - `create_inventory_supplier(p_actor, p_restaurant, p_name, p_contact, p_active)` y `update_inventory_supplier(p_actor, p_supplier_id, p_name, p_contact, p_active)` (manage; 0 filas si no existe/otro restaurante).
   - `list_inventory_purchase_orders(p_actor, p_restaurant, p_branch, p_status text default null, p_limit integer default 100)` → cabeceras con `id, supplier_id, supplier_name, status, currency, ordered_at, received_at, received_by, total_minor` (suma de `quantity * unit_cost_minor` de sus líneas), orden `ordered_at desc, id`.
   - `read_inventory_purchase_order(p_actor, p_order_id)` → cabecera + `lines` jsonb (`item_id, item_name, quantity, unit_code, unit_cost_minor`).
   - Todas exigen membresía con rol manage (`owner|admin|manager`) en el scope; `p_limit` 1..200.
2. **API** `apps/api/src/inventory/purchasing.{service,controller,test}.ts`:
   - `GET/POST /api/v1/inventory/suppliers` y `PATCH /suppliers/:id` (manage).
   - `GET /api/v1/inventory/purchase-orders?restaurantId&branchId&status?&limit?`, `POST /purchase-orders` (cuerpo `{restaurantId, branchId, supplierId, currency, idempotencyKey, orderedAt?, lines[]}` → `inventory_create_purchase_order`; el servidor añade actor), `GET /purchase-orders/:id`, `POST /purchase-orders/:id/receive` (cuerpo `{warehouseId, deviceId?, occurredAt?, receivedAt?}`).
   - Dinero siempre entero menor; no sumes totales en el cliente ni en el servicio si SQL ya los da.
   - Mapeo `22000/23514→400`, `23503/23505→409`, `42501→403`, resto 503; `INVENTORY_PURCHASE_IDEMPOTENCY_CONFLICT` → 409 con mensaje legible.
   - Registra controlador/servicio en `AppModule`, prueba en `scripts.test` y 401 en `app.smoke.test.ts`.
3. **Pruebas**:
   - SQL `supabase/tests/inventory_purchasing_api_invariants.sql`: lectura de proveedores/OC filtrada por membresía; `total_minor` correcto con dos líneas; OC de otro restaurante invisible; actor sin manage ⇒ `42501`; `read_inventory_purchase_order` devuelve líneas con nombre del insumo.
   - API: permiso, validación del cuerpo, una llamada por endpoint con función/parámetros correctos, `idempotencyKey` propagada, errores mapeados.
   - Registra migración y prueba en `apps/api/src/operations/inventory-{schema-,}verification.ts` sin tocar entradas existentes.

## Prohibido
Editar `20261126000400`, otros módulos, dependencias, commit/push. No ejecutes PostgreSQL.

## Puertas (Node 24.19.0)
`. .\tools\agentic\use-node24.ps1`; `$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"`; `& $PNPM --filter @super-restaurant/api typecheck`; `lint`; `test`.

## Hecho cuando
Migración, API, pruebas y registros aplicados; puertas verdes con salida real; informe con archivos, decisiones (totales, límites) y `git status --short`. Aplica Ponytail.
