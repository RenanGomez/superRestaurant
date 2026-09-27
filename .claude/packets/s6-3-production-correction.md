# Paquete de contexto: s6-3-production-correction

## Tarea
s6-3-production-correction · capa: L1 (implementer-claude) · riesgo: alto

## Objetivo
Evolucionar el evento KDS durable actual para order-item cancellation en una corrección de producción tipada (tipo cancel|replace, reason, source line, optional replacement line, shared idempotent identity) con estado de entrega por destino `pending|delivered|failed` para KDS (primario) e impresora (secundario, reprint disponible), de modo que los reintentos sean selectivos y nunca dupliquen. Consumir contratos recién integrados: productionDestination y reprintAvailable de packages/shared-types/src/order-item-change-impact.ts, y PrintJobQueue/PrinterPort de packages/printing/src/print-job-queue.ts. Persistencia: migración SQL candidata bajo supabase/migrations (nunca editar aplicadas), verificador rollback-only PostgreSQL siguiendo patrones existentes, servicio NestJS + repositorio en apps/api, sin UI.

## Criterios de aceptación (verificables)
- [ ] Nueva tabla `app.production_corrections` con columnas: id (uuid PK), restaurant_id, branch_id, order_id, order_item_id, correction_type (enum cancel|replace), reason (text), source_line_event_id (uuid FK), replacement_line_event_id (uuid NULL FK), idempotency_key, created_at, created_by
- [ ] Nueva tabla `app.production_correction_deliveries` con: id (uuid PK), correction_id (uuid FK), destination (enum kds|printer), status (enum pending|delivered|failed), last_error_code (text NULL), attempts (int), created_at, updated_at
- [ ] Migration candidate path: supabase/migrations/20260926000100_create_production_corrections.sql (timestamp format matching 20260902000200_create_orders_realtime.sql, dentro de `begin; ... commit;`)
- [ ] Rollback-only catalog verifier: supabase/tests/production_corrections_catalog.sql verifying table existence, RLS, security-definer functions app_private.emit_production_correction and app_private.deliver_production_correction_to_destination
- [ ] NestJS service ProductionCorrectionService en apps/api/src/production-corrections.ts: constructor(database: DatabaseClientPort, notifications: RealtimeNotificationPort, printQueue: PrintJobQueue), method emit(actorId, scope, orderId, expectedVersion, operation: cancel|replace, reason, orderItemId, replacementItemId?): Promise<ProductionCorrectionEmitted>
- [ ] NestJS repository PostgresProductionCorrectionRepository: read, persist, listFailedDeliveries, markDelivered, markFailed
- [ ] Persistence codec PersistedProductionCorrectionV1 en apps/api/src/persistence/order-persistence-codec.ts aligning with PersistedCancellationAuditV1 pattern, export encodeProductionCorrection/decodeProductionCorrection
- [ ] Idempotency: double-submit same correction_type/orderId/orderItemId/idempotencyKey returns same kdsEvent, never duplicates row
- [ ] Per-destination retry: PrintJobQueue.deliverNext paired with production_correction_deliveries.status=failed retry, no re-emit to KDS on printer retry
- [ ] RLS: orders.cancel.sent, orders.cancel.pending authorize kds_primary destination; app_private functions use authenticated actor scope (restaurant_id, branch_id) via RLS
- [ ] KDS cursor compatibility: existing KDS recovery query (recoverKdsSql) unchanged; new corrections materialized as KdsEventV1 with eventType="kds.correction"
- [ ] Run `pnpm --filter @super-restaurant/domain test` (existing tests still green)
- [ ] Run `pnpm --filter apps-api test` on orders.test.ts: cancelItem flow with production correction emission verified
- [ ] SQL `from scratch` test: migrate from empty schema, verify all constraints and RLS policies hold, then rollback and postcheck confirms base state

## Archivos de entrada
- apps/api/src/orders.ts (líneas 290–322): cancelItem handler flow, authorization branches, persist call returning kdsEvent
- apps/api/src/persistence/order-persistence-codec.ts (líneas 48–182): PersistedCancellationAuditV1 structure, persist pattern, audit encoding
- packages/domain/src/order-item-change-impact.ts (líneas 34–49): productionDestination ("kds_primary"|null), reprintAvailable (bool), production ("correction_required"|"none"|"post_delivery_adjustment_required")
- packages/printing/src/print-job-queue.ts (líneas 1–114): PrinterPort interface, PrintJobQueue class with enqueue/deliverNext/retry, PrintDestination type (kds|printer|reprint)
- packages/shared-types/src/realtime.ts (líneas 73–286): RealtimeNotificationV1, KdsEventV1 structure, parseRealtimeNotificationV1
- supabase/migrations/20260902000200_create_orders_realtime.sql (líneas 1–96): current order_audit_events and KDS schema, constraints, indexes
- supabase/tests/cash_registers_simple_payments_catalog.sql: security-definer function audit pattern, RLS checks, function privilege verification

## Símbolos relevantes

| Archivo | Símbolo | Por qué importa |
|---|---|---|
| apps/api/src/orders.ts:290–322 | cancelItem(principal, input) | punto de entrada autorizado; dispara persist(actorId, expectedVersion, mutation) que retorna kdsEvent |
| apps/api/src/orders.ts:397–398 | await this.notifications.notify(result.kdsEvent) | patrón actual de notificación KDS durable; S6.3 extiende para per-destination delivery tracking |
| packages/domain/src/order-state.ts:117–135 | transitionOrderItem(from, to, context) | normaliza OrderItemCancellationAudit con eventId, idempotencyKey, reason, authorization; S6.3 consume para source_line_event_id |
| packages/domain/src/order-item-change-impact.ts:34–49 | OrderItemChangeImpact interface | productionDestination: "kds_primary" | null, reprintAvailable: bool; S6.3 usa para determinar destinos |
| packages/printing/src/print-job-queue.ts:51–114 | PrintJobQueue class | enqueue(jobId, destination, bytes, now): bool; deliverNext(port, now): Promise<PrintJobSnapshot|null>; retry(jobId, now): bool; S6.3 orquesta con printer destination |
| packages/shared-types/src/realtime.ts:73–102 | KdsEventV1, RealtimeNotificationV1 | eventType: "kds.changed"; cursor: KdsCursorV1; S6.3 introduce eventType="kds.correction" |
| apps/api/src/persistence/order-persistence-codec.ts:48–121 | PersistedCancellationAuditV1, PersistedOrderItemV1 | cancellationAudit?: PersistedCancellationAuditV1; S6.3 extiende con reference a production_corrections tabla |
| supabase/migrations/20260902000200_create_orders_realtime.sql:41–96 | order_audit_events table | columns: event_id, idempotency_key (dedup), restaurant_id, branch_id, order_id, actor_id, operation, entity_id, event_payload (jsonb), constraints: idempotency_unique, operation_valid; S6.3 patrón base |

## Invariantes que NO deben cambiar
- dinero en minor units + ISO, nunca float (no aplica directamente; refund obligation es separado)
- alcance Restaurant/Branch obligatorio en toda consulta y mutación; RLS enforce en todas las tablas app.* y app_private.*
- ninguna línea confirmada se borra o reescribe; cancelación es transición a estado immutable con auditoría enlazada
- idempotencyKey == deuplicacion, nunca fila duplicada por reintento (app.production_corrections + app.production_correction_deliveries)
- actor, sucursal (branch_id), dispositivo (device_id), razón (reason) se auditan en cada corrección; cliente nunca autoriza
- KDS es autoridad durable: per-destination delivery tracking permite reintentos sin duplicados
- migraciones SQL versionadas bajo supabase/migrations, nunca editar migraciones ya aplicadas
- esquema candidato + rollback-only verifier, nunca aplicadas sin autorización humana

## Fuera de alcance
- S6.2 (Capture draft elimination): usa su propia auditoría sin production_corrections
- S6.4 (compensaciones financieras): refund/void/saldo integran sólo después de autoridad S8.6
- UI/UX (S6.5): sin interfaz, sólo persistencia y servicios API
- Redis/BullMQ: PrintJobQueue en memoria; outbox persistente para print jobs es futura ADR
- reimpresión manual selectiva por destino (reprint tracking posterior a S6.3)
- Realtime WebSocket push (notifications.notify() es hook; gateway.broadcast implementado en realtime.gateway.ts)

## Verificación
```bash
# Lint + typecheck
pnpm --filter @super-restaurant/shared-types lint
pnpm --filter @super-restaurant/domain typecheck
pnpm --filter apps-api lint typecheck

# Unit tests: domain y codec invariantes
pnpm --filter @super-restaurant/domain test
pnpm --filter apps-api test -- --testNamePattern="cancelItem|production.*correction"

# Migration rollback test
cd supabase && psql $DATABASE_URL -f migrations/20260926000100_create_production_corrections.sql
psql $DATABASE_URL -c "SELECT app_private.verify_production_corrections_schema();"
psql $DATABASE_URL -f tests/production_corrections_catalog.sql
# (rollback y postcheck via runSchemaVerification en schema-verification.ts)

# Idempotency: double-submit test corpus
pnpm --filter apps-api test -- --testNamePattern="production.*idempotent"
```

## Riesgo sugerido / Capa sugerida
Alto / L1 (implementer-claude). Toca KDS durable events (asíncrono crítico), idempotencia (riesgo de duplicados), RLS/tenancy (aislamiento multi-restaurante), migraciones SQL (estado persistido). Requiere análisis CodeGraph, auditoría de dependencias (respuesta en blast radius), pruebas de rollback y doble-envío antes de human review.
