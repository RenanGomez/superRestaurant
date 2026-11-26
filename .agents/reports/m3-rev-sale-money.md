I'll read the specified files and perform the review.
VEREDICTO: CORREGIR

**Hallazgos (archivo:línea)**
- **P1** `supabase/migrations/20261126000500_inventory_sale_consumption.sql:426` — el reverso filtra solo `cancellationAudit.eventId = command.eventId`, pero las líneas de cocina se cancelan en pasos previos con un eventId derivado (`apps/api/src/orders.ts:646`; `20261007000400_cancel_order.sql:253`); el paso de orden solo reaudita `pending` (`:333-342`). Resultado: `sent/preparing/ready` nunca se revierten al cancelar la orden (stock queda consumido). Corrección: recibir `p_steps` como `cancel_order` y reversar los ítems cuyo `eventId` esté en `{command.eventId} ∪ {step.audit.eventId}`.
- **P1** Sin cableado: `apps/api/src/captures.ts:560` y `apps/api/src/orders.ts:92` siguen llamando `confirm_capture_draft_v3`/`cancel_order`; `persist_order_item_cancellation` (`orders.ts:89`) no tiene envoltorio de inventario. Ningún `*_with_inventory` tiene consumidor (grep en `apps`/`packages`: 0). Hoy ninguna venta descuenta stock y la cancelación de línea suelta nunca revierte.
- **P2** `migration:363-368` — los ids se toman del `p_order` del llamador, no de `v_result`; si no coinciden con la orden confirmada se consume el stock de otra orden. Validar `v_result->'order'->>'orderId'/'restaurantId'/'branchId'` y fallar si no igualan.
- **P2** `migration:148-154` — inserta la fila `sale` antes de saber si habrá movimientos (producto sin receta → 0 movimientos) y el reverso (`:292`) devuelve `skipped` sin crear la fila `cancel`: auditoría asimétrica. Crear la fila solo si `movements > 0` o registrar el motivo.
- **P3** `migration:120` vs `:278` — locks advisory con prefijos distintos: confirmación y reverso de la misma orden no se serializan.
- **P3** `migration:21-25` — sin FK a la línea de orden (`order_item_id`), solo a `orders`.
- **P3** `supabase/tests/inventory_sale_consumption_invariants.sql:265,267` — los envoltorios solo se invocan con `null`; no se prueba el gating `applied`/`saved` ni el evento derivado.

**Correcto (verificado):** explosión por receta activa con mitades `((rl.quantity+1)/2)*v_quantity` y agregación por insumo, todo entero (`inventory_recipe_lines.quantity integer`, `:43`); idempotencia real por `on conflict (restaurant_id, idempotency_key)` (`inventory_ledger.sql:239-264`) y unicidad de `inventory_consumptions` (`:25`); reverso con `compensates_movement_id` y sin inventar movimientos (`:292-321`); `SECURITY DEFINER`, `search_path=''`, owner postgres, grants solo a `app_api`, RLS forzada con política de lectura por sucursal (`:441-491`).

## Estado
done — revisión de solo lectura completada; 2 P1 bloquean la aprobación.

## Qué hice
- Leí la migración, el diff de verificación y las dependencias (ledger, cancel_order, recipes, API).

## Archivos tocados
- ninguno

## Verificación
```
> git diff -- apps/api/src/operations/inventory-schema-verification.ts apps/api/src/operations/run-inventory-schema-verification.ts
+export function inventorySaleConsumptionInvariantSql(): string { ... }
+  if (!names.includes("20261126000500_inventory_sale_consumption.sql")) throw ...
+    ["sale-consumption", inventorySaleConsumptionInvariantSql()],
> grep -r "confirm_capture_draft_v3_with_inventory|cancel_order_with_inventory" apps
No files found
> apps/api/src/orders.ts:646  eventId: derivedUuid("cancel-order-event", command.eventId, `${command.orderId}:${command.expectedVersion}:${orderItemId}`)
```

## Riesgos / dudas
- ¿El cableado API y el reverso de líneas de cocina entran en esta tarea o en otra? Sin eso la migración es código muerto.

## Notas propuestas
- Los `*_with_inventory` deben aislar el conjunto de eventos de la cancelación (comando + pasos), no solo `command.eventId`.