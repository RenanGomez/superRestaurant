# Estado del loop

Actualizado: 2026-11-28 (Ola 7, primer corte cerrado: exportación CSV del día, ticket promedio en contrato/pantalla/SQL y proxy de sync con scope por evento)

- **M1:** cerrado. **M2: cerrado en su alcance técnico.** `o0-purge-wire`, `o0-leader-wire` y
  `o0-device-registry` están fusionados y probados (#138, #147, #148), y la deuda del proxy de sync quedó
  cerrada en #163. Las **puertas humanas** siguen abiertas en `docs/agentic/m2-offline-signoff.md`:
  dispositivo real (mobile/KDS), impresora Bluetooth, ratificación del ASAP 15/30 min y la prueba única
  del operador.
- **M3 inventario: 100 % del alcance fusionado.** `lastRemote=20261128000100` tras aplicar la migración del
  ticket promedio con §19.6 (`docs/agentic/dev-migrations-2026-11-28.md`).
- **Ola 7, primer corte (fusionado en `main` `1fdaa542`, #160–#163):**
  - `report-export-csv` **DONE**: serializador RFC 4180 propio y `daySummaryRows` con las siete columnas del
    plan, secciones agrupadas. La revisión de codex encontró un **P1 real** (filas intercaladas por caja) que
    se corrigió antes del merge.
  - `report-export-endpoint` **DONE**: `GET /reports/day-summary/export` sobre `ReportsService.daySummary`,
    una sucursal y un día, `Content-Disposition` con sello UTC, límites de ADR-014 (413/504).
  - `report-export-web` **DONE**: route handler same-origin con scope de cookie y token solo en servidor;
    botón «Descargar CSV» con estado ocupado y error accesible.
  - `o7-visual-reports-spec` **DONE**: pase visual **2/2** (1366×800 y 390×844) con **descarga real** de
    `day-summary_*.csv`, consola y red limpias, capturas en `docs/agentic/visual-2026-11-28/`.
  - `sql-average-ticket-contract` **DONE (#161)**: `ordersPaid.averageMinor` opcional al parsear y tarjeta
    «Ticket promedio» sin aritmética en el cliente. Revisión de codex: APROBAR.
  - `sql-average-ticket` **DONE (#162)**: la función de resumen emite `averageMinor` (división entera bigint,
    medio hacia arriba, `null` sin órdenes pagadas); verificador rollback-only y flujo HTTP **9/9** en verde;
    migración `20261128000100` aplicada a dev con el protocolo §19.6 completo.
  - `o7-p2-sync-proxy-scope` **DONE (#163)**: el proxy rechaza en el borde un `push` con eventos de otra
    sucursal (403) o un lote mal formado (400), antes de pedir sesión o autorización.
- **Puertas de la ola:** shared-types `build`/`test` en 0; API `test`, `typecheck`, `lint`, `build`,
  `verify:branch-day-summary-schema:rollback` y `test:http:local` 9/9 en 0; web `test`, `typecheck`, `lint`
  y `e2e:typecheck` en 0; CI verde en #160, #161, #162 y #163 (Verify, PostgreSQL, Playwright).
- **Revisión cruzada:** codex revisó el serializador (P1) y el contrato del ticket (APROBAR); gemini revisó
  el endpoint (APROBAR con dos P2, corregidos); dsh revisó el SQL (APROBAR) y el proxy (APROBAR, un P2 y dos
  P3 a deuda). **dsh murió sin informe cinco veces** dejando el código, y **codex perdió su ejecutor** a
  mitad de la ola: la migración pasó a gemini. Se corrigió un bug del harness (la rama gemini escribía
  `prompt.md` sin el brief).
- **Puerta humana pendiente:** la prueba única del operador (D1–D7, T1–T4, seis pestañas de inventario)
  sigue sin registrarse; ninguna fila de «Día operable» pasa a DONE. `o5-compras-ui-read` sigue en REVIEW:
  no hay cuenta web con rol `viewer`/`auditor` en desarrollo y el plan prohíbe declararlo DONE sin verla.
- **Siguiente ola:** Ola 8 (reportes con rango, XLSX/PDF y reembolsos ejecutados) según
  `docs/plans/plan-2026-11-28-etapa-fase5.md`; el CSV y el promedio ya están en `main` y en dev.
