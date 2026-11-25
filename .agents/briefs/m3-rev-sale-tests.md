# Revisión B · m3-sql-sale-consumption (nivel A, pruebas y ganchos de venta)

Solo lectura. No ejecutes tests/PG, no leas `.agents/reports/*` ni rutas fuera del repo. Responde en ≤ 20 líneas.

Lee solo:
- `supabase/tests/inventory_sale_consumption_invariants.sql`
- `supabase/migrations/20261126000500_inventory_sale_consumption.sql` (para contrastar)

Contexto: el orquestador corrió `verify:inventory-schema:rollback` (83 migraciones, verde). Los envoltorios llaman a `confirm_capture_draft_v3`/`cancel_order` sin editarlos.

Busca:
1. ¿Las 6 invariantes del brief están realmente probadas (consumo exacto, replay sin duplicar, reverso por línea, doble reverso, mitades con redondeo, aislamiento entre tenants)? ¿Alguna pasa por la razón equivocada?
2. ¿Falta un caso P1/P2 para cerrar el hito: orden cancelada completa (no por línea), producto sin receta, almacén inactivo, actor de otra sucursal?
3. ¿El test deja datos que rompan el postcheck (transacción + rollback) o depende del orden de migraciones?
4. ¿El brief/ADR-013 se cumple en lo que respecta a `(order_item_id, cause)` e idempotencia?

Salida: primera línea `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR`; hallazgos P1/P2/P3 con `archivo:línea` y corrección.
