# day-summary-report · resumen del día por sucursal (T3)

## Tarea
day-summary-report · **API nivel A** (`implementer-claude`, razonamiento alto; función SQL nueva de lectura financiera agregada) + **web nivel C** (Codex, `-Base claude/day-summary-report`). Revisión doble en A, una en C. Fila T3 del bloque «turno completo» (PROJECT_NOTES 2026-10-06).

## Objetivo
`POST /reports/day-summary` {scope, date} → resumen de sólo lectura del día (en la zona horaria del restaurante): ventas por canal (`table|counter|takeaway|delivery`, nombres reales del enum) y por método (`cash|card_manual|transfer`), propinas (totales y en efectivo), cargos de envío, conteo y monto de órdenes pagadas, entregas liquidadas, órdenes canceladas y capturas cerradas (si `order_cancellations` existe en main al implementar; si no, sólo capturas `no_sale`), y por turno/caja: apertura, cierre, fondo, esperado, contado, diferencia, movimientos por tipo. Pantalla `/app/reports/day` con selector de fecha (hoy por defecto), tarjetas y tablas en pesos.

## Hechos verificados (researcher 2026-10-06)
- Corte X por caja: `read_cash_register_operational_report` (vigente en `20261007000200_payments_transfer_method.sql:300-430`: fondo, esperado, contado, diferencia, ventas por método, propinas, movimientos ≤ 200); contrato `CashRegisterOperationalReportV1` (`packages/shared-types/src/payments.ts:129-146`); `PaymentsController.report` (`payments.controller.ts:55-72`) → `FinancialService.report` (`payments.ts:319-324`, permiso `cash-register.manage`).
- Fuentes: `app.orders` (channel, status, totales congelados, `created_at`/`paid_at`), `app.payments` (method, amount, tip, captured_at, state), `app.cash_movements`, `app.order_deliveries` (settled), `cash_register_sessions`/turnos (`operational_shifts`), `capture_drafts` `no_sale` (`capture_command_events`). Zona horaria: `app.restaurants.time_zone` (`20260906000200`, IANA, default America/Hermosillo).
- Permiso `reports.read` existe (`rbac-policy.ts:27`; supervisor 60, viewer 125): usarlo y añadirlo a `manager` si no lo tiene; `cashier` no.
- Patrón de lector: `list_branch_order_work_items` (`20261007000100:15-99`, request jsonb con scope).

## Diseño (seguir salvo razón documentada)
1. **SQL** `20261007000500_branch_day_summary.sql`: `app_private.read_branch_day_summary(p_actor uuid, p_request jsonb)` `stable security definer search_path ''`, EXECUTE sólo `app_api`; valida membresía con `reports.read` en el scope; `date` `YYYY-MM-DD` interpretado en `restaurants.time_zone` → rango `[inicio, fin)` en UTC; agregados por **pagos capturados** del día (ventas = pagos, no órdenes abiertas), por canal de la orden y por método; propinas; envíos (`deliveryCharge` de órdenes pagadas del día); entregas `settled` del día; canceladas (`order_cancellations` si existe en el esquema al momento de aplicar: usar `to_regclass` para no fallar) y capturas `no_sale`; turnos del día con sus cajas (apertura, cierre, fondo, esperado, contado, diferencia, movimientos por tipo). Índices: justificar los que falten para `(restaurant_id, branch_id, captured_at)` en `payments` sólo si la consulta real lo requiere (EXPLAIN en la prueba local). Prueba SQL (día con 2 turnos, 3 métodos, 2 canales, una entrega liquidada, una captura no_sale; día vacío → ceros; aislamiento) y verificador rollback-only.
2. **Contrato** `BranchDaySummaryV1` (shared-types `reports.ts`): dinero en minor, `currency`, `date`, `timeZone`, `salesByChannel[]`, `salesByMethod[]`, `tips`, `deliveryFees`, `deliveriesSettled`, `cancellations {orders, captures}`, `shifts[]`; parser fail-closed con pruebas (sumas coherentes).
3. **API**: módulo `reports` (`reports.controller.ts`, `reports.ts`) con `POST /reports/day-summary`; adaptador con fila real `{ result }`; 403; contract test HTTP.
4. **Web (Codex, después)**: `/app/reports/day` en el menú (sólo con `reports.read`), selector de fecha, tarjetas (ventas, propinas, envíos, canceladas) y tablas (por canal, por método, turnos); pesos; 390×844.

## Criterios de aceptación
- [ ] Resumen correcto en la prueba SQL; ceros en día vacío; sin escrituras.
- [ ] Puertas: shared-types test/build; api lint/typecheck/test/build; typecheck web/mobile/kds; prueba SQL + sonda local.
- [ ] Commits por unidad (db, shared-types, api); **commitear antes de cualquier informe**.

## Archivos de entrada
- C:\tmp\sr-wt\day-summary-report\supabase\migrations\20261007000200_payments_transfer_method.sql (280-440), 20260903000300_create_cash_register_operational_reporting.sql, 20261007000100_branch_order_work_tray_delivery_state.sql (1-100), 20260906000200_add_authoritative_restaurant_time_zone.sql.
- C:\tmp\sr-wt\day-summary-report\apps\api\src\payments.ts (300-340), payments.controller.ts, auth\rbac-policy.ts, branch-order-work-tray.ts (adaptador).
- C:\tmp\sr-wt\day-summary-report\packages\shared-types\src\payments.ts (120-150).

## Invariantes
Sólo lectura; dinero congelado en enteros; ventas = pagos capturados; alcance Restaurant/Branch; sin push; no editar migraciones aplicadas.

## Fuera de alcance
Exportar, comparativas entre días, impresión del resumen.

## Formato de salida
Resumen, archivos y hashes, puertas y sonda, riesgos.
