# Brief m3-web-movimientos (nivel C · pestaña Movimientos en /app/inventario)

## Objetivo
Añadir la pestaña «Movimientos» a `/app/inventario`: listar movimientos y saldos, registrar ajuste/merma/transferencia con motivo obligatorio y confirmación in-app.

Tiempo estimado: 40 min. Escritor único de `apps/web/src/app/app/inventario/**` y `apps/web/src/lib/inventory-ui.*`.

## API disponible
- `GET /api/v1/inventory/movements?restaurantId&branchId&warehouseId?&itemId?&limit?` → lista con `kind, quantityDelta, unitCode, occurredAt, reason, warehouseId, itemId`.
- `GET /api/v1/inventory/balances?restaurantId&branchId&warehouseId?` → `warehouseId, itemId, quantity`.
- `POST /api/v1/inventory/movements` con `{restaurantId, branchId, warehouseId, itemId, kind, quantityDelta, unitCode, reason, idempotencyKey, compensatesMovementId:null, toWarehouseId:null, unitCostMinor:null, currency:null}`; para `transfer_out`/`transfer_in` manda `toWarehouseId` (UUID) y `quantityDelta` positivo/negativo según el tipo; el servidor añade actor y dispositivo.
- Permisos: lectura `catalog.read`, escritura `catalog.manage` (la UI muestra el botón solo como pista; el servidor decide).

## Requisitos
- Pestaña «Movimientos» con `?tab=movimientos`, filtros por almacén e insumo (usando los insumos/almacenes ya cargados en la pantalla), lista legible (tipo en español: Ajuste, Merma, Conteo, Transferencia; cantidad con unidad; fecha; motivo) y tabla de saldos por almacén.
- Botones «Ajustar», «Merma» y «Transferir» abren un diálogo in-app (`role="dialog"`, Escape, foco contenido/devuelto, fondo bloqueado si hay helper; si no, documentarlo): seleccionan almacén e insumo, cantidad entera positiva, unidad del insumo, motivo obligatorio (mínimo 3 caracteres) y, en transferencia, almacén destino distinto.
- Idempotencia: genera una `idempotencyKey` (UUID) una vez al abrir el diálogo y la conserva al reintentar; el botón se deshabilita mientras guarda.
- Estados: carga, vacío («Sin movimientos todavía»), error con «Reintentar», éxito breve; mensajes en español, sin UUIDs ni códigos internos; sin `alert/confirm/prompt`; targets ≥ 44 px.
- No calcular dinero ni saldos en cliente; mostrar lo que da el API.
- Sin `AbortSignal` omitido: usa timeout de 10 s como el resto de diálogos de la pantalla.
- Añade pruebas puras en `apps/web/src/lib/inventory-ui.test.ts` (etiquetas de tipo, validación del formulario, idempotencia estable al reintentar).

## Puertas (Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
$ErrorActionPreference='Continue'
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/web lint
& $PNPM --filter @super-restaurant/web typecheck
& $PNPM --filter @super-restaurant/web test
& $PNPM --filter @super-restaurant/web build
```

## Hecho cuando
Pestaña funcional contra los endpoints reales, diálogos accesibles, pruebas y puertas web verdes con salida real; informe con archivos, decisiones de UX y `git status --short`. La verificación visual la hace el orquestador. Aplica Ponytail y AGENTS §14.
