# Brief m3-api-functions (nivel A · reemplaza los grants directos de `app_api` por funciones `app_private`)

## Por qué (hallazgo P1 de revisión)
Conceder DML directo a `app_api` rompe invitantes fijados del repo: `apps/api/src/operations/app-api-recovery.ts` (predicado `safe` exige que `app_api` **no** tenga USAGE del esquema `app` ni privilegios de tabla) y `supabase/tests/tenancy_memberships_runtime_catalog.sql`. Además `USING(true)` permitiría leer inventario de otro restaurante si se filtra la credencial. ADR-013 §13 manda escrituras por `app_private.*` SECURITY DEFINER. Por eso el P1 de PR #90 se cierra con **funciones**, no con grants.

## Objetivo
1. Crear `supabase/migrations/20261126000600_inventory_api_functions.sql` con 8 funciones `app_private` (patrón del repo: `security definer`, `search_path=''`, dueño `postgres`, `revoke all` y `grant execute` solo a `app_api`).
2. Crear `supabase/tests/inventory_api_functions_invariants.sql`.
3. Reescribir las consultas de `apps/api/src/inventory/items.service.ts` para usarlas (sin DML directo).
4. Mantener los cambios ya hechos: mapeo `23514`→`request`, `23503`→`conflict` y `name` 160 en `packages/shared-types/src/inventory.ts`.

Tiempo estimado: 40 min. Único escritor de esos archivos.

## Funciones (todas `returns table (...)` con esta forma exacta)
Forma ítem: `id uuid, restaurant_id uuid, sku text, name text, unit_code text, purchase_unit_factor integer, min_quantity integer, active boolean`.
Forma almacén: `id uuid, restaurant_id uuid, branch_id uuid, name text, active boolean`.

1. `list_inventory_items(p_actor_id uuid, p_restaurant_id uuid)` — devuelve vacío si el actor no tiene membresía activa en ese restaurante; si la tiene, filas con `deleted_at is null` ordenadas por `name, id`.
2. `read_inventory_item_for_manage(p_actor_id uuid, p_item_id uuid)` — 0 filas si no existe/está borrado; `42501` `INVENTORY_ACTOR_FORBIDDEN` si existe y el actor no tiene rol `owner|admin|manager` activo en su restaurante; si no, 1 fila.
3. `create_inventory_item(p_actor_id uuid, p_restaurant_id uuid, p_sku text, p_name text, p_unit_code text, p_purchase_unit_factor integer, p_min_quantity integer, p_active boolean)` — exige manage en el restaurante (`42501`), inserta y devuelve la fila.
4. `update_inventory_item(p_actor_id uuid, p_item_id uuid, p_sku text, p_name text, p_unit_code text, p_purchase_unit_factor integer, p_min_quantity integer, p_active boolean)` — exige manage (`42501`), 0 filas si no existe/borrado, actualiza `updated_at` y devuelve la fila.
5. `list_inventory_warehouses(p_actor_id uuid, p_restaurant_id uuid, p_branch_id uuid)` — membresía activa en `(restaurant, branch)`, orden `name, id`.
6. `read_inventory_warehouse_for_manage(p_actor_id uuid, p_warehouse_id uuid)` — 0 filas o `42501` como el de ítems.
7. `create_inventory_warehouse(p_actor_id uuid, p_restaurant_id uuid, p_branch_id uuid, p_name text, p_active boolean)`.
8. `update_inventory_warehouse(p_actor_id uuid, p_warehouse_id uuid, p_name text, p_active boolean)`.

Patrón de comprobación de membresía: igual que `app_private.inventory_create_purchase_order` (`app.memberships` + `app.membership_role_grants` con `revoked_at is null`, restaurante no deshabilitado y sucursal activa; roles `owner/admin/manager` para manage).

## Servicio (`apps/api/src/inventory/items.service.ts`)
- Sustituye las constantes SQL por:
  - `select * from app_private.list_inventory_items($1::uuid, $2::uuid)` (actor, restaurantId)
  - `select * from app_private.read_inventory_item_for_manage($1::uuid, $2::uuid)` (actor, itemId)
  - `select * from app_private.create_inventory_item($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::integer,$7::integer,$8::boolean)`
  - `select * from app_private.update_inventory_item($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::integer,$7::integer,$8::boolean)`
  - análogas de almacenes con `(actor, restaurantId, branchId)` / `(actor, warehouseId, name, active)`.
- `createItem`/`createWarehouse` y los `list` conservan su `authorizeRestaurant`/`authorizeBranchScope` de la API (defensa en profundidad); solo cambia la sentencia y se añade `principal.userId` como primer parámetro (mira cómo `AuthenticatedPrincipal` expone el actor; el servicio ya lo usa en autorización).
- `updateItem`/`updateWarehouse`: `readXForManage` con el actor; 0 filas ⇒ `missing`; luego la autorización existente; el merge/validación con `parseInventoryItemV1`/`parseInventoryWarehouseV1` se conserva y el update va a la función.
- En `rows()`: `23505`/`23503` ⇒ `conflict`, `23514` ⇒ `request`, **`42501` ⇒ `authorization`**, resto ⇒ `unavailable`.
- Elimina las constantes de DML directo que queden sin uso; no dupliques helpers.

## Prueba SQL (`inventory_api_functions_invariants.sql`)
Estilo `inventory_catalog_invariants.sql` (usa su patrón de fixtures de restaurante/sucursal/membresías y `auth.users`). Debe comprobar:
1. `has_schema_privilege('app_api','app','USAGE')` es **false** y no hay privilegios de tabla para `app_api` en `inventory_items`/`inventory_warehouses` (el invariante de `app-api-recovery` sigue intacto).
2. `app_api` puede `EXECUTE` las 8 funciones y **no** puede ejecutar `app_private.inventory_record_movement` ni escribir las tablas.
3. Como `app_api`: crear insumo/almacén con actor manager funciona y devuelve la fila; `list` los ve; `read_..._for_manage` los lee; `update` cambia el nombre.
4. Actor sin rol manage (p. ej. `cashier`) ⇒ `42501` al crear y en `read_..._for_manage`.
5. Aislamiento: actor del restaurante A no ve ni actualiza ítems de B (`list` vacío, `read_for_manage` 0 filas, `update` 0 filas).
6. Ítem borrado (`deleted_at`) no aparece en `list` ni en `read_for_manage`.

## Registro en el verificador
`apps/api/src/operations/inventory-schema-verification.ts`: renombra a `inventoryApiFunctionsInvariantSql()` leyendo `inventory_api_functions_invariants.sql`.
`run-inventory-schema-verification.ts`: import, `if (!names.includes("20261126000600_inventory_api_functions.sql")) throw new Error("INVENTORY_API_FUNCTIONS_MIGRATION_MISSING")` y entrada `["api-functions", ...]`.

## Prohibido
- No toques `20261126000100…00400`, `app-api-recovery.ts`, `tenancy_memberships_runtime_catalog.sql` ni `inventory_catalog_invariants.sql` (deben seguir exigiendo que `app_api` no tenga acceso directo).
- No ejecutes PostgreSQL ni la suite (el orquestador corre el verificador). Sin commit/push/dependencias.

## Puertas (Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
$ErrorActionPreference='Continue'
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/api typecheck
& $PNPM --filter @super-restaurant/api lint
& $PNPM --filter @super-restaurant/api test
git diff --check
```

## Hecho cuando
Migración + test + servicio + registro aplicados; typecheck, lint, test API y `git diff --check` verdes con salida real. Informe con archivos, mapeo de errores y `git status --short`.
Aplica Ponytail: cambio mínimo correcto, sin recortar validación, seguridad ni pruebas.
