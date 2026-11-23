# Deuda técnica

Registro de deuda aceptada, con su identificador, impacto y condición de salida.

## M0-7 — Fallos conocidos de M0-7 (CI)

- Estado: aceptada temporalmente; tests tolerados en `.github/workflows/ci.yml`
  (`KNOWN_FAILING_SQL_TESTS`). Cualquier otro test que falle sigue marcando el paso en rojo.
- Motivo: fallan en CI al correr en lote; reparar y quitar de la lista.
- Tests tolerados:
  - `supabase/tests/pizza_model_v2_invariants.sql` — `app_private.confirm_capture_draft_v3` roto
    (`record "product" has no field "base_group_id"`).
  - `supabase/tests/capture_drafts_invariants.sql`
  - `supabase/tests/capture_repeat_order_invariants.sql`
  - `supabase/tests/capture_selection_plan_invariants.sql`
  - `supabase/tests/delivery_zones_invariants.sql`
  - `supabase/tests/menu_shared_modifier_groups_invariants.sql`
  - `supabase/tests/order_deliveries_invariants.sql`
- Verificadores omitidos en CI: `verify:pizza-model-v2-schema:rollback` se quitó de
  `Run compatible rollback verifiers` por el mismo bug M0-7
  (`confirm_capture_draft_v3`/`base_group_id`); restaurar al reparar.
- Paso tolerado en CI: `Run local HTTP flow` usa `continue-on-error: true` porque el flujo
  local no está verde en CI (`order_detail` responde `503 ORDER_UNAVAILABLE`); el fixture de
  entrega se corrigió para cotizar por CP, pero el flujo sigue sin pasar. Quitar el
  `continue-on-error` al repararlo.
- Condición de salida: los siete tests pasan en CI sin tolerancia, se elimina la lista
  `KNOWN_FAILING_SQL_TESTS` del paso `Run SQL tests`, se restaura la línea
  `verify:pizza-model-v2-schema:rollback` y se quita el `continue-on-error` de
  `Run local HTTP flow`.
