# Revisión · m3-api-alerts-costing (nivel B)

Solo lectura. No leas `.agents/reports/*` ni salgas del repo; no ejecutes PG. Responde en ≤ 15 líneas.

Lee:
- `supabase/migrations/20261126001100_inventory_costing_api.sql`
- `supabase/tests/inventory_costing_api_invariants.sql`
- `apps/api/src/inventory/costing.service.ts`, `costing.controller.ts`, `costing.test.ts`

Contexto: el orquestador ya pasó `verify:inventory-schema:rollback` (88 migraciones) y typecheck/lint/test.

Comprueba:
1. Costo medio con aritmética entera y redondeo medio hacia arriba (sin floats); resto documentado.
2. Alertas solo bajo el mínimo, con membresía y sin cruzar restaurante/sucursal.
3. El margen usa catálogo/receta vigentes (documentado) y no inventa datos si falta receta o precio.
4. Permisos `catalog.read`, mapeo de errores y que el servicio no recalcule dinero.

Salida: `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR` y hallazgos P1/P2/P3 con `archivo:línea`.
