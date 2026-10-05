# api-http-flow-iteration-2 · flujo HTTP local con entregas, mitades y tarjeta

## Tarea
api-http-flow-iteration-2 · **nivel B** (`implementer-claude`, razonamiento moderado; sólo infraestructura de pruebas en `apps/api`). Segunda iteración prevista en `api-http-postgres-tests` (HANDOFF 2026-10-05).

## Objetivo
Añadir a `apps/api/src/http-flow.local.test.ts` (o un segundo archivo bajo el mismo script `test:http:local`) tres recorridos reales contra PostgreSQL local: (a) **entrega**: captura telefónica con dirección cubierta → confirmar → `POST /branch-orders/tray` con `unassignedDeliveriesOnly` lista la orden → assign al courier → dispatch → `POST /deliveries/order-detail` como courier (200) y como otro courier (403) → complete → settle en efectivo con cambio → corte X incluye el efectivo; (b) **mitad y mitad**: catálogo con tamaño `fraction` → `POST /captures/line-quote` y plan de selección dan el mismo precio (mayor sabor + extra de media al 50 % ceil) → confirmar → `list_kds_tickets` muestra «Mitad A/B»; (c) **tarjeta externa y transferencia**: cobro parcial con `card_manual` (terminal y referencia) + resto por `transfer` con referencia → `paid`, `transferCapturedMinor` en el corte y efectivo esperado sin cambio; transfer sobre entrega `en_route` → 409 `DELIVERY_NOT_DELIVERED`.

## Hechos verificados
- `apps/api/src/operations/local-postgres.ts`, `http-test-fixtures.ts`, `http-test-app.ts`, `http-flow.local.test.ts` (integrados en `main` `018d876`); runbook `docs/runbooks/api-http-flow-local.md`.
- Endpoints: `/captures/*` (workspace, selection-plan, delivery-quote, payment-intent, confirm), `/branch-orders/tray`, `/deliveries/list|assign|dispatch|complete|fail|settle|settle_prepaid|order-detail`, `/payments/quote|collect`, `/cash-registers/*`, `/kds/*` (verificar nombres en los controllers). Fixtures de zonas: `delivery_zones` + códigos postales (`20260927000100`); roles `courier` en `rbac-policy.ts`.

## Diseño
- Extender `http-test-fixtures.ts` con: zona de entrega con CP cubierto, cliente con dirección, tamaño con `fraction` (grupo de sabores y de extras), segundo courier. Mantener el primer flujo intacto y rápido; cada flujo con su propio `runId` y cleanup. Reutilizar las migraciones aplicadas una sola vez por proceso si el helper lo permite (si no, aceptar ~30 s por flujo y documentarlo).

## Criterios de aceptación
- [ ] `pnpm --filter @super-restaurant/api run test:http:local -- --local-disposable-only` pasa con los cuatro flujos y salida literal.
- [ ] Puertas: api lint/typecheck/test/build (la suite normal sigue sin PG).
- [ ] Commits por flujo; **commitear antes de cualquier informe**.

## Invariantes
Sólo PG local desechable con marcador y cleanup; sin cambios de producto ni SQL (si un endpoint falta o se comporta distinto, documentar la brecha en el informe en vez de parchear el producto); sin push.

## Formato de salida
Resumen, hashes, salida literal, brechas de producto detectadas, riesgos.
