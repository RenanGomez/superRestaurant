VEREDICTO: CORREGIR

**P2 · `supabase/migrations/20261126000400_inventory_purchasing.sql:406-409`** — el handler `when unique_violation` no distingue la constraint violada. Un payload con líneas duplicadas (misma `item_id`+`unit_code`, que viola `inventory_purchase_order_lines_unique` en `:83`) se reintenta una vez y termina relanzando un **23505 crudo** en vez de `22000 INVENTORY_PURCHASE_LINE_INVALID`. Corrección: detectar duplicados `(item_id, unit_code)` en el bucle de forma (`:253-308`) y lanzar 22000; o en el handler leer `GET STACKED DIAGNOSTICS ... = CONSTRAINT_NAME` y solo reintentar si es `inventory_purchase_orders_restaurant_idempotency_unique`; en otro caso relanzar 22000 `INVENTORY_PURCHASE_LINE_INVALID`.

**P2 · `...:319-348`** — el lookup/replay por `(restaurant_id, idempotency_key)` no compara `branch_id`: una llamada de la sucursal B con la misma clave y `supplier/currency/líneas` idénticos devuelve como replay la orden de la sucursal A. Corrección: exigir `v_existing.branch_id = p_branch_id` para el replay; si no coincide, `INVENTORY_PURCHASE_IDEMPOTENCY_CONFLICT`.

**P3 · `...:335-336`** — el SELECT de líneas filtra solo por `order_id`; añadir `and l.restaurant_id = p_restaurant_id` (defensa en profundidad).

Lo demás del brief es correcto: replay idéntico devuelve la orden sin insertar (`:325-348`), multiconjunto orden-independiente por `jsonb_agg(... order by ...::text)` y sin `orderedAt` (`:310-312, :326-341`), carrera resuelta por unique+reintento (`:316-411`), y `unitCostMinor`/`idempotencyKey`/moneda/proveedor validados como enteros/antes de insertar (`:216-249, :277-298, :354-369`).

Verificación (solo lectura):
```
> Select-String -Path "supabase/migrations/20261126000400_inventory_purchasing.sql" -Pattern "inventory_purchase_order_lines_unique|idempotency_unique|when unique_violation|for update"
49: constraint inventory_purchase_orders_restaurant_idempotency_unique unique (restaurant_id, idempotency_key),
83: constraint inventory_purchase_order_lines_unique unique (order_id, item_id, unit_code),
323: for update;
406: exception when unique_violation then
448: for update;
```
NO VERIFICADO: ejecución en PG y rama de concurrencia real (brief prohíbe correr tests/PG; solo se leyó el diff y el archivo).