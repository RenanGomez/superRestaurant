# Revisión · m3-api-purchasing (nivel A)

Solo lectura. No leas `.agents/reports/*` ni salgas del repo; no ejecutes PG. Responde en ≤ 18 líneas.

Lee:
- `supabase/migrations/20261126001000_inventory_purchasing_api.sql`
- `supabase/tests/inventory_purchasing_api_invariants.sql`
- `apps/api/src/inventory/purchasing.service.ts`, `purchasing.controller.ts`, `purchasing.test.ts`

Ya verde en el orquestador: `verify:inventory-schema:rollback` (87 migraciones), typecheck/lint/test.

Comprueba:
1. Que la API no duplique validaciones de dinero ni recalcule totales: usa las funciones SQL y sus resultados.
2. `idempotencyKey` del cliente se propaga sin alterar; conflicto de replay ⇒ 409 legible; actor/dispositivo del servidor.
3. Alcance: proveedores y OC de otro restaurante invisibles; `read_inventory_purchase_order` no expone líneas ajenas; recepción exige manage y `warehouseId` de la sucursal.
4. Mapeo de errores y límites (`limit` 1..200).
5. ¿Algún caso P1/P2 ausente en las pruebas?

Salida: `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR` y hallazgos P1/P2/P3 con `archivo:línea`.
