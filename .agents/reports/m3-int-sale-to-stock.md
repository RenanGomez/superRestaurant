I'll start by reading the operational files and understanding the harness structure.
Now I understand the structure. Let me implement the new flow.
Now typecheck and lint the API.
## Estado — done: flujo `http_flow_inventory` listo (HTTP + SQL); la corrida PostgreSQL queda al orquestador.
## Qué hice
- Fixture: un solo catálogo del flujo con producto con receta y otro sin receta; siembra como postgres (item `Harina` unit `g`, almacén de sucursal `is_default=true`, receipt 5 000 y receta 120 g/unidad), confirmación real por API (`sale_consumption=-240`, saldo 4 760), replay idéntico sin duplicar, cancelación de línea con `sale_reversal`+`compensates_movement_id`+`cause='cancel'` y saldo 5 000, y línea sin receta inerte.
- Enganche a `test:http:local`; `captureAndConfirm` ahora devuelve el body `confirm` exacto para reenviarlo.
## Archivos tocados
- `apps/api/src/operations/http-flow-inventory.ts` (nuevo), `http-flow-support.ts` (+campo `confirm`), `apps/api/src/http-flow.local.test.ts` (+test).
## Verificación
```powershell
pnpm --filter @super-restaurant/api run typecheck; pnpm --filter @super-restaurant/api run lint; pnpm --filter @super-restaurant/api exec tsc --project tsconfig.test.build.json
```
```text
typecheck_EXIT=0 ; lint_EXIT=0 ; testbuild_EXIT=0 ; emitidos .test-dist/http-flow.local.test.js y .test-dist/operations/http-flow-inventory.js
```
## Riesgos / dudas
- NO VERIFICADO: corrida PG/HTTP real (`test:http:local -- --local-disposable-only`), prohibida por el brief; la ejecuta el orquestador con `LOCAL_POSTGRES_BIN`. `git status --short`: M `http-flow-support.ts`, M `http-flow.local.test.ts`, ?? `http-flow-inventory.ts` (más reportes `.agents/*` ajenos sin tocar).
## Notas propuestas
- ninguna.