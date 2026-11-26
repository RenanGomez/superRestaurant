# Prompt para la siguiente sesión (2026-11-26, cierre de M3)

Copia el bloque siguiente como primer mensaje de la conversación nueva.

---

Eres el orquestador de superRestaurant (POS multi-sucursal). Esta sesión es solo dsh (DeepSeek vía
OpenCode Go): Codex y Gemini están sin cuota. No uses codex, gemini ni subagentes Claude como worker.

ARRANQUE (no leas archivos de más de 300 líneas):

1. Lee `HANDOFF.md` (2 primeras entradas), `docs/plans/plan-2026-11-26-siguiente.md` (§0-§2),
   `docs/agentic/status.md` y `docs/agentic/backlog.json` (solo los items que no están `done`).
2. Verifica con `git log --oneline -5`, `git status` y `gh pr list --state open`.

Estado esperado: `main` en `eec82d70` o posterior; M3 al ~97 % con las seis pestañas de
`/app/inventario` (insumos, recetas, almacenes, movimientos, compras, alertas) y API de inventario
completa; `test:http:local` 10/10; `verify:inventory-schema:rollback` con 88 migraciones desde cero;
dev al día hasta `20261126001100`. Pendiente de M3: pase visual, journey E2E de inventario y el P2
de `EXECUTE` en `inventory_record_movement`.

BLOQUEO CONOCIDO (compruébalo antes de planificar): la sesión de Playwright caducó
(`Invalid Refresh Token`). Si `apps/web/playwright/.auth/user.json` no autentica, pide a Emmanuel:

- `pnpm --filter @super-restaurant/web e2e:auth` y login manual, **o**
- cerrar Chrome del todo y `tools\agentic\local-servers\e2e-import-session.bat`.

Mientras no haya sesión, avanza con lo que no la necesita (no la maquilles ni marques DONE sin ella).

PASO 0 OBLIGATORIO: PREFLIGHT DE MIGRACIONES (READ_ONLY)

`.env.adr010.local` tiene `ADR010_DATABASE_URL`; quita la query y añade `?sslmode=verify-full`.
Nunca imprimas la cadena ni el certificado.

```powershell
$env:SCHEMA_VERIFICATION_CONFIRMATION='READ_ONLY'
$env:SCHEMA_VERIFICATION_EXPECTED_PROJECT_REF='zwbyiefqeu jstyzysydn'   # sin el espacio
$env:SCHEMA_VERIFICATION_DATABASE_URL='<base>?sslmode=verify-full'
$env:SCHEMA_VERIFICATION_CA_CERT_PATH='C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\.certs\prod-ca-2021.crt'
pnpm --filter @super-restaurant/api run preflight:migrations
```

Esperado: `lastRemote=20261126001100` y `localMissingInRemote` solo `20260908000100` (excluida: sus
objetos existen en remoto sin fila de historial; no la reapliques ni edites
`supabase_migrations.schema_migrations`). Si hay candidatas nuevas, protocolo §19.6 completo de
`docs/runbooks/migration-apply.md`.

OLA 3 — CIERRE DE M3, en este orden

1. **`m3-visual-pass`** (orquestador, C): levanta API (`SYNC_CURSOR_SECRET` ≥ 32 efímero, nunca
   registrado) y web, y corre
   `E2E_VISUAL=1 pnpm exec playwright test e2e/visual/inventario.spec.ts --project desktop`
   (12 combinaciones: 6 pestañas × 1366×800 y 390×844). Capturas a
   `docs/agentic/visual-verify-2026-11-26/`. Exige consola y red limpias, desborde 0 px, targets
   ≥ 44 px y cero diálogos nativos.
2. **`m3-e2e-journey`** (dsh, B): brief ya escrito en `.agents/briefs/m3-e2e-journey.md`. Escribe
   `apps/web/e2e/journeys/journey-13-inventario.spec.ts`; tú lo ejecutas (el worker no corre
   Playwright ni PostgreSQL).
3. **`m3-visual-fixes`** (dsh, C): solo por bloques de hallazgos del pase; re-pase del bloque.
4. **`m3-schema-grant-close`** (dsh, A ×2 focos): retirar `EXECUTE` de `app_api` en
   `inventory_record_movement` (P2 de compras) exponiendo wrappers por operación. Verificador
   rollback-only obligatorio.
5. **`m3-close-docs`** (orquestador, D): HANDOFF, `status.md`, `backlog.json`, `debt.md`, smoke
   `docs/smoke/smoke-2026-11-26.*` con lo realmente visto, tag `m3-rc1`.

Reglas no negociables

- Los workers dsh no commitean, no hacen push y NO ejecutan PostgreSQL ni Playwright. Tú corres
  `verify:*:rollback`, `test:http:local -- --local-disposable-only` y el pase visual, con
  `LOCAL_POSTGRES_BIN=C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\.cache\postgres-local\pgsql\bin`.
- Node 24: `. .\tools\agentic\use-node24.ps1` y después `$ErrorActionPreference='Continue'`; pnpm en
  `C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD`. Si `pnpm --filter ... run <script>`
  sale con exit 1 sin diagnóstico, ejecuta el `tsc`/`node` del script directamente.
- Un escritor por archivo; compartidos (`app.module.ts`, `package.json`,
  `operations/inventory-*verification.ts`, `inventory-workspace.tsx`, `apps/web/package.json`) en una
  sola tarea por ola.
- Ramas `harness/<id>` → PR → CI verde (Verify, PostgreSQL, Playwright) → revisión dsh (dos focos en
  A) → `gh pr merge <n> --squash --delete-branch`. Nada de force-push a `main`.
- Si `gh pr create/merge` falla con GraphQL transitorio: `gh pr list --head <rama>` y el endpoint
  REST (`gh api repos/RenanGomez/superRestaurant/pulls -f ...`, `gh api -X PUT .../pulls/<n>/merge -f
  merge_method=squash`). Si GitHub no dispara CI en un push: cerrar y reabrir el PR.
- Migraciones: preflight antes de cerrar cada ola; nunca editar una migración aplicada.
- Al cerrar cada ola: HANDOFF, `status.md`, `backlog.json`, `debt.md` y smoke si hubo UI.

Trampas que ya costaron tiempo

1. dsh agota turno sin informe (~40 %) pero suele dejar el código: revisa `git status`, ejecuta las
   puertas y escribe tú el resultado; si falta código, relanza el mismo `-Id` con feedback concreto.
2. El sandbox de dsh no puede escribir fuera del repo: si un revisor intenta usar `$env:TEMP` o
   redirecciones, falla. Dile explícitamente «no escribas archivos; usa `git show`».
3. Efecto de módulo en las specs de Playwright: no mutes estado global; pasa opciones por llamada.
4. `E2E_VISUAL` + proyectos `desktop`/`mobile`: marca `@desktop-only` y exclúyelo en `mobile` o la
   spec se duplica.
5. `providers` directos en `AppModule`: no hay `imports` de módulos; no crees `*.module.ts`.
6. Verde local ≠ verde en CI: `git -c core.whitespace=cr-at-eol diff --check` antes de commitear
   (backlog.json tiene CRLF).
7. Al crear una rama de documentación, parte SIEMPRE de `origin/main` limpio
   (`git switch -c docs/<tema> origin/main`); en la sesión anterior una rama creada desde otra rama
   metió una spec sin sus correcciones en el PR de docs.
8. El API local no arranca sin `SYNC_CURSOR_SECRET` (≥ 32): genéralo efímero por corrida y no lo
   registres.

Cierre: deja HANDOFF con la siguiente acción mínima, sin workers vivos y sin PRs abiertos.

---

## Notas para el orquestador humano

- Si Emmanuel ya refrescó la sesión, empieza directo por el punto 1 de la Ola 3.
- Si no, adelanta `m3-schema-grant-close` (nivel A, no necesita navegador) y deja el journey escrito
  para la pasada con sesión.
