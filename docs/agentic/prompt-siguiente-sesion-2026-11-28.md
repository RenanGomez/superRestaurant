# Prompt para la siguiente sesión (cerrar compras legibles y arrancar exportaciones)

Copia el bloque siguiente como primer mensaje de la conversación nueva.

---

Eres el orquestador de superRestaurant (POS multi-sucursal). Los tres motores (codex, gemini/agy y dsh)
tienen cuota: reparte el trabajo entre los tres y usa `.harness/bin/agent.ps1 -Write -Worktree`.

ARRANQUE (no leas archivos de más de 300 líneas)

1. Lee `HANDOFF.md` (primera entrada), `docs/agentic/status.md`, `docs/agentic/backlog.json` (solo items
   que no estén `done`) y `docs/adr/ADR-014.md`.
2. Verifica con `git log --oneline -5`, `git status` y `gh pr list --state open`.
3. Levanta el stack solo si vas a verificar UI: `tools\agentic\local-servers\start-local.bat nobuild`
   **con** `SYNC_CURSOR_SECRET` (≥32) en el entorno. Nunca imprimas el secreto. Si la sesión de Playwright
   tiene más de una hora, `node tools/agentic/local-servers/refresh-e2e-session.mjs`.

Estado esperado: `main` con la Ola 6 primer corte fusionada (#151–#154); dev en `20261126001500`;
`o5-compras-ui-read` en **REVIEW** porque falta la pasada con una cuenta `viewer`/`auditor`;
`docs/architecture/metrics-catalog.md` y `docs/adr/ADR-014.md` en el repo. La prueba del operador sigue
pendiente: no muevas filas de «Día operable» a DONE.

PASO 0 OBLIGATORIO — PREFLIGHT READ_ONLY

La URL va en `SCHEMA_VERIFICATION_DATABASE_URL` (no en `ADR010_DATABASE_URL`), sin query y sin comillas;
la ruta de la CA debe ser **absoluta**. Nunca imprimas la cadena ni el certificado.

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

Esperado: `lastRemote=20261126001500` y `localMissingInRemote` solo `20260908000100`. Cualquier otra
candidata exige el protocolo §19.6 completo.

TRABAJO DE LA SESIÓN, en este orden

1. **Cerrar `o5-compras-ui-read` (C, 30 min).** Falta ver el panel con una cuenta de solo lectura. Dos
   caminos: (a) crear en dev una membresía con rol `viewer` para una cuenta de pruebas y hacer el pase
   visual de `/app/inventario?tab=compras` con ella; (b) si Emmanuel acepta la evidencia del API + helper,
   pasarlo a DONE con esa decisión registrada en HANDOFF. Sin una de las dos cosas, sigue en REVIEW.
2. **Exportaciones de reportes (Ola 7, 2–3 h).** Implementa ADR-014 por partes, un PR por parte:
   - `report-export-csv` (B): serializador puro `apps/api/src/reports/export/csv.ts` (RFC 4180, `\r\n`,
     BOM opcional) y prueba de contrato contra `BranchDaySummaryV1` (mismos totales, importes enteros,
     comillas y acentos escapados).
   - `report-export-endpoint` (B): `GET /reports/day-summary/export?format=csv` con `Content-Disposition`,
     `Cache-Control: private, no-store`, límite de 31 días y 50 000 filas (`400`/`413` con código propio).
   - `report-export-ui` (C): botón de descarga en `/app/reportes` que pide los bytes con el token y guarda
     el blob; el cliente no recalcula nada.
   El XLSX y el PDF quedan para después de que el CSV tenga contrato verde.
3. **SQL de la Ola 7 (A, solo la que exija la pantalla).** Los cinco huecos del catálogo de métricas están
   en `docs/architecture/metrics-catalog.md` §«Lo que no existe hoy». Empieza por `sql-average-ticket` y
   `sql-sales-gross-net-tax` si la pantalla de reportes los necesita; cualquier migración va con §19.6.
4. **Si sobra tiempo · P3 de `docs/agentic/debt.md`:** prueba de `SyncMergeExecutor.execute()` con scope
   mal formado, `correlationId` por evento, `42501` en `items.service.ts` y carpeta de capturas por corrida
   en la spec visual de inventario.
5. **Cierre** (tú, D): HANDOFF, `status.md`, `backlog.json`, `debt.md`, smoke del día y preflight final.

PUERTAS (todas antes de DONE)

- `pnpm --filter` del alcance en `test`, `lint`, `typecheck`, `build` y `e2e:typecheck` en 0.
- UI: pase visual con navegador real en 1366×800 y 390×844, consola y red limpias, sin
  `alert/confirm/prompt`; documenta la brecha si un rol no tiene cuenta.
- Un PR por tarea, CI verde (Verify, PostgreSQL, Playwright) y revisión cruzada por un motor distinto al
  que escribió. Los P1 se corrigen antes del merge; los P2/P3 van a `debt.md`.
- `git diff --check` en docs y smoke regenerado con lo realmente visto.

REGLAS QUE NO SE RELAJAN

- Un escritor por archivo; los compartidos (`apps/api/package.json`, `reportes/**`, `supabase/migrations`)
  en una sola tarea por ola. Los conflictos del script `test` de `apps/api/package.json` se resuelven
  conservando **ambas** entradas nuevas (ya pasó con #153 y #154).
- No editar migraciones aplicadas. Nada de datos reales sin respaldo y alcance por ids.
- Nada de «Día operable» a DONE sin la prueba del operador (D1–D7, T1–T4, seis pestañas).
- Sin workers vivos ni PRs abiertos al cerrar; si queda trabajo delegado sin integrar, dilo explícito.
