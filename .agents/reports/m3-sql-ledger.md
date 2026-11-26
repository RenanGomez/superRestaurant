## Estado
done — ledger inmutable, balances derivados, función idempotente e invariantes 1–8 escritos.

## Qué hice
- Migración con tablas, trigger 42501, RLS + FORCE, `app_private.inventory_record_movement` y grants solo a `app_api`; test transaccional de 8 invariantes; verificador actualizado.

## Archivos tocados
- supabase/migrations/20261126000200_inventory_ledger.sql; supabase/tests/inventory_ledger_invariants.sql; apps/api/src/operations/inventory-schema-verification.ts; apps/api/src/operations/run-inventory-schema-verification.ts.

## Verificación
```
. .\tools\agentic\use-node24.ps1; node -v; & $PNPM --filter @super-restaurant/api typecheck; & $PNPM --filter @super-restaurant/api lint; git diff --check
v24.19.0; $ tsc --noEmit --project tsconfig.json; typecheck_exit=0; $ eslint --max-warnings=0 --config ../../eslint.config.mjs src; lint_exit=0; diff_check_exit=0
```

## Riesgos / dudas
- NO VERIFICADO: PG por orquestador (binario fuera del worktree); nada más abierto.

## Notas propuestas
- ninguna