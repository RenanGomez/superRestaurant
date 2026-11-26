I'll review the purchasing API implementation against the brief.
## Estado
VEREDICTO: APROBAR — sin P1/P2; 4 P3 (ninguno bloquea).

## Qué hice
- Revisión de solo lectura: migración 20261126001000, su test SQL, purchasing.service/controller/test y las funciones SQL que invocan (create/receive, ledger).

## Archivos tocados
- ninguno.

## Verificación
```powershell
Select-String -Path "apps\api\src\inventory\purchasing.service.ts","apps\api\src\inventory\purchasing.controller.ts" -Pattern "idempotencyKey: command.idempotencyKey|INVENTORY_PURCHASE_IDEMPOTENCY_CONFLICT"
```
Salida: purchasing.service.ts:288: idempotencyKey: command.idempotencyKey, / purchasing.controller.ts:125: code: "INVENTORY_PURCHASE_IDEMPOTENCY_CONFLICT",
## Riesgos / dudas
- P3: service.ts:332 deviceId del cuerpo (movements usa x-device-id, controller:42); controller.ts:123 replay idéntico→201; service.ts:535/543 vs 20261126001000:374 puede desbordar bigint (22003→503); tests: sin 2ª sucursal bajo r (sql:56-58), sin clamp limit>200, sin receive 403/warehouse ajeno.
- Sin P1/P2 ausentes: alcance SQL restaurant+branch y líneas por restaurant (mig:330-350,438-456,510-516); receive manage + warehouse de sucursal (20261126000400:476-496; ledger 20261126000200:166-174).
## Notas propuestas: ninguna