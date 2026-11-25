# Brief m3-api-items (nivel B · API de insumos y almacenes)

## Objetivo
Endpoints de insumos y almacenes de inventario, con scope por restaurante/sucursal y contratos compartidos.

Tiempo estimado: 30 min.

## Alcance
- Crea: `apps/api/src/inventory/items.service.ts`, `apps/api/src/inventory/items.controller.ts`, `apps/api/src/inventory/items.module.ts`, `apps/api/src/inventory/items.test.ts`.
- Edita: `apps/api/package.json` (solo registrar `items.test.js` en `scripts.test`).
- Prohibido: `app.module.ts` (lo cablea `m3-api-wire`), migraciones, `packages/**`, otras apps, dependencias. Sin commit ni push; sin salir del worktree.

## Contexto y firmas
- Tablas: `app.inventory_items` (id, restaurant_id, sku, name, unit_code, purchase_unit_factor, min_quantity, active, timestamps, deleted_at) y `app.inventory_warehouses` (id, restaurant_id, branch_id, name, active).
- Contratos: `packages/shared-types/src/inventory.ts` exporta `InventoryItemV1`, `InventoryWarehouseV1`, `parseInventoryItemV1`, `parseInventoryWarehouseV1`, `INVENTORY_UNITS`.
- Patrón del repo: mira `apps/api/src/delivery-zones.ts` (servicio + controlador en el mismo archivo) y `apps/api/src/auth/authentication.ts` (`getAuthenticatedPrincipal`, `parseBearerAuthorization`, `RateLimited`). Usa `@Inject(DATABASE_CLIENT)` y `TransactionalDatabaseClientPort` de `../database.js`.
- Convención HTTP: `@Controller()`, rutas `inventory/items`, `inventory/warehouses`, `@RateLimited({ limit: 120, windowMs: 60_000 })`, `@Header("Cache-Control","private, no-store")`, `@HttpCode` donde aplique.

## Qué construir
1. `GET /api/v1/inventory/items?restaurantId=...` y `GET /api/v1/inventory/warehouses?restaurantId=&branchId=`: lista con scope autorizado (rechaza scope ajeno con 403 `ACTION_NOT_AUTHORIZED`).
2. `POST /api/v1/inventory/items` y `POST /api/v1/inventory/warehouses`: crea validando con los parsers de shared-types (sin `id`, que lo genera la base), devuelve el recurso.
3. `PATCH /api/v1/inventory/items/:id` (name, sku, minQuantity, active, purchaseUnitFactor) y `PATCH /api/v1/inventory/warehouses/:id` (name, active). Nada de borrado físico: `active=false` o `deleted_at`.
4. Servicio con transacción por operación, SQL parametrizado (`$1`, `$2`…), y scope derivado del principal (nunca del body). Sin `SELECT *` en respuestas al cliente: columnas explícitas.
5. Pruebas (`node:test` + `node:assert/strict`, dobles de `DATABASE_CLIENT` como en `apps/api/src/delivery-zones.test.ts`): scope ajeno → 403; payload inválido → 400 `INVENTORY_REQUEST_INVALID`; creación devuelve el recurso; lista filtra por scope.

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/shared-types build
& $PNPM --filter @super-restaurant/domain build
& $PNPM --filter @super-restaurant/api lint
& $PNPM --filter @super-restaurant/api typecheck
Push-Location apps/api
& $PNPM exec tsc --project tsconfig.test.build.json
node .test-dist/inventory/items.test.js
Pop-Location
```

## Hecho cuando
Endpoints y pruebas en verde con salida real; lint/typecheck api verdes; `git diff --check` limpio.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con archivos, rutas exactas y bloques comando + salida real.
Aplica Ponytail: cambio más pequeño correcto, reutiliza patrones existentes, sin recortar validación, seguridad ni pruebas.
