## Estado — done: migración, API, pruebas y registros aplicados; typecheck/lint/test verdes.
## Qué hice — alertas por saldo, costo medio entero, coste de receta y margen estimado; API, AppModule, scripts.test, smoke 401 y verificadores.
## Archivos tocados
- supabase/migrations/20261126001100_inventory_costing_api.sql; supabase/tests/inventory_costing_api_invariants.sql
- apps/api/src/inventory/costing.{service,controller,test}.ts; app.module.ts; app.smoke.test.ts; package.json; operations/inventory-schema-verification.ts; operations/run-inventory-schema-verification.ts
- git status --short (filtrado): M package.json, app.module.ts, app.smoke.test.ts, operations/inventory-*; ?? costing.*, migración y prueba SQL
## Verificación
```powershell
. .\tools\agentic\use-node24.ps1; $PNPM="C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"; & $PNPM --filter @super-restaurant/api typecheck; & $PNPM --filter @super-restaurant/api lint
Node activo: v24.19.0; pnpm: 11.19.0; $ tsc --noEmit --project tsconfig.json; $ eslint --max-warnings=0 --config ../../eslint.config.mjs src
& $PNPM --filter @super-restaurant/api test
✔ HTTP contract: 401, 400, 200, 403 and 200 for the costing endpoints (422.797ms); ℹ tests 11; ℹ pass 11; ℹ fail 0
```
## Riesgos / dudas — SQL no ejecutado por prohibición del brief: falta verify:inventory-schema:rollback; producto sin sucursal usa el primer default accesible y el margen usa catálogo/receta actuales (documentado).
## Notas propuestas — ninguna