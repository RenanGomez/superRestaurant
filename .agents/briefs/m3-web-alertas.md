# Brief m3-web-alertas (nivel C · pestaña «Alertas» en /app/inventario)

## Objetivo

Añadir la pestaña **Alertas** a `/app/inventario`: saldo bajo mínimo con su déficit, costo medio por
almacén/insumo, costo de una receta y margen estimado de un producto. Solo se muestra lo que
devuelve el servidor; aquí no se calcula dinero ni se decide permisos.

Tiempo estimado: 35 min. Eres el **único escritor** de los archivos de la sección «Archivos».

## Archivos (exactos, ninguno más)

1. `apps/web/src/app/app/inventario/alerts-panel.tsx` (nuevo, `"use client"`).
2. `apps/web/src/app/app/inventario/actions.ts` (nuevas operaciones de solo lectura + lectores).
3. `apps/web/src/app/app/inventario/inventory-workspace.tsx` (pestaña + render).
4. `apps/web/src/lib/inventory-ui.ts` y `apps/web/src/lib/inventory-ui.test.ts` (etiquetas/formatos puros).

Prohibido tocar: `page.tsx`, `purchasing-panel.tsx`, `movements-panel.tsx`, `recipes-panel.tsx`,
`inventory-modal.tsx`, `apps/web/package.json`, `packages/shared-types/**`, `apps/api/**`, `supabase/**`.

## API disponible (ya en `main`, no la cambies)

Todas son **lecturas** con `catalog.read` (también accesibles a roles de solo lectura):

- `GET /api/v1/inventory/alerts?restaurantId&branchId` → `{schemaVersion:1, restaurantId, branchId, alerts:[{itemId, itemName, unitCode, warehouseId, warehouseName, quantity, minQuantity, deficit}]}`
- `GET /api/v1/inventory/costs?restaurantId&branchId&warehouseId&itemId` → `{schemaVersion:1, restaurantId, branchId, warehouseId, itemId, quantity, valueMinor, unitCostMinor, currency|null, roundingRemainder}`
- `GET /api/v1/inventory/product-costs?restaurantId&productId` → `{schemaVersion:1, restaurantId, productId, costs:[{itemId, itemName, unitCode, quantity, purchaseUnitFactor, unitCostMinor, lineCostMinor, currency|null}]}`
- `GET /api/v1/inventory/margins?restaurantId&branchId&productId` → `{schemaVersion:1, restaurantId, branchId, productId, priceMinor, costMinor, marginMinor, currency}`

Errores ya mapeados a `InventoryError` en `actions.ts` (`invalid`, `denied`, `conflict`, `missing`,
`timeout`, `unauthenticated`, `unavailable`).

## Requisitos funcionales

- Pestaña `alertas` en `INVENTORY_TABS` (después de `compras`), etiqueta «Alertas» y `?tab=alertas`.
  Actualiza la aserción de `inventory-ui.test.ts` que fija la lista de pestañas.
- **Saldo bajo mínimo:** lista de alertas con insumo, almacén, saldo actual, mínimo y déficit, con
  unidades legibles (`inventoryUnitLabel`) y números con `formatInventoryNumber`. Vacío honesto:
  «Todo el inventario está por encima del mínimo». Botón «Actualizar» que recarga desde el servidor.
- **Costo medio:** selector de insumo + almacén (de los ya cargados en la pantalla) y, al elegir
  ambos, `costs`; muestra cantidad, valor total, costo unitario y el resto de redondeo. Si
  `currency` es `null`, no inventes moneda: indica que aún no hay compras que fijen costo.
- **Costo de receta y margen:** selector de producto del menú (reutiliza `listProducts` ya existente);
  muestra las líneas de `product-costs` con su `lineCostMinor` y el margen de `margins`
  (precio, costo, margen y porcentaje **calculado solo para mostrar** a partir de esos tres enteros,
  sin sumar líneas ni recalcular el costo). Si un importe es 0 por falta de receipts, adviértelo con
  texto neutro («Sin costo registrado todavía»).
- El formato de dinero usa `formatMinorUnits` (ya existe) con la moneda que devuelve el servidor;
  si es `null`, usa el código de la orden o muestra el importe sin símbolo, nunca una moneda inventada.
- Estados explícitos: carga, vacío, error con «Reintentar», y aviso de rol cuando el API devuelva
  `denied`. Sin `alert/confirm/prompt`, sin UUIDs visibles, targets ≥ 44 px, foco visible, layout
  `flex-col sm:flex-row` para no desbordar a 390 px.
- Helpers puros con pruebas: al menos `formatPercentFromMinor(part, total)` (porcentaje de margen con
  enteros, redondeo explícito y `—` cuando el total es 0) y `stockAlertSummary(alert)` (texto
  «faltan N unidades» sin códigos internos). Nada de React ni red en `inventory-ui.ts`.
- Español operativo y archivos en **UTF-8 válido** (no toques los acentos de otros archivos).

## Reglas de la sesión

- No hagas `git commit`, `git push`, ni crees ramas o PRs: el orquestador integra.
- No ejecutes PostgreSQL ni `verify:*`/`test:http:local`.
- No edites `dist`, `.next`, `node_modules` ni artefactos.

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
script directamente y revisa la salida real.

## Hecho cuando

La pestaña «Alertas» muestra saldo bajo mínimo, costo medio, costo de receta y margen con datos del
servidor; los helpers nuevos tienen pruebas; lint, typecheck, test y build web salen en verde con
salida real; y `.agents/reports/m3-web-alertas.md` lista archivos, decisiones, salida de puertas y
`git status --short`. La verificación visual la hace el orquestador.

Aplica Ponytail (el cambio mínimo que cumple) y AGENTS §14.
