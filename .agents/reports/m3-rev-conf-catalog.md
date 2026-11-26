VEREDICTO: CAMBIOS

P1 supabase/tests/inventory_catalog_invariants.sql:62-88 — la invariante «SKU único case-insensitive por restaurante mientras no esté borrado» (migración:24-26) no tiene prueba que falle si se rompe: nunca se intenta un duplicado ACTIVO (`flour` tras `FLOUR`); borrar el índice deja la suite verde (solo se prueba reuso tras soft-delete + mismo SKU en otro restaurante).
P1 supabase/migrations/20261126000100_inventory_catalog.sql:46-48 — la invariante «nombre de almacén único por sucursal mientras activo» no tiene ninguna prueba: no se inserta un segundo almacén activo con igual `lower(name)`, ni se reusa el nombre estando inactivo.
P2 supabase/tests/inventory_catalog_invariants.sql:83-88 — el ítem soft-deleted nunca se consulta como `authenticated`, así que la cláusula `deleted_at is null` de la policy (migración:65) no está probada; quitarla no rompe la suite (fuga de borrados).
P2 supabase/tests/inventory_catalog_invariants.sql:65-68 — FK compuesta `(restaurant_id,branch_id)` (migración:40-41) no probada adversarialmente: no se intenta un warehouse con branch de OTRO restaurante para verificar rechazo cross-tenant.
P2 apps/api/package.json — reescritura completa del archivo (formato ConvertTo-Json: CRLF + 4 espacios + doble espacio + sin newline final); `git diff --check` sale 2 con 253 líneas, y el brief exige «solo añadir el script» y diff --check limpio; funcionalmente solo agrega `verify:inventory-schema:rollback`.
P3 supabase/tests/inventory_catalog_invariants.sql:48-60 — check `name` btrim 1..160 (migración:21) sin prueba.
P3 supabase/tests/inventory_catalog_invariants.sql:28-33 — privilegios solo verificados para `authenticated`/`app_api`; escritura/lectura de `anon`/`service_role`/`public` (revocados en migración:53) no comprobada.

Prueba adversarial propia: NO VERIFICADO ejecución — el modo plan read-only me impide escribir el `.sql` en `.harness/state/tmp/` y levantar el cluster local (violaría el sandbox). Análisis estático: las aserciones existentes de `unit_code`, `purchase_unit_factor`, `min_quantity`, FORCE RLS y aislamiento item/warehouse SÍ fallan si se rompen; las de unicidad y de visibilidad de borrados NO.

Evidencia ejecutada:
```
git diff --check origin/main...harness/m3-sql-catalog
apps/api/package.json:1: trailing whitespace.
+{
apps/api/package.json:2: trailing whitespace.
+    "name":  "@super-restaurant/api",
... (todas las líneas) ... exit=2
Compare-Object scripts origin/main vs rama:
added:   verify:inventory-schema:rollback
removed: (ninguno)
```
NO VERIFICADO: `verify:inventory-schema:rollback` real (PG por orquestador, como ya advierte el brief).