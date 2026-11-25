# Brief m3-sql-purchasing (nivel A · SQL inventario: compras y recepción)

## Objetivo
Proveedores, órdenes de compra y recepción que genera movimiento `receipt` y recalcula el costo.

Tiempo estimado: 35 min. Carril SQL: único escritor de `supabase/migrations/**` y `supabase/tests/**`.

## Alcance
- Crea: `supabase/migrations/20261126000400_inventory_purchasing.sql`, `supabase/tests/inventory_purchasing_invariants.sql`.
- Edita: `apps/api/src/operations/inventory-schema-verification.ts` (añadir el test a la lista).
- Prohibido: migraciones anteriores, otras apps, `package.json`, dependencias, rutas fuera del worktree. Sin commit ni push.

## Fuente de verdad
`docs/adr/ADR-013.md` §2.6, §2.11, §3. Base ya en `main`: `inventory_items`, `inventory_warehouses` (`00100`), `inventory_movements` + `app_private.inventory_record_movement` (`00200`), recetas (`00300`).

## Qué construir
1. `app.inventory_suppliers`: `id`, `restaurant_id`, `name`, `contact` (nullable), `active`, timestamps. Único `(restaurant_id, lower(name))` activo.
2. `app.inventory_purchase_orders`: `id`, `restaurant_id`, `branch_id`, `supplier_id`, `status` (`draft|sent|received|cancelled`), `currency`, `ordered_at`, `received_at`, `created_by`, timestamps. Único `(restaurant_id, id)`, índice por `(branch_id, status)`.
3. `app.inventory_purchase_order_lines`: `order_id`, `item_id`, `quantity` (entero > 0), `unit_code`, `unit_cost_minor` (entero ≥ 0), único `(order_id, item_id, unit_code)`.
4. `app_private.inventory_create_purchase_order(p_actor_id, p_restaurant_id, p_branch_id, p_payload jsonb) returns jsonb`: valida membresía/rol (owner/admin/manager), insumos del restaurante, unidades compatibles, cantidades/importes enteros. Devuelve `{orderId, status}`.
5. `app_private.inventory_receive_purchase_order(p_actor_id, p_order_id, p_payload jsonb) returns jsonb`: solo desde `sent` o `draft`; por cada línea llama a `inventory_record_movement` con `kind='receipt'`, `quantity_delta=+quantity`, `source_type='purchase_order_line'`, `idempotency_key='receipt:'||order_id||':'||line_id`, `unit_cost_minor`; marca la orden `received` y devuelve `{status:'received', movements:[...]}`. Reintentar la recepción no duplica movimientos (idempotencia) y devuelve el mismo resultado.
6. RLS `ENABLE` + `FORCE` en las tres tablas; lectura por scope; escritura solo por las funciones privadas (`REVOKE ALL`, `GRANT EXECUTE ... TO app_api`).

## Invariantes `supabase/tests/inventory_purchasing_invariants.sql`
1. Crear OC válida; insumo de otro restaurante rechazado; cantidad decimal o ≤ 0 rechazada.
2. Estado inválido rechazado por check.
3. Recepción genera un movimiento `receipt` por línea con el saldo correcto (`SUM` del ledger).
4. Reintentar la recepción con la misma key no duplica movimientos ni saldo.
5. Recepción de una orden ya `received` no vuelve a mover stock.
6. Aislamiento: actor de otra sucursal/restaurante no puede crear ni recibir.
7. Privilegios: `authenticated`/`anon`/`service_role` no escriben las tablas ni ejecutan las funciones.

## Puertas (obligatorio, Node 24.19.0)
No ejecutes PostgreSQL (binario fuera del worktree).
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/api typecheck
```
El orquestador ejecuta `verify:inventory-schema:rollback`.

## Hecho cuando
Migración, invariantes 1–7 y registro en el verificador; `typecheck` real en el informe; `NO VERIFICADO: PG por orquestador`.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe.
Aplica Ponytail: cambio más pequeño correcto, sin recortar validación, seguridad ni pruebas.
