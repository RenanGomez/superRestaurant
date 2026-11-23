# Deuda tecnica (P3)

Hallazgos P3 y atajos registrados. No se ejecutan durante el hito abierto: se
revisan al cierre del hito y, si aplica, pasan al backlog del siguiente.

## Formato

| Fecha | Hito | Item | Descripcion | Motivo del atajo | Seguimiento |
|---|---|---|---|---|---|
| - | - | - | - | - | - |

## Registradas

| Fecha | Hito | Item | Descripcion | Motivo del atajo | Seguimiento |
|---|---|---|---|---|---|
| 2026-11-22 | AO M0 | P2 · smoke E2E limitado | El smoke de Playwright solo cubre `/health` y `/login`; no ejercita flujos de producto. | Prioridad a desbloquear el CI de M0. | Ampliar los flujos E2E al cierre del hito. |
| 2026-11-22 | AO M0 | P2 · guardia CI opcional en `database.ts` | En `apps/api/src/database.ts` la guardia ligada a `CI === "true"` es opcional y no se ejerce fuera de CI. | Se mantiene para no alterar el arranque local. | Revisar al cierre del hito y hacerla explícita. |
| 2026-11-22 | AO M0 | P3 · robustez de `stop()` en `local-postgres` | `LocalPostgres.stop()` puede dejar limpieza incompleta si fallan `pg_ctl` o `admin.end()`. | Solo afecta a fixtures locales desechables. | Endurecer la limpieza en una tarea mecánica. |
| 2026-11-22 | M1 | P2 · `registerId = deviceId` en cobro mobile (`m1-mobile-pay-note`) | `apps/mobile/src/ui/app.tsx` usa `deviceId` como `registerId` al consultar `/api/v1/cash-registers/report` y `/api/v1/payments/checkout`; no descubre ni permite elegir otra caja abierta de la sucursal ni abrir caja desde mobile. | Reutilizar los endpoints existentes sin introducir nuevas rutas o migraciones en nivel C. | Añadir selección de caja abierta o apertura controlada cuando se amplíe la operación de caja en mobile. |
| 2026-11-22 | M1 | P3 · tabla `FRACTION_DIGITS` duplicada (`m1-mobile-pay-note`) | `apps/mobile/src/money.ts` define `FRACTION_DIGITS` (incluyendo `XTS` para fixtures) en paralelo a `apps/web/src/lib/money-scale.ts`. | Evitar tocar `packages/shared-types` (carril de un solo escritor) en una tarea de nivel C. | Consolidar una tabla compartida de escala monetaria por código ISO en `packages/shared-types` al cerrar M1. |

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
