# Brief m3-sale-sql-fix (nivel A · P1/P2/P3 de las dos revisiones del consumo por venta)

## Objetivo
Corregir `supabase/migrations/20261126000500_inventory_sale_consumption.sql` y `supabase/tests/inventory_sale_consumption_invariants.sql` según las revisiones:
- el reverso debe cubrir las líneas de cocina canceladas en pasos previos (eventId derivado), no solo `command.eventId`;
- el almacén no lo elige el llamador: la sucursal declara un almacén por defecto (`is_default`) y la venta se salta el consumo si no hay ninguno;
- ids de la orden tomados del `v_result` autoritativo, no del `p_order` del cliente;
- fila `sale`/`cancel` en `app.inventory_consumptions` solo cuando hubo movimientos;
- un solo prefijo de advisory lock para consumo y reverso;
- pruebas nuevas: cancelación real por envoltorio (`saved`), ceil con cantidad impar, dos mitades que comparten insumo, aislamiento solo por sucursal, fila r2 real, consulta de replay consistente y skip sin almacén.

Tiempo estimado: 40 min. Único escritor de esos dos archivos. **No** toques `apps/**` (el cableado va en otra tarea).

## Cambios exactos
1. **Almacén por defecto.** `alter table app.inventory_warehouses add column is_default boolean not null default false;` + índice único parcial `(restaurant_id, branch_id) where is_default and active`. Añade a `inventory_consume_order` la resolución interna: si `is_default` activo existe en `(restaurant, branch)` se usa; si no existe, devuelve `{"status":"skipped","reason":"no_default_warehouse","movements":0}` sin mover stock. **Quita el parámetro `p_warehouse_id`** de `inventory_consume_order`, de `inventory_reverse_order_item` (el almacén sale del movimiento original) y del envoltorio de confirmación.
2. **Envoltorio de confirmación** `app_private.confirm_capture_draft_v3_with_inventory(p_actor_id uuid, p_command jsonb, p_order jsonb, p_order_audits jsonb) returns jsonb` (4 argumentos): llama a `confirm_capture_draft_v3`, y solo con `status='applied'` consume. Toma `restaurantId`/`branchId`/`orderId` del **resultado** (`v_result #>> '{order,restaurantId}'`, etc., según la forma real de `v_result`); si no existen o no son UUID, lanza `55000 INVENTORY_ORDER_REFERENCE_INVALID` (no consumas una orden distinta).
3. **Reverso con pasos.** `app_private.cancel_order_with_inventory(p_actor_id uuid, p_command jsonb, p_steps jsonb)` pasa también `p_steps` a un helper que arma el conjunto de eventos de la cancelación: `command.eventId` **más** `p_steps[i].audit.eventId` (los pasos de línea usan `p_audit -> 'eventId'`; ver `20261007000400_cancel_order.sql:200-262`, donde cada línea cancelada guarda `cancellationAudit.eventId = step.audit.eventId`). Revierte cada línea del resultado cuyo `cancellationAudit.eventId` esté en ese conjunto. Reutiliza el advisory lock `inventory-consumption:<orderId>` también en el reverso.
4. **Auditoría simétrica.** En consumo, inserta la fila `cause='sale'` solo si se generó al menos un movimiento (si la receta es inexistente no hay fila). En reverso, inserta/actualiza `cause='cancel'` solo si se generó al menos un `sale_reversal`. Mantén el único `(restaurant_id, order_id, order_item_id, cause)`.
5. **Replay coherente.** En la prueba, la consulta de replay debe incluir `compensates_movement_id is not null` igual que la primera.
6. **Sin cambios** en `inventory_record_movement`, en las funciones de confirmación/cancelación vigentes ni en sus grants.

## Pruebas (mismo archivo, transacción + `rollback;`)
- **Cancelación real por envoltorio (P1):** siembra una orden `open` con una línea `pending` (como ya hace el test), ejecuta `inventory_consume_order` para generar consumo, arma `p_command` (claves exactas de `cancel_order`: `schemaVersion,scope,orderId,expectedVersion,eventId,idempotencyKey,deviceId,occurredAt,reason`) y `p_steps` con el **paso de orden** (audit `order.state_changed`, `from`=status actual, `to='cancelled'`, `automaticallyCancelledOrderItemIds` = ids pendientes, `cancellationAudit` en la orden) y llama a `cancel_order_with_inventory`. Exige `status='saved'`, el saldo repuesto al inicial, un `sale_reversal` con `compensates_movement_id` y la fila `cause='cancel'`. Si el paso exacto resulta inabordable, para y repórtalo con la salida real en vez de inventar.
- **Eventos de pasos de cocina:** prueba al menos el helper/conjunto de eventos con un `p_steps` que contenga un `audit.eventId` distinto del comando y una línea `sent` con ese `cancellationAudit.eventId`, verificando que el reverso la incluye (puede ser una llamada directa al helper si el paso completo es inviable; dilo).
- **Ceil impar:** receta 121 → 61 por mitad (`(121+1)/2`), no 60.
- **Mitades que comparten insumo:** ambas mitades con el mismo `item_id` y verifica un único movimiento con la suma agregada.
- **Aislamiento por sucursal:** actor manager del mismo restaurante pero otra sucursal no consume ni revierte (usa una fixtura de segunda sucursal).
- **r2 no vacuo:** inserta una fila de consumo en el otro restaurante y confirma que `authenticated`/`app_api` no la lee por la política de la tabla.
- **Skip sin almacén por defecto:** sin `is_default`, `inventory_consume_order` devuelve `skipped` y no hay movimientos; con `is_default`, consume.
- **Envoltorio de confirmación:** mantén el gating `null`→`rejected`; el camino `applied` completo queda para `m3-int-sale-to-stock` (anótalo en el informe).

## Puertas (Node 24.19.0)
No ejecutes PostgreSQL (el orquestador corre `verify:inventory-schema:rollback`). Ejecuta typecheck y lint del API:
```powershell
. .\tools\agentic\use-node24.ps1
$ErrorActionPreference='Continue'
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/api typecheck
& $PNPM --filter @super-restaurant/api lint
git diff --check
```

## Hecho cuando
Migración y test corregidos con los puntos 1–6; informe con decisiones (forma del paso de orden, helper de eventos), bloques comando+salida y `git status --short`. Sin commit ni push.
Aplica Ponytail: cambio mínimo correcto, sin recortar validación, seguridad ni pruebas.
