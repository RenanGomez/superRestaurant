# Brief m3-sql-sale-consumption (nivel A · SQL inventario: consumo por venta y reverso)

## Objetivo
Consumo de inventario ligado a la confirmación de venta y reverso ligado a la cancelación, idempotentes y con prueba de doble envío y de otro tenant.

Tiempo estimado: 40 min. Carril SQL: único escritor de `supabase/migrations/**` y `supabase/tests/**` en esta tarea.

## Alcance
- Crea: `supabase/migrations/20261126000500_inventory_sale_consumption.sql`, `supabase/tests/inventory_sale_consumption_invariants.sql`.
- Edita: `apps/api/src/operations/inventory-schema-verification.ts` y `run-inventory-schema-verification.ts` (añadir la migración y el test).
- Prohibido: editar `confirm_capture_draft_v3` ni `cancel_order` (son migraciones integradas); tocar otras apps; dependencias; remoto; rutas fuera del worktree. Sin commit ni push.

## Fuente de verdad
`docs/adr/ADR-013.md` §2.7, §2.8 y §5 (mapa `m3-map-sale-hooks`). Datos confirmados:
- La confirmación usa `app_private.confirm_capture_draft_v3(uuid,jsonb,jsonb,jsonb)` y persiste las líneas en `app.orders.aggregate->'items'` (`orderItemId`, `snapshot.productId`, `snapshot.modifiers[]`, `snapshot.geometry` `whole|halves`, `quantity` entera). **No existe `app.order_items`.**
- Cancelación: `app_private.cancel_order(uuid,jsonb,jsonb)` y `app_private.persist_order_item_cancellation(...)`; el rastro por línea vive en `item.cancellationAudit`.
- No existe tabla de reembolsos.

## Qué construir
1. `app.inventory_consumptions`: `id`, `restaurant_id`, `branch_id`, `order_id uuid not null`, `order_item_id uuid not null`, `cause text not null check (cause in ('sale','cancel'))`, `warehouse_id`, `created_at`, `created_by`, `source_version integer`. Único `(restaurant_id, order_id, order_item_id, cause)`.
2. `app_private.inventory_consume_order(...)`: recibe el `aggregate` ya persistido (o se relee de `app.orders` dentro de la transacción) y explota las líneas contra `app.inventory_recipe_lines` de la receta activa, soportando `geometry = 'halves'` con multiplicador 1/2 entero. Inserta movimientos `sale_consumption` vía `app_private.inventory_record_movement` con `source_type = 'order_item'`, `source_id = order_item_id`, `idempotency_key = 'sale:' || order_id || ':' || order_item_id`. Sin receta no hay movimiento (no es error). `ON CONFLICT` no duplica.
3. `app_private.inventory_reverse_order_item(...)`: para una línea cancelada, inserta `sale_reversal` por cada `sale_consumption` previo, con `compensates_movement_id`, `idempotency_key = 'cancel:' || order_id || ':' || order_item_id`, y registra la fila en `app.inventory_consumptions` con `cause = 'cancel'`.
4. Disparadores o funciones envoltorio **sin editar las funciones existentes**: crea `app_private.confirm_capture_draft_v3_with_inventory(...)` que llama a `confirm_capture_draft_v3` y, si el resultado no es `replayed`, invoca el consumo; y `app_private.cancel_order_with_inventory(...)` análoga. Documenta en un `COMMENT ON FUNCTION` que la API debe llamar a las variantes con inventario. Si prefieres triggers `AFTER INSERT` sobre `app.order_audit_events`/`app.order_cancellations`, justifícalo en el informe y cubre el mismo comportamiento.
5. RLS + FORCE y sin grants directos.

## Invariantes `supabase/tests/inventory_sale_consumption_invariants.sql`
1. Confirmar una orden con receta descuenta exactamente las cantidades esperadas (una línea simple y una pizza a mitades).
2. Reenviar la confirmación no duplica consumos ni movimientos (misma key).
3. Cancelar la línea repone el saldo exacto y no duplica el reverso al reintentar.
4. Producto sin receta no genera movimientos.
5. Un actor de otro restaurante no puede consumir ni leer (aislamiento).
6. El saldo final tras venta + cancelación es igual al inicial.

## Puertas (obligatorio, Node 24.19.0)
El binario de PostgreSQL local vive fuera del worktree y el sandbox lo rechaza: **no ejecutes el verificador**.
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/api typecheck
& $PNPM --filter @super-restaurant/api lint
```

## Hecho cuando
Migración + invariantes 1–6 + verificador coherentes; `typecheck`, `lint` y `git diff --check` limpios con salida real; informe marca `NO VERIFICADO: PG por orquestador`.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con archivos, decisiones (triggers vs envoltorio), y bloques comando + salida real.
Aplica Ponytail: cambio más pequeño correcto, sin recortar validación, seguridad ni pruebas.
