Now I'll write the migration.
## Estado
done — migración, invariantes y verificador listos; PostgreSQL no ejecutado por indicación del brief.

## Qué hice
- `app.inventory_recipes` versionada (`version > 0`, único por scope+versión, único parcial de activa) y `app.inventory_recipe_lines` con snapshot inmutable vía trigger (UPDATE → `42501`), FK cascade y unit codes `g|ml|piece`.
- `app_private.publish_inventory_recipe(uuid,uuid,jsonb)` valida actor/membership, producto/modificador del restaurante, insumo mismo restaurante no borrado, unidad exacta y cantidad entera `1..999999999`; versiona, desactiva la anterior en la misma transacción y devuelve `{recipeId, version}`. RLS `ENABLE`+`FORCE`, lectura por membership, escritura solo `app_api`.
- Invariantes 1–6 cubiertos (v1/v2, insumo ajeno, 0/decimal/unidad, activa duplicada, actor ajeno, RLS recipes+líneas).

## Archivos tocados
- `supabase/migrations/20261126000300_inventory_recipes.sql` — nueva migración.
- `supabase/tests/inventory_recipes_invariants.sql` — nuevas invariantes.
- `apps/api/src/operations/inventory-schema-verification.ts` — `inventoryRecipeInvariantSql()`.
- `apps/api/src/operations/run-inventory-schema-verification.ts` — check de la migración 00300, summary y lista de invariantes.

## Verificación
```
node -v
v24.19.0
& $PNPM --filter @super-restaurant/api typecheck
$ tsc --noEmit --project tsconfig.json          (exit 0)
& $PNPM --filter @super-restaurant/api lint
$ eslint --max-warnings=0 --config ../../eslint.config.mjs src   (exit 0)
git diff --check                                 (exit 0)
NO VERIFICADO: PG por orquestador (el brief prohíbe ejecutar el verificador)
```

## Riesgos / dudas
- `productId`/`modifierId` se validan contra el restaurante, pero no se exige que el modificador pertenezca a ese producto (el catálogo es versionado).
- La inmutabilidad de líneas bloquea UPDATE; DELETE solo llega por cascade del header y no hay grant ni función de borrado.

## Notas propuestas
- Ninguna.