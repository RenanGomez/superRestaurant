# Brief m3-web-compras (nivel C · pestaña «Compras» en /app/inventario)

## Objetivo

Añadir la pestaña **Compras** a `/app/inventario`: listar y dar de alta/editar proveedores, crear
órdenes de compra con clave de idempotencia estable y totales **del servidor**, ver el detalle de
una OC y recibirla contra un almacén con `deviceId`. Nada de dinero calculado en el cliente.

Tiempo estimado: 45 min. Eres el **único escritor** de los archivos de la sección «Archivos».

## Archivos (exactos, ninguno más)

1. `apps/web/src/app/app/inventario/purchasing-panel.tsx` (nuevo, `"use client"`).
2. `apps/web/src/app/app/inventario/actions.ts` (añadir operaciones y lectores; patrón existente).
3. `apps/web/src/app/app/inventario/inventory-workspace.tsx` (pestaña + render del panel).
4. `apps/web/src/lib/inventory-ui.ts` y `apps/web/src/lib/inventory-ui.test.ts` (helpers puros + pruebas).

Prohibido tocar: `apps/web/package.json`, `packages/shared-types/**`, `apps/api/**`, `supabase/**`,
`inventory-modal.tsx`, `movements-panel.tsx`, `recipes-panel.tsx`, `page.tsx`, cualquier migración.
No añadas tipos a `shared-types`: las vistas de proveedor/OC viven **locales** en `actions.ts`
(igual que `RecipeSummaryV1`), con sus propios lectores defensivos.

## API disponible (ya en `main`, no la cambies)

- `GET /api/v1/inventory/suppliers?restaurantId&includeInactive?` → `{schemaVersion:1, restaurantId, includeInactive, suppliers:[{id, restaurantId, name, contact|null, active, createdAt}]}`
- `POST /api/v1/inventory/suppliers` `{restaurantId, name, contact: string|null, active?: boolean}` → 201 `{id, restaurantId, name, contact, active, createdAt}`
- `PATCH /api/v1/inventory/suppliers/:id` `{name?, contact?, active?}` (al menos una clave) → proveedor
- `GET /api/v1/inventory/purchase-orders?restaurantId&branchId&status?&limit?` → `{schemaVersion:1, restaurantId, branchId, orders:[{id, supplierId, supplierName, status, currency, orderedAt, receivedAt|null, receivedBy|null, totalMinor}]}`
- `POST /api/v1/inventory/purchase-orders` `{restaurantId, branchId, supplierId, currency, idempotencyKey, orderedAt?, lines:[{itemId, quantity(int>0), unitCode, unitCostMinor(int>=0)}]}` → 201 `{orderId, status, replayed}`. Rechaza totales enviados por el cliente (`400 INVENTORY_REQUEST_INVALID`) y clave repetida con otro contenido (`409 INVENTORY_PURCHASE_IDEMPOTENCY_CONFLICT`).
- `GET /api/v1/inventory/purchase-orders/:id` → OC con `lines:[{itemId, itemName, quantity, unitCode, unitCostMinor}]` y `totalMinor` (autoridad del servidor).
- `POST /api/v1/inventory/purchase-orders/:id/receive` `{warehouseId, deviceId?: uuid, occurredAt?, receivedAt?}` → 201 `{status:"received", movements:[{lineId, movementId}], ...}`
- Roles: leer = `catalog.read`; escribir = `catalog.manage`. Insumos y almacenes ya se cargan en la pantalla.
- Errores mapeados a `InventoryError` (`invalid`, `denied`, `conflict`, `missing`, `timeout`, `unauthenticated`, `unavailable`) como hoy en `actions.ts`.

## Requisitos funcionales

- Pestaña `compras` en `INVENTORY_TABS` (después de `movimientos`), etiqueta «Compras» y `?tab=compras`.
  Actualiza la aserción de `inventory-ui.test.ts` que fija la lista de pestañas.
- Sub-secciones en el panel: **Proveedores** (lista, alta, edición, activar/desactivar) y **Órdenes**
  (lista con filtro por estado, detalle y recepción). Descarta textos de jerga: nada de UUIDs.
- Alta/edición de proveedor y de OC dentro de un diálogo in-app reutilizando `InventoryModal`
  (`role="dialog"`, Escape, foco contenido y devuelto, botón deshabilitado mientras guarda, error
  pintado dentro, sin `alert/confirm/prompt`).
- OC: elegir proveedor, moneda ISO (por defecto la de la sucursal si ya la tienes; si no, `MXN`),
  líneas insumo + cantidad entera > 0 + unidad del insumo + costo unitario minor entero >= 0, y
  `orderedAt` opcional. La `idempotencyKey` se genera **una vez por borrador** (estado del
  componente + `ensureInventoryIdempotencyKey`) y se reutiliza tal cual en cada reintento; tras
  un éxito se descarta. El total que se muestra sale de `totalMinor` del servidor: no sumes
  líneas en el cliente ni formatees dinero desde la suma (solo `formatMinorUnits` de presentación).
- Recepción: selector de almacén (de los ya cargados) + `deviceId` UUID estable de la sesión del
  navegador (mismo patrón que otros paneles; si no hay, no inventes: usa `crypto.randomUUID()` una
  vez por montaje y guárdalo en estado/`sessionStorage`); tras recibir, recarga la OC y la lista
  desde el servidor y muestra los movimientos generados (conteo, sin ids).
- Estados explícitos: carga, vacío («Aún no hay proveedores/órdenes»), error con «Reintentar»,
  éxito breve, y aviso cuando el rol no permite escribir (paneles de solo lectura). Targets >= 44 px,
  foco visible, `flex-col sm:flex-row` para no desbordar a 390 px.
- Helpers puros en `inventory-ui.ts` con pruebas en `inventory-ui.test.ts`: al menos
  `formatMinorUnits(minor, currency)` (presentación, sin floats acumulados), validación de borrador
  de proveedor (nombre 1..160, contacto 1..200 o null) y de OC (proveedor, moneda ISO de 3 letras,
  al menos una línea, cantidades enteras, sin insumos repetidos, costos enteros), y la etiqueta en
  español de `PurchaseOrderStatusV1` (`draft|sent|received|cancelled`). En español, sin códigos.
- Accesibilidad y copy en español; escribe archivos en **UTF-8 válido** (no toques acentos
  existentes de otros archivos: algunos visores los muestran mal pero el archivo está bien).

## Reglas de la sesión

- No hagas `git commit`, `git push`, ni crees ramas o PRs: el orquestador integra.
- No ejecutes PostgreSQL ni `verify:*`/`test:http:local`; eso lo corre el orquestador.
- No edites `dist`, `.next`, `node_modules` ni artefactos.
- Si una puerta falla por causas ajenas (red, caché), documenta el error real en el informe; no la maquilles.

## Puertas que debes ejecutar (Node 24.19.0)

```powershell
. .\tools\agentic\use-node24.ps1
$ErrorActionPreference='Continue'
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/shared-types build
& $PNPM --filter @super-restaurant/web lint
& $PNPM --filter @super-restaurant/web typecheck
& $PNPM --filter @super-restaurant/web test
& $PNPM --filter @super-restaurant/web build
```

Si `pnpm --filter ... run <script>` sale con exit 1 sin diagnóstico, ejecuta el `tsc`/`node` del
script directamente y revisa la salida real antes de concluir que falló.

## Hecho cuando

La pestaña «Compras» funciona con proveedores, OC (idempotencia estable, totales del servidor) y
recepción (almacén + deviceId); los diálogos son accesibles; `inventory-ui.test.ts` cubre los helpers
nuevos; lint, typecheck, test y build web salen en verde con salida real; y el informe
`.agents/reports/m3-web-compras.md` lista archivos, decisiones, salida de puertas y `git status --short`.

La verificación visual real la hace el orquestador: no abras navegador.

Aplica Ponytail (el cambio mínimo que cumple) y AGENTS §14.
