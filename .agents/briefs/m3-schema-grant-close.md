# Brief m3-schema-grant-close (nivel A · retirar EXECUTE del ledger crudo)

## Objetivo

Cerrar el P2 de compras: `app_private.inventory_record_movement` conserva `EXECUTE` para el rol
`app_api`, así que la API podría insertar un movimiento `receipt` (o cualquier otro) saltándose la
recepción de compras y bloquear la legítima por el único de `source`. Se retira el grant y la API pasa
a escribir movimientos manuales por un envoltorio por operación.

Insumo ya en `main` (léelo antes de escribir):

- `supabase/migrations/20261126000200_inventory_ledger.sql` — define
  `app_private.inventory_record_movement(p_actor_id, p_restaurant_id, p_branch_id, p_warehouse_id,
  p_item_id, p_kind, p_quantity_delta, p_reason, p_idempotency_key, p_source_type, p_source_id,
  p_compensates_movement_id, p_occurred_at, p_device_id)` y en su cola hace `revoke all … from public,
  anon, authenticated, service_role, app_api` + `grant execute … to app_api`.
- `supabase/migrations/20261126000800_inventory_movement_api.sql` — ejemplo de envoltorio
  (`app_private.inventory_transfer`) con `security definer`, `set search_path = ''`, comentario de
  cabecera, `alter function … owner to postgres`, `revoke`/`grant` a `app_api`.
- `apps/api/src/inventory/movements.service.ts` — `recordManualSql` llama hoy al ledger crudo con 12
  parámetros y `gen_random_uuid()`/`clock_timestamp()` en SQL.
- `supabase/tests/inventory_ledger_invariants.sql` (líneas ~40-70) — hoy **exige** que `app_api` sí
  pueda ejecutar el ledger crudo; hay que invertir esa aserción.
- `supabase/tests/inventory_movements_api_invariants.sql` — pruebas de los envoltorios de movimientos.
- `apps/api/src/operations/inventory-schema-verification.ts` y
  `apps/api/src/operations/run-inventory-schema-verification.ts` — registro de migraciones e
  invariantes del verificador.

## Diseño exigido

1. Migración nueva `supabase/migrations/20261126001200_inventory_manual_movement_api.sql` (no editar
   ninguna migración aplicada):
   - `create function app_private.inventory_record_manual_movement(p_actor_id uuid, p_restaurant_id
     uuid, p_branch_id uuid, p_warehouse_id uuid, p_item_id uuid, p_kind text, p_quantity_delta
     integer, p_reason text, p_idempotency_key text, p_device_id uuid) returns jsonb`,
     `language plpgsql volatile security definer set search_path = ''`.
   - Valida argumentos nulos con `22000` y código propio (p. ej.
     `INVENTORY_MANUAL_MOVEMENT_ARGUMENT_MISSING`); restringe `p_kind` a `adjustment`, `waste` y
     `count_adjustment` (cualquier otro → `22000 INVENTORY_MANUAL_MOVEMENT_KIND_INVALID`); exige
     `p_reason` no vacío (`22000 INVENTORY_MANUAL_MOVEMENT_REASON_REQUIRED`); `p_quantity_delta` no
     puede ser 0 si el ledger crudo ya lo rechaza (no dupliques esa regla: deja que el mensaje del
     ledger suba).
   - Llama al ledger crudo con `p_source_type => 'inventory_manual'`, `p_source_id => null`,
     `p_compensates_movement_id => null`, `p_occurred_at => pg_catalog.clock_timestamp()` y
     `p_idempotency_key` tal cual. Nada de `receipt`/`sale_consumption` alcanzable desde aquí.
   - Cola: `alter function … owner to postgres`; `revoke all on function
     app_private.inventory_record_manual_movement(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,uuid)
     from public, anon, authenticated, service_role;` + `grant execute … to app_api`; y
     **`revoke all on function app_private.inventory_record_movement(uuid,uuid,uuid,uuid,uuid,text,
     integer,text,text,text,uuid,uuid,timestamptz,uuid) from public, anon, authenticated,
     service_role, app_api;`** (sin grant posterior).
2. `apps/api/src/inventory/movements.service.ts`: `recordManualSql` pasa a
   `select app_private.inventory_record_manual_movement($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::integer,$8::text,$9::text,$10::uuid) as result`
   y ajusta el array de parámetros (actor, restaurante, sucursal, almacén, insumo, kind, delta, motivo,
   idempotencia, device). No cambies firmas públicas ni el mapeo de errores; conserva el filtro
   `MANUAL_KINDS` de la API como primera barrera.
3. `supabase/tests/inventory_ledger_invariants.sql`: invertir la aserción — `app_api` **no** debe poder
   ejecutar `inventory_record_movement`; el resto de roles tampoco. Las llamadas internas del propio
   test (corren como `postgres`) siguen igual.
4. `supabase/tests/inventory_movements_api_invariants.sql`: añadir pruebas de que
   (a) `app_api` puede ejecutar `inventory_record_manual_movement`, (b) `app_api` **no** puede ejecutar
   `inventory_record_movement` (`has_function_privilege` en falso), (c) bajo `set local role app_api`
   un movimiento manual válido registra saldo y replay con misma idempotencia devuelve `duplicate`,
   (d) el envoltorio rechaza `p_kind = 'receipt'` con el código esperado y no crea fila.
5. `apps/api/src/operations/run-inventory-schema-verification.ts`: exigir la migración
   `20261126001200_inventory_manual_movement_api.sql` (mismo patrón que las demás). Añade el
   `inventory…InvariantSql` nuevo solo si creas un archivo de test nuevo; si amplías
   `inventory_movements_api_invariants.sql`, no hace falta función extra.

## Archivos (exactos, eres el único escritor)

- `supabase/migrations/20261126001200_inventory_manual_movement_api.sql` (nuevo)
- `apps/api/src/inventory/movements.service.ts`
- `apps/api/src/inventory/movements.test.ts` (solo si el mock de SQL lo exige)
- `supabase/tests/inventory_ledger_invariants.sql`
- `supabase/tests/inventory_movements_api_invariants.sql`
- `apps/api/src/operations/run-inventory-schema-verification.ts`

Prohibido tocar: `apps/web/**`, `packages/**`, `app.module.ts`, `package.json`, otras migraciones,
`docs/**`.

## Reglas de la sesión

- No hagas `git commit`, `git push`, ni crees ramas o PRs.
- **No ejecutes PostgreSQL ni el verificador**: el orquestador corre
  `pnpm --filter @super-restaurant/api run verify:inventory-schema:rollback`. Tú no tienes PG.
- Puedes y debes ejecutar typecheck, lint y unitarias del API.

## Puertas que debes ejecutar

```powershell
. .\tools\agentic\use-node24.ps1
$ErrorActionPreference='Continue'
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/api run typecheck
& $PNPM --filter @super-restaurant/api run lint
& $PNPM --filter @super-restaurant/api run test
```

## Hecho cuando

Typecheck, lint y unitarias del API en verde; la migración y los tests SQL escritos según el diseño;
`.agents/reports/m3-schema-grant-close.md` explica el diseño, qué se probó y qué queda para el
verificador rollback-only. Aplica AGENTS §9/§12 y §15.
