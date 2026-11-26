Now I'll add the rejection in `parseMovementRequest` and the corresponding test.
# m3-grant-fix — hecha
Cambios: `parseMovementRequest` devuelve `undefined` si el contrato trae `compensatesMovementId` no nulo, así el controlador responde 400 (`INVENTORY_REQUEST_INVALID`) antes de tocar la base; no se tocaron `packages/shared-types` ni las transferencias. P3: `app_api` llama directo a `app_private.inventory_record_movement` y debe recibir `42501`.
Archivos: apps/api/src/inventory/movements.service.ts, apps/api/src/inventory/movements.test.ts, supabase/tests/inventory_movements_api_invariants.sql
Verificación:
```
$ pnpm --config.verify-deps-before-run=false --filter @super-restaurant/api run typecheck -> $ tsc --noEmit --project tsconfig.json (exit 0)
$ pnpm --config.verify-deps-before-run=false --filter @super-restaurant/api run lint -> $ eslint --max-warnings=0 --config ../../eslint.config.mjs src (exit 0)
$ pnpm --config.verify-deps-before-run=false --filter @super-restaurant/api run test -> ok 4 - recordMovement: a manual compensation reference is rejected before the database; # fail 0
```
Riesgos/pendientes: SQL no ejecutado (el brief prohíbe PostgreSQL); el verificador rollback-only queda al orquestador. No existía un test previo que esperara ignorar un `compensatesMovementId` no nulo; el fixture ya usa `null` y sigue en verde.
Notas: Sin commit. Se compiló `shared-types` y `domain` (faltaba `dist`) antes del typecheck; el test cubre el rechazo sin SQL (`database.queries.length === 0`).