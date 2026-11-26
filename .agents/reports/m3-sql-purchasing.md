Now I'll create the purchasing migration.
I spotted a PL/pgSQL variable/column ambiguity (`order_id`) in the test. Let me rewrite it with safe names.
## Estado
done — migración 00400, invariantes 1–7 y verificador registrado; PostgreSQL lo valida el orquestador.

## Qué hice
- `inventory_suppliers`/`purchase_orders`/`purchase_order_lines` con FK de scope, checks de estado/enteros, RLS `ENABLE+FORCE` y lectura por restaurante/sucursal; escritura sólo por funciones privadas.
- `inventory_create_purchase_order` (rol owner/admin/manager, insumo/unidad/enteros) e `inventory_receive_purchase_order` (sólo `draft|sent`, idempotencia `receipt:order:line`, replay sin mover stock).
- Trigger `BEFORE INSERT` estampa `unit_cost_minor`/`currency` en movimientos `purchase_order_line` porque `inventory_record_movement` no recibe costo.

## Archivos tocados
- `supabase/migrations/20261126000400_inventory_purchasing.sql`, `supabase/tests/inventory_purchasing_invariants.sql` (nuevos); `apps/api/src/operations/inventory-schema-verification.ts`, `apps/api/src/operations/run-inventory-schema-verification.ts`.

## Verificación
```
. .\tools\agentic\use-node24.ps1; $PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"; & $PNPM --filter @super-restaurant/api typecheck
Node activo: v24.19.0  (C:\Users\Emmanuel G\AppData\Local\Programs\node24)
pnpm: 11.19.0
$ tsc --noEmit --project tsconfig.json
EXIT=0
```
NO VERIFICADO: PostgreSQL/rollback (binario fuera del worktree; lo corre el orquestador).

## Riesgos / dudas
- Trigger de costo y `unique (restaurant_id, id)` añadido a `inventory_items`: revisar choque con el carril recetas (00300) al fusionar.

## Notas propuestas
- ninguna