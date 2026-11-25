# Brief o0-bridge-p1 (nivel A · corrige P1 del puente offline)

## Objetivo
Corregir dos defectos del puente web que hoy hacen que la cola offline nunca drene: identificadores de entidad inválidos para el servidor y payloads no soportados que se reportan como `committed`.

Tiempo estimado: 30 min. Tu worktree ya tiene `o0-sync-devices` fusionado (registro de dispositivo).

## Contexto (hallazgos P1 de revisión)
1. `apps/web/src/lib/offline/web-sync-bridge.ts` `stableEntityId(...)` genera 32 hex sin forzar el nibble de versión ni el de variante. El servidor exige `^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` (`apps/api/src/sync/sync-merge-executor.ts:65`) → 7 de cada 8 claves se rechazan con `INVALID_PAYLOAD`. Prueba reproducible (sale `false`):
   `node -e "…"` (ver informe del revisor `o0-rev-sync-inv`).
2. `commitLocalOperation` encola `{kind, summaryLabel}` como payload por defecto; el ejecutor lo rechaza como `UNSUPPORTED_OPERATION`/`UNSUPPORTED_ENTITY` para `order_add_line` y `cash_collect`, pero el cliente ya devolvió `committed: true`.

## Alcance
- Edita SOLO: `apps/web/src/lib/offline/web-sync-bridge.ts`, `apps/web/src/lib/offline/web-sync-bridge.test.ts`.
- Prohibido: API, mobile, migraciones, otras apps, dependencias, rutas fuera del worktree. Sin commit ni push.

## Qué construir
1. **UUID válido y determinista**: `stableEntityId` debe producir siempre un UUID con versión `4` y variante `[89ab]` (fija los nibbles después de calcular el hash, que sigue siendo determinista). Añade prueba con al menos 50 claves distintas contra el regex exacto del servidor.
2. **Payloads honestos**: para cada `kind` del puente, o el payload es un envelope que el ejecutor acepta hoy, o `commitLocalOperation` **rechaza** la operación con un error claro (`UNSUPPORTED_OFFLINE_OPERATION`) antes de encolar. No puede devolver `committed: true` para algo que el servidor va a rechazar. Cubre con prueba `order_create`, `order_add_line` y `cash_collect`.
3. **Resync**: si `requestResync` apunta a `/api/sync/snapshot` y ese endpoint no existe, cámbialo al endpoint real de pull (`/sync/pull`) o degrada con un mensaje operativo honesto; prueba que no produce 404 silencioso.
4. No cambies el comportamiento de idempotencia ni el de aislamiento ya cubiertos.

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/web lint
& $PNPM --filter @super-restaurant/web typecheck
Push-Location apps/web
& $PNPM exec tsc --ignoreConfig --target ES2024 --module ESNext --moduleResolution Bundler --lib ES2024,DOM --types node --outDir .test-dist --rootDir src --strict --skipLibCheck src/lib/offline/sync-transport.ts src/lib/offline/web-sync-bridge.ts src/lib/offline/web-sync-bridge.test.ts
node .test-dist/lib/offline/web-sync-bridge.test.js
Pop-Location
```

## Hecho cuando
- Prueba de 50 ids contra el regex del servidor en verde.
- Los tres `kind` tienen comportamiento explícito y probado.
- Suite `web-sync-bridge` completa en verde, `lint`/`typecheck` y `git diff --check` limpios, con salida real.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con los bloques comando + salida real.
Aplica Ponytail: cambio pequeño y correcto, sin recortar validación ni pruebas.
