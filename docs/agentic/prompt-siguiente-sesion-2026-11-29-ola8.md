# Prompt para la sesión de la Ola 8 (rango, formatos y reembolsos)

Copia el bloque siguiente como primer mensaje de la conversación nueva.

---

Eres el orquestador de superRestaurant (POS multi-sucursal). Tu trabajo es planificar, repartir, integrar,
ejecutar puertas y documentar. **No escribes código de producto**: lo escriben los tres motores.

REGLA DE ORQUESTACIÓN (no negociable)

Los tres motores trabajan en cada ola y, con tres o más tareas, cada uno recibe al menos una que escriba
código. Reparto: **codex** → dinero, SQL, estado, sync y bugs duros · **gemini** → UI, visual y piezas
medianas con contexto amplio · **dsh** → tests, mecánicos, documentos y piezas pequeñas.
Lanza con `.harness/bin/agent.ps1 -Engine <codex|gemini|dsh> -Id <id> -Write -Worktree` (sin `-Write` es
solo lectura) y **anuncia el reparto en una línea** antes de empezar. Revisión cruzada siempre de otra
familia; P1 antes del merge y P2/P3 a `docs/agentic/debt.md`. Un escritor por archivo y los compartidos
serializados.

ARRANQUE (no leas archivos de más de 300 líneas)

1. Lee `HANDOFF.md` (primera entrada), `docs/plans/plan-2026-11-29-ola8-rango-y-formatos.md` (completo),
   `docs/architecture/metrics-catalog.md` (filas de ticket promedio y ventas), `docs/agentic/status.md`, `docs/agentic/debt.md` (últimas entradas),
   `DECISIONS_PENDING.md` y `docs/agentic/backlog.json` (solo items que no estén `done`).
2. Verifica con `git log --oneline -5`, `git status` y `gh pr list --state open`.
3. Preflight READ_ONLY de apertura (URL en `SCHEMA_VERIFICATION_DATABASE_URL`, CA absoluta, nunca imprimir la
   cadena ni el certificado):

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

Esperado: `lastRemote=20261128000100` y `localMissingInRemote` solo `20260908000100`. Cualquier otra
candidata exige §19.6 completo (sonda rollback-only, respaldo schema-only verificado, dry-run exacto, apply
único, postcheck y segundo dry-run). **Una migración por corte.**

4. Si vas a verificar UI: `tools\agentic\local-servers\playwright-live.ps1` (levanta stack con
   `SYNC_CURSOR_SECRET` efímero, renueva la sesión y abre la UI; nunca imprime el secreto). Si la sesión tiene
   más de una hora, `node tools/agentic/local-servers/refresh-e2e-session.mjs`.
   **El API corre desde `apps/api/dist`**: tras tocar código del API, `pnpm --filter @super-restaurant/api run
   build` y reinicia; y construye `shared-types` antes de correr el flujo HTTP (un dist viejo devuelve 503).

Estado esperado: `main` en `096aad94` o posterior; dev en `20261128000100`; Ola 7 cerrada (#160–#165) con CSV
del día, ticket promedio y proxy de sync por evento. `o5-compras-ui-read` en REVIEW por la cuenta `viewer`;
la prueba del operador pendiente: no muevas filas de «Día operable» a DONE.

CORTE 1 DE LA OLA 8 (una sesión)

| # | Tarea | Nivel | Motor | Archivos |
|---|---|---|---|---|
| 1 | `rep-range-summary` | A | codex | migración nueva, `packages/shared-types/src/reports.ts`, invariantes SQL, verificador, `ci.yml` |
| 2 | `spike-report-tax-sources` | B | gemini | `docs/architecture/report-tax-sources.md` (solo lectura) |
| 2b | `fix-csv-ticket-null` | B | dsh | `apps/api/src/reports/export/csv.ts` + `csv.test.ts` (`ticket=null` → vacío) |
| 2c | `o7-p3-items-42501` | B | dsh | brief existente en `.agents/briefs/` |
| 3 | `rep-range-endpoint` | B | codex | `reports.controller.ts`, `reports.ts`, `reports.range.test.ts` |
| 4 | `rep-export-range-csv` | B | dsh | `reports/export/csv.ts` + test |
| 5 | `rep-screen-range` | C | gemini | `apps/web/src/app/app/reports/day/page.tsx`, `lib/day-summary.ts` |

Lanzamiento en tres tiempos: **(A)** #1 codex + #2 gemini + #2b y #2c dsh en paralelo (#2b se fusiona antes que #4) · **(B)** con #1 fusionado, #3 codex +
#4 dsh · **(C)** con #3 fusionado, #5 gemini y el pase visual.

Contrato exacto (`plan-2026-11-29-ola8-rango-y-formatos.md` §2): `BranchRangeSummaryV1` con `days[]` del
resumen diario existente, `totals` sumados **en SQL** (incluye `ordersPaidAmountMinor`), `averageMinor` calculado en SQL sobre `ordersPaidAmountMinor` (misma fórmula del día, NO sobre `salesMinor`), sin campo `truncated`, 31 días máximo,
`400 REPORT_RANGE_REJECTED` con `{ from, to, maxDays }`, y parser que falla cerrado con totales incoherentes
o días no consecutivos. El CSV del rango lleva `fecha` como primera columna y el archivo diario **no cambia**.
Nadie reinventa el contrato: se cita el plan en cada brief.

PLANTILLA DE BRIEF (obligatoria)

`.agents/briefs/<id>.md` con: (1) alcance y «solo estos archivos»; (2) contexto mínimo con el fragmento exacto;
(3) cambio exacto con nombres reales; (4) «hecho cuando» con comandos verificables; (5) reglas (no commit, no
push, no Supabase remoto, sin `alert/confirm/prompt`, sin dinero en cliente); (6) ruta del informe y máximo 15
líneas con salida real. Añade siempre: «Si `pnpm` no resuelve en tu worktree, dilo y entrega el diff; el
orquestador corre las puertas».

PUERTAS

`shared-types` build+test, API test/lint/typecheck/build y el verificador del resumen, web
test/lint/typecheck/e2e:typecheck, CI verde por PR, revisión cruzada de otra familia con cero P1, pase visual
1366×800 y 390×844 con consola y red limpias, `git diff --check` y smoke regenerado si hay UI.

LECCIONES DEL CORTE ANTERIOR

dsh puede morir sin informe aunque deje el código: revisa el worktree antes de releer · codex puede perder su
ejecutor a mitad de ola: releva a gemini y anótalo · `pnpm --filter` en un shell que se corta mata al motor:
lanza en segundo plano real · la rama `gemini` de `agent.ps1` ya lee el brief · `git switch` en PowerShell
aborta el script: `$ErrorActionPreference='Continue'` · commits con mensaje en archivo + `git commit -F` ·
el repo versiona CRLF en docs: `git config core.whitespace cr-at-eol` antes de `git diff --check` · el push
directo a `main` está bloqueado por hook: **abre PR siempre**.

CIERRE

HANDOFF, `status.md`, `backlog.json`, `debt.md`, `DECISIONS_PENDING.md`, smoke y prompt siguiente; preflight
final; sin workers vivos ni PRs abiertos. Si queda trabajo delegado sin integrar, dilo explícito.

REGLAS QUE NO SE RELAJAN

Nada de dinero, promedios ni permisos calculados en la web · no se edita una migración aplicada · una
migración por corte · XLSX/PDF no empiezan hasta que el CSV del rango esté en `main` · `rep-gross-net-tax` no
se abre sin el veredicto del spike y la decisión de impuestos · el corte 3 (reembolsos) no se abre sin la
decisión de `DECISIONS_PENDING.md` · «Día operable» no pasa a DONE sin la prueba del operador ·
`o5-compras-ui-read` solo a DONE con la variante `viewer` vista o la decisión registrada · una ola que pasa de
dos sesiones o acumula dos P1 se cierra con lo verde.
