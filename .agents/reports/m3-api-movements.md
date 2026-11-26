## Estado
done — API de movimientos manuales, transferencia y lecturas implementada; SQL registrado pero no ejecutado.

## Qué hice
- Migración 00800 con `inventory_transfer` atómico/idempotente, `list_inventory_movements` y `list_inventory_balances`, grants solo a `app_api`.
- `MovementsService/Controller/tests` con parser compartido, permisos `catalog.manage/read`, mapeo 22000/23514→400, 23503→409, 42501→403; registros en AppModule, smoke y verificadores.

## Archivos tocados
- Nuevos: `supabase/migrations/20261126000800_inventory_movement_api.sql`, `supabase/tests/inventory_movements_api_invariants.sql`, `apps/api/src/inventory/movements.{service,controller,test}.ts`.
- Editados: `app.module.ts`, `app.smoke.test.ts`, `package.json`, `operations/inventory-schema-verification.ts`, `operations/run-inventory-schema-verification.ts`.

## Verificación
```
& $PNPM --filter @super-restaurant/api typecheck; & $PNPM --filter @super-restaurant/api lint; & $PNPM --filter @super-restaurant/api test   # salidas: tsc/eslint sin errores; test EXIT=0, 1..16, # pass 16, # fail 0
```
- `git diff --check` EXIT=0. SQL: NO VERIFICADO — el brief prohíbe ejecutar PostgreSQL; el orquestador debe correr `verify:inventory-schema:rollback`.

## Riesgos / dudas
- `transferPairId` se usa como almacén contraparte (el contrato no tiene otro campo); deviceId por header `x-device-id`; `limit` SQL clampa 1..200. El worktree trae cambios ajenos de `apps/web` y `.agents` sin tocar.

## Notas propuestas
- ninguna