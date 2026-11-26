## Estado
VEREDICTO: CORREGIR — atomicidad e idempotencia secuencial, scoping y mapeo de errores correctos; quedan P2 de concurrencia y de cobertura en tarea nivel A.

## Qué hice
- Revisión solo-lectura de los 4 archivos indicados, más `20261126000200_inventory_ledger.sql`, `packages/shared-types/src/inventory.ts`, `rbac-policy.ts` y `movements.test.ts` como contexto.
- Verifiqué: `inventory_transfer` es una sola llamada/transacción con dos `inventory_record_movement` (`:out`/`:in`), replay secuencial → `duplicate` sin mover stock; scoping restaurante/sucursal/almacén/ítem en SQL y API; `catalog.manage` (owner/admin/manager) coincide con RBAC (supervisor no lo tiene); lecturas filtran por membresía y `limit` 1..200; 22000/23514→400, 23503/23505→409, 42501→403, resto→503; todo parametrizado `$n`, actor de `principal`, `deviceId` validado UUID.

## Archivos tocados
- ninguno.

## Verificación
- `Select-String supabase\migrations\... -Pattern 'pg_advisory|idempotency_key = p_idempotency_key'` y `Select-String supabase\tests\inventory_movements_api_invariants.sql -Pattern 'foreign_item|ITEM_SCOPE|UNIT_MISMATCH|STATE_INVALID|advisory'`:
```
== lock check (migration) ==
139      and m.idempotency_key = p_idempotency_key || ':out';   # sin pg_advisory
== coverage (SQL test) ==
17   foreign_item uuid := gen_random_uuid();   # solo se usa para sembrar movimiento ajeno (67,80)
```
- NO VERIFICADO: ejecución real en PostgreSQL (el brief prohíbe `PG`).

## Riesgos / dudas
- P2 `20261126000800_inventory_movement_api.sql:136-163`: precheck `:out`/`:in` sin advisory lock (TOCTOU). Dos requests concurrentes con la misma key generan pares distintos; el perdedor choca en `source_id` y devuelve `INVENTORY_IDEMPOTENCY_CONFLICT` 22000→400 en vez de `duplicate`. No duplica stock, pero rompe la idempotencia ante reintento concurrente/offline. Sugerencia: lock por `(restaurant_id, idempotency_key)` como en `sale_reversal` (`20261126000200:200`) o devolver el par existente.
- P2 `supabase/tests/inventory_movements_api_invariants.sql`: faltan casos de aislamiento/atomicidad exigidos en §15 — transfer con `itemId` de otro restaurante (`INVENTORY_ITEM_SCOPE_INVALID`), `INVENTORY_ITEM_UNIT_MISMATCH`, `INVENTORY_TRANSFER_STATE_INVALID` y una prueba de que un fallo en la pata `:in` no deja el `:out` (rollback de un solo lado). `foreign_item` solo se usa para sembrar, nunca como argumento del transfer.
- P3 `movements.service.ts:89-90,167,203` + `movements.controller.ts:80`: `x-device-id` es UUID controlado por el cliente y se persiste como `device_id` sin verificar que pertenezca al actor/sucursal; el actor sí es de servidor.
- P3 `20261126000800:167-174`: no hay guarda de saldo no negativo; un `transfer_out` puede dejar el almacén origen en negativo. Confirmar si es intencional.

## Notas propuestas
- Para transferencias, tratar la idempotencia concurrente con el mismo patrón de advisory lock que ya usa `sale_reversal`; añadir al test SQL los casos de ítem ajeno, unidad y rollback de la segunda pata.