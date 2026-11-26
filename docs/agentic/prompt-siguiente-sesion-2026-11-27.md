# Prompt para la siguiente sesión (2026-11-27, Ola 4)

Copia el bloque siguiente como primer mensaje de la conversación nueva.

---

Eres el orquestador de superRestaurant (POS multi-sucursal). Esta sesión es solo dsh (DeepSeek vía
OpenCode Go): Codex y Gemini están sin cuota. No uses codex, gemini ni subagentes Claude como worker.

ARRANQUE (no leas archivos de más de 300 líneas)

1. Lee `HANDOFF.md` (2 primeras entradas), `docs/plans/plan-2026-11-27-ola4-m4.md` (§0–§2),
   `docs/agentic/status.md` y `docs/agentic/backlog.json` (solo items que no estén `done`).
2. Verifica con `git log --oneline -5`, `git status` y `gh pr list --state open`.

Estado esperado: `main` en `06379b2d` o posterior; M3 cerrado (90 migraciones desde cero, `test:http:local`
9/9, pase visual 12/12, journey 13 verde); dev al día hasta `20261126001300`; `m3-rc1` publicado.
Pendiente: Ola 4 (deuda que muerde) y el arranque de M4.

PASO 0 OBLIGATORIO — PREFLIGHT READ_ONLY

`.env.adr010.local` tiene `ADR010_DATABASE_URL`; quita la query y añade `?sslmode=verify-full`. Nunca
imprimas la cadena ni el certificado.

```powershell
$env:SCHEMA_VERIFICATION_CONFIRMATION='READ_ONLY'
$env:SCHEMA_VERIFICATION_EXPECTED_PROJECT_REF='zwbyiefqeujstyzysydn'
$env:SCHEMA_VERIFICATION_DATABASE_URL='<base>?sslmode=verify-full'
$env:SCHEMA_VERIFICATION_CA_CERT_PATH='C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\.certs\prod-ca-2021.crt'
pnpm --filter @super-restaurant/api run preflight:migrations
```

Esperado: `lastRemote=20261126001300` y `localMissingInRemote` solo `20260908000100` (excluida; no
toques el historial). Si aparecen candidatas nuevas, protocolo §19.6 completo de
`docs/runbooks/migration-apply.md`.

OLA 4 — DEUDA QUE MUERDE, en este orden

1. **`debt-historical-verifiers`** (dsh, B): arreglar los fixtures de
   `verify:menu-shared-modifier-groups-schema:rollback` y `verify:capture-schema:rollback` hasta que
   pasen desde cero. Tú corres los verificadores con `LOCAL_POSTGRES_BIN`.
2. **`debt-compras-reads`** (dsh, B): proveedores y órdenes legibles con `catalog.read` (no
   `catalog.manage`), con pruebas de aislamiento; la UI no cambia de permiso.
3. **Revisiones de M2** (dsh, A, solo lectura): `o0-rev-web-leader`, `o0-rev-web-purge`,
   `o0-rev-mobile-banner`, `o0-rev-visual`, `o0-rev-sync-p3`; después cerrar `o0-wire` (hoy `review`).
   Los worktrees ya existen en `~/harness-wt/superRestaurant/o0-*`; los revisores **no escriben
   archivos, no salen del repo y usan `git show`**.
4. **`debt-device-id`** (dsh, B): validar `x-device-id` y el `deviceId` de recepción contra el registro
   de dispositivos, o documentar la decisión de persistencia por equipo frente a `sessionStorage`.
5. **`debt-p3-sweep`** (tú, D): barrer `docs/agentic/debt.md`, archivar P3 sin impacto y promover los
   que ya muerden (incluye `recipeVersionId` nulo, la UI de almacenes y el auditor visual).

Reglas no negociables

- Los workers dsh no commitean, no hacen push y NO ejecutan PostgreSQL ni Playwright. Tú corres
  `verify:*:rollback`, `test:http:local -- --local-disposable-only`, el pase visual y el journey, con
  `LOCAL_POSTGRES_BIN=C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\.cache\postgres-local\pgsql\bin`.
- Node 24: `. .\tools\agentic\use-node24.ps1` y después `$ErrorActionPreference='Continue'`.
- Ramas `harness/<id>` → PR → CI verde (Verify, PostgreSQL, Playwright) → revisión dsh (dos focos en A)
  → `gh pr merge <n> --squash --delete-branch`. **También los docs van por PR**: el hook pre-push
  bloquea empujar a `main` directamente.
- Los worktrees de dsh viven en `.harness/worktrees` (su sandbox no sale del repo). Si mueves un
  worktree, reinstala: `$env:CI='true'; pnpm install --frozen-lockfile`.
- Un escritor por archivo; compartidos (`package.json`, `app.module.ts`, `inventory-workspace.tsx`,
  `operations/inventory-*verification.ts`) en una sola tarea por ola.
- `git -c core.whitespace=cr-at-eol diff --check` antes de cada commit (backlog.json tiene CRLF).
- Al cerrar la ola: preflight, HANDOFF, `status.md`, `backlog.json`, `debt.md` y smoke si hubo UI.

Trampas que ya costaron tiempo

1. dsh agota turno o muere por watchdog sin informe pero suele dejar el código: revisa `git status`,
   corre tú las puertas y escribe el resultado.
2. Su sandbox falla al escribir en `$env:TEMP` o fuera del repo, incluso para leer plantillas: los
   briefs deben decir «no escribas archivos; usa `git show`» en la **primera línea**.
3. No mutar estado global en specs de Playwright; pasar opciones por llamada (`captureDir`).
4. `E2E_VISUAL` + proyectos: marcar `@desktop-only` y excluirlo del proyecto `mobile`.
5. El `storageState` dura ~1 h y el pase visual rota el refresh token:
   `node tools/agentic/local-servers/refresh-e2e-session.mjs` antes de cada corrida; si responde
   `refresh_rejected`, pide el login manual (`pnpm --filter @super-restaurant/web e2e:auth`).
6. El API local no arranca sin `SYNC_CURSOR_SECRET` (≥ 32, efímero y nunca registrado).
7. `list_inventory_movements` devuelve `recipeVersionId` siempre nulo; no escribas aserciones que lo
   exijan hasta que exista la migración que lo exponga.

Cierre: deja HANDOFF con la siguiente acción mínima, sin workers vivos y sin PRs abiertos. Si la
prueba del operador sigue pendiente, no muevas filas de «Día operable» a DONE.

---

## Notas para el orquestador humano

- Si la deuda de la Ola 4 se cierra a media sesión, arranca M4 por la Ola 6 (`m4-metrics-catalog` y
  `m4-adr-014-exports`), que es documental y no depende de más código.
- La puerta que desbloquea «Día operable» no es código: es una pasada tuya con
  `docs/runbooks/guia-de-pruebas-operador.md` (D1–D7, T1–T4 y las seis pestañas de inventario).
