# Brief m3-sql-ledger (nivel A · SQL inventario: ledger inmutable)

## Objetivo
Ledger de movimientos de inventario inmutable, saldo derivado y función privada de registro idempotente.

Tiempo estimado: 40 min. Carril SQL: eres el único escritor de `supabase/migrations/**` y `supabase/tests/**` en esta tarea.

## Alcance
- Crea: `supabase/migrations/20261126000200_inventory_ledger.sql`, `supabase/tests/inventory_ledger_invariants.sql`.
- Edita: `apps/api/src/operations/inventory-schema-verification.ts` (añadir el nuevo test a la lista), `apps/api/src/operations/run-inventory-schema-verification.ts` (comprobar que la migración nueva está en `listMigrationNames()`).
- Prohibido: editar `20261126000100_inventory_catalog.sql` ni migraciones integradas; tocar otras apps; instalar dependencias; remoto. Sin commit ni push.
- Temporales en `.harness/state/tmp/`; bórralos al terminar.

## Fuente de verdad
`docs/adr/ADR-013.md` §2.4, §2.5, §2.13, §3. Base: `app.inventory_items` y `app.inventory_warehouses` de `20261126000100_inventory_catalog.sql` (ya en tu worktree). Patrón de seguridad: funciones `app_private.*` con `SECURITY DEFINER`, `search_path = ''`, `OWNER TO postgres`, `REVOKE ALL`, `GRANT EXECUTE TO app_api`.

## Qué construir
### Tablas
- `app.inventory_movements`: `id uuid pk default gen_random_uuid()`, `restaurant_id`, `branch_id`, `warehouse_id` (FK), `item_id` (FK), `kind text not null check (kind in ('receipt','sale_consumption','sale_reversal','waste','adjustment','transfer_out','transfer_in','count_adjustment'))`, `quantity_delta integer not null check (quantity_delta <> 0)`, `unit_code text not null`, `occurred_at timestamptz not null`, `recorded_at timestamptz not null default now()`, `actor_id uuid not null`, `device_id uuid`, `reason text`, `idempotency_key text not null`, `compensates_movement_id uuid references app.inventory_movements(id)`, `source_type text`, `source_id uuid`, `unit_cost_minor bigint check (unit_cost_minor is null or unit_cost_minor >= 0)`, `currency text`. Únicos: `(restaurant_id, idempotency_key)` y `(restaurant_id, source_type, source_id, kind, item_id)` cuando `source_id is not null`.
- Checks: `waste`/`adjustment`/`count_adjustment`/`transfer_out`/`transfer_in` exigen `reason` no vacío; `sale_reversal` exige `compensates_movement_id`; `unit_code` debe coincidir con el del insumo (validado en la función, no en un check cruzado).
- `app.inventory_balances`: `warehouse_id`, `item_id`, `quantity integer not null`, `updated_at`, PK `(warehouse_id, item_id)`. Tabla derivada: solo la escribe la función privada, nunca un cliente.
- Trigger `app_private.reject_inventory_movement_mutation()` `BEFORE UPDATE OR DELETE` que lanza `raise exception 'INVENTORY_MOVEMENT_IMMUTABLE' using errcode = '42501'`.
- RLS `ENABLE` + `FORCE` en ambas, lectura por scope de restaurante/sucursal (misma función de autorización que el catálogo). Sin grants directos.

### Función privada
```sql
app_private.inventory_record_movement(
  p_actor_id uuid, p_restaurant_id uuid, p_branch_id uuid, p_warehouse_id uuid,
  p_item_id uuid, p_kind text, p_quantity_delta integer, p_reason text,
  p_idempotency_key text, p_source_type text, p_source_id uuid,
  p_compensates_movement_id uuid, p_occurred_at timestamptz, p_device_id uuid
) returns jsonb
```
- Valida scope (almacén del branch, insumo del restaurante), unidad del insumo, motivo obligatorio y actor con membresía.
- Idempotencia: `insert ... on conflict (restaurant_id, idempotency_key) do nothing returning id`; si no insertó, relee por key y devuelve `{status:'duplicate', movementId}` solo si el payload coincide (kind, item, delta, reason); si difiere, `INVENTORY_IDEMPOTENCY_CONFLICT` (SQLSTATE `22000`).
- Actualiza `app.inventory_balances` con `on conflict ... do update set quantity = quantity + excluded.quantity` y devuelve `{status:'recorded', movementId, balance}`.
- `REVOKE ALL ... FROM PUBLIC` y `GRANT EXECUTE ... TO app_api`; cero grants a `authenticated`.

### Invariantes `supabase/tests/inventory_ledger_invariants.sql`
1. `UPDATE` y `DELETE` sobre `inventory_movements` fallan con `42501`.
2. Mismo `idempotency_key` con el mismo payload devuelve `duplicate` y no duplica movimiento ni saldo.
3. Mismo `idempotency_key` con payload distinto lanza `INVENTORY_IDEMPOTENCY_CONFLICT`.
4. `quantity_delta = 0` rechazado por check.
5. `waste` sin `reason` rechazada.
6. `sale_reversal` sin `compensates_movement_id` rechazada.
7. Un actor de otro restaurante no puede registrar (aislamiento) ni leer movimientos ajenos.
8. El saldo tras tres movimientos (100, -30, -20) es 50.

## Puertas (obligatorio, Node 24.19.0)
El binario de PostgreSQL local vive fuera de tu worktree y el sandbox lo rechaza: **no ejecutes el verificador**. El orquestador corre después `verify:inventory-schema:rollback`.
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/api typecheck
& $PNPM --filter @super-restaurant/api lint
```

## Hecho cuando
Migración, invariantes 1–8 y verificador escritos y coherentes; `typecheck`, `lint` y `git diff --check` limpios con salida real; el informe marca `NO VERIFICADO: PG por orquestador`.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con archivos, decisiones y bloques comando + salida real. Sin evidencia = NO VERIFICADO.
Aplica Ponytail: cambio más pequeño correcto, sin recortar validación, seguridad ni pruebas.
