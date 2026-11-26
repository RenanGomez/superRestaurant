## Estado
done — la transferencia usa `toWarehouseId` explícito; el `transferPairId` lo sigue asignando el servidor/SQL.

## Qué hice
- Contrato: `toWarehouseId` obligatorio (UUID en `transfer_out|transfer_in`, `null` en el resto); el request ya no exige `transferPairId` y rechaza uno no nulo (campo del servidor).
- Servicio: `recordTransfer` toma la contraparte de `command.toWarehouseId` (400 si falta) y mantiene el `transferPairId` de la respuesta desde el resultado SQL.
- Pruebas: transferencia válida, rechazo sin `toWarehouseId`, rechazo fuera de transferencia y de pair id de cliente; en API, rechazo sin `toWarehouseId`.

## Archivos tocados
- `packages/shared-types/src/inventory.ts` — campo y validación del request (parser del movimiento persistido intacto).
- `packages/shared-types/src/inventory.runtime.test.ts` — 4 casos nuevos y helper con `toWarehouseId: null`.
- `apps/api/src/inventory/movements.service.ts` — contraparte explícita, sin leer `transferPairId`.
- `apps/api/src/inventory/movements.test.ts` — casos de transferencia actualizados + rechazo sin destino.
- `git status --short`: M los dos de shared-types; los dos de `apps/api/src/inventory` ya estaban sin trackear antes de esta tarea.

## Verificación
```powershell
& $PNPM --filter @super-restaurant/shared-types build
$ tsc --project tsconfig.build.json
& $PNPM --filter @super-restaurant/shared-types test
ℹ tests 43  ℹ pass 43  ℹ fail 0
& $PNPM --filter @super-restaurant/api typecheck
$ tsc --noEmit --project tsconfig.json
& $PNPM --filter @super-restaurant/api lint
$ eslint --max-warnings=0 --config ../../eslint.config.mjs src
& $PNPM --filter @super-restaurant/api test   → EXIT=0
ℹ tests 17  ℹ pass 17  ℹ fail 0   (inventory/movements)
FAIL_LINES=0 en toda la suite
```

## Riesgos / dudas
- `transfer_in` conserva la semántica previa: `toWarehouseId` es la contraparte (origen), no el destino literal; confirmar si la UI espera “destino siempre”.

## Notas propuestas
- ninguna