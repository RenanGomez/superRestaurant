# Revisión A · m3-sql-sale-consumption (nivel A, consumo/dinero)

Solo lectura. No ejecutes tests/PG, no leas `.agents/reports/*` ni rutas fuera del repo. Responde en ≤ 20 líneas.

Lee solo:
- `supabase/migrations/20261126000500_inventory_sale_consumption.sql`
- `git diff -- apps/api/src/operations/inventory-schema-verification.ts apps/api/src/operations/run-inventory-schema-verification.ts`

Ya verificado por el orquestador: `verify:inventory-schema:rollback` verde con 83 migraciones y el test `inventory_sale_consumption_invariants.sql`.

Busca:
1. Corrección del consumo: explosión de receta activa por producto, mitades (`pizzaHalves.halves[]`) con `ceil(receta/2)` y agregación por insumo; cantidades enteras, sin floats.
2. Idempotencia real: replay de la misma orden no duplica movimientos ni la fila de `app.inventory_consumptions`; claves de ledger estables; carreras cubiertas por advisory lock.
3. Reverso: un `sale_reversal` por consumo previo con `compensates_movement_id`, sin duplicar al reintentar, y sin inventar movimientos para líneas sin consumo.
4. Envoltorios `confirm_capture_draft_v3_with_inventory` y `cancel_order_with_inventory`: ¿solo actúan con `applied`/`saved`? ¿un replay o `rejected` deja el stock intacto? ¿el reverso solo toca las líneas del `eventId`?
5. Seguridad: SECURITY DEFINER, `search_path=''`, dueño postgres, `revoke`/`grant` solo a `app_api`, membresía/scope revalidados, RLS de la tabla nueva.

Salida: primera línea `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR`; hallazgos P1/P2/P3 con `archivo:línea` y corrección.
