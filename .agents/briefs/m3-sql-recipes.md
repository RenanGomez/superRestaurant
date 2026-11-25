# Brief m3-sql-recipes (nivel A · SQL inventario: recetas versionadas)

## Objetivo
Recetas versionadas por producto y modificador, con snapshot inmutable de líneas, listas para explosionar consumos.

Tiempo estimado: 30 min. Carril SQL: único escritor de `supabase/migrations/**` y `supabase/tests/**` en esta tarea.

## Alcance
- Crea: `supabase/migrations/20261126000300_inventory_recipes.sql`, `supabase/tests/inventory_recipes_invariants.sql`.
- Edita: `apps/api/src/operations/inventory-schema-verification.ts` (añadir el test a la lista) y `run-inventory-schema-verification.ts` (comprobar la migración nueva).
- Prohibido: editar migraciones anteriores; tocar otras apps; dependencias; remoto; acceder a rutas fuera del worktree. Sin commit ni push.

## Fuente de verdad
`docs/adr/ADR-013.md` §2.9, §2.10, §3. Base: `app.inventory_items`, `app.inventory_warehouses` (`00100`) y `app.inventory_movements` (`00200`).

## Qué construir
- `app.inventory_recipes`: `id`, `restaurant_id`, `product_id uuid not null`, `modifier_id uuid` (null = receta base del producto), `version integer not null check (version > 0)`, `active boolean`, `created_at`, `created_by uuid`, `notes text`. Único `(restaurant_id, product_id, coalesce(modifier_id, '00000000-0000-0000-0000-000000000000'::uuid), version)`.
- `app.inventory_recipe_lines`: `recipe_id` (FK on delete cascade), `item_id` (FK a insumos, mismo restaurante), `quantity integer not null check (quantity > 0)`, `unit_code text not null`, único `(recipe_id, item_id, unit_code)`.
- Reglas: una sola receta `active` por `(restaurant_id, product_id, modifier_id)` (índice único parcial); crear una versión nueva no desactiva la anterior automáticamente salvo que la función lo haga en la misma transacción.
- `app_private.publish_inventory_recipe(p_actor_id uuid, p_restaurant_id uuid, p_payload jsonb) returns jsonb`: valida scope del actor, insumos del mismo restaurante, unidad compatible, cantidad entera > 0, y desactiva la versión activa anterior. Devuelve `{recipeId, version}`.
- RLS `ENABLE` + `FORCE` y lectura por scope; sin grants directos a `authenticated`.

## Invariantes `supabase/tests/inventory_recipes_invariants.sql`
1. Publicar v1 y v2 deja solo v2 activa y conserva v1 para histórico.
2. Un insumo de otro restaurante es rechazado.
3. Cantidad 0 o decimal rechazada; unidad incompatible con el insumo rechazada.
4. Dos recetas activas para el mismo producto/modificador no pueden coexistir (violación de único parcial).
5. Un actor de otro restaurante no puede publicar (aislamiento).
6. Lectura: el operador de la sucursal A no ve recetas del restaurante B.

## Puertas (obligatorio, Node 24.19.0)
El binario de PostgreSQL local vive fuera del worktree y el sandbox lo rechaza: **no ejecutes el verificador**. El orquestador lo corre después.
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/api typecheck
& $PNPM --filter @super-restaurant/api lint
```

## Hecho cuando
Migración + invariantes + verificador coherentes; `typecheck`, `lint` y `git diff --check` limpios con salida real; informe marca `NO VERIFICADO: PG por orquestador`.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con archivos, decisiones y bloques comando + salida real.
Aplica Ponytail: cambio más pequeño correcto, sin recortar validación, seguridad ni pruebas.
