# Brief p3-6-probe-v2 (nivel A, SQL; NO ejecutar contra ninguna base remota)

## Objetivo
Nueva migración `supabase/migrations/20261120000200_capture_selection_plan_probe_v2.sql` que redefine `probe_capture_selection_plan_replace` (última definición en `20261001000100_capture_payment_intent.sql`; origen en `20260928000100_capture_selection_plan.sql`) para aceptar planes `schemaVersion` 2 con `lines[].pizza` (ver `docs/architecture/PIZZA_MODEL_V2.md`, `supabase/migrations/20261120000100_pizza_model_v2.sql`, `packages/shared-types/src/capture-selection-plan.ts` y `apps/api/src/captures.ts`). Debe seguir aceptando schemaVersion 1 sin cambios de comportamiento; validar pizza fail-closed (dos mitades, fracciones, ruleVersion `pizza-halves-v2`, ids de la misma sucursal/restaurante); no calcular precios nuevos ni mezclar tenants.

## Reglas
- No editar migraciones ya aplicadas; solo la nueva. Incluye rollback documentado en comentario.
- Añade casos a `supabase/tests/capture_selection_plan_invariants.sql` (rollback-only) para v2 válido, v2 inválido y v1 intacto. NO ejecutarlos (no hay PostgreSQL); di claramente que no se ejecutaron.
- Tu worktree se corta de HEAD sin trabajo sin commitear: PASO 0 copia desde el checkout principal `C:/Users/Emmanuel G/Documents/ChatGPT/superRestaurant` los archivos citados (supabase/, docs/architecture, packages/shared-types/src, apps/api/src/captures.ts). Prohibido commit/push, remoto, Supabase.
- Devuelve rutas absolutas de los archivos nuevos/cambiados en tu worktree y el resumen; yo los copio a main.
