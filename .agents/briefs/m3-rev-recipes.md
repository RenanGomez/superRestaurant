# Revisión · m3-api-recipes (nivel B)

Solo lectura. No leas `.agents/reports/*` ni rutas fuera del repo; no ejecutes PG. Responde en ≤ 15 líneas.

Lee:
- `supabase/migrations/20261126000900_inventory_recipe_api.sql`
- `supabase/tests/inventory_recipe_api_invariants.sql`
- `apps/api/src/inventory/recipes.service.ts`, `recipes.controller.ts`, `recipes.test.ts`
- `git diff -- packages/shared-types/src/inventory.ts apps/api/src/app.module.ts`

Contexto: el orquestador ya pasó `verify:inventory-schema:rollback` (86 migraciones) y typecheck/lint/test.

Comprueba:
1. Publicar usa `publish_inventory_recipe` sin duplicar validaciones y deja una sola versión activa por producto/modificador.
2. Las lecturas filtran por membresía y restaurante; no exponen otro tenant.
3. El parser nuevo (si lo hay) es exact-key, con límites de longitud y sin aceptar campos del servidor.
4. Permisos (`catalog.manage`/`catalog.read`), mapeo de errores y ninguna ruta inventada respecto al controlador.

Salida: `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR` y hallazgos P1/P2/P3 con `archivo:línea`.
