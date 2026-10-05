# order-deliveries-api · despacho y liquidación de entregas (D6)

## Tarea
order-deliveries-api · capa: L1 (`implementer-claude`, razonamiento alto) · riesgo: alto · **nivel A** (dinero en la liquidación, tabla y funciones nuevas, rol RBAC nuevo, contratos). Fila D6 del «Día operable». §19.3: revisión doble, corte en la tercera ronda. **Arranca después de integrar `cash-collect-change-api`** (comparte `apps/api/src/payments.ts`): parte de `main` con ese merge.

## Objetivo
Que una orden de canal `delivery` confirmada pueda asignarse a un repartidor, salir a ruta, marcarse entregada y liquidarse en caja (efectivo contra entrega registrado como Payment al liquidar, con cambio y propina según la intención congelada), con journal inmutable y sin tocar la máquina de estados de Order.

## Hechos verificados (researcher 2026-10-03, main a2b04bc)
- Al confirmar la captura (`app_private.confirm_capture_draft_v3`, `supabase/migrations/20261001000100_capture_payment_intent.sql:712+`) la Order guarda `deliveryCharge` en el agregado y el snapshot V2 (`app.order_fulfillment_snapshots`) congela cliente, dirección, cotización (`zoneId, feeMinor, promiseStart/End`) e intención de pago (`method cash|card_manual|transfer, tenderedAmountMinor, tipMinor`). No se crea Payment ni CashMovement.
- `OrderDetailV1.fulfillment` (`packages/shared-types/src/orders.ts:358-387`) tiene `channel, tableId, customerLabel, addressLabel, paymentIntent` y hoy el API lo devuelve `null` (`POST /orders/detail` ya está en main). `list_branch_order_work_items` devuelve agregado + snapshot.
- Estados: `OrderState draft→open→partially_paid→paid→closed`, `OrderItemState`; `OrderFulfillmentStatus` es proyectado, no persistido (`packages/domain/src/commercial-order-state.ts:27-50`). No hay estado de entrega persistido.
- Roles (`packages/shared-types/src/index.ts:41-53`): no existe `courier`. No hay lector de miembros de la sucursal (deuda de mesas: lista de meseros).
- Cobro: `POST /payments/collect` exige `cashRegisterSessionId` abierta; tras `cash-collect-change-api` acepta `tenderedAmountMinor` y `tipMinor` y devuelve `changeMinor`. KDS ve `channel` pero nada más.
- Decisiones §8.1/§9.1 (2026-09-26): efectivo contra entrega se registra al liquidar el viaje en caja; el repartidor responde por el efectivo; diferencias como CashMovement, nunca editando Payment; 2 intentos, sin entrega parcial.

## Diseño (seguir salvo razón documentada)
1. **Rol y miembros**: añadir `courier` a `MEMBERSHIP_ROLE_CODES` y a `rbac-policy.ts` con permisos de lectura de sus entregas y transición propia (`deliveries.read`, `deliveries.update.own`); gerente/cajero/supervisor tienen `deliveries.manage`. Nuevo lector `POST /access/branch-members` (`{ scope, roles?: string[] }` → `{ members: [{ userId, displayName|null, roles }] }`, permiso `memberships.read` o el existente que mejor encaje) basado en las membresías activas de la sucursal; sirve para repartidores y para la deuda de meseros. Si no hay nombre de usuario en el modelo, devolver `displayName: null` y documentar.
2. **SQL** `20261006000200_order_deliveries.sql`: `app.order_deliveries` (restaurant_id, branch_id, order_id PK compuesta con FK a orders, courier_user_id null, state `pending|assigned|en_route|delivered|failed|settled`, version, assigned_at, dispatched_at, delivered_at, failed_reason, cash_to_collect_minor null, settled_payment_id null, settled_at, created/updated) con RLS forzada sin políticas; `app.order_delivery_events` journal append-only (operation, actor, device, occurred_at, received_at, idempotency_key única por actor+scope, expected_version, payload, result_state) ; funciones security definer `search_path=''` owner postgres, EXECUTE sólo `app_api`: `assign_delivery(actor, order, courier, expected_version, audit)` (crea la fila `pending→assigned` si no existe; valida que la Order sea `delivery` y esté `open|partially_paid`, membresía activa del repartidor en la sucursal), `dispatch_delivery` (`assigned→en_route`), `complete_delivery` (`en_route→delivered`), `fail_delivery` (`en_route→failed` con motivo), `settle_delivery(actor, order, cash_register_session_id, tendered_minor, tip_minor, expected_version, audit)` que, en la misma transacción, llama a la función de cobro existente (la que usa `POST /payments/collect`, con `tenderedAmountMinor`/`tipMinor`) por el saldo de la orden si la intención era `cash`, y marca `settled`; si la intención era `card_manual`/`transfer`, `settle` sólo registra la referencia y deja la cuenta para cobrarse por la vía normal (o cobra con la referencia si viene). Todas con replay por clave+payload y conflict por versión. Lector `list_branch_deliveries(actor, restaurant, branch)` → entregas activas con estado, repartidor, hora, cliente/dirección abreviada **sólo con `customers.read`**, total e intención. Prueba SQL (transiciones, aislamiento, PII, liquidación atómica: fallo del cobro ⇒ nada persiste, replay, repartidor ajeno). Sonda local PG17.
3. **Contratos** aditivos: `AssignDeliveryCommandV1`, `DispatchDeliveryCommandV1`, `CompleteDeliveryCommandV1`, `FailDeliveryCommandV1`, `SettleDeliveryCommandV1`, `BranchDeliveriesV1`, `OrderDeliveryV1`; `OrderDetailV1.fulfillment` pasa a rellenarse desde el snapshot V2 (cliente y dirección sólo con `customers.read`, `paymentIntent`, cotización) y añade `delivery: OrderDeliveryV1 | null`.
4. **API**: `POST /deliveries/list|assign|dispatch|complete|fail|settle` con permisos; `detail` rellena `fulfillment`. Pruebas con fila real `{ result }`.

## Criterios de aceptación
- [ ] Migración candidata con prueba SQL y sonda local ok; contratos aditivos; mobile/kds/web typecheck verdes.
- [ ] Liquidación atómica e idempotente; ningún cálculo de dinero fuera del dominio y de la función de cobro existente.
- [ ] Puertas: domain (si cambia), shared-types, api (test/typecheck/lint/build); web/mobile/kds typecheck.
- [ ] Commits por unidad (`feat(shared-types)`, `feat(db)`, `feat(api)`); informe parcial a los ~35 turnos; **commitear antes de cualquier informe**.

## Archivos de entrada
- C:\tmp\sr-wt\order-deliveries-api\supabase\migrations\20261001000100_capture_payment_intent.sql (10-110, 712-900), 20261002000100_branch_order_work_tray.sql, 20261004000200_table_board.sql (patrón de journal y funciones), migración de `cash-collect-change-api`.
- C:\tmp\sr-wt\order-deliveries-api\apps\api\src\orders.ts (detail), payments.ts, auth\rbac-policy.ts, auth\membership-*.ts, branch-order-tray.ts.
- C:\tmp\sr-wt\order-deliveries-api\packages\shared-types\src\orders.ts (358-387), index.ts (41-53), payments.ts.

## Invariantes
Dinero en el dominio y en la función de cobro existente; intención ≠ Payment hasta liquidar; cotización congelada nunca recalculada; PII sólo con `customers.read`; alcance Restaurant/Branch; journal inmutable; sin push ni remoto.

## Fuera de alcance
UI `/app/deliveries` (paquete C), notificaciones al repartidor, mapas, reembolsos, mobile.

## Formato de salida
Resumen con las reglas de liquidación en dos frases, archivos y hashes, resultado de puertas y sonda, riesgos.
