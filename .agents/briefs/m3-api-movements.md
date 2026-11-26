# Brief m3-api-movements (nivel A · API de movimientos manuales, transferencia y lectura de saldos)

## Objetivo
Exponer los movimientos manuales de inventario (ajuste, merma, conteo y transferencia entre almacenes) y la lectura de movimientos/saldos, con supervisor/motivo obligatorio y trazabilidad de actor y dispositivo.

Tiempo estimado: 50 min. Escritor único de los archivos listados.

## Alcance
- Crea: `supabase/migrations/20261126000800_inventory_movement_api.sql`, `supabase/tests/inventory_movements_api_invariants.sql`, `apps/api/src/inventory/movements.service.ts`, `apps/api/src/inventory/movements.controller.ts`, `apps/api/src/inventory/movements.test.ts`.
- Edita: `apps/api/package.json` (añade `node .test-dist/inventory/movements.test.js` a `scripts.test`, junto a `items.test.js`), `apps/api/src/app.module.ts` (registra `MovementsController` y `MovementsService` **directamente**, igual que `ItemsController`/`ItemsService`; el repo no usa `imports` de módulos), `apps/api/src/app.smoke.test.ts` (assert 401 en las rutas nuevas), `apps/api/src/operations/inventory-schema-verification.ts` y `run-inventory-schema-verification.ts` (registra migración y test **sin tocar** las entradas existentes).
- Prohibido: ejecutar PostgreSQL (lo hace el orquestador), otras apps, dependencias, commit/push.

## Contratos existentes (no los cambies)
`packages/shared-types/src/inventory.ts`: `InventoryMovementV1`, `InventoryMovementRequestV1`, `InventoryBalanceV1`, `INVENTORY_MOVEMENT_KINDS`, y el parser disponible (`parseInventoryMovementRequestV1`; comprueba su nombre exacto en el archivo y en `index.ts`). Reutiliza el parser; no dupliques validación.

## Qué construir
1. **Migración 00800** (patrón `app_private` del repo: `security definer`, `search_path=''`, dueño `postgres`, `revoke all` + `grant execute` solo a `app_api`):
   - `app_private.inventory_transfer(p_actor_id, p_restaurant_id, p_branch_id, p_from_warehouse_id, p_to_warehouse_id, p_item_id, p_quantity integer, p_unit_code, p_reason, p_idempotency_key, p_device_id) returns jsonb` — valida membresía con rol `owner|admin|manager`, almacenes de la misma sucursal y activos, cantidad positiva; genera un `transfer_pair_id` y llama dos veces a `app_private.inventory_record_movement` (`transfer_out` con delta negativo y `transfer_in` positivo; claves `p_idempotency_key || ':out'` y `':in'`; `source_type='inventory_transfer'`, `source_id=transfer_pair_id`). Replay con las mismas claves devuelve `duplicate` sin mover stock. Devuelve `{status, transferPairId, movements:[...]}`.
   - `app_private.list_inventory_movements(p_actor_id, p_restaurant_id, p_branch_id, p_warehouse_id uuid default null, p_item_id uuid default null, p_limit integer default 100) returns table (id uuid, restaurant_id uuid, branch_id uuid, warehouse_id uuid, item_id uuid, kind text, quantity_delta integer, unit_code text, occurred_at timestamptz, actor_id uuid, reason text, idempotency_key text, compensates_movement_id uuid, transfer_pair_id uuid, unit_cost_minor bigint, currency text, recipe_version_id uuid, rounding_remainder integer)` — membresía activa en `(restaurant, branch)`, solo lectura, orden `occurred_at desc, id`, `limit` entre 1 y 200.
   - `app_private.list_inventory_balances(p_actor_id, p_restaurant_id, p_branch_id, p_warehouse_id uuid default null) returns table (warehouse_id uuid, item_id uuid, quantity integer, updated_at timestamptz)` — membresía activa, solo lectura, orden por `warehouse_id, item_id`.
   - **No redefinas** `inventory_record_movement` ni `inventory_consumptions`.
2. **API** con la estructura de `apps/api/src/inventory/items.{service,controller,module}` (mismo estilo de DI, guards, DTOs y errores):
   - `POST /api/v1/inventory/movements`: cuerpo = `InventoryMovementRequestV1` sin `actorId` (lo pone el servidor) y sin `id`/`occurredAt`. Acepta `adjustment`, `waste`, `count_adjustment` llamando a `app_private.inventory_record_movement` con `source_type='inventory_manual'`, `source_id=gen_random_uuid()`; y `transfer_out`/`transfer_in` a través de `inventory_transfer` (una sola llamada, sin que el cliente mande el par). Motivo obligatorio para ajuste/merma/conteo (el SQL ya lo exige; devuelve 400 con código legible). Permiso `catalog.manage`; actor y `deviceId` del contexto.
   - `GET /api/v1/inventory/movements?restaurantId&branchId&warehouseId?&itemId?&limit?` y `GET /api/v1/inventory/balances?restaurantId&branchId&warehouseId?`: lectura con `catalog.read`, mismo patrón de autorización que `items.service`.
   - Mapea `23514`→400, `23503`→409, `42501`→403 y `22000`→400; el resto 503.
   - Crea `movements.controller.ts` (sin `movements.module.ts`: registra el controlador y el servicio en `AppModule`, como `Items`; puedes omitir el `.module.ts` para no dejar archivos huérfanos). No toques `items.*`.
3. **Pruebas**:
   - API (`movements.test.ts`, mismo doble de base de datos que `items.test.ts`): autorización por rol, validación del cuerpo, una llamada por operación con el nombre de función y parámetros correctos (incluido `source_type`), mapeo de errores y aislamiento por restaurante/sucursal.
   - SQL (`inventory_movements_api_invariants.sql`, transacción + `rollback;`): transferencia mueve el stock de un almacén al otro y deja dos movimientos con el mismo `transfer_pair_id`; replay no duplica; actor sin rol manage ⇒ `42501`; almacén de otra sucursal ⇒ `22000`; `list_inventory_movements`/`list_inventory_balances` filtran por membresía y no ven otro restaurante; `limit` fuera de rango no rompe (usa el default o falla con 22000, elige y pruébalo).

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
Migración + servicio/controlador/módulo + pruebas + registros aplicados; typecheck/lint/test API verdes con salida real; informe con archivos, decisiones (transferencia atómica, límites) y `git status --short`. Sin commit ni push.
Aplica Ponytail: cambio mínimo correcto, sin recortar validación, seguridad ni pruebas.
