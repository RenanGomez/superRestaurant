I'll perform this read-only review as instructed.
VEREDICTO: APROBAR

## Estado
done — revisión nivel A (solo lectura); sin P1/P2, 3 P3 no bloqueantes.

## Qué hice
- Firmas `app_private.*(p_actor_id, …)` coinciden con las 8 llamadas del servicio (actor primero); no queda DML directo ni SQL muerto; `42501`→authorization(403), `23514`→request(400), `23503/23505`→conflict(409); `updateItem/updateWarehouse` siguen validando el merge con los parsers (mergeItem/mergeWarehouse→parse…V1) y leen con `read_*_for_manage`; los tests cubren 23514→request, 23503→conflict, 42501→authorization y name 160/161.

## Archivos tocados
- ninguno (solo lectura)

## Verificación
```
git show a42591f0:apps/api/src/inventory/items.service.ts | Select-String 'app_private\.(list|read|create|update)_inventory'
const listItemsSql = "select * from app_private.list_inventory_items($1::uuid, $2::uuid)";
const updateInventoryWarehouse = "select * from app_private.update_inventory_warehouse($1::uuid,$2::uuid,$3::text,$4::boolean)";
git show a42591f0:supabase/migrations/20261126000600_inventory_api_functions.sql | Select-String 'create function app_private'
create function app_private.list_inventory_items(p_actor_id uuid, p_restaurant_id uuid)
create function app_private.update_inventory_warehouse(p_actor_id uuid, p_warehouse_id uuid, p_name text, p_active boolean)
```
(NO VERIFICADO: ejecución real de tests/typecheck — el brief declara verde y no se ejecutó aquí.)

## Riesgos / dudas
- P3 `items.service.ts:299` — `42501` genérico→403 puede enmascarar un fallo real de privilegios de BD como "no autorizado".
- P3 `items.test.ts:262` — el caso "foreign restaurant" simula una fila que `read_*_for_manage` nunca devuelve a un no-miembro; en producción esa vía da 404, no 403 (el test no refleja la BD real).
- P3 `list_inventory_*` solo exige membresía, no `catalog.read` (un courier-miembro lo frena el API, no la BD).
- Worktree: la rama principal está en `harness/m3-sql-purchasing` y el cambio vive en `a42591f0` (`harness/m3-api-items`); el commit además toca `apps/api/src/operations/inventory-*verification.ts` y añade `supabase/tests/inventory_api_functions_invariants.sql`, fuera del alcance leído.

## Notas propuestas
- ninguna