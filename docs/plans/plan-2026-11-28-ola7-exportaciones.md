# Plan — Ola 7: exportaciones de reportes sobre el catálogo de métricas

Sustituye como guía de corto plazo a `docs/plans/plan-2026-11-27-ola6-compras-m4.md` (queda como
registro). Estado verificado el 2026-11-27: `main` en `ebe388b1`, Ola 6 fusionada (#151–#155), dev en
`20261126001500`, **M2 cerrado en su alcance técnico**, M3 al 100 % del alcance fusionado, `o5-compras-ui-read`
en REVIEW por la cuenta `viewer`, y sin PRs abiertos ni workers vivos.

## 0. Objetivo de la sesión

1. Cerrar la única brecha de producto que quedó abierta: **`o5-compras-ui-read`** (un pase con una cuenta
   de solo lectura, o una decisión explícita de Emmanuel).
2. Convertir `docs/adr/ADR-014.md` en producto: **exportación CSV** del resumen del día de punta a punta
   (serializador puro → endpoint con streaming → descarga desde `/app/reports/day`).
3. Pagar la primera deuda del catálogo de métricas que la pantalla necesita: **`sql-average-ticket`**.
4. Si sobra tiempo, dos deudas P2 de sync y la verificación de una deuda que puede estar ya cerrada.

**Fuera de alcance de esta ola:** XLSX y PDF (van después de que el CSV tenga contrato verde), `app.refunds`
y el reporte de reembolsos ejecutados (exige tabla nueva y ADR), costo histórico por receta, y cualquier
migración que no exija una pantalla de esta lista.

## 1. Cerrar `o5-compras-ui-read` (30 min, decisión humana primero)

Estado: #152 fusionado; helper probado y pase visual 12/12 con la sesión de manager. Falta ver la variante
`viewer`/`auditor` en navegador.

| Camino | Qué hace falta | Resultado |
|---|---|---|
| A · cuenta de solo lectura | Crear en dev una membresía con rol `viewer` para una cuenta de pruebas (Supabase Auth + `app.memberships`), iniciar sesión con ella y recorrer `/app/inventario?tab=compras` | El item pasa a DONE con la captura y la nota en HANDOFF |
| B · aceptar la evidencia | Decisión de Emmanuel: el API ya autoriza con `catalog.read` (#131) y el helper replica la matriz (#152) | El item pasa a DONE con la decisión registrada en HANDOFF y `backlog.json` |

Hecho cuando: una de las dos rutas queda escrita en HANDOFF y `backlog.json` refleja `done` o sigue `review`
con la brecha. **No se relaja** ninguna otra puerta: si se elige A, el pase se hace en 1366×800 y 390×844.

## 2. Exportación CSV del resumen del día (nivel B/C, 2–3 h)

Tres tareas encadenadas, un PR cada una. El contrato lo fija este plan para que las tres puedan escribirse
en paralelo sin que nadie invente formas.

| Id | Nivel | Motor sugerido | Depende de | ETA |
|---|---|---|---|---|
| `report-export-csv` | B | dsh | — | 45 min |
| `report-export-endpoint` | B | codex | — (contrato del plan) | 60 min |
| `report-export-web` | C | gemini | endpoint fusionado | 45 min |
| `report-export-xlsx-pdf` | B | codex | CSV en `main` | 90 min, opcional |


### 2.1 `report-export-csv` (B, escritor: dsh) — serializador puro

| Archivo | Qué |
|---|---|
| `apps/api/src/reports/export/csv.ts` (nuevo) | `serializeRfc4180(rows: readonly (readonly string[])[], options?: { readonly bom?: boolean }): string` |
| `apps/api/src/reports/export/csv.test.ts` (nuevo) | Pruebas del serializador y del mapeo del resumen a filas |
| `apps/api/package.json` | Registrar el test en la cadena `test` (una línea, después de `reports.test.js`) |

Reglas del serializador (no negociables):

- RFC 4180: campo con `,`, `"`, `\r` o `\n` entre comillas dobles; comilla interna duplicada (`""`); unión con
  `\r\n` y salto final.
- `bom: true` antepone `\uFEFF` (solo para Excel; por defecto apagado).
- Nada de `Number`, `toFixed`, `toLocaleString` ni notación científica: **los importes entran ya como
  `string` de entero** en unidad menor; el serializador no convierte tipos.
- Filas vacías y campos vacíos conservan la coma (`a,,c`).
- Un valor que no sea `string` es error de programación (tipo, no runtime).

Mapeo del resumen a filas (`daySummaryRows(summary: BranchDaySummaryV1): readonly (readonly string[])[]`),
en este orden y con cabecera en español:

```
seccion,concepto,zona,moneda,importe,conteo,detalle
totales,pagos cobrados,<timeZone>,<currency>,<totals.salesMinor>,<totals.paymentCount>,propinas=<totals.tipsMinor>;efectivo=<totals.cashTipsMinor>
ordenes,pagadas,,<currency>,<ordersPaid.amountMinor>,<ordersPaid.count>,ticket=<ordersPaid.averageMinor o vacio>
entregas,cargo congelado,,<currency>,<deliveryFees.amountMinor>,<deliveryFees.orderCount>,
entregas,liquidadas,,<currency>,<deliveriesSettled.cashCollectedMinor>,<deliveriesSettled.count>,
cancelaciones,ordenes,y,,,<cancellations.orders>,capturas=<cancellations.captures>;devolucion_pendiente=<cancellations.refundPendingMinor>
canal,<channel>,,<currency>,<amountMinor>,<paymentCount>,propina=<tipMinor>
metodo,<method>,,<currency>,<amountMinor>,<paymentCount>,propina=<tipMinor>
turno,<shiftId>,<timeZone>,,<openingFloatMinor>,<registers.length>,nombre=<name>;estado=<status>;abierto=<openedAt>;cerrado=<closedAt o vacio>
caja,<registerId>,<timeZone>,<currency>,<expectedCashBalanceMinor>,<movements.length>,turno=<shiftId>;estado=<status>;contado=<countedClosingBalanceMinor o vacio>;diferencia=<differenceMinor o vacio>
movimiento,<type>,<timeZone>,<currency>,<amountMinor>,<count>,caja=<registerId>;direccion=<direction>
```

- `zona` es `summary.timeZone` en las filas con corte de día; el archivo lleva además la zona y la fecha en
  la cabecera de la respuesta.
- `importe` y `conteo` van vacíos cuando el contrato no trae el dato (nunca `0` inventado).
- Procedencia exacta: `BranchDaySummaryV1` (`packages/shared-types/src/reports.ts:83`), `totals`
  (`:43`), `ordersPaid` (`:93`), `deliveryFees` (`:95`), `deliveriesSettled` (`:96`), `cancellations`
  (`:101`), `salesByChannel[]` (`:29`), `salesByMethod[]` (`:36`), `shifts[].registers[]` (`:59`/`:74`) y
  `movements[]` (`:52`).
- `ordersPaid.averageMinor` **no existe hoy**: hasta que llegue `sql-average-ticket` (§3) esa celda va vacía.
  El serializador no la calcula.

Hecho cuando: un día con dos canales, dos métodos, un turno con dos cajas y tres movimientos produce filas
en ese orden; un campo con `,`/`"`/salto de línea sale escapado; importes negativos (`differenceMinor`)
conservan el signo; día sin pagos da cabecera y cero filas.

Verificación: `pnpm --filter @super-restaurant/api run test` con el test nuevo en la cadena.

### 2.2 `report-export-endpoint` (B, escritor: codex) — descarga con streaming

| Archivo | Qué |
|---|---|
| `apps/api/src/reports.controller.ts` | `GET /reports/day-summary/export` con `Content-Disposition` y `Cache-Control: private, no-store` |
| `apps/api/src/reports.ts` | Reutiliza `daySummary` (una llamada por día); no reimplementa el cálculo |
| `apps/api/src/reports.export.test.ts` (nuevo) | Contrato del endpoint con el servicio real sustituido por doble |

Reglas:

- Query: `branchId` (UUID), `date` (`YYYY-MM-DD`), `format=csv`, `bom=1` opcional. **Una sucursal y un día
  por petición** (el resumen es diario); un rango de varios días responde `400 REPORT_EXPORT_RANGE_REJECTED`
  con la lista de fechas aceptadas en el mensaje.
- Autorización: la misma del resumen (`reports.read`); sucursal ajena → `403 ACTION_NOT_AUTHORIZED`.
- Límites de ADR-014: si el archivo supera **50 000 filas o 20 MB**, `413 REPORT_EXPORT_TOO_LARGE` con
  `{ rows, maxRows }` y sin archivo parcial; si el SQL supera **30 s**, `504 REPORT_EXPORT_TIMEOUT`.
- Nombre: `day-summary_<branchId>_<date>_<YYYYMMDDTHHmmssZ>.csv` (marca de tiempo UTC de generación).
- El endpoint **no escribe nada**: sin transacción de escritura, sin auditoría nueva.
- Cuando el día no tiene pagos, el CSV es válido (cabecera + cero filas), no `404`.

Hecho cuando: cabecera `Content-Disposition` exacta; `content-type: text/csv; charset=utf-8`; un rol sin
`reports.read` recibe 403; una sucursal ajena 403; `date` inválida 400; y el cuerpo contiene las filas del
serializador sin recalcular importes.

Verificación: `pnpm --filter @super-restaurant/api run test`, `typecheck`, `lint`; y si el arnés lo permite,
un bloque nuevo en `test:http:local` (`http_flow_reports_export`) que compare el total del CSV contra
`POST /reports/day-summary` del mismo día (rollback-only, `local_disposable_only`).

### 2.3 `report-export-web` (C, escritor: gemini) — botón de descarga

| Archivo | Qué |
|---|---|
| `apps/web/src/app/api/reports/day-summary/export/route.ts` (nuevo) | Route handler que valida la sesión, llama al API con el access token y reenvía los bytes con `Content-Disposition` |
| `apps/web/src/app/app/reports/day/page.tsx` (+ `actions.ts` si hace falta) | Botón «Descargar CSV» con estado ocupado, error en español y sin `alert/confirm/prompt` |
| `apps/web/src/lib/report-export.ts` (nuevo) | Helper puro del nombre de archivo y del estado del botón (probado) |

Reglas:

- El navegador **nunca** habla con el API directamente: el token vive en la cookie de sesión y lo usa el
  route handler (mismo patrón que `apps/web/src/app/api/sync/sync-proxy.ts`).
- El cliente no calcula ni reordena nada: descarga bytes.
- Botón con `min-h-11`, etiqueta accesible, se deshabilita mientras descarga y muestra «No se pudo generar
  el archivo. Reintenta.» en `role="alert"` si falla. Si el API responde `413`, el texto explica el límite
  («El día supera 50 000 filas; exporta por turno»).

Hecho cuando: con sesión real, el botón descarga `day-summary_<sucursal>_<fecha>_<ts>.csv` cuyo contenido
coincide con los totales de la pantalla; sin sesión, el route handler responde 401 y no filtra la ruta del
API; y el pase visual de `/app/reports/day` queda limpio en 1366×800 y 390×844.

Verificación: `pnpm --filter @super-restaurant/web run test|lint|typecheck|build|e2e:typecheck` y el pase
visual con la sesión renovada.

### 2.4 `report-export-xlsx-pdf` (B, solo si el CSV está verde)

No empieza hasta que #2.1–#2.3 estén fusionados. Añade `exceljs` y `pdfkit` a `apps/api` (una dependencia
cada uno, como fija ADR-014), `format=xlsx|pdf`, `WorkbookWriter` por encima de 2 000 filas y una prueba que
lea el XLSX de vuelta verificando enteros. Si el tiempo de la sesión no da, queda como primer item de la
Ola 8 y **no** se abre a medias.

## 3. `sql-average-ticket` (nivel A, 45–60 min, escritor: codex)

La única métrica del catálogo que la pantalla de reportes necesita y hoy no existe
(`docs/architecture/metrics-catalog.md`, fila «Ticket promedio»).

- `packages/shared-types/src/reports.ts`: `ordersPaid.averageMinor: number | null` (**opcional al parsear**
  para no romper consumidores con forma vieja; el API siempre lo emite). Regla: `null` cuando
  `ordersPaid.count === 0`; si no, `ordersPaid.amountMinor / ordersPaid.count` con división entera y
  redondeo **medio hacia arriba**, calculado en SQL, nunca en la web. El parser del subobjeto `ordersPaid`
  se amplía aceptando la forma con y sin el campo.
- `supabase/migrations/<nueva>_branch_day_summary_average_ticket.sql`: reemplaza **solo** la función de
  resumen (mismo cuerpo, un campo más), sin tocar el resto del cálculo. Migración nueva, nunca editada.
- `apps/api/src/reports.ts`: proyecta el campo tal cual llega de SQL.
- Prueba SQL en `supabase/tests/`: un día con 3 órdenes y venta 100 001 → `average_minor = 33334`; día sin
  órdenes pagadas → `null`; y la identidad `average_minor * count` dentro de un ticket de diferencia.
- Pantalla: `/app/reports/day` muestra «Ticket promedio» formateado por el helper existente de dinero.

Hecho cuando: unitarias de dominio/contrato, prueba SQL de invitantes y `verify:branch-day-summary-schema:rollback`
(o el verificador que cubra el resumen) en verde; el pase visual muestra el promedio y no lo calcula el
navegador.

Riesgo declarado: es un contrato que consumen dos apps; se despliegan juntas y el parser acepta la forma
anterior durante una release.

## 4. Si sobra tiempo · deudas que caben en la ola

| Id | Nivel | Qué | Hecho cuando |
|---|---|---|---|
| `o7-p2-sync-proxy-scope` | B | El proxy de sync valida `body.scope` contra la cookie pero no cada evento (`apps/web/src/app/api/sync/sync-proxy.ts`) | Un evento con otro `restaurantId`/`branchId` se rechaza en el proxy, con prueba |
| `o7-p2-sync-conflicts-ci` | B/A | Llevar `test:sync-conflicts:local` a `pg-verify` y añadir un push HTTP que produzca `manual_review` | La suite corre en CI y el caso de revisión manual existe |
| `o7-verify-visual-debt` | D | Comprobar si `offline-kds.spec.ts` ya usa `expectFinalRoute`/`assertBranchState` (#139) y, si es así, cerrar la deuda | La deuda queda cerrada con la línea que lo prueba, o se corrige |
| `o7-p3-items-42501` | B | `items.service.ts` distingue el `42501` real por `message` acotado y no mapea todo a 403 | Prueba con los dos mensajes |

## 5. Puertas y comandos

```powershell
. .\tools\agentic\use-node24.ps1
pnpm --filter @super-restaurant/shared-types run build
pnpm --filter @super-restaurant/api run test|lint|typecheck
pnpm --filter @super-restaurant/web run test|lint|typecheck|build|e2e:typecheck
# contrato HTTP con PostgreSQL desechable (solo si se toca test:http:local)
pnpm --filter @super-restaurant/api run test:http:local -- --local-disposable-only
# pase visual (sesión vigente; si caducó: node tools/agentic/local-servers/refresh-e2e-session.mjs)
$env:E2E_VISUAL='1'; pnpm --filter @super-restaurant/web exec playwright test e2e/visual/inventario.spec.ts --project desktop
```

- Preflight READ_ONLY obligatorio al arrancar y al cerrar. Cualquier candidata distinta de `20260908000100`
  exige el protocolo §19.6 completo (sonda rollback-only, respaldo schema-only, dry-run exacto, apply único,
  postcheck y segundo dry-run).
- Servidores: `tools\agentic\local-servers\start-local.bat nobuild` **con** `SYNC_CURSOR_SECRET` (≥32) en el
  entorno; nunca imprimir el secreto.
- Un PR por tarea, CI verde (Verify, PostgreSQL, Playwright) y revisión cruzada por un motor distinto al que
  escribió. Los P1 se corrigen antes del merge; los P2/P3 van a `debt.md`.
- `apps/api/package.json` es archivo compartido: si dos tareas de la ola tocan el script `test`, se serializan
  o el integrador conserva **ambas** entradas (ya pasó con #153 y #154).

## 6. Cierre de sesión

HANDOFF (entrada del corte), `status.md`, `backlog.json` (con `report-export-*` y `sql-average-ticket` en
`done` o `review` con la brecha), `debt.md`, smoke del día regenerado si hay UI (`node
tools/agentic/build-smoke-html.mjs <fecha>`) y prompt de la siguiente sesión. Nada de «Día operable» a DONE
sin la prueba del operador. Sin workers vivos ni PRs abiertos al cerrar.

## 7. Riesgos y decisiones que no se reabren

- **El CSV no lleva lógica de negocio.** Serializa lo que el servidor ya calculó; si un total no cuadra, se
  corrige en SQL, no en el serializador ni en la web.
- **Una dependencia por formato.** XLSX y PDF no empiezan hasta que el CSV esté fusionado, y no se añaden
  librerías para CSV (ADR-014 §2).
- **`app.refunds` no se crea en esta ola.** El reporte de reembolsos ejecutados exige tabla nueva y ADR;
  se queda en el catálogo como hueco `sql-refunds-and-cancellation-reasons`.
- **El ticket promedio se calcula en SQL.** Si la UI lo divide, la tarea se rechaza.
- **Ninguna migración se edita.** La de `averageTicketMinor` es nueva y se aplica con §19.6.
- **La prueba del operador (D1–D7, T1–T4, seis pestañas) sigue pendiente** y no la sustituye ningún pase
  visual automatizado.
