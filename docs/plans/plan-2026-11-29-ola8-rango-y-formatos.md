# Plan — Ola 8: reportes con rango, tres formatos y la decisión de reembolsos

Sustituye como guía de corto plazo a `docs/plans/plan-2026-11-28-ola7-exportaciones.md` (queda como registro).
Estado verificado el 2026-11-28 al cerrar la Ola 7: `main` en `096aad94`, dev en `20261128000100`, Ola 7
fusionada (#160–#165), el CSV del día y el ticket promedio en `main` y en dev, el proxy de sync con scope por
evento, y sin PRs abiertos. Deuda viva: `o5-compras-ui-read` en REVIEW (falta cuenta `viewer`/`auditor`),
`o7-p3-items-42501` con brief escrito, y la prueba del operador sin registrar.

## 0. Objetivo y alcance

Que el operador y el contador pidan **un periodo**, no un día, y que la exportación deje de ser solo CSV.

Tres cortes, cada uno con su cierre:

| Corte | Contenido | Sesiones | Migración |
|---|---|---|---|
| **1** | Periodo de punta a punta: agregado SQL, contrato, endpoint, CSV del rango y pantalla + spike fiscal | 1 | sí, una |
| **2** | XLSX y PDF sobre el CSV del rango ya fusionado, filtros por canal y método en servidor | 1 | no |
| **3** | Reembolsos ejecutados (ADR-016, tabla y reporte) | 1 | sí, una |

**Fuera de alcance de la ola:** CFDI y cualquier integración fiscal real, dashboard gerencial (Ola 9), CRM
(Ola 10), personal (Ola 11), rentabilidad por zona (Ola 12). **No** se abre `rep-gross-net-tax` sin el
veredicto del spike ni sin la decisión de impuestos de Emmanuel. La prueba del operador no se sustituye por
ningún pase automatizado: ninguna fila de «Día operable» pasa a DONE en esta ola.

## 1. Decisiones previas

| Antes de | Decisión | Efecto si falta |
|---|---|---|
| Corte 3 | ¿El reembolso **ejecutado** se registra en el POS o solo se anota? ¿Qué rol puede ejecutarlo? ¿Efectivo y tarjeta, o solo efectivo en esta etapa? | El corte 3 no se abre; `adr-016-refunds` queda escrito como propuesta y nada más |
| Corte 1 (solo `rep-gross-net-tax`) | ¿El impuesto se reporta incluido en la venta o desglosado? ¿Se factura? | La tarea no se abre; el spike queda documentado |
| Corte 1 | ¿Hay cuenta web `viewer`/`auditor` de pruebas? | `o5-compras-ui-read` sigue en REVIEW |

Las decisiones se registran en `DECISIONS_PENDING.md` (se crea con la primera) y en HANDOFF. **El agente no
las toma.**

## 2. Corte 1 — el periodo (una sesión)

### 2.1 `rep-range-summary` (A, codex) — agregado SQL y contrato

| Archivo | Qué |
|---|---|
| `supabase/migrations/20261129000100_branch_range_summary.sql` (nuevo) | `app_private.read_branch_range_summary(p_actor_id uuid, p_request jsonb)`, `SECURITY DEFINER`, `search_path = ''`, `REVOKE` a `public/anon/authenticated/service_role` y `GRANT EXECUTE` solo a `app_api` |
| `packages/shared-types/src/reports.ts` | `BranchRangeSummaryV1` + `parseBranchRangeSummaryV1` |
| `packages/shared-types/src/reports.runtime.test.ts` | Contrato y coherencia |
| `supabase/tests/branch_range_summary_invariants.sql` (nuevo) | Invariantes con datos reales |
| `apps/api/src/operations/run-branch-day-summary-schema-verification.ts` | Aplica también esta migración y corre el archivo nuevo |
| `.github/workflows/ci.yml` | Hook `run_invariant` tras la migración nueva |

Contrato exacto (lo fija este plan; nadie lo reinventa):

```ts
export interface BranchRangeSummaryV1 {
  readonly schemaVersion: 1;
  readonly scope: BranchScope;
  readonly from: string;   // YYYY-MM-DD inclusivo, calendario del restaurante
  readonly to: string;     // idem, from <= to
  readonly timeZone: string;
  readonly currency: string;
  readonly days: readonly BranchDaySummaryV1[];   // una por día, ascendente, sin huecos
  readonly totals: {
    readonly salesMinor: number;
    readonly tipsMinor: number;
    readonly cashTipsMinor: number;
    readonly paymentCount: number;
    readonly ordersPaid: number;      // suma de days[].ordersPaid.count
    readonly ordersPaidAmountMinor: number; // suma de days[].ordersPaid.amountMinor (sin propinas)
    readonly averageMinor: number | null;
  };
}
```

Reglas (no negociables):

- **Nada se recalcula de otra forma:** cada día sale de `app_private.read_branch_day_summary` (la misma
  función del día). La función del rango solo itera, suma y valida; si un día responde `denied`, `rejected`
  o `conflict`, el rango responde igual y no inventa ceros.
- `days` va **ascendente** y sin huecos: un día sin movimientos es un día válido con ceros.
- `totals.salesMinor/tipsMinor/cashTipsMinor/paymentCount/ordersPaid/ordersPaidAmountMinor` son sumas de `days[]`.
- `totals.averageMinor` se calcula **en SQL** con la **misma fórmula del día** (`ordersPaid.amountMinor /
  ordersPaid.count`, catálogo de métricas): `null` si `ordersPaid = 0`; si no, división entera `bigint` medio
  hacia arriba sobre `totals.ordersPaidAmountMinor`. **No** se usa `salesMinor` (son pagos del día, no el
  importe de las órdenes pagadas: dos definiciones distintas darían un ticket del rango distinto del del día).
- **Sin `truncated`.** El resumen del día recorta en silencio a 50 turnos (`limit 50`) y no expone bandera; el
  rango hereda ese tope. Se registra como deuda y no se inventa una señal nueva en esta migración.
- `from`/`to` inválidos, `from > to` o más de **31 días inclusivos** → `400 REPORT_RANGE_REJECTED` con
  `{ from, to, maxDays: 31 }`.
- `reports.read` en la sucursal exacta; sucursal ajena → `403 ACTION_NOT_AUTHORIZED` (lo decide el servicio,
  la función revalida con el actor).
- El parser **falla cerrado**: `days.length` igual al número de días entre `from` y `to`, fechas
  consecutivas, `currency` y `timeZone` idénticos en todos los días, y `totals` igual a la suma de `days`
  (sin tolerancia). Un `totals` incoherente invalida el rango entero.

Hecho cuando: los invariantes prueban dos días con pagos distintos (suma exacta), un día sin pagos en medio
(no rompe la suma), `averageMinor` de rango con 3 órdenes y `ordersPaidAmountMinor` `100001` → `33334`, y un caso donde `salesMinor` ≠ `ordersPaidAmountMinor` que prueba que el promedio usa el segundo, y el rechazo de 32
días. El verificador aplica la migración nueva tras la del día y queda `status=ok` con `local_cleanup
stopped=true`.

Riesgo declarado: la función hace hasta 31 llamadas al lector del día. Es deliberado (una sola fuente de
cálculo); si el tiempo crece, se optimiza en una migración posterior, no duplicando la aritmética.

### 2.2 `rep-range-endpoint` (B, codex) — lectura del periodo

| Archivo | Qué |
|---|---|
| `apps/api/src/reports.controller.ts` | `POST /reports/branch-range` (JSON, para la pantalla) y `GET /reports/branch-range/export` (CSV) |
| `apps/api/src/reports.ts` | `branchRange(principal, input)` reutilizando el puerto del día |
| `apps/api/src/reports.range.test.ts` (nuevo) | Contrato de los dos endpoints con doble del servicio |

- `POST` devuelve `BranchRangeSummaryV1`. `GET` devuelve CSV con
  `content-disposition: attachment; filename="range-summary_<branchId>_<from>_<to>_<YYYYMMDDTHHmmssZ>.csv"`,
  `content-type: text/csv; charset=utf-8`, `Cache-Control: private, no-store`.
- Errores: `400 REPORT_RANGE_REJECTED` (rango/fechas), `400 REPORT_EXPORT_FORMAT_REJECTED`,
  `403 ACTION_NOT_AUTHORIZED`, `413 REPORT_EXPORT_TOO_LARGE` (`{ rows, maxRows }`), `504 REPORT_EXPORT_TIMEOUT`.
  Mismos códigos que el export del día; no se inventan nuevos.
- El endpoint no escribe nada y no cachea el rango.

### 2.3 `rep-export-range-csv` (B, dsh) — CSV de un periodo

- **Extiende** el serializador de la Ola 7 (`apps/api/src/reports/export/csv.ts`), no lo reescribe:
  `rangeSummaryRows(summary: BranchRangeSummaryV1): readonly (readonly string[])[]` y el serializador sigue
  siendo el mismo.
- Cabecera del rango (ocho columnas, la fecha primero):

  ```
  fecha,seccion,concepto,zona,moneda,importe,conteo,detalle
  ```

- Por cada día, las **mismas** filas de sección del archivo diario (`totales`, `ordenes`, `entregas`,
  `cancelaciones`, `canal`, `metodo`, `turno`, `caja`, `movimiento`) con `fecha` = la del día. Al final, un
  bloque de una fila:

  ```
  rango,totales,,<timeZone>,<currency>,<totals.salesMinor>,<totals.paymentCount>,propinas=<totals.tipsMinor>;efectivo=<totals.cashTipsMinor>;ordenes_pagadas=<totals.ordersPaid>;ticket=<averageMinor, vacío si es null>
  ```

- El archivo diario **no cambia** (siete columnas, sin `fecha`) para no romper lo ya entregado.
- **Prerrequisito (bug de Ola 7, tarea `fix-csv-ticket-null`, dsh):** `daySummaryRows` escribe `ticket=null`
  cuando el SQL devuelve `averageMinor: null` (solo trata `undefined`), y la prueba solo cubre la clave
  ausente. Se corrige a vacío para `null` y `undefined`, con prueba del caso `null`, **antes** de
  extender el serializador; el bloque `rango` usa la misma regla.
- Hecho cuando: dos días producen primero las filas del día 1 y después las del día 2, en orden, y el bloque
  `rango` coincide **sin tolerancia** con `POST /reports/branch-range`; un día vacío en medio no altera la
  suma; el escapado RFC 4180 sigue probado.

### 2.4 `rep-screen-range` (C, gemini) — la pantalla con periodo

- `/app/reports/day` gana un selector de periodo: **hoy, ayer, últimos 7 días, mes en curso, rango explícito**.
  El formulario navega y el servidor pide el rango; el cliente **no** suma ni recorta.
- Tarjetas del rango (ventas, propinas, envíos, canceladas, ticket promedio) y una tabla **por día** con
  ventas, pagos y diferencia; el detalle del día sigue disponible enlazando a ese día.
- Descarga «Descargar CSV del periodo» con estado ocupado y error en `role="alert"`; al superar 31 días o
  50 000 filas, el texto explica el límite.
- Sin `alert/confirm/prompt`; targets de 44 px; estados vacío, error y generando explícitos.
- Hecho cuando: cambiar el periodo cambia los números **del servidor**, el pase visual queda limpio en
  1366×800 y 390×844, y la descarga del rango baja un archivo cuyo total coincide con la pantalla.

**Filtros por canal y método: no en este corte.** Van en el corte 2, en servidor, para no mezclar dos
cambios de contrato en la misma migración.

### 2.5 `spike-report-tax-sources` (B, gemini, solo lectura, 45 min)

- Mapa de qué guardan hoy `app.orders.aggregate` y los snapshots de línea sobre **descuentos, impuestos
  incluidos/excluidos y cortesías**, con `archivo:línea` y un payload real de ejemplo.
- Salida: media página en `docs/architecture/report-tax-sources.md` y veredicto `hay datos` / `faltan datos`.
- Si faltan: se abre `adr-015-fiscal-tax-report` y `rep-gross-net-tax` **no** se implementa en esta etapa.

## 3. Corte 2 — formatos y filtros (una sesión, con el corte 1 en `main`)

### 3.1 `rep-export-xlsx` (B, gemini)

- `exceljs` como **única** dependencia nueva en `apps/api` (ADR-014 §2). Hojas `Resumen`, `Por día`,
  `Canales`, `Métodos`, `Turnos`, `Movimientos`.
- Streaming (`WorkbookWriter`) por encima de 2 000 filas; por debajo, buffer permitido.
- Importes como entero **en unidad menor** (centavos) con encabezado explícito «importe (centavos)» y moneda en columna aparte; ni un float ni formato `#,##0` que aparente pesos.
- Hecho cuando: una prueba lee el XLSX de vuelta con la propia librería, cada celda monetaria es entero y los
  totales coinciden con el CSV del mismo periodo.

### 3.2 `rep-export-pdf` (B, codex)

- `pdfkit` como segunda y última dependencia de exportación. Portada con sucursal, rango, zona y fecha de
  generación; una tabla por día. Sin HTML ni navegador headless.
- Hecho cuando: `%PDF-1.7`, páginas razonables para 31 días y los totales aparecen literalmente en el texto.

### 3.3 `rep-screen-formats` (C, dsh)

- Tres botones (CSV, Excel, PDF) con estado por formato; el que falla se explica solo, sin bloquear los otros.

### 3.4 `rep-export-filters` (B, codex + C, gemini)

- `channels` y `methods` **en servidor** sobre el mismo rango: el SQL filtra los pagos y recalcula `totals`;
  el cliente no filtra importes. Contrato: `readonly channels?: BranchDaySummaryChannelV1[]` y
  `readonly methods?: BranchDaySummaryMethodV1[]` en la petición; respuesta igual con `days` filtrados.
- Hecho cuando: filtrar por `cash` da una suma distinta y coherente, y la pantalla no recalcula nada.

## 4. Corte 3 — reembolsos ejecutados (bloqueado por decisión)

Antes de abrirlo: decisión de Emmanuel (§1). Después:

- `adr-016-refunds` (D, gemini): tabla inmutable `app.refunds` (`id`, scope, `order_id`, `payment_id`,
  `amount_minor`, `tip_minor`, `currency`, `reason`, `actor_id`, `device_id`, `occurred_at`, `received_at`,
  `idempotency_key`), sin UPDATE ni DELETE (trigger `42501`), escritura solo por función `app_private`, y la
  distinción entre **obligación pendiente** y **reembolso ejecutado**. Alternativas descartadas: reutilizar
  `order_cancellations` (no distingue ejecución) y añadir columnas a `payments` (inmutable, ya capturado).
- `sql-refunds-table` (A, codex): migración nueva con la tabla y `app_private.record_order_refund(...)`
  idempotente por `(order_id, idempotency_key)`, con guard de obligación y actor. No toca `payments`.
- `rep-refunds-field` (A, codex): `cancellations.refundedMinor` y `refunds: { count, amountMinor }` en el
  resumen del día y del rango; reconciliación `refundPendingMinor + refundedMinor <= capturado de las
  canceladas`.
- Hecho cuando: doble envío no duplica reembolso; reembolso sin obligación → `409` con código propio; el
  reporte cuadra con la tabla y la migración entra con §19.6 completo.

## 5. Reparto y orden de lanzamiento

Un escritor por archivo y los compartidos serializados. Archivos compartidos de la ola:
`packages/shared-types/src/reports.ts`, `apps/api/src/reports.ts`, `apps/api/src/reports.controller.ts`,
`apps/api/src/reports/export/csv.ts`, `apps/web/src/app/app/reports/day/page.tsx`, `apps/api/package.json`,
`apps/web/package.json`, `.github/workflows/ci.yml` y `supabase/migrations` (**una por corte**).

**Corte 1, tiempo A (paralelo):** codex → `rep-range-summary` (2.1, dueño de contrato, migración, verificador
y hook de CI) · gemini → `spike-report-tax-sources` (2.5, solo lectura) · dsh → `fix-csv-ticket-null` (2.3,
prerrequisito, solo `csv.ts` y su prueba) y `o7-p3-items-42501` (brief ya escrito, inventario).

**Corte 1, tiempo B (paralelo, con 2.1 fusionado):** codex → `rep-range-endpoint` (2.2) · dsh →
`rep-export-range-csv` (2.3) · gemini → prepara el brief de pantalla leyendo la pantalla actual.

**Corte 1, tiempo C:** gemini → `rep-screen-range` (2.4) y el orquestador corre el pase visual.

**Corte 2:** tiempo A codex → `rep-export-pdf` (3.2) y gemini → `rep-export-xlsx` (3.1) · tiempo B dsh →
`rep-screen-formats` (3.3) · tiempo C codex → `rep-export-filters` (3.4) y gemini la parte de pantalla.

**Corte 3:** ADR primero (gemini), después SQL (codex) y por último el reporte y la pantalla.

Revisión cruzada obligatoria: el diff de un motor lo revisa otro distinto; P1 antes del merge y P2/P3 a
`docs/agentic/debt.md`. Un motor que muera sin informe se releva a otro, y su código se verifica antes de
mergear.

## 6. Puertas y comandos

```powershell
. .\tools\agentic\use-node24.ps1
pnpm --filter @super-restaurant/shared-types run build   # SIEMPRE antes del API: un dist viejo da 503 engañosos
pnpm --filter @super-restaurant/shared-types run test
pnpm --filter @super-restaurant/api run test; lint; typecheck; build
pnpm --filter @super-restaurant/api run verify:branch-day-summary-schema:rollback
pnpm --filter @super-restaurant/api run test:http:local -- --local-disposable-only
pnpm --filter @super-restaurant/web run test; lint; typecheck; e2e:typecheck
$env:E2E_VISUAL='1'; pnpm --filter @super-restaurant/web exec playwright test e2e/visual/reports-day.spec.ts --project desktop --project mobile
```

- **Preflight READ_ONLY** al abrir y al cerrar. Cualquier candidata distinta de `20260908000100` exige el
  protocolo §19.6 completo: sonda rollback-only, respaldo schema-only verificado, dry-run exacto, apply único,
  postcheck y segundo dry-run. La migración del rango y la de reembolsos van **en cortes distintos**.
- El CLI de Supabase necesita `NODE_EXTRA_CA_CERTS` con la CA del proyecto además de `sslmode=verify-full`
  (ver `docs/agentic/dev-migrations-2026-11-28.md`).
- CI verde (Verify, PostgreSQL, Playwright) por PR; pase visual cuando haya UI; smoke regenerado.
- Un CSV que no cuadre se corrige **en SQL**, nunca en el serializador ni en la pantalla.

## 7. Riesgos y decisiones que no se reabren

- **Los totales se suman en SQL.** Si la pantalla suma `days[]`, la tarea se rechaza.
- **Una migración por corte.** El rango y los reembolsos no comparten migración ni sesión.
- **XLSX y PDF no empiezan** hasta que el CSV del rango esté en `main`.
- **`rep-gross-net-tax` no se abre** sin el veredicto del spike y la decisión de impuestos.
- **Reembolsos no se abren** sin la decisión de §1; sin ella, `adr-016-refunds` queda como propuesta.
- **Nada de «Día operable» a DONE** sin la prueba del operador; `o5-compras-ui-read` sigue en REVIEW sin la
  cuenta `viewer`/`auditor`.
- Si una ola pasa de dos sesiones o acumula dos P1 en el mismo archivo, se cierra con lo verde y lo pendiente
  pasa al corte siguiente con su id.

## 8. Cierre de sesión

HANDOFF (entrada del corte), `status.md`, `backlog.json` (rango, exportaciones y reembolsos en `done` o
`review` con la brecha), `debt.md`, smoke regenerado si hay UI
(`node tools/agentic/build-smoke-html.mjs <fecha>`), informe de migración si se aplicó, y prompt de la
siguiente sesión. Sin workers vivos ni PRs abiertos.
