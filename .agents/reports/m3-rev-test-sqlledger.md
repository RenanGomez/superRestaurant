VEREDICTO: CAMBIOS
P1 supabase/migrations/20261126000200_inventory_ledger.sql:203-206 <replay con la misma idempotency_key y `warehouse_id`/`branch_id`/`source` distintos devuelve `duplicate` sin registrar el movimiento (solo compara kind/item/delta/reason); el saldo del segundo almacen nunca se crea y se reporta exito> <no hay prueba: el unico replay del test varia `quantity_delta` 999 en inventory_ledger_invariants.sql:104>
P1 supabase/tests/inventory_ledger_invariants.sql:20,47,50 <`foreign_item` y `foreign_warehouse` se declaran e insertan pero nunca se usan; `INVENTORY_WAREHOUSE_SCOPE_INVALID` (:169) e `INVENTORY_ITEM_SCOPE_INVALID` (:178) no tienen ninguna prueba> <grep del archivo: 0 coincidencias de ambos codigos; solo se prueba actor ajeno (:148)>
P1 supabase/migrations/20261126000200_inventory_ledger.sql:255-263 <`revoke all`/`grant select`/`grant execute` no se verifican: no hay `has_table_privilege` ni `has_function_privilege` para authenticated/app_api/anon/service_role> <grep del test: 0 coincidencias de has_table_privilege/has_function_privilege/app_api (el test de catalogo si las tenia)>
P2 supabase/tests/inventory_ledger_invariants.sql:146-157 <rutas de revocacion (`m.revoked_at`, `rg.revoked_at`) sin prueba; solo se prueba actor de otro restaurante, no membresia/rol revocado> <no existe fixture de revocacion en el archivo>
P2 supabase/migrations/20261126000200_inventory_ledger.sql:46 <`inventory_movements_source_unique` nunca se ejerce; el test no envia `source_type`/`source_id`, asi que el dedupe por origen no esta probado ni su error 23505> <grep del test: 0 coincidencias de source_type/source_id>
P2 supabase/tests/inventory_ledger_invariants.sql:87-99 <doble envio solo secuencial; no hay dos transacciones concurrentes con la misma key, que es donde el `on conflict do nothing` puede fallar> <no hay segundo cliente/conexion en el test>
P3 supabase/tests/inventory_ledger_invariants.sql:66,97 <RLS de `inventory_balances` no se prueba (solo se lee como postgres); tampoco se valida que `compensates_movement_id` (:21) pertenezca al mismo restaurante/almacen/insumo> <no hay `set local role` sobre balances ni chequeo de scope del compensado>

Prueba adversarial (NO EJECUTADA: modo plan solo-lectura impide crear cluster/archivos; la logica se demuestra leyendo las lineas citadas):
```sql
-- dentro de transaccion con rollback y fixtures del test
select app_private.inventory_record_movement(actor,r,b,warehouse,item,'receipt',10,null,'k-cross',null,null,null,now(),null);
select app_private.inventory_record_movement(actor,r,b,otro_warehouse,item,'receipt',10,null,'k-cross',null,null,null,now(),null);
-- se esperaria 22000 INVENTORY_IDEMPOTENCY_CONFLICT; el codigo devuelve 'duplicate' (lineas 203-206)
```

Evidencia real (solo lectura):
```
$ git show harness/m3-sql-ledger:supabase/migrations/20261126000200_inventory_ledger.sql | Select-String -Pattern "v_existing\."
203: if v_existing.kind <> p_kind
204: or v_existing.item_id <> p_item_id
205: or v_existing.quantity_delta <> p_quantity_delta
206: or v_existing.reason is distinct from p_reason

$ git show harness/m3-sql-ledger:supabase/tests/inventory_ledger_invariants.sql | Select-String -Pattern "has_table_privilege|has_function_privilege|INVENTORY_WAREHOUSE_SCOPE_INVALID|INVENTORY_ITEM_SCOPE_INVALID|source_type|source_id|app_api"
158: execute 'set local role authenticated';
164: execute 'set local role authenticated';
(sin coincidencias de privilegios, scope-invalid, source_type ni app_api)
```
NO VERIFICADO: ejecucion del verificador `verify:inventory-schema:rollback` y del test adversarial (plan mode solo-lectura); no afirmo que los invariantes pasen en verde.