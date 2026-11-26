# Revisión A · m3-sql-purchasing-fix (nivel A, dinero/idempotencia)

Solo lectura. No ejecutes tests/PG, no leas `.agents/reports/*` ni rutas fuera del repo. Responde en ≤ 20 líneas.

Lee solo el diff:
`git diff -- supabase/migrations/20261126000400_inventory_purchasing.sql`

Contexto: `inventory_create_purchase_order` pasa a ser idempotente por `(restaurant_id, idempotency_key)`; el orquestador ya corrió `verify:inventory-schema:rollback` (verde, incluye `inventory_purchasing_invariants.sql`).

Busca:
1. ¿El replay idéntico devuelve la misma orden sin insertar nada, y una clave con payload distinto falla con `INVENTORY_PURCHASE_IDEMPOTENCY_CONFLICT`?
2. ¿La comparación estructural de líneas es correcta (multiconjunto, orden irrelevante, tipos) y no depende de `orderedAt`?
3. ¿La carrera de dos llamadas simultáneas termina en replay (unique + reintento) sin duplicar orden/líneas ni dejar estado parcial?
4. ¿`unitCostMinor`/`idempotencyKey`/moneda/proveedor se validan antes de insertar y con enteros (sin floats)?
5. ¿Algún camino de error deja la transacción en estado raro o convierte un 22000 en 23505 crudo? (p. ej. líneas duplicadas en el payload).

Salida: primera línea `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR`; hallazgos P1/P2/P3 numerados con `archivo:línea` y corrección.
