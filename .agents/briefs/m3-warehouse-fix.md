# REGLA DURA: no ejecutes PostgreSQL ni Playwright. No hagas commit/push.

# Brief m3-warehouse-fix (nivel A · dos P2 de la revisión)

Worktree: `C:\Users\Emmanuel G\harness-wt\superRestaurant\m3-default-warehouse`, rama
`harness/m3-default-warehouse` (PR #125, ya rebasada sobre `main`). **No cambies de rama.**

## P2-1 — PATCH incoherente con `isDefault`

`supabase/migrations/20261126001300_inventory_default_warehouse.sql` (~línea 304) hace
`is_default = (p_is_default and p_active)`: un `PATCH {isDefault:true, active:false}` responde 200 con
`isDefault:false`, mientras el POST responde `400` (`22000
INVENTORY_WAREHOUSE_DEFAULT_REQUIRES_ACTIVE`). Unifica: en `update_inventory_warehouse`, si
`p_is_default` y `not p_active` lanza `22000 INVENTORY_WAREHOUSE_DEFAULT_REQUIRES_ACTIVE`; si solo se
desactiva un almacén que era predeterminado, se limpia el flag como hoy (sin error). Añade el caso a
`supabase/tests/inventory_default_warehouse_invariants.sql` (PATCH default+inactive → 22000; desactivar
el default → queda sin default y sin error).

## P2-2 — falta la prueba de aislamiento en update

En `apps/api/src/inventory/items.test.ts` añade un caso: `updateWarehouse` con el `warehouseId` de otro
restaurante/sucursal responde `missing`/`conflict` según el comportamiento actual (lee primero cómo lo
resuelve el servicio y afirma **ese** contrato, con `isDefault: true` en el patch incluido), y que no
se ejecuta el SQL de update. Si el servicio ya devuelve `missing`, fíjalo así.

## Archivos (exactos)

- `supabase/migrations/20261126001300_inventory_default_warehouse.sql`
- `supabase/tests/inventory_default_warehouse_invariants.sql`
- `apps/api/src/inventory/items.test.ts`
- `apps/api/src/inventory/items.service.ts` (solo si el P2-2 descubre un hueco real de scope)

Prohibido tocar cualquier otro archivo.

## Puertas

```powershell
. .\tools\agentic\use-node24.ps1
$ErrorActionPreference='Continue'
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/api run typecheck
& $PNPM --filter @super-restaurant/api run lint
& $PNPM --filter @super-restaurant/api run test
```

El verificador rollback-only lo corre el orquestador. Informe en
`.agents/reports/m3-warehouse-fix.md`: qué cambió, qué prueba cubre cada P2 y qué no se pudo probar.
