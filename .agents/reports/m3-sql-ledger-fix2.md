I'll start by reading the operational files and the target migration/test files.
Now I'll implement the function fixes in the migration.
## Estado
done — P1/P2 del ledger SQL corregidos con pruebas; sin commit.

## Qué hice
- Reverso: compensa `sale_consumption` del mismo restaurant/branch/warehouse/item, delta inverso exacto y único → `INVENTORY_REVERSAL_INVALID` (22000).
- Idempotencia compara branch/warehouse/item/source_type/source_id/compensates → `INVENTORY_IDEMPOTENCY_CONFLICT`; rechaza insumo con `deleted_at` e inventario `active=false`.
- Pruebas: reversos válido/duplicado/signo/almacén, scope `foreign_item`/`foreign_warehouse`, privilegios (solo `app_api` ejecuta), balances FORCE RLS + aislamiento, source unique y delta=0 por el check correcto.

## Archivos tocados
- `supabase/migrations/20261126000200_inventory_ledger.sql`; `supabase/tests/inventory_ledger_invariants.sql` (diff disponible en el worktree).

## Verificación
```
$ . .\tools\agentic\use-node24.ps1; node -v; & $PNPM --filter @super-restaurant/api typecheck
v24.19.0
$ tsc --noEmit --project tsconfig.json
EXITCODE=0
```

## Riesgos / dudas
- NO VERIFICADO: PG por orquestador (sin PostgreSQL en el worktree; `verify:inventory-schema:rollback`). Unicidad de reverso validada en la función (única vía de escritura), no en índice parcial.

## Notas propuestas
- ninguna