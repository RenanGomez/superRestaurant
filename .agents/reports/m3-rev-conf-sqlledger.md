VEREDICTO: CAMBIOS

P1 supabase/migrations/20261126000200_inventory_ledger.sql:213 el "reverso único" es solo un `exists(...)` TOCTOU sin índice único parcial, sin `FOR UPDATE` y sin advisory lock; dos reversos concurrentes con claves distintas del mismo `sale_consumption` (T1/T2 bajo READ COMMITTED) no ven la fila no confirmada del otro y ambos insertan → doble compensación de stock. Prueba: `git grep` no halla unique/lock sobre `compensates_movement_id` y el test solo lo cubre secuencialmente (tests:319, un único `do $test$`).

P3 supabase/migrations/20261126000200_inventory_ledger.sql:46 un `source_id` duplicado con clave nueva escapa como `23505 unique_violation` crudo (el `ON CONFLICT` apunta solo a `(restaurant_id, idempotency_key)`), rompiendo el contrato `recorded|duplicate|22000` de la función; el test lo fija como `unique_violation` (tests:333), así que el API deberá mapear 23505.

Prueba adversarial propuesta (NO VERIFICADO: modo plan read-only; no puedo crear archivos ni arrancar el clúster PostgreSQL): dos sesiones `psql`/`dblink` concurrentes que, tras insertar `sale_consumption` con delta -30, llamen `inventory_record_movement(...,'sale_reversal',30,...,'rev-A',...,sale_movement)` y `(...,'rev-B',...,sale_movement)` sin commit entre medias; con el esquema actual ambas devuelven `status:'recorded'` y el saldo sube 60. Esperado tras el fix (unique parcial `... on (compensates_movement_id) where kind='sale_reversal'` o `pg_advisory_xact_lock`): la segunda falla con `INVENTORY_REVERSAL_INVALID`/`23505`.

Verificación (evidencia real, solo lectura):
```
> git grep -n "compensates_movement_id" harness/m3-sql-ledger -- supabase | Select-String -Pattern "unique|index|exclude|constraint"
harness/.../20261126000200_inventory_ledger.sql:46:create unique index inventory_movements_source_unique   (solo source; ninguna sobre compensates_movement_id)
> git grep -n -e "x.compensates_movement_id = p_compensates_movement_id" ... harness/m3-sql-ledger
harness/.../20261126000200_inventory_ledger.sql:213:      where x.compensates_movement_id = p_compensates_movement_id
harness/.../tests/inventory_ledger_invariants.sql:319:    raise exception 'second reversal of the same consumption accepted';
```
El resto del diff (inmutabilidad UPDATE/DELETE, idempotencia con unique `(restaurant_id, idempotency_key)` —race-safe—, scope/AAD de actor, RLS FORCE, grants, wiring del verificador) es correcto y sus invariantes 1–8 tienen prueba ejecutable; no encontré más P1.

Siguiente acción mínima: añadir unique parcial sobre `compensates_movement_id` (o `pg_advisory_xact_lock(hashtextextended('inventory-reversal:'||p_compensates_movement_id,0))` como en `20260903000200_create_cash_registers_simple_payments.sql`) y un test de concurrencia de dos sesiones; luego re-ejecutar `verify:inventory-schema:rollback`.