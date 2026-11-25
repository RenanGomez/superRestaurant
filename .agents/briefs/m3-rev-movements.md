# Revisión · m3-api-movements (nivel A)

Solo lectura. No leas `.agents/reports/*` ni rutas fuera del repo; no ejecutes PG. Responde en ≤ 20 líneas.

Lee:
- `supabase/migrations/20261126000800_inventory_movement_api.sql`
- `supabase/tests/inventory_movements_api_invariants.sql`
- `apps/api/src/inventory/movements.service.ts`
- `apps/api/src/inventory/movements.controller.ts`

Contexto: el orquestador ya pasó `verify:inventory-schema:rollback` (85 migraciones, verde) y la suite del API; `toWarehouseId` es el destino explícito de la transferencia y `transferPairId` lo asigna el servidor.

Comprueba:
1. `inventory_transfer` es atómica e idempotente: dos movimientos (`:out`/`:in`) con el mismo par, replay sin mover stock, y sin dejar un solo lado si algo falla.
2. El API no permite mover stock sin `catalog.manage`, ni sin motivo en ajuste/merma/conteo, ni con almacén/insumo de otro restaurante o sucursal; `transfer_out`/`transfer_in` usan `toWarehouseId`.
3. Las funciones de lectura filtran por membresía y no exponen otro restaurante; `limit` acotado.
4. Mapeo de errores (22000/23514→400, 23503→409, 42501→403, resto 503) y ningún SQL inyectable ni campo de cliente usado como actor/dispositivo.
5. ¿Falta algún caso P1/P2 en la prueba SQL o del API?

Salida: `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR` y hallazgos P1/P2/P3 con `archivo:línea`.
