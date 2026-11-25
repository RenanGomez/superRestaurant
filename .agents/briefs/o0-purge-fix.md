# Brief o0-purge-fix (nivel A · corrige P1 de la revisión de o0-web-purge)

## Objetivo
Que la política de purga y el almacén digan lo mismo: `purge_all` purga todo cuando no hay evidencia, y conserva la evidencia cuando la hay.

Tiempo estimado: 20 min. Tu worktree ya contiene `o0-web-purge` (PR #74, ronda 2).

## P1 a corregir
`apps/web/src/lib/offline/sync-purge.ts:22` decide `purge_all` para `sign_out` sin evidencia, pero `purgeAll()` en `sync-store.ts` conserva el outbox siempre (la prueba `sync-purge.test.ts:137-141` afirma `wiped:false` con `retainedOutboxCount:1`). La decisión y el efecto no coinciden.

Solución (conservadora, no se borra evidencia financiera jamás):
- `purgeAll()` borra slots, claves y metadatos cuando **no** hay entradas de outbox retenidas; si hay evidencia, conserva outbox y devuelve `{ wiped: false, retainedOutboxCount }` como hoy.
- La política se documenta con esa semántica: `purge_all` = "purga total si no hay evidencia; si la hay, degrada a `purge_replica_keep_outbox`".
- Ajusta la prueba para los dos casos: (a) `sign_out` sin evidencia → `wiped: true`, outbox vacío, `loadState` devuelve `null`; (b) `sign_out` con evidencia → `wiped: false`, outbox intacto y la réplica se puede releer.

## Opcional barato (solo si sobra tiempo)
P3: prueba de `lock()` sobre un almacén ya en cuarentena (estado `locked+quarantined` sin corrupción) y de `purge → persist → loadState` tras el reencrypt.

## Alcance
- Edita SOLO: `apps/web/src/lib/offline/sync-store.ts`, `apps/web/src/lib/offline/sync-purge.ts`, `apps/web/src/lib/offline/sync-purge.test.ts`.
- Prohibido: `packages/**`, `package.json` (lo cablea `o0-wire`), otras apps, dependencias, rutas fuera del worktree. Sin commit ni push.

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/web lint
& $PNPM --filter @super-restaurant/web typecheck
Push-Location apps/web
& $PNPM exec tsc --ignoreConfig --target ES2024 --module ESNext --moduleResolution Bundler --lib ES2024,DOM --types node --outDir .test-dist --rootDir src --strict --skipLibCheck src/lib/offline/sync-store.ts src/lib/offline/sync-store.test.ts src/lib/offline/sync-purge.ts src/lib/offline/sync-purge.test.ts
node .test-dist/lib/offline/sync-store.test.js
node .test-dist/lib/offline/sync-purge.test.js
Pop-Location
```

## Hecho cuando
Ambos casos de purga probados y en verde (salida real), suites completas de `sync-store` y `sync-purge` verdes, lint/typecheck y `git diff --check` limpios.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con bloques comando + salida real.
Aplica Ponytail: cambio más pequeño correcto, sin recortar validación ni pruebas.
