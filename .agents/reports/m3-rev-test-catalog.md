I'll analyze the branch read-only (Plan Mode forbids writing files or running mutating commands, so I can't execute an adversarial test — I'll note that as a limitation). Let me gather evidence.
VEREDICTO: APROBAR

P2 supabase/tests/inventory_catalog_invariants.sql:62 sin prueba negativa de SKU duplicado en el mismo restaurante; el único `(restaurant_id,lower(sku))` (migración:24) podría ser no-único o estar invertido y el test pasa (solo cubre cross-restaurante y liberación tras borrado). Evidencia: 0 coincidencias de `unique_violation`.
P2 supabase/tests/inventory_catalog_invariants.sql:65 el único activo de nombre de almacén (migración:47) no se prueba; falta un insert duplicado `(r,b,lower(name))` que deba fallar. Quitar ese índice no rompe ningún assert.
P2 supabase/tests/inventory_catalog_invariants.sql:39 sin prueba negativa de la FK compuesta `(restaurant_id,branch_id)->branches` (migración:41): un almacén `(r2,b)` con branch ajeno pasaría si la FK fuese simple; el test de aislamiento no lo detecta.
P2 supabase/tests/inventory_catalog_invariants.sql:85 la cláusula `deleted_at is null` de la política (migración:66) no se verifica: ningún assert comprueba que el insumo borrado sea invisible; eliminarla no rompe el test.
P3 supabase/migrations/20261126000100_inventory_catalog.sql:44 check de nombre/btrim (1..160) sin prueba (nombre vacío o de 161 chars).
P3 apps/api/package.json:1 reescritura completa (formato) y sin newline final: ruido ajeno; solo se añade `verify:inventory-schema:rollback` (96→97 scripts, resto idéntico).

```
$ git show harness/m3-sql-catalog:supabase/tests/inventory_catalog_invariants.sql | Select-String -Pattern "unique_violation|duplicate|lower\(sku\)|active_name|branch_scope|btrim"
    (own_item, r, 'FLOUR', 'Flour', 'g'),
    (foreign_item, r2, 'FLOUR', 'Foreign flour', 'g');
  ... (deleted_item, r, 'SUGAR' ...)
  ... (gen_random_uuid(), r, 'SUGAR', 'Sugar again', 'g');
  -> 0 líneas con unique_violation / active_name / branch_scope / btrim
```

Prueba adversarial propuesta (NO VERIFICADO: Plan Mode es read-only y no hay PostgreSQL local; el brief delega PG al orquestador):
`insert ... (r,'FLOUR',...)` debe dar 23505; `insert ... warehouses(r,b,'Main')` debe dar 23505; `insert ... warehouses(r2,b,'x')` debe dar 23503.
Cobertura real: el loop "Run SQL tests" de `.github/workflows/ci.yml` ejecuta `supabase/tests/*.sql` con psql, así que `inventory_catalog_invariants.sql` corre en CI (no requiere añadir el runner a CI).