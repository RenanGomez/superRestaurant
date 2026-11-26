I'll review the branch files as instructed.
VEREDICTO: APROBAR

Hallazgos (ninguno bloqueante):
- P3 `apps/api/src/operations/http-flow-inventory-api.ts:228` · `assert.equal(totalsOrder.totalMinor, undefined)` verifica un campo que `CreatePurchaseOrderResultV1` nunca devuelve (`purchasing.service.ts:117`): tautológica; el 400 por `totalMinor` inyectado ya cubre el contrato. Lo mismo aplica al literal `"received"` en `:278`.
- P3 `apps/api/src/operations/http-test-app.ts:49-65` · el doble reimplementa la transacción en lugar de reutilizar `runDatabaseTransaction` (`database.ts:129`), como ya hace `sync/sync-conflicts.local.test.ts:127`; omite el `releaseError` si falla `COMMIT` (devuelve la conexión al pool sin marcarla). No anida ni deja conexiones sin liberar (`finally client.release()`), y no altera flujos existentes: no hay código que ramifique por presencia de `transaction`.
- P3 `http-flow-inventory-api.ts:209-213` · el replay comprueba solo el conteo de `app.inventory_purchase_orders`; no verifica que no se dupliquen líneas ni la idempotencia de `/receive` (segundo POST), aunque el SQL retorna antes del insert.

Verificado conforme al brief: 401 sin sesión, 403 `ACTION_NOT_AUTHORIZED` (viewer y restaurante B), 400 `INVENTORY_REQUEST_INVALID`, 404, 409 `INVENTORY_PURCHASE_IDEMPOTENCY_CONFLICT`; totales contrastados con `quantity * unitCostMinor` (`:224,228-232,250`), enteros, sin floats; aislamiento por `find` sin depender del orden (`:232-236,250`); conteo contra tabla real (`:211`); ids `randomUUID`, cluster limpiado por `runHttpFlow`.

```powershell
git show harness/m3-api-http-tests:apps/api/src/operations/http-flow-inventory-api.ts | Select-String -Pattern 'totalsOrder.totalMinor' -Context 2,2
        const expectedTotal = lineA.quantity * lineA.unitCostMinor + lineB.quantity * lineB.unitCostMinor;
        const totalsOrder = await createPurchaseOrder(context, supplierId, [lineA, lineB], `totals-${randomUUID()}`);
>       assert.equal(totalsOrder.totalMinor, undefined);
git show ...:apps/api/src/inventory/purchasing.service.ts | Select-String 'interface CreatePurchaseOrderResultV1' -Context 0,4
> export interface CreatePurchaseOrderResultV1 {
    readonly orderId: string;
    readonly status: string;
    readonly replayed: boolean;
```

NO VERIFICADO: ejecución real del flujo (el brief prohíbe PostgreSQL) y CI/typecheck de la rama.