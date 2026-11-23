# Deuda tecnica (P3)

Hallazgos P3 y atajos registrados. No se ejecutan durante el hito abierto: se
revisan al cierre del hito y, si aplica, pasan al backlog del siguiente.

## Formato

| Fecha | Hito | Item | Descripcion | Motivo del atajo | Seguimiento |
|---|---|---|---|---|---|
| - | - | - | - | - | - |

## Registradas

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
