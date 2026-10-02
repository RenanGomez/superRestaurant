# tables-board · mesas operativas: estado, cuenta y mesero

## Tarea
tables-board · capa: L1 (`implementer-claude`, razonamiento alto) · riesgo: alto · **nivel A** (migración SQL, contrato de Order consumido por web y mobile, lector con alcance) para las unidades 1-3; la unidad 4 (UI) es nivel C y se hace en un paquete posterior para Codex, pero este paquete deja listo todo lo que la UI necesita.

## Objetivo
Que el plano de mesas sirva para operar: el servidor devuelve por mesa si está libre u ocupada, la cuenta activa, su total, el mesero y la hora de apertura; se puede abrir una cuenta en una mesa (Order canal `table` ligada al turno abierto) y asignar o cambiar mesero con auditoría; el operador nunca elige turno a mano.

## Hechos verificados (main 7047fbe, researcher 2026-10-01)
- `app.dining_zones` (`20260831000100`) y `app.dining_tables` con layout (`20260901000100`, 224 líneas); API `apps/api/src/dining-tables.ts` (`DiningTableService`, `GET /dining/layout`, `POST /dining/tables`, `PATCH /dining/tables/layout`).
- `app.operational_shifts` (`20260905000100`): única `open` por sucursal; `order_operational_shifts` y `app_private.create_operational_order`, `app_private.list_active_table_orders` (`20260905000200`, 276 líneas). `CreateOrderCommandV2` con `shiftId` (`packages/shared-types/src/orders.ts:36`), `ActiveTableOrderListV2` (`:88`); `OrderService.create` ya persiste con `operationalShiftId`. `GET /orders/active?tableId` (`apps/api/src/table-order-context.ts:55`, controlador `:17`).
- Turnos: existe `app_private.list_active_operational_shifts`; la captura web consulta `GET /shifts/active` (`apps/web/src/lib/capture-confirmation-context.ts:28`): confirmar con CodeGraph si el controlador existe y si hay endpoint para **abrir** turno; si no lo hay, añadirlo (unidad 0).
- RBAC (`apps/api/src/auth/rbac-policy.ts`): rol `waiter` con `tables.read`, `orders.read/create/update/cancel.pending`. No hay `waiterId` en Order ni tabla de asignación.
- UI actual `/app` muestra `DiningZone` (editor arrastrable de admin, `apps/web/src/app/app/dining-zone.tsx`), sin estado operativo.

## Diseño (seguir salvo razón documentada)
0. **Turnos** (sólo si falta): `POST /shifts/open` (permiso de gerente/cajero existente que mejor encaje; justificar) que abre el turno de la sucursal vía función SQL existente o nueva en la misma migración; `GET /shifts/active` si no existe. Contratos exactos.
1. **Migración** `supabase/migrations/20261004000200_table_board.sql`: columna aditiva `waiter_user_id uuid null` en `app.orders` (FK a usuarios/memberships según el patrón de `actor_id`), con auditoría: la asignación se registra como evento en `app.order_audit_events` (`operation = 'order.waiter_assigned'`, payload con `from`/`to`) mediante función `app_private.assign_order_waiter(actor, expected_version, order_id, waiter_user_id, audit jsonb)` que valida membresía del mesero en la misma sucursal y avanza versión como `persist_order_mutation`; función lectora `app_private.list_table_board(actor, restaurant, branch)` que devuelve por mesa: `tableId, name, zoneId, zoneName, capacity, layout (x,y,w,h), status ('free'|'occupied'), activeOrders[{orderId, status, version, totalMinor, currency, waiterUserId, waiterName, openedAt}]`, derivando `occupied` de órdenes `draft|open|partially_paid` con `table_id`; alcance y membresía revalidados en SQL; EXECUTE sólo `app_api`. Prueba `supabase/tests/table_board_invariants.sql` (aislamiento por sucursal, estado derivado, mesero de otra sucursal rechazado, auditoría del cambio). Sonda local PG17 como `run-send-order-to-kitchen-schema-verification.ts`.
2. **Contratos** (shared-types, aditivos): `TableBoardV1` + `parseTableBoardV1`; `AssignOrderWaiterCommandV1` (audit input + `orderId`, `expectedVersion`, `waiterUserId | null`); `waiterUserId: string | null` en las lecturas de Order donde ya se exponga la orden (detalle `OrderDetailV1`, `ActiveTableOrderListV2` si cabe sin romper; si rompe parsers exactos de mobile, documentar y dejar sólo en `OrderDetailV1` y `TableBoardV1`).
3. **API**: `POST /tables/board` (`tables.read`), `POST /orders/assign-waiter` (`orders.update`), y «abrir cuenta en mesa» reutilizando `POST /orders` V2: el servidor resuelve el turno abierto de la sucursal cuando el comando no trae `shiftId` (si el contrato V2 lo exige, aceptar `shiftId: null` o añadir V3 aditivo; justificar) y rechaza con `conflict` «sin turno abierto» si no hay. `availableActions` del detalle incluye `assignWaiter` cuando aplica. Pruebas: aislamiento, mesero ajeno, sin turno, idempotencia de abrir cuenta.
4. (Posterior, nivel C) UI `/app/tables`: plano con colores por estado, tocar mesa → «Abrir cuenta» o ver cuentas, mesero visible. **No en este paquete.**

## Criterios de aceptación
- [ ] Migración candidata reproducible con prueba SQL y sonda local ok.
- [ ] Contratos aditivos; web/mobile/kds typecheck verdes.
- [ ] Endpoints con pruebas de aislamiento, autorización, idempotencia; el operador no envía turno.
- [ ] Puertas: shared-types, api (test/typecheck/lint/build), web/mobile/kds typecheck.
- [ ] Commits por unidad (`feat(db)`, `feat(shared-types)`, `feat(api)`); informe parcial a los ~35 turnos; commitear antes de cualquier informe.

## Archivos de entrada
- C:\tmp\sr-wt\tables-board\supabase\migrations\20260901000100_create_dining_tables_layout.sql, 20260905000100_create_operational_shifts.sql, 20260905000200_link_operational_shifts_to_orders.sql, 20261003000100_send_order_to_kitchen.sql (patrón reciente).
- C:\tmp\sr-wt\tables-board\apps\api\src\dining-tables.ts, table-order-context.ts, orders.ts (create y detail), auth\rbac-policy.ts, operations\run-send-order-to-kitchen-schema-verification.ts.
- C:\tmp\sr-wt\tables-board\packages\shared-types\src\orders.ts (1-150) y dining/tables contracts.

## Invariantes
Alcance Restaurant/Branch en SQL y API; transiciones de Order sólo por el dominio; auditoría de asignaciones; dinero del agregado congelado; contratos aditivos; no editar migraciones aplicadas; sin push ni remoto.

## Fuera de alcance
UI del plano operativo, dividir/juntar cuentas, cobro desde mesa, impresión.

## Formato de salida
Resumen, archivos y hashes, resultado final de cada puerta y de la prueba SQL, riesgos.
