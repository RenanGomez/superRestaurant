# Plan de trabajo — desde el 2026-11-26

Este plan sustituye como guía de corto plazo a `docs/plans/plan-dsh-cierre-m3-2026-11-25.md` (que
queda como registro de la sesión) y se apoya en `plan-deepseek-fases-3-8.md` para M4-M7.

## 0. Estado verificado

- `main` en `d7a73c83`. Sin PRs abiertos y sin workers vivos.
- **M1 cerrado**; **M2 al 79 %** (5 revisiones de Ola 0 pendientes y las puertas humanas de
  `m2-offline-signoff.md`); **M3 al ~97 %** (14 items: 12 hechos, UI completa con seis pestañas).
- Migraciones: 88 desde cero en verde; dev al día hasta `20261126001100`; `20260908000100` sigue
  excluida por objetos preexistentes (no tocar el historial).
- Puertas del corte: `test:http:local` 10/10, `verify:inventory-schema:rollback` ok, web
  lint/typecheck/test 21/21/build, API typecheck/lint 0, `e2e:typecheck` 0.

## 1. Bloqueo único y acción humana (primero)

El pase visual y el journey E2E necesitan una sesión de Playwright válida. La actual caducó
(`Invalid Refresh Token`).

1. `pnpm --filter @super-restaurant/web e2e:auth` y login manual, **o**
2. cerrar Chrome del todo y `tools\agentic\local-servers\e2e-import-session.bat`.

Después, el orquestador levanta API+web (`SYNC_CURSOR_SECRET` ≥ 32 efímero, nunca registrado).

## 2. Ola 3 — cierre de M3 (1-2 días)

| Id | Nivel | Qué | Hecho cuando |
|---|---|---|---|
| `m3-visual-pass` | C (orquestador) | `E2E_VISUAL=1 playwright test e2e/visual/inventario.spec.ts --project desktop`: 6 pestañas × 1366×800 y 390×844 | 12 capturas en `docs/agentic/visual-verify-2026-11-26/`, consola y red limpias, desborde 0 px, targets ≥ 44 px, sin diálogos nativos |
| `m3-e2e-journey` | B (dsh) | Journey 13: insumo → almacén → receta → venta descuenta → cancelar repone → alerta por déficit → margen (brief ya escrito) | `e2e:typecheck` 0, journey verde contra el stack local, limpieza por `runId` registrada antes de actuar |
| `m3-visual-fixes` | C (dsh) | Solo si el pase encuentra algo: una tarea por bloque de hallazgos | Gate C + re-pase del bloque afectado |
| `m3-schema-grant-close` | A (dsh ×2) | Retirar `EXECUTE` de `app_api` en `inventory_record_movement` y exponer wrappers por operación (P2 de compras) | Verificador rollback-only con el grant retirado, prueba de recepción y de movimiento manual en verde |
| `m3-close-docs` | D (orquestador) | HANDOFF/status/backlog/debt + smoke `2026-11-26` actualizado con el pase visual | Smoke con las seis pestañas marcadas según lo realmente visto |

Salida de M3: journey verde, pase visual documentado, deuda P2 de inventario cerrada y tag
`m3-rc1` con smoke regenerado (§5.2 del plan maestro).

## 3. Ola 4 — deuda que ya muerde (2-3 días)

- **`debt-historical-verifiers` (B):** `verify:menu-shared-modifier-groups-schema:rollback` y
  `verify:capture-schema:rollback` fallan por fixtures históricos. Un verificador que no corre es un
  control que no existe.
- **`debt-m2-reviews` (A, 5 tareas de revisión):** `o0-rev-web-leader`, `o0-rev-web-purge`,
  `o0-rev-mobile-banner`, `o0-rev-visual`, `o0-rev-sync-p3` + cerrar `o0-wire` (review). Son las que
  impiden declarar M2 cerrado al 100 %.
- **`debt-compras-reads` (B):** leer proveedores/órdenes con `catalog.read` en vez de
  `catalog.manage`, con pruebas de aislamiento.
- **`debt-device-id` (B):** `deviceId` de recepción y `x-device-id` contra el registro de
  dispositivos; decidir persistencia por equipo frente a `sessionStorage`.
- **P3 sin dueño todavía:** barrido de `docs/agentic/debt.md` al cerrar la ola (los P3 que sigan sin
  impacto se archivan).

## 4. M4 — Gestión, CRM y personal (Fase 5)

- **Ola 6 (D):** `m4-metrics-catalog` (catálogo de métricas versionadas con fuente autoritativa y
  zona horaria) y `m4-adr-014-exports` (CSV nativo; XLSX/PDF con una dependencia cada uno).
- **Ola 7 (A, SQL en cadena):** reportes por restaurante/sucursal/canal/zona; CRM con consentimiento,
  preferencias y ledger de puntos inmutable; personal con empleados, asistencia auditada y comisiones.
- **Ola 8 (B):** endpoints de reportes y exportación con permisos y sin PII de más; reconciliación
  «suma del reporte = suma de pagos de las órdenes semilla».
- **Ola 9 (C):** dashboard operativo y gerencial, reportes con filtros, ficha de cliente ampliada,
  personal/asistencia y rentabilidad por canal/producto/zona/repartidor.

## 5. M5 — Fiscal, pagos integrados y canales (Fase 6)

Solo proveedores falsos; los reales son puerta humana.

- **Ola 10:** puertos `FiscalProvider` (CFDI 4.0), `PaymentProvider`, `AggregatorAdapter` y
  proveedores falsos deterministas + contract tests reutilizables.
- **Ola 11 (A):** `pending_invoice` con reintentos y operación degradada; pagos con idempotencia,
  estados explícitos, webhooks firmados y anti-replay; refunds y conciliación auditada.
- **Ola 12:** webhooks de agregadores idempotentes (nunca duplican orden ni saltan cocina) y
  normalización de productos/estados por canal.
- **Ola 13 (C):** pedido web, menú QR y kiosco con endpoints públicos, rate limit y sin datos de
  otros tenants; UI de facturación pendiente y conciliación.

## 6. M6 — Multi-sucursal y lanzamiento (Fase 7)

- **Ola 14:** reportes consolidados con scope Restaurant e importador CSV legacy idempotente.
- **Ola 15 (auditoría):** un revisor de solo lectura por módulo (`auth`, `sync`, `captures`, `cash`,
  `inventory`, `integrations`, `web`) contra la lista de AGENTS §13; `pnpm audit` sin críticos; suite
  de fugas entre tenants generada desde OpenAPI; rate limit en todo endpoint sensible.
- **Ola 16:** carga contra PG17 local con datos semilla, simulacro de respaldo/restauración medido
  contra RPO/RTO, alertas y runbooks, checklist go/no-go con evidencia automática o «humano».

## 7. M7 — Expansión (Fase 8)

Reservaciones y lista de espera; promociones avanzadas y tarjetas de regalo (ledger inmutable);
ADRs de rutas/flota, franquicias y central de producción (solo documento); ADR-009 (servidor local
LAN) en borrador con la pregunta abierta.

## 8. Ritmo y puertas (sesión solo-dsh)

- Un escritor por archivo y por ola; los compartidos (`app.module.ts`, `package.json`,
  `operations/inventory-*verification.ts`, `inventory-workspace.tsx`) en una sola tarea por ola.
- Los workers no commitean, no hacen push y no ejecutan PostgreSQL; el orquestador corre
  `test:http:local`, `verify:*:rollback`, el pase visual y la integración.
- Por PR: gates locales → CI (Verify, PostgreSQL, Playwright) → revisión dsh (dos focos en A) → cero
  P1 → squash merge.
- Migraciones: preflight antes de cada ola; si hay candidatas, protocolo §19.6 completo.
- Cierre de cada ola: HANDOFF, `status.md`, `backlog.json`, `debt.md` y smoke si hubo UI.

## 9. Riesgos y decisiones pendientes de Emmanuel

1. **Sesión E2E:** sin ella no hay pase visual ni journey (bloqueo actual).
2. **`SYNC_CURSOR_SECRET` de producción:** rotarlo invalida cursores; definirlo antes de desplegar.
3. **`20260908000100`:** reconciliación pendiente (requiere migración idempotente nueva).
4. **Puertas humanas de M2:** dispositivo real, impresora Bluetooth y capturas siguen abiertas en
   `m2-offline-signoff.md`; sin ellas M2 no se declara DONE.
5. **Proveedores reales** (fiscal, pagos, agregadores) y la ratificación de la promesa ASAP (15/30
   min) siguen siendo decisiones humanas.
