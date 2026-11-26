VEREDICTO: CAMBIOS
P1 supabase/migrations/20261126000200_inventory_ledger.sql:39 sale_reversal solo exige `compensates_movement_id` no nulo; no hay unicidad/one-shot sobre ese campo ni validación de scope/kind/signo, y el índice source-unique (línea 46) se omite con `source_id` NULL, así que N reversals con keys distintas inflan stock. No probado: test:134 solo cubre el caso null.
P1 supabase/tests/inventory_ledger_invariants.sql:163 falta prueba de aislamiento de `app.inventory_balances`; solo se prueba lectura de movements (160/166), aunque la policy de balances (migration:283) expone stock entre tenants.
P2 supabase/migrations/20261126000200_inventory_ledger.sql:165 valida scope del almacén pero nunca su `active`; el catálogo documenta "Whether the warehouse may receive new movements" y el insumo tampoco valida `active`/`deleted_at` (línea 175) ⇒ se puede postear en almacén/insumo inactivo o borrado.
P2 supabase/tests/inventory_ledger_invariants.sql:118 el test de delta=0 inserta kind 'adjustment' con `reason` NULL, disparando `inventory_movements_reason_required` en vez del check de cero; no demuestra el invariante.
P2 supabase/migrations/20261126000200_inventory_ledger.sql:201 el conflicto de idempotencia compara solo kind/item/delta/reason; misma key con `warehouse_id`/`branch_id` distintos devuelve 'duplicate' apuntando a otro branch y descarta la escritura sin error.
P3 supabase/migrations/20261126000200_inventory_ledger.sql:46 una violación del índice source-unique (otra idempotency_key, mismo source) no se mapea en `ON CONFLICT`, surge 23505 crudo; sin prueba.
P3 supabase/tests/inventory_ledger_invariants.sql:140 sale_reversal no valida signo ni que el target sea `sale_consumption` del mismo tenant (FK `compensates_movement_id` sin scope).
P3 supabase/migrations/20261126000200_inventory_ledger.sql:141 `unit_cost_minor`/`currency` nunca los escribe el único writer (no son parámetros), así que el costo no se puede registrar vía API.

Verificación (salida real):
```
$ git grep -n "w.active\|i.active\|i.deleted_at" harness/m3-sql-ledger -- supabase/migrations/20261126000200_inventory_ledger.sql
NO_ACTIVE_CHECK_IN_LEDGER
$ git grep -n "inventory_balances" harness/m3-sql-ledger -- supabase/tests/inventory_ledger_invariants.sql
66:  select quantity into balance from app.inventory_balances   (rol admin, fuera del bloque authenticated)
97:  select quantity into balance from app.inventory_balances
$ git grep -n "w.id = p_warehouse_id\|i.restaurant_id = p_restaurant_id" harness/m3-sql-ledger -- supabase/migrations/20261126000200_inventory_ledger.sql
165:    where w.id = p_warehouse_id
175:    and i.restaurant_id = p_restaurant_id;
```