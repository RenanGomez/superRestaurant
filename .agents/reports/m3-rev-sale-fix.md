I'll read the two files under review.
Now let me verify the underlying `confirm_capture_draft_v3` and `cancel_order` result shapes and auto-cancel audit behavior.
TAREA: m3-sale-sql-fix · re-revisión nivel A
VEREDICTO: CORREGIR
1. Cubierto: los pasos cocina fijan `cancellationAudit.eventId=v_step_event` (cancel_order.sql:253) y la línea pendiente el evento de comando (cancel_order.sql:334); el helper une ambos y el wrapper filtra por ese conjunto (20261126000500_inventory_sale_consumption.sql:343-361,451-458).
2. Cubierto: `confirm_capture_draft_v3_with_inventory` toma scope/orden de `{record,detail,scope,*} / {record,detail,confirmedOrderId}` y falla cerrado con `55000` (…:386-400); esas rutas existen (20260916000200:55-58, 20261123000500:104).
3. P2 [prueba vacua]: la línea pendiente usa `no_recipe_product` (inventory_sale_consumption_invariants.sql:518), así que su reverso por el paso de orden no se puede observar: da 0 movimientos/filas se cubra o no, y pasaría igual si el wrapper ignorara el evento de comando. Usar un producto con receta para `pending_item` y asertar sus reversos; dejar otro ítem sin receta para el caso skip.
4. P3: aserción débil `visible < 2` (…invariants.sql:447); `movements` cuenta duplicados en replay (…20261126000500:176,194,321); la fila `cancel` toma el almacén del primer movimiento (…:289-297,329) y el reverso fallaría si ese almacén quedó inactivo (20261126000200:176-178).
5. Sin otro P1/P2 de código; el camino `applied` del wrapper de confirmación queda diferido a `m3-int-sale-to-stock` con cableado en `m3-sale-wire`, según el brief.
VERIFICACIÓN:
```
$ Get-Content supabase/tests/inventory_sale_consumption_invariants.sql | Select-Object -Skip 514 -First 7; Get-Content supabase/migrations/20261007000400_cancel_order.sql | Select-Object -Skip 330 -First 5
        'orderItemId', pending_item::text,
          'productId', no_recipe_product::text, 'geometry', 'whole', 'stationId', 'kitchen'
                or n.value -> 'cancellationAudit' ->> 'eventId' <> v_event::text
```
NO VERIFICADO: ejecución real de `supabase/tests/inventory_sale_consumption_invariants.sql` (el brief prohíbe PG); conclusiones solo por lectura.