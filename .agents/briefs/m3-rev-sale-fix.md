# Re-revisión · m3-sale-sql-fix (nivel A, verificar P1/P2 corregidos)

Solo lectura. No leas `.agents/reports/*` ni rutas fuera del repo, no ejecutes PG. Responde en ≤ 15 líneas.

Lee:
- `supabase/migrations/20261126000500_inventory_sale_consumption.sql`
- `supabase/tests/inventory_sale_consumption_invariants.sql`

Contexto: el orquestador ya pasó `verify:inventory-schema:rollback` (83 migraciones, verde). Se corrigieron: (1) reverso con `inventory_cancellation_event_ids` (comando + `steps[i].audit.eventId`); (2) almacén por defecto `is_default` resuelto dentro de la función y skip sin default; (3) ids del resultado autoritativo `v_result`; (4) filas `sale`/`cancel` solo con movimientos; (5) lock único `inventory-consumption:<orderId>`; (6) pruebas de cancelación real por envoltorio, ceil 121→61, mitades con insumo compartido, aislamiento por sucursal, fila r2 real y skip sin default.

Comprueba:
1. ¿El conjunto de eventos cubre de verdad las líneas de cocina canceladas por pasos y la línea pendiente por el paso de orden?
2. ¿El wrapper de confirmación toma los ids del resultado y falla cerrado si no están?
3. ¿Alguna de las pruebas nuevas pasa por la razón equivocada o quedó tautológica?
4. ¿Queda algún P1/P2 real sin cubrir (el camino `applied` del wrapper de confirmación se difiere a `m3-int-sale-to-stock`, con el cableado en `m3-sale-wire`)?

Salida: `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR` y hallazgos P1/P2/P3 con `archivo:línea`.
