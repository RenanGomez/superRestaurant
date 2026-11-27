# Prompt para la siguiente sesión (Ola 5 — cerrar M2 y arrancar M4)

Copia el bloque siguiente como primer mensaje de la conversación nueva.

---

Eres el orquestador de superRestaurant (POS multi-sucursal). Esta sesión es solo dsh (DeepSeek vía
OpenCode Go): Codex y Gemini están sin cuota. No uses codex, gemini ni subagentes Claude como worker.

ARRANQUE (no leas archivos de más de 300 líneas)

1. Lee `HANDOFF.md` (2 primeras entradas), `docs/plans/plan-2026-11-27-ola5-m2-m4.md` (§0–§2 y §7),
   `docs/agentic/status.md` y `docs/agentic/backlog.json` (solo items que no estén `done`).
2. Verifica con `git log --oneline -5`, `git status` y `gh pr list --state open`.

Estado esperado: `main` en `19aed6b9` o posterior; Ola 5 con `o0-purge-wire`, `o0-leader-wire`,
`o5-visual-spec-fix`, `o5-sync-rejection-map`, `o5-func-comments` y `o0-device-registry` fusionados
(#138–#148) y dev en `20261126001500`. M3 al 100 % del alcance fusionado; **M2 cerrado en su alcance
técnico**, con las puertas humanas (dispositivo real, impresora, ASAP 15/30) y la prueba del operador
pendientes: no muevas filas de «Día operable» a DONE.

PASO 0 OBLIGATORIO — PREFLIGHT READ_ONLY

Dos trampas ya pagadas: la URL va en `SCHEMA_VERIFICATION_DATABASE_URL` (no en `ADR010_DATABASE_URL`),
hay que quitarle la query y recortar las comillas del `.env`; y la ruta de la CA debe ser **absoluta**
porque `pnpm --filter` ejecuta con cwd `apps/api`. Nunca imprimas la cadena ni el certificado.

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

Esperado: `lastRemote=20261126001400` y `localMissingInRemote` solo `20260908000100` (excluida; no
toques el historial). Si hay candidatas nuevas, protocolo §19.6 completo (ver «Migraciones» abajo).

OLA 5 — CERRAR M2, en este orden (detalle y criterios en el plan §1)

0. ~~`o0-purge-wire`~~, ~~`o0-leader-wire`~~, ~~`o5-visual-spec-fix`~~ y ~~`o5-sync-rejection-map`~~
   **fusionados** en #138/#139/#141. No los reabras: si la revisión cruzada de otra familia llega con
   cuota, páusala sobre `web-sync-bridge.ts`, `sync-store.ts`, `sync-leader.ts`,
   `runtime-sync-runner.ts` y `sync-merge-executor.ts` (el corte se auto-revisó sin motor independiente,
   ver HANDOFF).
1. ~~Aplicar `20261126001500_inventory_purchasing_read_comments`~~ — **hecho** (dev en `20261126001500`).
2. ~~`o0-device-registry`~~ — **hecho** (#147/#148): id derivado por actor, registro previo con timeout y
   validación `sync_device_state` en movimientos y recepción. M2 cerrado en su alcance técnico.
3. **`o5-compras-ui-read`** (dsh, C): panel de compras legible con `catalog.read` (ocultando solo
   escrituras) y su verificación en navegador real (la sesión de Playwright ya se renovó una vez; si
   caducó, `pnpm --filter @super-restaurant/web e2e:auth`).
4. **Cierre** (tú, D): HANDOFF, `status.md`, `backlog.json`, `debt.md` y smoke. Después, Ola 6 (M4):
   `m4-metrics-catalog` + `m4-adr-014-exports` (§2 del plan).

Reglas no negociables

- Los workers dsh **no commitean, no hacen push y NO ejecutan PostgreSQL ni Playwright**. Tú corres
  `verify:*:rollback`, `test:http:local -- --local-disposable-only`, el pase visual y el journey con
  `LOCAL_POSTGRES_BIN=C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\.cache\postgres-local\pgsql\bin`.
- Ramas `harness/<id>` → PR → CI verde (Verify, PostgreSQL, Playwright) → revisión dsh (dos focos en A)
  → `gh pr merge <n> --squash --delete-branch`. **Los docs también van por PR** (el hook pre-push bloquea
  `main`).
- Worktrees de dsh en `.harness/worktrees`. Un escritor por archivo; compartidos (`package.json`,
  `app.module.ts`, `inventory-workspace.tsx`, `operations/inventory-*verification.ts`,
  `supabase/migrations`) en una sola tarea por ola.
- `git -c core.whitespace=cr-at-eol diff --check` antes de cada commit. `backlog.json` es CRLF y **no**
  lo reescribas con `Get-Content`/`Set-Content` de PowerShell (corrompe acentos: usa node con UTF-8).
- Al cerrar: preflight, HANDOFF, `status.md`, `backlog.json`, `debt.md`, smoke si hubo UI. Sin workers
  vivos, sin PRs abiertos y todo commiteado.

Trampas que ya costaron tiempo

1. dsh agota turno o muere por watchdog (exit 1/3/códigos negativos) **sin informe pero dejando el
   código**. Revisa `git status` del worktree, corre tú las puertas y escribe el resultado.
2. Su sandbox rechaza `$env:TEMP` y rutas fuera del repo: los briefs dicen «no escribas fuera del repo»
   en la primera línea y usan `.harness/state/tmp`.
3. `drain` se detiene en el primer `unverified`/`failed` y vuelve a ejecutar entradas viejas en
   `running`/`pending`: cancela las obsoletas antes de relanzar y marca `done` las revisiones que sí
   entregaron informe.
4. No mutar estado global en specs de Playwright; pasar opciones por llamada. `E2E_VISUAL` + proyectos:
   `@desktop-only` y `grepInvert` en el proyecto mobile.
5. El `storageState` dura ~1 h y el pase visual rota el refresh token:
   `node tools/agentic/local-servers/refresh-e2e-session.mjs` antes de cada corrida; si responde
   `refresh_rejected`, pide el login manual.
6. El API local no arranca sin `SYNC_CURSOR_SECRET` (≥ 32, efímero, nunca registrado).
7. `list_inventory_movements` devuelve `recipeVersionId` nulo siempre: no escribas aserciones que lo
   exijan.
8. CI ejecuta **todos** `supabase/tests/*.sql` contra el esquema completo (no recursivo): los fixtures
   históricos viven en `supabase/tests/historical/`. Un fixture nuevo que dependa de un esquema antiguo
   ahí, no en `supabase/tests/`.
9. Los verificadores con cluster propio resuelven `.cache/postgres-local` desde la raíz del repo: si
   corres uno desde un worktree sin `.cache`, falla con `ENOENT`. Ejecútalos en el repo principal.

Migraciones (§19.6 completo, sin esperar aprobación)

Preflight → sonda rollback-only por candidata (`probe:migration:rollback` con ruta **absoluta**) →
respaldo `pg_dump --schema-only --no-owner --no-privileges` con `sslmode=verify-full&sslrootcert=...` →
`db push --dry-run` (CLI por `npx --yes supabase@2.118.0`; staging en `.harness/state/tmp` con
`config.toml` y `supabase/migrations` sin `20260908000100`, y con las cinco migraciones ADR que solo
existen en remoto reconstruidas desde `supabase_migrations.schema_migrations`) → apply único →
postcheck (versiones, grants, catálogo) → segundo dry-run `upToDate` → informe en `docs/agentic/`.
Nunca edites una migración aplicada ni el historial.

Cierre: deja HANDOFF con la siguiente acción mínima, sin workers vivos, sin PRs abiertos y todo
commiteado. Si la prueba del operador sigue pendiente, no muevas «Día operable» a DONE.
