I'll review the diff against the actual codebase contracts. Starting with the ledger function and movement schema the new migration depends on.
VEREDICTO: CAMBIOS

P1 supabase/migrations/20261126000400_inventory_purchasing.sql:121 `inventory_create_purchase_order` no es idempotente: el payload sólo admite supplierId/currency/orderedAt/lines (:188), no hay idempotencyKey ni dedupe, y el id lo genera el servidor. Un reintento del cliente crea otra orden con líneas nuevas; al recibir ambas, `receipt:<order>:<line>` (:450) inserta movimientos distintos y duplica stock/costo. Prueba: `idempotency_matches=0` en la migración y el test sólo llama create una vez por payload.
P1 supabase/tests/inventory_purchasing_invariants.sql:147 prueba cantidad decimal/cero/negativa pero no `unitCostMinor` negativo/decimal ni moneda inválida; el invariante de dinero (coste entero no negativo, moneda ISO) queda sin probar. Prueba: todos los `unitCostMinor` del test son enteros positivos (250,75,1,1,1,1,10) y currency siempre `MXN`.
P1 supabase/tests/inventory_purchasing_invariants.sql:132 prueba ítem de otro restaurante pero no proveedor de otro restaurante en create; el chequeo `INVENTORY_PURCHASE_SUPPLIER_SCOPE_INVALID` (migración:213-231) no se ejerce. Prueba: `foreign_supplier` sólo se usa en un create de su propio tenant r2/b2 (:337).
P1 supabase/tests/inventory_purchasing_invariants.sql:255 la recepción no verifica auditoría: no se afirma `mv.actor_id`/`mv.device_id`, y `inventory_purchase_orders` no tiene `received_by` (sólo `created_by`, migración:38). El actor/device de la recepción queda sin prueba (sólo se valida coste/moneda).
P2 supabase/migrations/20261126000400_inventory_purchasing.sql:83 el trigger sólo estampa coste; `app_api` conserva EXECUTE en `inventory_record_movement` y puede insertar un movimiento `source_type='purchase_order_line'` con ítem/cantidad arbitrarios (sin pasar por receive). Por `inventory_movements_source_unique` eso además puede bloquear la recepción legítima con 23505.
P3 supabase/migrations/20261126000400_inventory_purchasing.sql:62 una línea duplicada (order_id,item_id,unit_code) devuelve 23505 crudo en vez de 22000 y no hay test que lo fije.

```text
PS> git show harness/m3-sql-purchasing:supabase/migrations/20261126000400_inventory_purchasing.sql | Select-String -Pattern "idempotency" -SimpleMatch | Measure-Object | ForEach-Object { 'idempotency_matches=' + $_.Count }
idempotency_matches=0
PS> git show harness/m3-sql-purchasing:supabase/tests/inventory_purchasing_invariants.sql | Select-String -Pattern "unitCostMinor" | ForEach-Object { $_.Line.Trim() }
'unitCode', 'g', 'unitCostMinor', 250),
'unitCode', 'ml', 'unitCostMinor', 75)
... 'unitCostMinor', 1)   (todas las demás apariciones son 1 o 10)
PS> git show harness/m3-sql-purchasing:supabase/tests/inventory_purchasing_invariants.sql | Select-String -Pattern "foreign_supplier"
(line 337) 'supplierId', foreign_supplier,   <-- dentro del create de r2/b2
```
NO VERIFICADO: no ejecuté el harness Postgres local (`verify:inventory-schema:rollback` requiere cluster desechable); la revisión es estática con `git show` sobre la rama.