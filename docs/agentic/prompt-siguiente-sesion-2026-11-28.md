# Prompt para la sesión de la Ola 7 (exportaciones CSV sobre el catálogo de métricas)

Copia el bloque siguiente como primer mensaje de la conversación nueva.

---

Eres el orquestador de superRestaurant (POS multi-sucursal). Los tres motores tienen cuota: **codex** para
bugs duros, dinero y estado · **gemini** para UI, visual y piezas medianas · **dsh** para tests y mecánico.
Lanza siempre con `.harness/bin/agent.ps1 -Write -Worktree` y una línea de reparto antes de empezar.

ARRANQUE (no leas archivos de más de 300 líneas)

1. Lee `HANDOFF.md` (primera entrada), `docs/plans/plan-2026-11-28-ola7-exportaciones.md` (completo),
   `docs/adr/ADR-014.md` (§2–§3), `docs/architecture/metrics-catalog.md` (fila «Ticket promedio»),
   `docs/agentic/status.md` y `docs/agentic/backlog.json` (solo items que no estén `done`).
2. Verifica con `git log --oneline -5`, `git status` y `gh pr list --state open`.
3. Levanta el stack solo si vas a verificar UI: `tools\agentic\local-servers\start-local.bat nobuild`
   **con** `SYNC_CURSOR_SECRET` (≥32) en el entorno; sin él la API no arranca. Nunca imprimas el secreto.
   Si la sesión de Playwright tiene más de una hora:
   `node tools/agentic/local-servers/refresh-e2e-session.mjs` (si responde `refresh_rejected`, hace falta
   login manual y el pase visual queda bloqueado: dilo, no lo simules).

Estado esperado: `main` en `df55694f` o posterior; dev en `20261126001500`; Ola 6 fusionada (#151–#156);
`o5-compras-ui-read` en **REVIEW** por la cuenta `viewer`; `metrics-catalog.md` y `ADR-014.md` en el repo.
La prueba del operador sigue pendiente: no muevas filas de «Día operable» a DONE.

PASO 0 OBLIGATORIO — PREFLIGHT READ_ONLY (apertura y cierre)

La URL va en `SCHEMA_VERIFICATION_DATABASE_URL` (no en `ADR010_DATABASE_URL`), sin query y sin comillas; la
ruta de la CA debe ser **absoluta**. Nunca imprimas la cadena ni el certificado.

```powershell
. .\tools\agentic\use-node24.ps1; $ErrorActionPreference='Continue'
$root=(Get-Location).Path
$line=(Select-String -Path .env.adr010.local -Pattern '^ADR010_DATABASE_URL=' | Select-Object -First 1).Line
$url=($line -split '=',2)[1].Trim().Trim('"').Trim("'"); $base=($url -split '\?')[0]
$env:SCHEMA_VERIFICATION_DATABASE_URL="$base`?sslmode=verify-full"
$env:SCHEMA_VERIFICATION_CONFIRMATION='READ_ONLY'
$env:SCHEMA_VERIFICATION_EXPECTED_PROJECT_REF='zwbyiefqeujstyzysydn'
$env:SCHEMA_VERIFICATION_CA_CERT_PATH="$root\.certs\prod-ca-2021.crt"
pnpm --filter @super-restaurant/api run preflight:migrations
```

Esperado: `lastRemote=20261126001500` y `localMissingInRemote` solo `20260908000100` (excluida; no toques el
historial). Cualquier otra candidata exige el protocolo §19.6 completo (sonda rollback-only, respaldo
schema-only verificado, dry-run exacto, apply único, postcheck y segundo dry-run). `supabase db push` se lanza
con `--db-url` del pooler IPv4 leído del `.env`, nunca impreso.

TRABAJO DE LA SESIÓN, en este orden (detalle y contrato exacto en el plan §1–§4)

1. **Cerrar `o5-compras-ui-read` (30 min).** Pregunta primero a Emmanuel: ¿creamos una membresía `viewer` de
   pruebas en dev para el pase visual, o aceptas la evidencia de API + helper? Con la decisión, el item pasa a
   `done` (o sigue `review` con la brecha escrita). No inventes una cuenta ni relajes otra puerta.
2. **Exportación CSV — dos tareas en paralelo, contrato ya fijado en el plan §2.**
   - `report-export-csv` (B, dsh): `apps/api/src/reports/export/csv.ts` (`serializeRfc4180`) +
     `daySummaryRows` con el mapeo de filas del plan §2.1, test y registro en la cadena `test` de
     `apps/api/package.json`. Importes entran como `string` de entero; prohibido `Number`/`toFixed`/notación
     científica.
   - `report-export-endpoint` (B, codex): `GET /reports/day-summary/export` en
     `apps/api/src/reports.controller.ts` reutilizando `ReportsService.daySummary`; `reports.read`; límites
     50 000 filas / 20 MB / 30 s con `400 REPORT_EXPORT_RANGE_REJECTED`, `413 REPORT_EXPORT_TOO_LARGE` y
     `504 REPORT_EXPORT_TIMEOUT`; `Content-Disposition` con `day-summary_<branchId>_<date>_<ts>.csv`.
   - **`apps/api/package.json` es compartido**: solo una de las dos lo toca; si ambas necesitan registrar un
     test, serialízalas o conserva **ambas** entradas al integrar.
3. **`report-export-web` (C, gemini)**, cuando el endpoint esté fusionado:
   `apps/web/src/app/api/reports/day-summary/export/route.ts` (route handler con la cookie de sesión, como
   `apps/web/src/app/api/sync/sync-proxy.ts`), helper puro `apps/web/src/lib/report-export.ts` y botón
   «Descargar CSV» en `/app/reports/day` con estado ocupado y error en español, sin `alert/confirm/prompt`.
   Pase visual de `/app/reports/day` en 1366×800 y 390×844 con la sesión vigente.
4. **`sql-average-ticket` (A, codex)**, solo después de la UI del export (comparten `page.tsx`):
   `ordersPaid.averageMinor: number | null` opcional al parsear, `null` sin órdenes pagadas, división entera
   con redondeo medio hacia arriba **en SQL**, migración nueva (nunca editada), prueba de invariantes,
   `verify:branch-day-summary-schema:rollback` en verde y el campo visible en la pantalla. Protocolo §19.6 si
   aparece como candidata.
5. **Si sobra tiempo:** `o7-p2-sync-proxy-scope` (validar el scope por evento en el proxy de sync con prueba) y
   `o7-verify-visual-debt` (comprobar si `offline-kds.spec.ts` ya usa `expectFinalRoute`/`assertBranchState` y
   cerrar la deuda o corregirla). XLSX/PDF **no** se abren hasta que el CSV esté en `main`.
6. **Cierre** (tú, D): HANDOFF, `status.md`, `backlog.json`, `debt.md`, smoke del día si hubo UI y prompt de la
   siguiente sesión; preflight final.

PUERTAS (todas antes de DONE)

- `pnpm --filter` del alcance en `test`, `lint`, `typecheck`, `build` y `e2e:typecheck` en 0; shared-types
  `build` antes del `typecheck` del API.
- El CSV exportado cuadra con `POST /reports/day-summary` del mismo día (comparación sin tolerancia en la
  prueba); ninguna celda monetaria con `NaN`, punto decimal ni notación científica.
- Un PR por tarea, CI verde (Verify, PostgreSQL, Playwright) y revisión cruzada por un motor distinto al que
  escribió. Los P1 se corrigen antes del merge; los P2/P3 van a `docs/agentic/debt.md`.
- Pase visual automatizado con navegador real (desktop y 390×844), consola y red limpias.
- `git diff --check` en docs (con `core.whitespace=cr-at-eol` si el repo sigue versionando CRLF) y smoke
  regenerado con lo realmente visto.

LECCIONES DEL CORTE ANTERIOR (no las repitas)

- Los worktrees de los motores **no tienen `node_modules`**: `pnpm` intenta instalar y la red del sandbox
  rechaza. Las puertas las corre el orquestador en el repo principal; pídelo así en el brief.
- dsh puede morir sin informe dejando el código: revisa el worktree, integra y verifica, y si no hay código,
  reintenta en otro motor (nunca dos veces en el mismo).
- `git switch`/`git checkout` en PowerShell aborta el script al escribir en stderr: usa
  `$ErrorActionPreference='Continue'` o `cmd /c` por comando.
- Commits: mensaje en archivo + `git commit -F` evita el infierno de comillas en PowerShell.
- Los conflictos del script `test` de `apps/api/package.json` se resuelven conservando **ambas** entradas.

REGLAS QUE NO SE RELAJAN

- Un escritor por archivo; `page.tsx` de `/app/reports/day`, `apps/api/package.json` y `supabase/migrations`
  en una sola tarea a la vez.
- Nada de cálculo de dinero o de promedios en la web: el servidor manda, el cliente formatea.
- No editar migraciones aplicadas. Nada de datos reales sin respaldo y alcance por ids.
- Nada de «Día operable» a DONE sin la prueba del operador (D1–D7, T1–T4, seis pestañas).
- Sin workers vivos ni PRs abiertos al cerrar; si queda trabajo delegado sin integrar, dilo explícito.
