VEREDICTO: APROBAR

Hallazgos
- P3 apps/api/src/inventory/movements.controller.ts:44-47 — el guard duplica `movements.service.ts:89-90` (`parseOptionalId` + `deviceId!==undefined && device===undefined` → `request` → mismo 400). La prueba HTTP (movements.test.ts:396-402) pasaría aun sin estas líneas, así que no aísla el cambio; inofensivo y sin header → `undefined` → no valida.
- P3 supabase/tests/inventory_api_functions_invariants.sql:73 — exige `proconfig` = `search_path=`/`search_path=""`, más estricto que «vacío o el esperado»; correcto porque la migración usa `set search_path = ''` (20261126000600:23), que Postgres registra como `search_path=`.

Comprobado
1. ✓ Guard corre antes de `recordMovement` (sin efecto) y usa el código existente `INVENTORY_REQUEST_INVALID` (controller:72).
2. ✓ Sin imports de `items.module` en código (solo docs/reportes); AppModule intacto: `ItemsController` :167, `ItemsService` :284.
3. ✓ Las 8 firmas del array coinciden con `alter function … owner to postgres` (20261126000600:550-557); usan `to_regprocedure`, `prosecdef`, `rolname='postgres'`, `proconfig` y mensaje con nombre.
4. ✓ Diff sin `packages/shared-types` ni migraciones; `recipes.service.ts:211` mapea `23505`→conflict y el test añade el caso sin retirar los demás.

```
$ git diff main...harness/m3-dsh-debt-clean --name-status
D apps/api/src/inventory/items.module.ts
M apps/api/src/inventory/movements.controller.ts
M apps/api/src/inventory/movements.test.ts
M apps/api/src/inventory/recipes.test.ts
M supabase/tests/inventory_api_functions_invariants.sql

$ Select-String ... 'function app_private\.(...)\('
20261126000600_inventory_api_functions.sql:23: set search_path = ''
20261126000600…:118: create function app_private.create_inventory_item(
20261126000600…:550: alter function app_private.list_inventory_items(uuid, uuid) owner to postgres;
```
NO VERIFICADO: ejecución real del bloque SQL (prohibido correr PostgreSQL en esta revisión; solo lectura de migraciones/prueba).