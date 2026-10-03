# tables-board-r2 (addendum; revisión Sonnet CORREGIR sobre f65864e)

## Tarea
tables-board-r2 · capa: L1 (`implementer-claude`, mismo escritor) · riesgo: alto · nivel A (migración candidata aún no aplicada: se edita en sitio, no se crea otra; API y pruebas).

## Hallazgos a cerrar
- [P2-1] `assign_order_waiter` (SQL) y `apps/api/src/order-waiter.ts:~105`: el audit lleva `from` siempre `null`. El SQL debe construir `from` desde `v_current.waiter_user_id` leído bajo `for update` e ignorar o rechazar (conflict) un `from` del cliente que no coincida; el servicio deja de enviar `previousWaiterUserId`. Corregir el comentario falso. Prueba SQL de reasignación A→B que verifique `from = A`, y prueba API.
- [P2-2] `open_operational_shift`: `idempotencyKey` se valida pero no se persiste. Registrar la apertura en una tabla de auditoría propia (`app.operational_shift_events` con actor, scope, shift_id, event_id, idempotency_key única por actor+scope, payload, created_at) y deduplicar por esa clave con comparación de payload (replay) o conflict si difiere. Corregir el comentario. Prueba SQL de replay y de clave reutilizada con payload distinto.
- [P2-3] `assign_order_waiter` debe limitarse a órdenes `draft|open|partially_paid`; en `paid|closed|cancelled` → conflict sin mutar. Prueba SQL con `order_b` (closed).
- [P3-1] Pruebas SQL de aislamiento cruzado: una orden de otra sucursal/restaurante no aparece en `list_table_board` del scope propio; `assign_order_waiter` con `order_id` de otro scope → conflict/not found sin mutar.

## Criterios
- [ ] Migración `20261004000200_table_board.sql` corregida (candidata, no aplicada), prueba SQL ampliada, sonda local PG17 ok (última línea en el informe).
- [ ] API ajustada y pruebas; puertas `pnpm --filter @super-restaurant/api test && typecheck && lint && build`, shared-types test/typecheck si cambia algo.
- [ ] Commits `fix(db): …`, `fix(api): …`. Informe breve.
