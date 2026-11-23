# Deuda tecnica (P3)

Hallazgos P3 y atajos registrados. No se ejecutan durante el hito abierto: se
revisan al cierre del hito y, si aplica, pasan al backlog del siguiente.

## Formato

| Fecha | Hito | Item | Descripcion | Motivo del atajo | Seguimiento |
|---|---|---|---|---|---|
| - | - | - | - | - | - |

## Registradas

- **m1-sec-rate-limit:** los contadores viven en memoria por proceso; reinicios y réplicas no comparten cuota. El límite previo usa la IP del socket, que puede identificar al proxy en despliegues detrás de uno. Adoptar almacenamiento compartido y una configuración explícita de proxies confiables antes de depender de estos límites en producción. El login directo a Supabase requiere protección del proveedor.

| Fecha | Hito | Item | Descripcion | Motivo del atajo | Seguimiento |
|---|---|---|---|---|---|
| 2026-11-22 | AO M0 | P2 · smoke E2E limitado | El smoke de Playwright solo cubre `/health` y `/login`; no ejercita flujos de producto. | Prioridad a desbloquear el CI de M0. | Ampliar los flujos E2E al cierre del hito. |
| 2026-11-22 | AO M0 | P2 · guardia CI opcional en `database.ts` | En `apps/api/src/database.ts` la guardia ligada a `CI === "true"` es opcional y no se ejerce fuera de CI. | Se mantiene para no alterar el arranque local. | Revisar al cierre del hito y hacerla explícita. |
| 2026-11-22 | AO M0 | P3 · robustez de `stop()` en `local-postgres` | `LocalPostgres.stop()` puede dejar limpieza incompleta si fallan `pg_ctl` o `admin.end()`. | Solo afecta a fixtures locales desechables. | Endurecer la limpieza en una tarea mecánica. |
| 2026-11-22 | M1 | P2 · `registerId = deviceId` en cobro mobile (`m1-mobile-pay-note`) | `apps/mobile/src/ui/app.tsx` usa `deviceId` como `registerId` al consultar `/api/v1/cash-registers/report` y `/api/v1/payments/checkout`; no descubre ni permite elegir otra caja abierta de la sucursal ni abrir caja desde mobile. | Reutilizar los endpoints existentes sin introducir nuevas rutas o migraciones en nivel C. | Añadir selección de caja abierta o apertura controlada cuando se amplíe la operación de caja en mobile. |
| 2026-11-22 | M1 | P3 · tabla `FRACTION_DIGITS` duplicada (`m1-mobile-pay-note`) | `apps/mobile/src/money.ts` define `FRACTION_DIGITS` (incluyendo `XTS` para fixtures) en paralelo a `apps/web/src/lib/money-scale.ts`. | Evitar tocar `packages/shared-types` (carril de un solo escritor) en una tarea de nivel C. | Consolidar una tabla compartida de escala monetaria por código ISO en `packages/shared-types` al cerrar M1. |

## M0-7 — Fallos conocidos de CI (pendiente)

- Reparado en migración nueva: `confirm_capture_draft_v3` usa los grupos y opciones de pizza V2; `pizza_model_v2_invariants.sql` y su verificador rollback pasan localmente. `order_deliveries_invariants.sql` también pasa en PostgreSQL local con fixtures de CI. Ambos se retiraron de la tolerancia.
- Siguen tolerados, reproducidos en PostgreSQL 17 desechable con los dos usuarios de CI:
  - `capture_drafts_invariants.sql`: `CAPTURE_CLAIM_ACTIVE_RESERVATION_ACCEPTED`.
  - `capture_repeat_order_invariants.sql`: `permission denied for schema app` bajo `app_api`.
  - `capture_selection_plan_invariants.sql`: `CAPTURE_SELECTION_CONFIRMATION_APPLY_OR_REPLAY_REJECTED`.
  - `delivery_zones_invariants.sql`: `DELIVERY_ZONES_WAITER_WRITE_ACCEPTED`.
  - `menu_shared_modifier_groups_invariants.sql`: `permission denied for schema app` bajo `app_api`.
- Investigar cada fallo y distinguir errores de fixture de errores de producto antes de retirar su tolerancia; conservar las pruebas de permisos.
- `Run local HTTP flow` sigue con `continue-on-error`: `order_detail` responde `503 ORDER_UNAVAILABLE` en CI. Reparar y retirar la tolerancia.
- Salida: los cinco tests restantes y el flujo HTTP pasan en CI sin tolerancia; eliminar `KNOWN_FAILING_SQL_TESTS` y `continue-on-error`.
