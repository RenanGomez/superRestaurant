# Brief debt-compras-reads

NO escribas archivos fuera del repo ni en `$env:TEMP`: sandbox de rutas limitado al worktree. Temporales solo en `.harness/state/tmp/` y bórralos. NO ejecutes PostgreSQL, psql ni Playwright (el orquestador los corre). NO commitees, NO hagas push, NO instales dependencias.

## Objetivo
Que las **lecturas** de proveedores y órdenes de compra usen el permiso `catalog.read` (no `catalog.manage`), con pruebas de aislamiento; las escrituras siguen en `catalog.manage`.

Tiempo estimado: 25 min

## Alcance (únicos archivos que puedes editar)
- `apps/api/src/inventory/purchasing.service.ts`
- `apps/api/src/inventory/purchasing.test.ts`

Prohibido: controladores, SQL/migraciones, `packages/shared-types`, UI, `apps/api/package.json`.

## Contexto mínimo
- RBAC en `apps/api/src/auth/rbac-policy.ts`: `viewer` y `auditor` tienen `catalog.read` y **no** `catalog.manage`; `manager` tiene ambos.
- Hoy en `purchasing.service.ts` los tres caminos de lectura exigen `catalog.manage` vía `authorizeRestaurant`/`authorizeBranch` (`rolesGrantPermission(membership.roles, "catalog.manage")` y `this.authorization.authorizeBranch(..., "catalog.manage")`). El arreglo más pequeño: parametrizar el permiso en esos helpers (p. ej. `authorizeRestaurant(principal, restaurantId, permission = "catalog.manage")`) y pasar `"catalog.read"` solo desde `listSuppliers`, `listPurchaseOrders` y `readPurchaseOrder`.
- **`readPurchaseOrder` hoy no autoriza en la capa de servicio**: solo lo filtra la función SQL por actor. Añade el chequeo de lectura con el alcance de la orden devuelta (mismo patrón que `receivePurchaseOrder`, que autoriza la sucursal de la orden), para que un actor de otro restaurante reciba 403 y no un 200/404 engañoso. Si la función SQL devuelve `missing` antes de poder autorizar, mantén el orden que no filtre existencia entre tenants (404 para ajeno está bien solo si el rol no tiene alcance; documenta la decisión en el reporte).
- Escrituras que **no** cambian: `createSupplier`, `updateSupplier`, `createPurchaseOrder`, `receivePurchaseOrder` (+ `readSupplierForManage`, que es de manage).
- `PurchasingApplicationError("authorization")` debe seguir mapeando a 403 en el controlador; no toques el mapeo.

## Hecho cuando
- `listSuppliers`, `listPurchaseOrders` y `readPurchaseOrder` autorizan con `catalog.read`; las cuatro escrituras siguen con `catalog.manage`.
- `purchasing.test.ts` añade pruebas de aislamiento con salida real: (a) principal `viewer` (solo `catalog.read`) lista proveedores y órdenes y lee una orden; (b) principal `viewer` **no** puede crear/editar proveedor ni crear/recibir orden (403); (c) principal de **otro restaurante/sucursal** recibe 403 en lectura de proveedores y de órdenes, y la lectura de una orden ajena no la devuelve; (d) `auditor` también lee.
- `pnpm --filter @super-restaurant/api run typecheck`, `lint` y `test` en 0 (puedes correrlos; no usan PostgreSQL).

## Pruebas (ahorro de cuota)
- Un ciclo de test al terminar; máximo 3 probar→corregir. Filtra salida (`Select-Object -Last 30`).
- Si `purchasing.test.ts` ya tiene dobles para `MEMBERSHIP_DIRECTORY`/`DATABASE_CLIENT`, reutilízalos; no crees un segundo arnés.

## Reporte
`.agents/reports/debt-compras-reads.md` con archivos tocados, decisión sobre el orden autorización/404 en `readPurchaseOrder`, comandos y salida real (bloque ```), y qué queda para el orquestador (PostgreSQL/Playwright). Aplica Ponytail: el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación, errores ni aislamiento.
