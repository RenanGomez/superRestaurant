# Plan de etapa — Fase 5 completa (gestión, CRM, personal y rentabilidad) con M4 como cabecera

Sustituye como guía de mediano plazo a `docs/plans/plan-2026-11-28-ola7-exportaciones.md`, que sigue vigente
como **Ola 7** (primer corte de esta etapa). Estado verificado el 2026-11-28: `main` en `8f05eae0`, dev en
`20261126001500`, Olas 0–6 fusionadas (#151–#157), sin PRs abiertos ni workers vivos, `o5-compras-ui-read` en
REVIEW por la cuenta `viewer`.

## 0. Objetivo y por qué ahora

El plan maestro pone **Fase 5 — Gestión, CRM y personal** después de inventario, y su criterio de salida es
exigente: métricas definidas y reconciliables, filtros por restaurante/sucursal/canal/zona horaria,
exportaciones con permisos y retención, historial que no se altera y márgenes trazables a eventos
autoritativos. Hoy hay catálogo de métricas (`docs/architecture/metrics-catalog.md`), ADR de exportaciones
(`docs/adr/ADR-014.md`) y un resumen del día funcionando: falta **convertirlo en producto** y abrir las tres
patas que la Fase 5 pide (clientes, personal, rentabilidad).

Esta etapa busca **avanzar mucho sin romper la disciplina**: olas de 4–8 tareas, cada una con una pantalla
que la justifique, un contrato fijado antes de escribir y puertas automáticas por PR.

Meta de la etapa: **M4 cerrado de verdad** (exportaciones en los tres formatos y reportes con rango) y **Fase 5
al 60–70 %** con dashboard, segmentos de cliente, asistencia/comisiones y rentabilidad por canal y producto.

## 1. Mapa de olas

| Ola | Foco | Tareas | Nivel | Motor principal | ETA | Salida |
|---|---|---|---|---|---|---|
| **7** | Compras legibles + CSV + ticket promedio | 6 | A/B/C | dsh, codex, gemini | 1 sesión | M4-1: el operador descarga el día |
| **8** | Reportes con rango, XLSX/PDF y reembolsos ejecutados | 10 | A/B/C/D | codex, dsh, gemini | 2 sesiones | M4 cerrado |
| **9** | Dashboard operativo y gerencial | 6 | A/B/C | codex, gemini, dsh | 1–2 sesiones | Fase 5: métricas visibles |
| **10** | CRM sobre el directorio existente | 6 | A/B/C/D | codex, gemini, dsh | 1–2 sesiones | Fase 5: clientes |
| **11** | Personal: asistencia, comisiones, desempeño | 5 | A/B/C/D | codex, dsh, gemini | 1–2 sesiones | Fase 5: personal |
| **12** | Rentabilidad por canal, producto, zona y repartidor | 5 | A/B/C | codex, gemini, dsh | 1 sesión | Fase 5: margen |
| **Transversal** | Deudas que muerden | 4 | B/D | dsh, codex | repartido | deuda viva a cero |

Total: **42 tareas**. No se abre una ola sin cerrar la anterior salvo que una tarea sea puramente documental
o una deuda independiente.

## 2. Reglas de ejecución (aplican a todas las olas)

- **Reparto por motor:** codex → dinero, SQL, estado, sync y bugs duros · gemini → UI, visual y piezas
  medianas con contexto amplio · dsh → tests, mecánicos, documentos y piezas pequeñas. Con tres o más tareas,
  cada motor recibe al menos una que escriba código.
- **Revisión cruzada obligatoria:** el diff de un motor lo revisa otro distinto. P1 antes del merge; P2/P3 a
  `docs/agentic/debt.md`.
- **Archivos compartidos (un escritor a la vez):** `apps/api/package.json` (cadena `test`),
  `apps/api/src/app.module.ts` (registro de controladores/servicios), `apps/api/src/reports.ts` y
  `reports.controller.ts`, `packages/shared-types/src/reports.ts`, `apps/web/src/app/app/reports/day/page.tsx`,
  `apps/web/package.json` y `supabase/migrations` (una migración por ola como máximo, siempre nueva).
- **Migraciones:** nunca se edita una aplicada. Cada migración nueva entra con §19.6 (sonda rollback-only,
  respaldo schema-only verificado, dry-run exacto, apply único a dev, postcheck y segundo dry-run).
- **Contrato antes de código:** si dos tareas comparten un tipo, el contrato lo fija esta etapa (o su brief)
  antes de que nadie escriba. Nada de inventar campos que la base no tiene.
- **Spikes marcados:** cuando el modelo de datos no está confirmado (`taxMinor` en snapshots, qué representa
  `app.settlements`), la primera tarea de la ola es un **spike de solo lectura** que devuelve un mapa de
  fuentes; sin ese mapa no se abre la implementación.
- **Puertas por PR:** `test`, `lint`, `typecheck`, `build` y `e2e:typecheck` del alcance en 0; CI verde
  (Verify, PostgreSQL, Playwright); pase visual automatizado en 1366×800 y 390×844 con consola y red limpias
  cuando haya UI; `git diff --check` en docs.
- **Regla de corte:** si una ola pasa de dos sesiones o acumula dos P1 en el mismo archivo, se cierra con lo
  verde y lo pendiente pasa a la ola siguiente con su id. Nada de dejar ramas vivas.

## 3. Ola 7 — primer corte (referencia)

Ya planificada en `docs/plans/plan-2026-11-28-ola7-exportaciones.md`: cerrar `o5-compras-ui-read`, CSV del
resumen del día en tres tareas (`report-export-csv`, `report-export-endpoint`, `report-export-web`) y
`sql-average-ticket`. **No se duplica aquí**; esta etapa la trata como entrada del M4.

## 4. Ola 8 — Reportes con rango, tres formatos y reembolsos ejecutados

Objetivo: que el operador y el contador puedan pedir **un periodo**, no un día, y que el reembolso ejecutado
deje de ser un hueco del catálogo.

### 4.1 `rep-range-summary` (A, codex) — el agregado por rango

- **Archivo nuevo:** `supabase/migrations/<nueva>_branch_range_summary.sql` con
  `app_private.read_branch_range_summary(p_actor_id uuid, p_request jsonb)`, `SECURITY DEFINER`,
  `search_path = ''`, `REVOKE ALL` y `GRANT EXECUTE TO app_api`, como las funciones existentes.
- **Contrato nuevo** en `packages/shared-types/src/reports.ts`:
  `BranchRangeSummaryV1 { schemaVersion, scope, from, to, timeZone, currency, days: BranchDaySummaryV1[],
  totals: { salesMinor, tipsMinor, cashTipsMinor, paymentCount, ordersPaid, averageMinor }, truncated: boolean }`.
  `days` reutiliza el resumen diario existente; nada se recalcula de otra forma.
- **Límites:** 31 días por petición; más de 31 → `400 REPORT_RANGE_REJECTED`; `truncated` avisa si el tope de
  turnos por día recorta.
- **Autorización:** `reports.read` por sucursal, igual que el resumen diario; sucursal ajena → 403.
- **Prueba SQL:** dos días con pagos distintos, suma de `days[].totals` = `totals`, y un día sin pagos no
  rompe la suma.
- Hecho cuando: `verify:branch-day-summary-schema:rollback` (o el verificador del resumen) cubre la función
  nueva y la prueba compara sin tolerancia.

### 4.2 `rep-export-range` (B, dsh) — CSV de un periodo

- Extiende el serializador de la Ola 7 (no lo reescribe): `rangeSummaryRows(summary: BranchRangeSummaryV1)`
  con la misma cabecera de siete columnas y una fila por día más un bloque `rango,totales`.
- Endpoint `GET /reports/branch-range/export?branchId&from&to&format=csv[&bom=1]`, límites 31 días / 50 000
  filas / 20 MB, con los mismos códigos que el export diario.
- Hecho cuando: el CSV de dos días contiene exactamente las filas de cada día y el total del rango coincide
  con `POST /reports/branch-range` (prueba de contrato, sin tolerancia).

### 4.3 `rep-export-xlsx` (B, codex) — libro con varias hojas

- `exceljs` como **única** dependencia nueva en `apps/api` (ADR-014 §2). Hojas: `Resumen`, `Por día`,
  `Canales`, `Métodos`, `Turnos`, `Movimientos`.
- Escritura en streaming (`WorkbookWriter`) por encima de 2 000 filas; por debajo se permite buffer.
- Importes como entero con formato `#,##0`; moneda en columna aparte; nada de floats.
- Hecho cuando: una prueba lee el XLSX de vuelta (con la propia librería), verifica que cada celda monetaria
  es entero y que los totales coinciden con el CSV del mismo periodo.

### 4.4 `rep-export-pdf` (B, codex) — imprimible de una sucursal y un periodo

- `pdfkit` como segunda y última dependencia de exportación. Documento de portada con sucursal, rango, zona y
  fecha de generación, y una tabla por día; sin plantillas HTML ni navegador headless.
- Hecho cuando: PDF válido (`%PDF-1.7`), número de páginas razonable para 31 días y los importes del texto
  coinciden con el CSV (búsqueda literal de los totales).

### 4.5 `spike-report-tax-sources` (B, gemini, solo lectura, 45 min)

- Mapa de qué guarda hoy `app.orders.aggregate` y los snapshots de línea sobre **descuentos, impuestos
  incluidos/excluidos y cortesías**, con `archivo:línea` y un ejemplo real de payload.
- Salida: media página en `docs/architecture/report-tax-sources.md` y veredicto `hay datos` / `faltan datos`.
- Si faltan: se abre `adr-015-fiscal-tax-report` y **no** se implementa `rep-gross-net-tax` en esta etapa.

### 4.6 `rep-gross-net-tax` (A, codex, solo si el spike dice `hay datos`)

- Campos nuevos en el resumen: `grossSalesMinor`, `discountMinor`, `taxMinor`, `netSalesMinor`, con la
  identidad `gross - discount = net` y `tax` dentro de `net` (o fuera, según el spike; se decide con datos).
- Cálculo en SQL desde los snapshots congelados; el histórico no se recalcula con el catálogo actual.
- Hecho cuando: la identidad cuadra en las tres pruebas (día con descuento, con impuesto excluido, sin nada)
  y la pantalla muestra los cuatro importes sin dividir en el cliente.

### 4.7 `adr-016-refunds` (D, gemini) + 4.8 `sql-refunds-table` (A, codex) + 4.9 `rep-refunds-field` (A, codex)

- **ADR-016:** tabla inmutable `app.refunds` (`id`, scope, `order_id`, `payment_id`, `amount_minor`, `tip_minor`,
  `currency`, `reason`, `actor_id`, `device_id`, `occurred_at`, `received_at`, `idempotency_key`), sin UPDATE
  ni DELETE (trigger `42501`), escritura solo por función `app_private`, y semántica de obligación pendiente
  vs reembolso ejecutado. Alternativas descartadas: reutilizar `order_cancellations` (no distingue ejecución),
  añadir columnas a `payments` (inmutable y ya capturado).
- **Migración:** tabla + función `app_private.record_order_refund(...)` idempotente por
  `(order_id, idempotency_key)`, con guard de obligación y actor. Sin tocar `payments`.
- **Reporte:** `cancellations.refundedMinor` y `refunds: { count, amountMinor }` en el resumen del día y del
  rango; reconciliación `refundPendingMinor + refundedMinor ≤ capturado de las canceladas`.
- Hecho cuando: doble envío no duplica reembolso; reembolso sin obligación → 409 con código propio; el
  reporte cuadra con la tabla.

### 4.10 `rep-screen-range` (C, gemini) — la pantalla de reportes con rango

- `/app/reports/day` gana selector de periodo (hoy, ayer, últimos 7 días, mes en curso, rango explícito),
  filtros por canal y método (servidor, no cliente) y descarga en los tres formatos con el estado de cada uno.
- El cliente **no** suma: pinta `totals` y `days[]` del servidor. Estados vacío, error, generando y límite
  superado, con textos en español y sin `alert/confirm/prompt`.
- Hecho cuando: cambiar el rango cambia los números del servidor; el pase visual queda limpio en desktop y
  390×844 y las descargas se comportan (contenido y nombre correctos).

## 5. Ola 9 — Dashboard operativo y gerencial

Objetivo: una pantalla donde el encargado vea el turno **sin abrir cinco pestañas**, y donde la gerencia vea
la semana.

### 5.1 `dash-kpi-function` (A, codex)

- `app_private.read_branch_operational_dashboard(p_actor_id uuid, p_request jsonb)` devuelve en **una** llamada:
  ventas y tickets de hoy, ticket promedio, órdenes abiertas por estado, propinas, cancelaciones del día,
  alertas de stock bajo (`list_inventory_alerts`), turno actual y caja esperada por sesión.
- Reutiliza las funciones existentes; no duplica fórmulas. Sin tablas nuevas. `reports.read` + `catalog.read`
  resuelto por el servicio antes de llamar.
- Hecho cuando: cada número coincide con su pantalla de origen (prueba que compara dashboard vs day-summary vs
  alerts) y el coste por llamada está medido (una sola ida a la base).

### 5.2 `dash-kitchen-times` (A, codex)

- Tiempo medio y percentil 90 de preparación por estación desde `app.kds_events` (creación → listo), con
  ventana de 7 días y filtro por sucursal. Nada de cronómetro en cliente.
- Hecho cuando: prueba SQL con tickets sintéticos de 5 y 20 minutos da media 12,5 y p90 correcto; el
  dashboard muestra `—` cuando no hay eventos en vez de `0`.

### 5.3 `dash-sync-health` (B, dsh)

- El dashboard consume el estado que ya expone `/api/sync` (pendientes, revisiones, última confirmación) y lo
  presenta en una tarjeta; **no** añade endpoint nuevo. Si el navegador no es líder, muestra el motivo que ya
  calcula `runtime-sync-runner`.
- Hecho cuando: con el outbox vacío dice «0 pendientes» y con eventos pendientes el número coincide con la
  barra de sync.

### 5.4 `dash-web` (C, gemini) + 5.5 `dash-visual` (C, gemini, pase)

- `/app` gana el bloque «Hoy» y `/app/reports/dashboard` la vista gerencial (semana, comparación con la
  anterior). Tarjetas con `min-h-11`, `role="status"` para carga y `role="alert"` para error, sin overlays
  sobre el área operativa.
- Hecho cuando: pase visual de ambas rutas en 1366×800 y 390×844, consola y red limpias, sin desbordes.

### 5.6 `dash-observability` (B, dsh)

- Log estructurado del dashboard con `correlationId`, `restaurantId`, `branchId` y duración; sin datos
  personales. Una prueba comprueba que el log no incluye correo ni teléfono.
- Hecho cuando: la prueba falla si alguien añade un campo PII al log.

## 6. Ola 10 — CRM sobre el directorio existente

El directorio ya existe (`app.customers`, `customer_phones`, `customer_addresses`,
`customer_command_events`) y la ficha muestra historial de pedidos. La ola **no** inventa marketing: mide,
segmenta y guarda consentimiento.

### 6.1 `adr-017-crm` (D, gemini)

- Decide: qué es un segmento (frecuencia, ticket medio, última compra, canal preferido), si las preferencias
  se **derivan** o se **guardan**, qué consentimiento se pide y con qué texto, retención y derecho de
  supresión, y qué NO se hace (envíos, campañas, puntos). Alineado con LFPDPPP y AGENTS §13.

### 6.2 `crm-segments-sql` (A, codex)

- `app_private.list_customer_segments(p_actor_id uuid, p_request jsonb)` agrega por cliente sobre
  `payments` + `orders` + `customers` (frecuencia, gasto, ticket medio, última compra, canal dominante) con
  filtros de periodo y sucursal. **Solo lectura**; no crea tablas.
- Sin PII en la respuesta más allá de nombre visible e id; teléfonos solo si el rol tiene `customers.read`.
- Hecho cuando: prueba con tres clientes sintéticos clasifica bien (`nuevo`, `recurrente`, `inactivo`) y un
  cliente de otro restaurante nunca aparece.

### 6.3 `crm-profile-web` (C, gemini)

- La ficha del cliente muestra segmento, frecuencia, gasto del periodo y última compra; el listado permite
  filtrar por segmento (servidor). Sin cálculos en el navegador.
- Hecho cuando: el filtro trae exactamente los clientes del servidor y el pase visual queda limpio.

### 6.4 `crm-consent` (A, codex)

- Tabla nueva `app.customer_consents` (customer, canal, estado, texto/versión, actor, ocurrido/recibido,
  inmutable con compensación) + comando `app_private.record_customer_consent`. Sin envíos: solo evidencia.
- El resumen por cliente expone `marketingAllowed`; un cliente sin consentimiento **nunca** aparece como
  contactable.
- Hecho cuando: revocar y volver a otorgar deja historia completa y el estado vigente es el último evento.

### 6.5 `crm-preferences` (B, codex) — solo si el ADR dice «derivar»

- Preferencias derivadas (productos más pedidos, exclusiones repetidas) desde el historial, con ventana y
  `min` de pedidos. Sin tabla nueva; se recalculan en servidor.
- Hecho cuando: con dos pedidos no se declara preferencia; con cinco, sí, y coincide con el detalle.

### 6.6 `crm-consent-web` (C, gemini)

- En la ficha: estado de consentimiento con fecha y origen, y acción explícita de otorgar/revocar con motivo.
  Sin `confirm()` nativo; diálogo accesible del sistema existente.
- Hecho cuando: el cambio se refleja al recargar y queda en la historia.

## 7. Ola 11 — Personal: asistencia, comisiones y desempeño

Hoy hay membresías (`app.memberships` con roles por sucursal), turnos (`app.operational_shifts` +
`operational_shift_events`) y sesiones de caja con cajero. No hay ficha de empleado, asistencia explícita ni
comisiones.

### 7.1 `adr-018-staff` (D, gemini)

- Decide: ¿la asistencia se **deriva** de turnos/caja o requiere fichaje explícito? ¿La comisión es por venta,
  por producto o por turno? ¿Quién la aprueba? ¿Se paga en caja o es solo reporte? Base: nunca calcular
  comisiones en cliente y nunca reescribir el histórico.

### 7.2 `staff-attendance` (B, dsh) — derivada

- Vista/función de solo lectura: por actor y día, primer y último evento de turno, horas en turno y sesiones
  de caja abiertas/cerradas, desde `operational_shift_events` y `cash_register_sessions`.
- Hecho cuando: un turno de 3 h con dos cajas da 3 h y dos sesiones; sin eventos, el día no aparece inventado.

### 7.3 `staff-commissions` (A, codex, solo si el ADR fija la regla)

- Tabla inmutable de comisión **devengada** con snapshot de la regla y del importe; cálculo en SQL sobre
  pagos capturados del periodo; corrección por movimiento compensatorio.
- Guardas: idempotencia por `(payment_id, rule_version)`; sin comisión sobre propinas ni sobre reembolsos.
- Hecho cuando: doble ejecución no duplica; un reembolso posterior no borra la comisión devengada (queda
  compensación explícita si la regla lo dice).

### 7.4 `staff-performance-api` (B, codex) + 7.5 `staff-web` (C, gemini)

- Endpoint de desempeño por persona y periodo: ventas cobradas, tickets, propinas, tiempo medio de turno y
  cancelaciones autorizadas. Pantalla `/app/system-admin/personal` (o la ruta que fije el ADR) con tabla,
  filtros y exportación CSV del periodo reutilizando el serializador de la Ola 8.
- Hecho cuando: los números cuadran con caja (`cash_register_sessions.cashier_id`) y la exportación pasa por
  el mismo contrato.

## 8. Ola 12 — Rentabilidad por canal, producto, zona y repartidor

### 8.1 `spike-profitability-sources` (B, gemini, solo lectura)

- Mapa exacto de dónde viven el **cargo de entrega**, el **costo real** (inventario) y el **pago al
  repartidor** (`order_deliveries`, `order_delivery_events`, `app.settlements` y `delivery_zone_settlements`
  — confirmar qué representa cada uno). Sin mapa no se implementa nada.

### 8.2 `prof-product-margin` (A, codex)

- Margen por producto y periodo usando costo de receta vigente **y** el costo congelado en
  `inventory_consumptions` cuando exista; si falta el histórico, se marca `parcial` y no se inventa.
- Hecho cuando: la suma de márgenes por producto cuadra con el margen del canal y los productos sin receta
  aparecen como `sin costo` en vez de 100 % de margen.

### 8.3 `prof-channel` (A, codex)

- Venta, costo, cargo de entrega y margen por canal (`table`, `counter`, `takeout`, `delivery`) en el rango,
  con la misma reconciliación que el resumen.

### 8.4 `prof-zone-courier` (B, codex)

- Por zona: pedidos, cargo cobrado, costo declarado y margen. Por repartidor: entregas, tiempo medio, efectivo
  liquidado y diferencias. Solo si el spike confirma que hay fuente para el costo; si no, se entrega el
  reporte de **ingreso** por zona y el costo queda como deuda con su id.

### 8.5 `prof-web` (C, gemini, con pase visual)

- `/app/reports/profitability` con tres pestañas (producto, canal, zona/repartidor), filtros de periodo y
  exportación CSV. Estados vacío/parcial explícitos.

## 9. Decisiones que Emmanuel debe tomar antes de cada ola

| Antes de | Decisión | Por qué bloquea |
|---|---|---|
| Ola 8 | ¿Reembolso **ejecutado** se registra en el POS o solo se anota? ¿Quién puede ejecutarlo? | `adr-016-refunds` y la tabla `app.refunds` |
| Ola 8 | ¿El impuesto se reporta incluido o desglosado? ¿Se factura (CFDI) en esta etapa? | `rep-gross-net-tax` depende del spike |
| Ola 9 | ¿El dashboard vive en `/app` o en ruta propia? ¿Qué ve un `viewer`? | alcance de `dash-web` y RBAC |
| Ola 10 | ¿Consentimiento explícito para marketing o solo preferencias? ¿Se enviará algo algún día? | `adr-017-crm` |
| Ola 11 | ¿Comisión por venta, por producto o por turno? ¿Se paga en caja? | `adr-018-staff` |
| Ola 12 | ¿El costo de reparto es el cargo cobrado o un costo declarado por zona? | `prof-zone-courier` |
| Todas | Cuenta `viewer`/`auditor` de pruebas y prueba del operador (D1–D7, T1–T4) | cierran `o5-compras-ui-read` y «Día operable» |

Ninguna de estas decisiones se toma por el agente: se pregunta y se registra en `DECISIONS_PENDING.md` y en
HANDOFF.

## 10. Puertas y criterios de salida

**Por ola:** las puertas de §2 + CI verde + revisión cruzada + smoke regenerado si hay UI + preflight READ_ONLY
al abrir y cerrar.

**Criterios de salida de la etapa (Fase 5 del plan maestro):**

1. métricas definidas y versionadas, reconciliables con órdenes y pagos (`metrics-catalog.md` actualizado con
   cada campo nuevo y su prueba);
2. filtros por restaurante, sucursal, canal y zona horaria en reportes y dashboard;
3. exportaciones con permisos, retención y privacidad (CSV/XLSX/PDF, sin PII innecesaria);
4. el historial operativo no se altera por cambios posteriores de cliente o catálogo (snapshots y costo
   congelado verificados);
5. indicadores de tiempo y margen trazables hasta eventos autoritativos (`kds_events`, `payments`,
   `inventory_consumptions`).

La etapa **no** declara DONE ninguna fila de «Día operable»: eso sigue dependiendo de la prueba del operador.

## 11. Riesgos y cosas que no se hacen

- **No se abre Fase 6** (fiscal, PAC, terminal de pago, agregadores) en esta etapa. CFDI y pagos integrados
  necesitan ADR y proveedor; el spike de impuestos solo informa.
- **No se envían comunicaciones.** Consentimiento es evidencia, no campaña; nada de email/SMS/push.
- **No se crea lealtad con puntos** ni wallets. Si Emmanuel lo pide, va como ola propia con ADR.
- **No se toca `app.payments`** para reembolsos: tabla nueva + compensación, nunca UPDATE.
- **No se recalcula el histórico** con el catálogo vigente: se usa el snapshot o se marca `parcial`.
- **No se mueve dinero real** en comisiones: se devenga y se reporta; pagar en caja es decisión aparte.
- **Riesgo de sobrecarga del dashboard:** una sola llamada, con `statement_timeout` y prueba de latencia; si
  no cabe, se parte en dos tarjetas con carga diferida.
- **Riesgo de PII en reportes:** cada endpoint nuevo pasa por una prueba que verifica que no expone correo ni
  teléfono completo a roles sin `customers.read`.

## 12. Calendario sugerido (sesiones de ~3 h)

| Sesión | Contenido |
|---|---|
| 1 | Ola 7 completa (compras legibles, CSV, ticket promedio) |
| 2 | Ola 8 parte 1: `rep-range-summary`, `rep-export-range`, spike fiscal |
| 3 | Ola 8 parte 2: XLSX, PDF, `rep-screen-range` |
| 4 | Ola 8 parte 3 (si el spike lo permite): `rep-gross-net-tax`; ADR-016 + tabla de reembolsos |
| 5 | Ola 9: dashboard (función, tiempos de cocina, web) |
| 6 | Ola 10: ADR CRM, segmentos, ficha y consentimiento |
| 7 | Ola 11: ADR staff, asistencia, comisiones y pantalla |
| 8 | Ola 12: spike, margen por producto y canal, web; cierre de etapa con smoke y HANDOFF |

Si una sesión se corta, la ola se cierra con lo verde y lo pendiente arranca la siguiente con su id. Lo que no
se hace nunca es abrir dos olas a la vez sobre los mismos archivos.
