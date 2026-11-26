# Brief m3-api-http-tests (nivel B · contratos HTTP de inventario)

## Objetivo

Escribir el flujo contractual de inventario por HTTP real: autenticación 401, rol 403, validación
400, idempotencia 409, aislamiento entre restaurantes/sucursales y totales calculados por el servidor,
para insumos, almacenes, movimientos/saldos, recetas, proveedores, órdenes de compra y alertas/costos.

Tiempo estimado: 40 min. Eres el **único escritor** de los archivos de la sección «Archivos».

## Archivos (exactos, ninguno más)

1. `apps/api/src/operations/http-flow-inventory-api.ts` (nuevo; exporta `inventoryApiFlow()`).
2. `apps/api/src/http-flow.local.test.ts` (import + una entrada `test(...)`).

Prohibido tocar: `apps/api/package.json`, `apps/api/src/app.module.ts`, controladores, servicios,
`packages/shared-types/**`, `supabase/**`, `apps/web/**`, los demás `http-flow-*.ts` y
`http-test-*.ts`. Si crees que hace falta un helper nuevo, escríbelo **dentro** de
`http-flow-inventory-api.ts`.

## Arnés existente (léelo antes de escribir)

- `apps/api/src/operations/http-flow-inventory.ts` — patrón de referencia (siembra con
  `context.admin.query`, `publishCatalog`, `openShiftAndRegister`, `captureAndConfirm`).
- `apps/api/src/operations/http-test-harness.ts` — `runHttpFlow({databasePrefix, marker, stage}, body)`
  con `context.send(actor, method, path, body)`, `context.scope`, `context.foreignScope`,
  `context.fixtures`, `context.audit()`, `context.check(name)`.
- Actores disponibles (`HTTP_TEST_ACTORS`): `manager`, `cashier`, `courier`, `courier_other`,
  `viewer` (restaurante A), `other_restaurant_manager` (restaurante B).
- El flujo se ejecuta con `pnpm --filter @super-restaurant/api run test:http:local -- --local-disposable-only`
  (cluster PostgreSQL 17 desechable por flujo). **Tú no lo ejecutas**: el orquestador corre esa puerta.
- Usa `databasePrefix: "superrestaurant_http_inventory_api"` y `marker: "LOCAL_HTTP_FLOW_ONLY"`,
  `stage: "http_flow_inventory_api"`. No reutilices el prefijo de otro flujo.

## Cobertura mínima (una `context.check(...)` por bloque)

1. **401 sin sesión:** `GET /inventory/items`, `GET /inventory/warehouses`, `GET /inventory/suppliers`,
   `GET /inventory/purchase-orders`, `GET /inventory/movements`, `GET /inventory/balances`,
   `GET /inventory/alerts`, `GET /inventory/costs`, `GET /inventory/product-costs`,
   `GET /inventory/margins` y `POST /inventory/items`, todos con `context.send(null, ...)` → 401.
2. **403 de rol:** `viewer` (solo lectura) en `POST /inventory/items`, `POST /inventory/suppliers`,
   `POST /inventory/purchase-orders` y `POST /inventory/movements` → 403 con código
   `ACTION_NOT_AUTHORIZED`; y `viewer` sí puede `GET /inventory/items` → 200.
3. **400 de validación:** `POST /inventory/items` sin `name`; `POST /inventory/purchase-orders` con
   `totalMinor` inyectado (el cliente no fija totales); `PATCH /inventory/suppliers/:id` con cuerpo
   vacío; `POST /inventory/purchase-orders/:id/receive` sin `warehouseId`. Todos → 400
   `INVENTORY_REQUEST_INVALID`.
4. **404:** `GET /inventory/purchase-orders/<uuid aleatorio>` → 404 `INVENTORY_NOT_FOUND`.
5. **409 de idempotencia:** crear OC con una clave; repetir **el mismo cuerpo** → 201 con
   `replayed: true` y sin duplicar la orden (`select count(*)` por `context.admin` = 1); repetir la
   misma clave con **otra línea** → 409 `INVENTORY_PURCHASE_IDEMPOTENCY_CONFLICT`.
6. **Totales del servidor:** OC con dos líneas; `totalMinor` de la respuesta y del detalle igual a la
   suma de `quantity * unitCostMinor` (en minor units, sin floats); el detalle devuelve
   `itemName`, `quantity`, `unitCode`, `unitCostMinor` de cada línea; `totalMinor` no cambia si el
   cliente intenta enviarlo (cubierto en 3).
7. **Aislamiento:** `other_restaurant_manager` con el `scope` del restaurante A en
   `GET /inventory/items`, `GET /inventory/suppliers` y `GET /inventory/purchase-orders` → 403
   `ACTION_NOT_AUTHORIZED` (o 404 `INVENTORY_NOT_FOUND` si el servicio resuelve por membresía;
   registra el código real que obtengas) y **nunca** devuelve filas del restaurante A; el detalle de
   una OC de A con ese actor → 403/404 y ningún nombre de proveedor de A en el cuerpo.
8. **Recepción y saldos:** recibir la OC contra el almacén por defecto → 201 `status:"received"` con
   un movimiento por línea; `GET /inventory/balances` refleja la cantidad recibida; `GET /inventory/alerts`
   del insumo con `minQuantity` por encima del saldo lo lista con su déficit; `GET /inventory/costs`
   devuelve el costo medio calculado por el servidor (entero) y `GET /inventory/product-costs` /
   `GET /inventory/margins` responden 200 para un producto con receta publicada por API
   (`POST /inventory/recipes`).
9. **Regresión de insumos/almacenes/recetas:** crear insumo y almacén por API (201), listarlos,
   publicar receta (201) y leerla (`GET /inventory/recipes/:id`), con el alcance correcto.

Si alguna aserción revela un comportamiento distinto del documentado aquí, **no cambies el API**:
ajusta la aserción al comportamiento real y anótalo como hallazgo en el informe.

## Reglas de la sesión

- No hagas `git commit`, `git push`, ni crees ramas o PRs: el orquestador integra.
- **No ejecutes PostgreSQL ni `test:http:local`/`verify:*`**: el orquestador corre esas puertas.
  Puedes y debes ejecutar typecheck, lint y el `test` unitario del API, que compilan el archivo nuevo.
- No edites `dist`, `.next`, `node_modules` ni artefactos.
- Código y textos en español operativo; archivos en **UTF-8 válido**.

## Puertas que debes ejecutar (Node 24.19.0)

```powershell
. .\tools\agentic\use-node24.ps1
$ErrorActionPreference='Continue'
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/shared-types build
& $PNPM --filter @super-restaurant/api typecheck
& $PNPM --filter @super-restaurant/api lint
& $PNPM --filter @super-restaurant/api test
```

`api test` compila `tsconfig.test.build.json`, que incluye `http-flow.local.test.ts` y tu módulo:
es la forma de validar tipos sin ejecutar el flujo. Si `pnpm --filter ... run <script>` sale con
exit 1 sin diagnóstico, ejecuta el `tsc`/`node` del script directamente y revisa la salida real.

## Hecho cuando

`http-flow-inventory-api.ts` cubre los 9 bloques con aserciones explícitas de status y código, está
registrado en `http-flow.local.test.ts`, typecheck/lint/test del API salen en verde con salida real, y
el informe `.agents/reports/m3-api-http-tests.md` lista archivos, decisiones, códigos reales
observados, salida de puertas y `git status --short`.

El orquestador ejecutará `test:http:local` con `LOCAL_POSTGRES_BIN`; deja el flujo limpio y sin
dependencias de estado entre bloques.

Aplica Ponytail (el cambio mínimo que cumple) y AGENTS §15.
