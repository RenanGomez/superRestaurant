# Brief m3-default-warehouse (nivel A · almacén predeterminado por sucursal)

## Por qué

La sucursal de desarrollo **no tiene ningún almacén** (`select count(*) from app.inventory_warehouses`
= 0) y la API/UI **no permiten** crear uno marcado `is_default`, así que el consumo por venta se
salta siempre (`inventory_sale_consumption.sql`: «a sale in a branch without a default warehouse is
skipped»). El journey E2E 13 se salta por eso: el flujo venta→stock no se puede probar ni usar.

`app.inventory_warehouses.is_default` ya existe con índice único parcial
`inventory_warehouses_one_default_idx` (`20261126000500:4-8`). Falta exponerlo de punta a punta.

## Diseño exigido

### SQL — migración nueva `supabase/migrations/20261126001300_inventory_default_warehouse.sql`
- No edites migraciones aplicadas. `begin;`/`commit;`.
- Sustituye (drop + create, con el mismo patrón `security definer`, `set search_path = ''`,
  `owner to postgres`, guardia `APP_API_ROLE_REJECTED`) estas funciones añadiendo el parámetro al
  final:
  - `app_private.create_inventory_warehouse(p_actor_id uuid, p_restaurant_id uuid, p_branch_id uuid,
    p_name text, p_active boolean, p_is_default boolean)` → inserta; si `p_is_default` entonces
    primero `update app.inventory_warehouses set is_default = false where restaurant_id = … and
    branch_id = … and is_default` y exige `p_active` (si no, `22000
    INVENTORY_WAREHOUSE_DEFAULT_REQUIRES_ACTIVE`). Devuelve la fila.
  - `app_private.update_inventory_warehouse(p_actor_id uuid, p_warehouse_id uuid, p_name text,
    p_active boolean, p_is_default boolean)` → al marcar default limpia el anterior de la sucursal;
    si `p_active = false` fuerza `is_default = false`.
  - `app_private.list_inventory_warehouses(...)` debe devolver `is_default` (si hoy hace `select *`
    de la tabla, ya sale; confírmalo) y `read_inventory_warehouse_for_manage` ídem.
- `revoke all` de las firmas viejas y nuevas a public/anon/authenticated/service_role y `grant
  execute` solo a `app_api` (mismo criterio que `20261126000600`/`01200`).
- Rechaza nombre vacío y restaurante/sucursal ajenos igual que hoy (no relajes validaciones).

### Contratos `packages/shared-types/src/inventory.ts`
- `InventoryWarehouseV1`: nuevo campo obligatorio `readonly isDefault: boolean` (boolean estricto).
- Create/patch de almacén: `isDefault?: boolean` opcional (create con default `false` en la API;
  patch ausente = sin cambio).
- Actualiza `inventory.runtime.test.ts` con casos de parseo (válido, falta, tipo incorrecto).

### API `apps/api/src/inventory/items.service.ts` (+ `items.controller.ts` si expone claves)
- `insertWarehouseSql`: `create_inventory_warehouse($1..$5::boolean,$6::boolean)`.
- `updateWarehouseSql`: `update_inventory_warehouse($1,$2,$3::text,$4::boolean,$5::boolean)`.
- `WAREHOUSE_CREATE_KEYS`/`WAREHOUSE_PATCH_KEYS` aceptan `isDefault`; `toWarehouse` lo lee de
  `is_default`; patch sin `isDefault` conserva el actual (lee antes con
  `read_inventory_warehouse_for_manage` como ya hace).
- Mapeo de error: `23505` (índice único de default) → `conflict`; `22000` → `request`.
- `items.test.ts`: casos de create/update con y sin `isDefault`, mapeo `23505` y orden de
  parámetros.

### Web `apps/web/src/app/app/inventario/`
- `inventory-workspace.tsx`: en el formulario de almacén, checkbox «Almacén predeterminado para
  consumo por venta» (target ≥ 44 px, texto de ayuda con `FieldHint`), y en el listado una marca
  clara («Predeterminado») para el que lo sea. Al guardar, refresca la lista (solo puede haber uno).
- `actions.ts`: pasa el campo nuevo a las llamadas de crear/editar.
- `apps/web/src/lib/inventory-ui.ts` (+ su test si hay helpers puros): cualquier helper de etiqueta
  va ahí y se prueba.
- Sin `alert/confirm/prompt`; estados de carga/error explícitos; copy en español.

### Verificador
- `apps/api/src/operations/run-inventory-schema-verification.ts`: exige
  `20261126001300_inventory_default_warehouse.sql`.
- Nueva prueba SQL `supabase/tests/inventory_default_warehouse_invariants.sql` y su registro en
  `apps/api/src/operations/inventory-schema-verification.ts` + lista de invariantes del runner:
  - crear dos almacenes y marcar el segundo default deja exactamente uno activo con `is_default`
    para la sucursal;
  - crear otro default lo mueve (el anterior queda `false`);
  - desactivar el default lo deja `is_default = false`;
  - `is_default = true` con `active = false` falla con `22000`;
  - `app_api` puede ejecutar las tres funciones y no tiene DML directo en la tabla.

## Archivos (exactos, único escritor)

- `supabase/migrations/20261126001300_inventory_default_warehouse.sql` (nuevo)
- `supabase/tests/inventory_default_warehouse_invariants.sql` (nuevo)
- `packages/shared-types/src/inventory.ts`, `packages/shared-types/src/inventory.runtime.test.ts`
- `apps/api/src/inventory/items.service.ts`, `items.controller.ts` (si hace falta), `items.test.ts`
- `apps/api/src/operations/inventory-schema-verification.ts`,
  `apps/api/src/operations/run-inventory-schema-verification.ts`
- `apps/web/src/app/app/inventario/inventory-workspace.tsx`,
  `apps/web/src/app/app/inventario/actions.ts`, `apps/web/src/lib/inventory-ui.ts` (+ test)

Prohibido tocar: `apps/web/e2e/**`, `apps/api/src/inventory/movements*`, otras migraciones,
`package.json`, `app.module.ts`, `docs/**`.

## Reglas de la sesión

- No hagas `git commit`, `git push`, ni crees ramas o PRs.
- **No ejecutes PostgreSQL ni Playwright**: el orquestador corre el verificador rollback-only y el
  pase visual. Tú corres typecheck/lint/unitarias de shared-types, API y web.

## Puertas que debes ejecutar

```powershell
. .\tools\agentic\use-node24.ps1
$ErrorActionPreference='Continue'
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/shared-types run build
& $PNPM --filter @super-restaurant/shared-types run test
& $PNPM --filter @super-restaurant/api run typecheck
& $PNPM --filter @super-restaurant/api run lint
& $PNPM --filter @super-restaurant/api run test
& $PNPM --filter @super-restaurant/web run typecheck
& $PNPM --filter @super-restaurant/web run lint
& $PNPM --filter @super-restaurant/web run test
```

## Hecho cuando

Las puertas en verde y el informe `.agents/reports/m3-default-warehouse.md` explica el diseño SQL,
cómo se mueve el único default, qué cubre la prueba SQL y qué falta por verificar (rollback-only y
pase visual los corre el orquestador). Aplica AGENTS §9/§12/§14/§15.
