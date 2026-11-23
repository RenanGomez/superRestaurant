# Inventario de cobertura obligatoria — M1 (§4.4)

Fecha: 2026-11-22 · Corte inspeccionado: `origin/main` (`8542c540`) · Ítem: `m1-coverage-inventory` (nivel D, solo lectura sobre código y SQL).
Fuentes: `docs/plans/plan-autonomo-100.md` §4.4, `AGENTS.md` §15, `docs/agentic/backlog.json`, `docs/agentic/debt.md` y `.github/workflows/ci.yml`.

## 1. Resumen por área (§4.4)

| # | Área obligatoria (§4.4 / AGENTS §15) | Estado | Evidencia principal | Huecos clave |
|---|---|---|---|---|
| 1 | Aislamiento entre restaurantes y sucursales | **Cubierto (parcial en CI)** | `membership-authorization.test.ts`, `realtime.gateway.test.ts`, `tenancy_memberships_*`, `courier_order_detail_invariants.sql`, `http-flow.local.test.ts` | 7 SQL tolerados y `http-flow` con `continue-on-error` en CI; sin prueba HTTP multi-sucursal del mismo restaurante |
| 2 | Dinero y redondeo | **Cubierto (parcial en descuentos/pizza SQL)** | `money.test.ts`, `order-totals.test.ts`, `fraction-pricing.test.ts`, `pizza-halves-pricing.test.ts`, `cash-register.test.ts`, `payments.test.ts` | `pizza_model_v2_invariants.sql` roto en CI; sin flujo API/SQL de descuentos ni cortesías (Journey 8) |
| 3 | Máquinas de estado | **Cubierto (parcial en cierres)** | `order-state.test.ts`, `capture-draft.test.ts`, `payment.test.ts`, `cash-register.test.ts`, `deliveries.test.ts`, `kds-state.test.ts` | `order_deliveries`/`capture_drafts` tolerados en CI; falta cierre de turno (`shifts/close`) y cierre explícito de orden `paid → closed` en API/HTTP |
| 4 | Doble envío / doble cobro | **Cubierto (parcial en CI y comandos simples)** | `payment.test.ts`, `orders.test.ts`, `payments.test.ts`, `send_order_to_kitchen_invariants.sql`, `http-flow.local.test.ts`, `order-submission.test.ts` | `http-flow` no bloqueante en CI; sin E2E navegador de doble clic/cobro mixto; `open`/`transitionItem`/`cancelItem` sin prueba SQL/HTTP de replay/concurrencia |
| 5 | Cancelación / reembolso | **Parcial (reembolso faltante)** | `order-cancel.test.ts`, `order-cancellation.test.ts`, `cancel_order_invariants.sql`, `http-flow-cancellation.ts`, `payment.test.ts` (`refundPayment`) | **Faltante en API/SQL/Web:** ejecución de reembolso (`Refund`) sobre obligación pendiente; falta prueba HTTP local de `POST /orders/items/cancel` |
| 6 | Reconexión y conflictos offline | **Parcial / Faltante (integración M2)** | `packages/sync-engine/src/engine-{outbox,pull}.test.ts` (72 tests), `apps/web/e2e/offline.spec.ts` (informativo), `apps/mobile/src/revalidation.test.ts` | Sin `POST /sync` en API/SQL, sin storage persistente real en web/mobile, sin prueba de conflicto 2 dispositivos, sin prueba de reconexión WS + cursor KDS |
| 7 | Inventario compensatorio | **Faltante (0 % productivo; M3)** | Solo clasificador abstracto `order-item-change-impact.ts` + `.test.ts` (sin stock ni movimientos) | Sin dominio, tablas SQL, recetas, descuento por venta ni movimientos compensatorios de inventario |
| 8 | Permisos de supervisor | **Parcial** | `rbac-policy.test.ts`, `order-cancel.test.ts`, `delivery-zones.test.ts` (`setManualFee`), `capture_assignment_invariants.sql`, `cancel_order_invariants.sql` | Sin permiso/flujo de descuentos y cortesías; `refunds.create` definido en RBAC pero sin endpoint ni prueba; sin prueba de aprobación por supervisor delegado |
| 9 | Migraciones desde cero y sobre la versión anterior | **Parcial (upgrade faltante en CI)** | `.github/workflows/ci.yml` (`pg-verify`, 70 migraciones desde cero), `run-migration-{preflight,postcheck,rollback-probe}.test.ts`, 3 verificadores rollback | 7 SQL tolerados + `pizza-model-v2` omitido en CI; **faltante:** prueba automatizada de upgrade sobre versión anterior con datos sembrados; >30 verificadores rollback fuera de CI |

---

## 2. Detalle por área y evidencia verificada

### 2.1 Aislamiento entre restaurantes y sucursales
- **Cubierto:**
  - Dominio: `packages/domain/src/payment.test.ts`, `packages/domain/src/cash-register.test.ts`, `packages/domain/src/order.test.ts`, `packages/domain/src/capture-draft.test.ts`, `packages/domain/src/delivery-zone.test.ts`.
  - API y autorización por alcance exacto: `apps/api/src/auth/membership-authorization.test.ts` (rechaza `restaurantId`/`branchId` ajenos y membresía revocada), `apps/api/src/auth/postgres-membership-lookup.test.ts`, `apps/api/src/realtime.gateway.test.ts` (salas `kds:v1:<restaurant>:<branch>:<station>` y desconexión al revocar), `apps/api/src/delivery-zones.test.ts`, `apps/api/src/deliveries-privacy.test.ts`, `apps/api/src/courier-order-detail.test.ts`.
  - SQL y catálogo RLS: `supabase/tests/tenancy_memberships_catalog.sql`, `supabase/tests/tenancy_memberships_post_*.sql`, `supabase/tests/courier_order_detail_invariants.sql`, `supabase/tests/cancel_order_invariants.sql`, `supabase/tests/send_order_to_kitchen_invariants.sql`, `supabase/tests/capture_assignment_invariants.sql`, `supabase/tests/branch_order_work_tray_invariants.sql`, `supabase/tests/customer_directory_invariants.sql`.
  - Integración HTTP local y sync: `apps/api/src/http-flow.local.test.ts` (`cross_restaurant_403_and_role_403`), `packages/sync-engine/src/engine-pull.test.ts` (`PULL_SCOPE_VIOLATION` entre `SCOPE_A1`/`SCOPE_A2`/`SCOPE_B1`).
- **Faltante / parcial:**
  - En `.github/workflows/ci.yml`, `http-flow.local.test.ts` tiene `continue-on-error: true` y 7 invariantes SQL con pruebas de tenancy están en `KNOWN_FAILING_SQL_TESTS` (cubierto por `m1-z2b-confirm-pizza-v2` y `m1-pg-verify-clean`).
  - `apps/api/src/http-flow.local.test.ts` valida `restaurantA/branchA` contra `restaurantB/branchB`, pero no ejerce por HTTP aislamiento **entre dos sucursales del mismo restaurante** (`branchA` vs `branchB` en `restaurantA`).

### 2.2 Dinero y redondeo
- **Cubierto:**
  - Dominio sin `float`: `packages/domain/src/money.test.ts` (minor units enteros seguros, ISO-4217, overflow, `BigInt`, modos `trunc|floor|ceil|half-away-from-zero`, 96 casos property-based), `packages/domain/src/order-totals.test.ts` (snapshots congelados, impuestos incluidos/excluidos, descuentos, redondeo), `packages/domain/src/fraction-pricing.test.ts` (extras de mitad al 50 % `ceil`), `packages/domain/src/pizza-halves-pricing.test.ts` (10 vectores v2), `packages/domain/src/order-totals-pizza-halves.test.ts`, `packages/domain/src/cash-register.test.ts` (propiedad de conservación de saldos y `tip_in`), `packages/domain/src/payment-intent.test.ts`, `packages/domain/src/payment-obligation.test.ts`.
  - Contratos, API, SQL y clientes: `packages/shared-types/src/payments.runtime.test.ts`, `packages/shared-types/src/capture-line-quote.runtime.test.ts`, `apps/api/src/payments.test.ts`, `apps/api/src/capture-pizza-plan.test.ts`, `supabase/tests/cash_collect_change_invariants.sql`, `supabase/tests/cash_transfer_method_invariants.sql`, `supabase/tests/capture_payment_intent_invariants.sql`, `supabase/tests/branch_day_summary_invariants.sql`, `apps/web/src/app/app/caja/caja-helpers.test.ts`, `apps/mobile/src/money.test.ts`.
- **Faltante / parcial:**
  - Paridad SQL de precios pizza v2 (`supabase/tests/pizza_model_v2_invariants.sql` y `verify:pizza-model-v2-schema:rollback`) rota en CI (cubierto por `m1-z2b-confirm-pizza-v2` y `m1-pg-verify-clean`).
  - No existen comandos API/SQL ni pruebas de integración para **descuentos y cortesías** sobre órdenes (solo cálculos puros en `packages/domain/src/order-totals.ts`; Journey 8 del plan maestro).

### 2.3 Máquinas de estado
- **Cubierto:**
  - `Order` y `OrderItem`: `packages/domain/src/order-state.test.ts` (transiciones válidas, rechazo de saltos/retrocesos/terminales), `packages/domain/src/commercial-order-state.test.ts`, `apps/api/src/orders.test.ts`, `apps/kds/src/kds-state.test.ts`.
  - `CaptureDraft`, `Payment`, `CashRegister`, `OrderDelivery`: `packages/domain/src/capture-draft.test.ts`, `packages/domain/src/payment.test.ts`, `packages/domain/src/cash-register.test.ts`, `apps/api/src/captures.test.ts`, `apps/api/src/deliveries.test.ts`, `apps/api/src/operational-shifts.test.ts`, `supabase/tests/order_deliveries_invariants.sql`, `supabase/tests/capture_drafts_invariants.sql`, `supabase/tests/capture_no_sale_invariants.sql`.
- **Faltante / parcial:**
  - `order_deliveries_invariants.sql` y `capture_drafts_invariants.sql` están tolerados en CI (cubierto por `m1-pg-verify-clean`).
  - No existe endpoint ni prueba HTTP/SQL de transición `paid → closed` en `apps/api/src/orders.controller.ts` ni de cierre de turno en `apps/api/src/operational-shifts.controller.ts` (solo existen `GET /shifts/active` y `POST /shifts/open`).

### 2.4 Doble envío / doble cobro
- **Cubierto:**
  - Dominio: `packages/domain/src/payment.test.ts` (`createOrReplayPayment`, `transitionPayment`, `refundPayment`), `packages/domain/src/cash-register.test.ts` (replay y rechazo de reutilización de clave en movimientos y cierre), `packages/domain/src/order-audit.test.ts`.
  - API y SQL: `apps/api/src/payments.test.ts`, `apps/api/src/orders.test.ts` (`sendToKitchen` replay byte-idéntico y 409 divergente/versión obsoleta), `apps/api/src/order-cancel.test.ts`, `apps/api/src/deliveries.test.ts`, `apps/api/src/delivery-zones.test.ts`, `supabase/tests/send_order_to_kitchen_invariants.sql`, `supabase/tests/cancel_order_invariants.sql`, `supabase/tests/cash_collect_change_invariants.sql`, `supabase/tests/cash_transfer_method_invariants.sql`, `supabase/tests/order_deliveries_invariants.sql`.
  - HTTP local y clientes: `apps/api/src/http-flow.local.test.ts` (`register_open_replay_identical_and_divergent_409`, `order_create_add_send_replay_and_stale_409`, `cash_collect_change_tip_replay_identical_and_divergent_409`, `paymentCount === 1`), `apps/mobile/src/order-submission.test.ts` (reintento reanuda sin duplicar), `packages/sync-engine/src/engine-outbox.test.ts` (`timeoutAfterCommit` → `duplicate` con 1 efecto).
- **Faltante / parcial:**
  - `http-flow.local.test.ts` no es bloqueante en CI (cubierto por `m1-pg-verify-clean`).
  - Falta prueba E2E de navegador de pagos mixtos y reintento/doble clic sin duplicados (cubierto en `m1-e2e-journeys-7-12`, Journey 9).
  - Mutaciones individuales de orden (`POST /orders/open`, `POST /orders/items/transition`, `POST /orders/items/cancel`) carecen de prueba SQL/HTTP de replay e idempotencia a nivel comando comparable a `send_order_to_kitchen_invariants.sql`.

### 2.5 Cancelación / reembolso
- **Cubierto:**
  - Cancelación de ítem, orden completa y captura `no_sale`: `packages/domain/src/order-state.test.ts`, `packages/domain/src/order-cancel.test.ts`, `packages/domain/src/order-cancellation.test.ts`, `packages/domain/src/order-item-change-impact.test.ts`, `apps/api/src/order-cancel.test.ts`, `apps/api/src/operations/http-flow-cancellation.ts`, `apps/web/src/lib/order-cancellation.test.ts`, `supabase/tests/cancel_order_invariants.sql`, `supabase/tests/cancellation_actor_summary_invariants.sql`, `supabase/tests/capture_no_sale_invariants.sql`.
  - Reembolso en dominio puro: `packages/domain/src/payment.test.ts` (`refundPayment` parcial/total, inmutabilidad, idempotencia, autorización) y `packages/domain/src/cash-register.test.ts` (`cash_refund` compensatorio).
- **Faltante:**
  - **Ejecución de reembolso (`Refund`) en API, SQL y Web:** `apps/api/src/payments.controller.ts` no expone ningún endpoint de reembolso, ni existen tablas/funciones SQL que liquiden una obligación `refund_obligation = 'pending'` y registren el movimiento `cash_refund` en caja.
  - Falta prueba HTTP local contra PostgreSQL para `POST /orders/items/cancel` de una línea ya enviada a cocina (verificando permiso `orders.cancel.sent`, motivo, auditoría y corrección KDS).

### 2.6 Reconexión y conflictos offline
- **Cubierto:**
  - Motor puro de outbox y pull en `packages/sync-engine/src/`: `contract.test.ts`, `outbox-state.test.ts`, `payload-guard.test.ts`, `engine-outbox.test.ts` (secuencia monotónica persistente, concurrencia, lease vencido tras reinicio, backoff exponencial, `conflict`/`rejected`/`manual_review`, `duplicate`), `engine-pull.test.ts` (cursor opaco paginado, `resync_required`, `canonicalVersion`, `tombstone` irreversible, `DEVICE_REVOKED`).
  - Comportamiento online-first ante corte de red: `apps/web/e2e/offline.spec.ts` (informativo: sin crash/overlay y recupera al reconectar), `apps/mobile/src/revalidation.test.ts`, `apps/web/src/lib/revalidate-on-return.test.ts`.
- **Faltante:**
  - **Integración servidor (`POST /sync`) y almacenamiento local persistente (M2 / Fase 3):** ningún cliente (`apps/web`, `apps/mobile`, `apps/kds`) importa `packages/sync-engine` ni existe endpoint/SQL de sincronización; `InMemorySyncStorage` es solo para pruebas unitarias.
  - **Prueba de conflicto multi-dispositivo real** y brechas internas de `packages/sync-engine` (resync por snapshot, purga de terminales, matriz de capacidades offline por operación, migración de `schemaVersion`, rollback con múltiples pendientes por entidad).
  - **Reconexión WebSocket + recuperación por cursor (`GET /kds/events`):** `apps/api/src/realtime.gateway.test.ts` no prueba pérdida de conexión y recuperación sin huecos ni duplicados en cliente (parcialmente en `m1-kitchen-ready-notify` y `m1-e2e-journeys-7-12` Journey 12).

### 2.7 Inventario compensatorio
- **Cubierto:**
  - Solo clasificación abstracta sin persistencia en `packages/domain/src/order-item-change-impact.test.ts`, `packages/shared-types/src/order-item-change-impact.runtime.test.ts` y `apps/api/src/order-item-change-impact.test.ts`.
- **Faltante (0 % productivo; corresponde a M3 / Fase 4):**
  - No existen entidades/reglas de insumos, almacenes, recetas ni descuento por venta con movimientos compensatorios inmutables en `packages/domain`, `apps/api` ni `supabase/migrations/`.

### 2.8 Permisos de supervisor
- **Cubierto:**
  - Matriz RBAC sin herencia: `apps/api/src/auth/rbac-policy.ts` + `apps/api/src/auth/rbac-policy.test.ts` (`orders.cancel.sent`, `orders.cancel.order`, `captures.transfer`, `captures.takeover`, `refunds.create`, `cash-register.manage`, `delivery_zones.manage`).
  - Cancelación de orden/línea enviada: `packages/domain/src/order-state.test.ts`, `packages/domain/src/order-cancel.test.ts`, `apps/api/src/order-cancel.test.ts`, `apps/api/src/operations/http-flow-cancellation.ts` (403 cajero), `supabase/tests/cancel_order_invariants.sql`.
  - Transferencia y takeover de captura: `packages/domain/src/capture-draft.test.ts`, `apps/api/src/auth/membership-authorization.test.ts`, `supabase/tests/capture_assignment_invariants.sql`.
  - Cuota manual de envío: `apps/api/src/delivery-zones.test.ts` (`setManualFee`: supervisor ok, cajero 403, motivo obligatorio), `supabase/tests/delivery_zones_settlements_invariants.sql`.
- **Faltante:**
  - **Descuentos y cortesías con autorización de supervisor** (Journey 8): sin permiso en `rbac-policy.ts`, sin API/SQL ni pruebas.
  - **Enforce y prueba de `refunds.create`** en API y SQL (dependiente del flujo de reembolso del área 5).
  - **Autorización de supervisor delegada sobre sesión de otro operador** (cajero/mesero solicita, supervisor autoriza con trazabilidad de `actorId` + `authorization.actorId` distintos): hoy las pruebas de API/SQL solo prueban cuando el propio actor autenticado tiene rol de supervisor.

### 2.9 Migraciones desde cero y sobre la versión anterior
- **Cubierto:**
  - Desde cero en CI: `.github/workflows/ci.yml` (`pg-verify`) aplica las 70 migraciones (`20260830000100`…`20261121000100`) sobre PostgreSQL 17 limpio, corre auditorías de catálogo intermedias, `supabase/tests/*.sql` y 3 scripts `verify:*-schema:rollback` (`schema`, `capture-selection-plan`, `cash-transfer-method`).
  - Herramientas de operación y pruebas unitarias: `apps/api/src/operations/run-migration-preflight.test.ts`, `run-migration-postcheck.test.ts`, `run-migration-rollback-probe.test.ts`, `schema-verification.test.ts`, `post-p2-catalog.test.ts`.
  - Backfills unitarios en invariantes SQL: `supabase/tests/menu_shared_modifier_groups_invariants.sql`, `menu_locked_ingredients_invariants.sql`, `catalog_halves_product_level_invariants.sql`.
- **Faltante:**
  - **Migraciones limpias sin tolerancias en CI:** 7 tests SQL en `KNOWN_FAILING_SQL_TESTS`, `verify:pizza-model-v2-schema:rollback` omitido y `http-flow` con `continue-on-error: true` (ya en backlog: `m1-z2b-confirm-pizza-v2` y `m1-pg-verify-clean`).
  - **Migración sobre la versión anterior (upgrade con datos existentes):** `pg-verify` nunca siembra datos en el corte anterior (`N-k`) antes de aplicar migraciones nuevas; no existe prueba automatizada de upgrade incremental que valide preservación de datos y backfills sobre filas reales previas.
  - **Verificadores rollback fuera de CI:** más de 30 scripts `verify:*-schema:rollback` en `apps/api/package.json` no se ejecutan en `pg-verify` (varios aún atados a binario local Windows o catálogo remoto histórico).

---

## 3. Huecos ya cubiertos en `docs/agentic/backlog.json` (no duplicar)

| Ítem existente | Áreas §4.4 que cierra | Estado en backlog |
|---|---|---|
| `m1-z2b-confirm-pizza-v2` | 1 (aislamiento), 2 (dinero pizza v2), 9 (migraciones) | `ready` (nivel A, `codex`) |
| `m1-pg-verify-clean` | 1, 2, 3, 4, 8, 9 (elimina tolerancias CI y `continue-on-error` de `http-flow`) | `ready` (nivel A, `codex`, dep `m1-z2b-confirm-pizza-v2`) |
| `m1-kitchen-ready-notify` | 1 (aislamiento por sucursal/estación WS), 6 (realtime) | `ready` (nivel B, `agy`) |
| `m1-e2e-journeys-1-6` y `m1-e2e-journeys-7-12` | 2, 3, 4 (Journey 9 sin duplicados), 6 (Journey 12 online-first), 8 (Journey 8) | `ready` (nivel B, `opencode`) |

---

## 4. Huecos nuevos propuestos para el backlog

Todos llevan `parent: "m1-coverage-inventory"` para trazabilidad (§3.1 del plan autónomo). Los ítems de M2/M3 se registran desde ahora para su hito correspondiente sin romper el alcance congelado de M1.

| ID propuesto | Hito | Área §4.4 | Nivel | Motor (`lane`) | `parent` | Alcance y aceptación verificable |
|---|---|---|---|---|---|---|
| `m1-cov-branch-isolation-http` | M1 | 1 · Aislamiento | B | `opencode` | `m1-coverage-inventory` | Añadir flujo HTTP en `apps/api/src/operations/` + `http-flow.local.test.ts` con dos sucursales (`branchA`/`branchB`) del mismo restaurante verificando 403/404 cruzado en órdenes, caja, KDS y entregas. Aceptación: `test:http:local` verde con check `cross_branch_same_restaurant_403`. |
| `m1-cov-discounts-courtesies` | M1 | 2 · Dinero · 8 · Supervisor | A | `codex` | `m1-coverage-inventory` | Implementar descuentos/cortesías autorizados por supervisor (`orders.discount.apply` en `rbac-policy.ts`, migración SQL, API, auditoría con motivo y cálculo exacto sin float) para cerrar Journey 8. Aceptación: unitarias dominio/API, invariantes SQL rollback-only y flujo HTTP con 403 cajero + 201 supervisor. |
| `m1-cov-order-item-cancel-http` | M1 | 4 · Idempotencia · 5 · Cancelación · 8 · Supervisor | B | `opencode` | `m1-coverage-inventory` | Añadir en `http-flow.local.test.ts` + SQL invariante pruebas de `POST /orders/items/cancel` sobre línea `sent` (403 cajero, 201 supervisor, corrección KDS, replay idempotente y 409 versión obsoleta) y de replay en `open`/`transitionItem`. Aceptación: `test:http:local` y SQL test verdes. |
| `m1-cov-order-shift-close` | M1 | 3 · Estados | A | `codex` | `m1-coverage-inventory` | Exponer cierre formal de turno (`POST /shifts/close`) y cierre de orden `paid → closed` en API/SQL con invariantes (no cerrar turno con caja abierta, historial intacto). Aceptación: invariante SQL rollback-only + prueba en `http-flow.local.test.ts`. |
| `m1-cov-refunds-execution` | M1 | 5 · Reembolso · 8 · Supervisor | A | `codex` | `m1-coverage-inventory` | Implementar liquidación de `refund_obligation = 'pending'` vía `POST /payments/refund` (`refunds.create`), tabla/función SQL inmutable + movimiento `cash_refund` en caja, idempotencia y auditoría. Aceptación: invariantes SQL de reembolso parcial/total, 403 cajero, replay sin doble salida y `http-flow.local.test.ts` verde. |
| `m1-cov-delegated-supervisor-auth` | M1 | 8 · Supervisor | A | `codex` | `m1-coverage-inventory` | Definir y probar aprobación de supervisor delegada (actor operador + autorizador supervisor distinto verificado en servidor, sin confiar en el cliente) para cancelación/descuento/reembolso, o registrar decisión conservadora en `DECISIONS_PENDING.md` si M1 mantiene solo actor privilegiado. Aceptación: ADR/decisión o pruebas API+SQL con dos actores distintos. |
| `m1-cov-migration-upgrade-ci` | M1 | 9 · Migraciones | A | `codex` | `m1-coverage-inventory` | Añadir job/paso en `.github/workflows/ci.yml` que aplique migraciones hasta el corte base (`N-k`), siembre catálogo/órdenes/pagos/zonas representativos y aplique el delta hasta `HEAD` verificando preservación de filas, backfills e invariantes post-upgrade; migrar verificadores rollback críticos a `LocalPostgres`. Aceptación: `pg-verify` verde en CI con etapa `upgrade-from-previous`. |
| `m1-cov-ws-reconnect-cursor` | M1 | 6 · Reconexión | B | `opencode` | `m1-coverage-inventory` | Prueba de integración de reconexión WebSocket + recuperación durable por cursor `GET /kds/events` sin pérdida ni duplicación de eventos al reconectar tras corte. Aceptación: prueba nueva en `apps/api/src/realtime.gateway.test.ts` (o `http-flow`) + `apps/kds` en verde. |
| `m2-cov-offline-sync-e2e` | M2 | 6 · Offline | A | `codex` | `m1-coverage-inventory` | Implementar `POST /sync` (push/pull con cursor versionado), storage persistente real (ADR-005) e integración de `packages/sync-engine` en web/mobile, más brechas de `sync-engine` (snapshot resync, purga, migración `schemaVersion`) y prueba de conflicto real con 2 dispositivos (`manual_review` financiero). Aceptación: suite `e2e:offline` y pruebas multi-dispositivo verdes en CI. |
| `m3-cov-inventory-compensating` | M3 | 7 · Inventario | A | `codex` | `m1-coverage-inventory` | Construir dominio y persistencia SQL de inventario (insumos, recetas, movimientos inmutables por venta y movimientos compensatorios por cancelación/merma/ajuste, aislados por `restaurantId`/`branchId`). Aceptación: unitarias de dominio, invariantes SQL rollback-only y prueba de integración venta → cancelación → compensación en verde. |
