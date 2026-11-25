# Brief m3-movements-transfer-fix (nivel B · destino real de la transferencia)

## Objetivo
Quitar el abuso de `transferPairId` como almacén contraparte. La transferencia debe usar un campo explícito `toWarehouseId` y el `transferPairId` lo asigna el servidor.

Tiempo estimado: 20 min. Escritor único de los archivos listados.

## Contexto
- `packages/shared-types/src/inventory.ts`: `InventoryMovementRequestV1` (comando de UI) y su parser exigen hoy `transferPairId` UUID cuando `kind` es `transfer_out|transfer_in`. El API lo está usando como almacén destino (`apps/api/src/inventory/movements.service.ts:180-197`), lo que es engañoso.
- El movimiento persistido (`InventoryMovementV1`) sí lleva `transferPairId` (lo genera el SQL). No cambies eso.

## Cambios
1. `packages/shared-types/src/inventory.ts`:
   - Añade a `InventoryMovementRequestV1` el campo **obligatorio** `toWarehouseId: string | null` (UUID solo para `transfer_out|transfer_in`; `null` en el resto).
   - En el parser del **request** (el que valida `InventoryMovementRequestV1`, no el del movimiento persistido): acepta la clave nueva en el conjunto exacto, exige UUID para transferencias y `null` en el resto; deja de exigir `transferPairId` en el request (acepta `null` siempre, porque lo asigna el servidor). Mantén `hasValidTransferPair` para el movimiento persistido.
   - Actualiza `packages/shared-types/src/inventory.runtime.test.ts`: caso válido de transferencia con `toWarehouseId`, rechazo sin él, rechazo si viene en un ajuste y aceptación de `transferPairId: null` en el request.
2. `apps/api/src/inventory/movements.service.ts`: en `recordTransfer` usa `command.toWarehouseId` como contraparte (valida que exista antes de llamar; si falta, 400), y no leas `command.transferPairId`. Mantén el `transferPairId` de la respuesta desde el resultado SQL.
3. `apps/api/src/inventory/movements.test.ts`: actualiza los casos de transferencia (parámetros esperados: `from`, `to` desde `toWarehouseId`) y añade el rechazo de transferencia sin `toWarehouseId`.

## Prohibido
- No toques SQL, otras apps ni el parser del movimiento persistido. Sin dependencias, sin commit/push. No ejecutes PostgreSQL.

## Puertas (Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
$ErrorActionPreference='Continue'
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/shared-types build
& $PNPM --filter @super-restaurant/shared-types test
& $PNPM --filter @super-restaurant/api typecheck
& $PNPM --filter @super-restaurant/api lint
& $PNPM --filter @super-restaurant/api test
```

## Hecho cuando
Contrato y servicio con `toWarehouseId`, pruebas actualizadas y todo verde con salida real. Informe con archivos, decisiones y `git status --short`. Aplica Ponytail.
