I'll review the files specified in the brief.
# m3-rev-recipes — hecha (nivel B, solo lectura; commit 104aca39)
Cambios: revisión de API/SQL de recetas versionadas, sin editar archivos. Archivos: `20261126000900_inventory_recipe_api.sql`, `inventory_recipe_api_invariants.sql`, `apps/api/src/inventory/{recipes.service,recipes.controller,recipes.test}.ts`, `packages/shared-types/src/inventory.ts`, `app.module.ts`.
Verificación:
```powershell
PS> git show --stat 104aca39
 apps/api/src/inventory/recipes.controller.ts | 75 +++ · apps/api/src/inventory/recipes.service.ts | 329 ++++ · supabase/migrations/20261126000900_inventory_recipe_api.sql | 150 +++ · supabase/tests/inventory_recipe_api_invariants.sql | 190 +++
PS> $all=(Get-ChildItem supabase\migrations -File); "total=$($all.Count) sql=$(($all|Where-Object Extension -eq '.sql').Count) nonSql=$(($all|Where-Object Extension -ne '.sql').Name -join ',')"
total=87 sql=86 nonSql=README.md
```
NO VERIFICADO: `verify:inventory-schema:rollback` y `pnpm test` (no ejecuté PG/TS en modo lectura); `git diff -- packages/shared-types/src/inventory.ts apps/api/src/app.module.ts` sale vacío porque el cambio ya está commiteado en 104aca39.
- P2 `apps/api/src/inventory/recipes.service.ts:76-87` (y `:194-201`): el publish commitea en una transacción y la relectura va en otra; si falla tras el commit responde 503 con la versión ya publicada y, sin idempotency key, el reintento crea otra versión.
- P3 `recipes.service.ts:204-208`: `23505` no se mapea a `conflict` (cae a 503), a diferencia de `items.service.ts` que mapea `23505`/`23503` a conflict.
- P3 `20261126000900_inventory_recipe_api.sql:49-56`: el listado no filtra `modifier_id`, mezcla receta base y de modificadores del producto (el cliente debe filtrar por el `modifier_id` devuelto).
- P3 `packages/shared-types/src/inventory.ts:145-147,508` vs `20261126000300_inventory_recipes.sql:95,187`: el parser acepta ULID y cantidad sin tope; SQL exige UUID y ≤9 dígitos (termina en 400, no en fuga).
- P3 `20261126000900:33-47` vs `20261126000300:133-151`: las lecturas no validan sucursal activa como el publicador; P3 `inventory_recipe_api_invariants.sql:62-78` no prueba concurrencia (la unicidad activa descansa en el advisory lock `20261126000300:227`).
Correcto: una sola versión activa por producto/modificador (índice parcial `20261126000300:31-38` + publish), lecturas con membresía+restaurante sin cruzar tenant (invariantes `:156-186`), grants solo a `app_api` (`:137-143`), parser exact-key con topes (200 líneas, notas 500) y rutas reales (`recipes.controller.ts:33,42,50`).
VEREDICTO: APROBAR