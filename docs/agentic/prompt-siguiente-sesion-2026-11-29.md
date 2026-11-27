# Prompt para la siguiente sesión (compras legibles, matriz RBAC y arranque de M4)

Copia el bloque siguiente como primer mensaje de la conversación nueva.

---

Eres el orquestador de superRestaurant (POS multi-sucursal). Esta sesión es solo dsh (DeepSeek vía
OpenCode Go): Codex y Gemini están sin cuota. No uses codex, gemini ni subagentes Claude como worker.

ARRANQUE (no leas archivos de más de 300 líneas)

1. Lee `HANDOFF.md` (2 primeras entradas), `docs/plans/plan-2026-11-27-ola6-compras-m4.md` (completo),
   `docs/agentic/status.md` y `docs/agentic/backlog.json` (solo items que no estén `done`).
2. Verifica con `git log --oneline -5`, `git status`, `gh pr list --state open`.
3. Levanta el stack solo si vas a verificar UI: `tools\agentic\local-servers\start-local.bat nobuild`
   **con** `SYNC_CURSOR_SECRET` (≥32) en el entorno; sin él la API no arranca
   (`SyncCursor` lanza `SYNC_CURSOR_SECRET_INVALID`). Nunca imprimas el secreto.

Estado esperado: `main` en `a9eaa60c` o posterior; Ola 5 fusionada (#138–#149); dev en
`20261126001500`; **M2 cerrado en su alcance técnico** (puertas humanas aparte: dispositivo real,
impresora, ASAP 15/30); M3 al 100 % del alcance fusionado. La prueba del operador sigue pendiente: no
muevas filas de «Día operable» a DONE.

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

Esperado: `lastRemote=20261126001500` y `localMissingInRemote` solo `20260908000100` (excluida; no
toques el historial). Cualquier otra candidata exige el protocolo §19.6 completo (sonda rollback-only,
respaldo schema-only verificado, dry-run exacto, apply único, postcheck, segundo dry-run). El staging
temporal excluye `20260908000100` y reproduce las cinco ADR históricas; `supabase db push` se lanza con
`--db-url` del pooler (IPv4) leído del `.env`, nunca impreso.

TRABAJO DE LA SESIÓN, en este orden (detalle en el plan §1–§3)

1. **Matriz RBAC compartida** (B, 20 min): mover `RBAC_ROLE_PERMISSIONS_V1` y `rolesGrantPermission` de
   `apps/api/src/auth/rbac-policy.ts` a `packages/shared-types`, reexportarlos desde el API y dejar los
   tests de ambos verdes. Objetivo: que el web no copie listas de roles.
2. **`o5-compras-ui-read`** (C, 45–60 min): helper `inventory-access.ts` (`canReadPurchases` /
   `canManagePurchases`), prop `canRead` desde `page.tsx` al workspace y al panel; cargar proveedores,
   órdenes y detalle con `canRead`; dejar solo las acciones de escritura detrás de `canManage` (la
   recepción sigue exigiendo además `deviceStatus === "ready"`). Prueba del helper con los ocho roles de
   `catalog.read` y las negativas de `kitchen`/`courier`.
   - Pase visual: `E2E_VISUAL=1 playwright test e2e/visual/inventario.spec.ts --project desktop` con la
     sesión vigente. Si caducó: `pnpm --filter @super-restaurant/web e2e:auth` (login manual; los
     servidores deben estar arriba). Para ver la variante `viewer`/`auditor` hace falta una cuenta con
     ese rol; si no la hay, documenta la brecha y deja el item en REVIEW.
3. **M4 documental** (D, 60–90 min): `m4-metrics-catalog` (`docs/architecture/metrics-catalog.md`) y
   `m4-adr-014-exports` (`docs/adr/ADR-014.md`), con el criterio del plan §2.
4. **Si sobra tiempo:** P3 del plan §3 (`INVALID_SCOPE`, `correlationId` por evento, argumentos del
   verificador de capture, `42501` en `items.service.ts`). Uno por PR pequeño.
5. **Cierre** (tú, D): HANDOFF, `status.md`, `backlog.json`, `debt.md` y smoke; preflight final.

PUERTAS (todas antes de DONE)

- `pnpm --filter @super-restaurant/web run test|lint|typecheck|build|e2e:typecheck` en 0.
- Pase visual de inventario 12/12 con consola y red limpias (nunca `alert/confirm/prompt`).
- Un PR por tarea, CI verde (Verify, PostgreSQL, Playwright) y revisión por un motor distinto al que
  escribió; si no hay cuota para otra familia, regístralo en HANDOFF y haz una segunda pasada del diff.
- `git diff --check` en docs; smoke regenerado si hubo UI.

REGLAS QUE NO SE RELAJAN

- Un escritor por archivo; los compartidos (`inventory-workspace.tsx`, `purchasing-panel.tsx`,
  `actions.ts`, `package.json`, `supabase/migrations`) en una sola tarea por ola.
- No editar migraciones aplicadas. Nada de datos reales sin respaldo y alcance por ids.
- Nada de «Día operable» a DONE sin la prueba del operador (D1–D7, T1–T4, seis pestañas).
- Sin workers vivos ni PRs abiertos al cerrar; si queda trabajo delegado sin integrar, dilo explícito.
