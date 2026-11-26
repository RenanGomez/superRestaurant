# Brief m3-sale-wire (nivel A · cablear los envoltorios de inventario en el API + cancelación de línea)

## Objetivo
Que el consumo por venta deje de ser código muerto: el API llama a los envoltorios con inventario en los tres puntos de escritura, y se añade el envoltorio que falta para la cancelación de una línea suelta.

Tiempo estimado: 35 min. Escritor único de `apps/api/src/captures.ts`, `apps/api/src/orders.ts`, sus pruebas y la migración nueva.

## Contexto exacto (ya está en `main` de esta rama)
- `supabase/migrations/20261126000500_inventory_sale_consumption.sql`: `app_private.confirm_capture_draft_v3_with_inventory(uuid,jsonb,jsonb,jsonb)` (4 args, resuelve el almacén por defecto de la sucursal y consume solo con `applied`) y `app_private.cancel_order_with_inventory(uuid,jsonb,jsonb)` (revierte las líneas canceladas por el comando y por los pasos).
- `app_private.inventory_reverse_order_item(p_actor_id uuid, p_restaurant_id uuid, p_branch_id uuid, p_order_id uuid, p_order_item_id uuid) returns jsonb` revierte una línea desde sus consumos previos.
- `app_private.persist_order_item_cancellation(p_actor_id uuid, p_expected_version bigint, p_order jsonb, p_audit jsonb)` (`20260905000300`) devuelve `{status, order, version, kdsEvent}` con `status='saved'` en la escritura nueva, `'replayed'` si ya existía y `'conflict'|'forbidden'` en el resto.
- Llamadas actuales: `apps/api/src/captures.ts:517` (probe con `null::jsonb`) y `:560` (confirm real); `apps/api/src/orders.ts:89` (cancelar línea) y `:92` (cancelar orden).

## Qué hacer
1. **Migración nueva** `supabase/migrations/20261126000700_inventory_line_cancel.sql`:
   `create function app_private.persist_order_item_cancellation_with_inventory(p_actor_id uuid, p_expected_version bigint, p_order jsonb, p_audit jsonb) returns jsonb` — llama a `persist_order_item_cancellation` y, **solo** con `status='saved'`, toma `orderId`/`restaurantId`/`branchId` del resultado (`v_result -> 'order'`) y llama a `inventory_reverse_order_item` con `(p_audit ->> 'entityId')::uuid`. Devuelve `v_result || jsonb_build_object('inventory', ...)`. Si `status` es `replayed`, devuelve sin revertir. Patrón de seguridad de las demás funciones (SECURITY DEFINER, `search_path=''`, dueño `postgres`, `revoke all` + `grant execute` solo a `app_api`).
   Registra la migración en `apps/api/src/operations/inventory-schema-verification.ts` y `run-inventory-schema-verification.ts` **sin tocar** las entradas existentes (añade `inventoryLineCancelInvariantSql()` y su entrada leyendo `supabase/tests/inventory_line_cancel_invariants.sql`).
2. **Prueba SQL** `supabase/tests/inventory_line_cancel_invariants.sql`: siembra orden + consumo (como en `inventory_sale_consumption_invariants.sql`), cancela una línea con el wrapper, exige `status='saved'`, saldo repuesto y `sale_reversal` con `compensates_movement_id`; un segundo intento devuelve `replayed` y no duplica el reverso.
3. **API**:
   - `captures.ts`: las dos consultas pasan a `app_private.confirm_capture_draft_v3_with_inventory(...)` con los mismos argumentos.
   - `orders.ts`: cancelación de línea → `persist_order_item_cancellation_with_inventory`; cancelación de orden → `cancel_order_with_inventory`, mismos argumentos y mismo parseo de resultado (no cambies contratos ni mensajes).
4. **Pruebas del API**: actualiza las que asertan la sentencia SQL (búsquedas por substring tipo `database.queries[0].sql.includes(...)`) y añade una aserción por cada punto que fije el nombre de la función nueva y el número de parámetros.

## Prohibido
- No edites `20261126000500` ni las funciones `confirm_capture_draft_v3`/`cancel_order`/`persist_order_item_cancellation`.
- No ejecutes PostgreSQL (el orquestador corre `verify:inventory-schema:rollback` y `test:http:local`). Sin commit/push/dependencias.

## Puertas (Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
$ErrorActionPreference='Continue'
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/api typecheck
& $PNPM --filter @super-restaurant/api lint
& $PNPM --filter @super-restaurant/api test
```

## Hecho cuando
Tres puntos cableados, migración y prueba SQL nuevas, pruebas del API actualizadas; typecheck/lint/test verdes con salida real; informe con archivos, decisiones y `git status --short`.
Aplica Ponytail: cambio mínimo correcto, sin recortar validación, seguridad ni pruebas.
