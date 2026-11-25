# Brief o0-devices-fix (nivel A · corrige P1 de la revisión de o0-sync-devices)

## Objetivo
Que dos cajeros que comparten tablet puedan sincronizar (dispositivo por actor) y que la prueba garantice que el registro ocurre antes del primer push.

Tiempo estimado: 25 min. Tu worktree ya contiene `o0-sync-devices` (PR #79).

## P1 a corregir
1. `apps/web/src/components/offline-runtime-mount.tsx:9` usa una clave de navegador (`sr-web-device-id`) como `deviceId` de sync, pero `app_private.sync_register_device` ata la fila al **actor** (`on conflict do nothing`) y `sync_device_state` es por actor: el segundo cajero del mismo tablet queda `unknown` y recibe 403 para siempre.
   - Solución: deriva un `deviceId` de sync **estable por (dispositivo, actor)** usando el mismo hashing determinista del puente, con formato UUID válido (versión 4, variante `[89ab]`). No cambies el almacenamiento de la identidad base del navegador; solo el identificador que se envía al API y el que usa el motor (replica y outbox quedan por actor, lo que además protege la evidencia en cambio de turno).
   - Documenta la decisión en un comentario corto y en el informe.
2. `apps/web/src/lib/offline/web-sync-bridge.test.ts:400` afirma "antes del primer push" sin verificarlo. Añade una prueba que registre el orden real de llamadas (registro antes que push) y que falle si se invierte.

## Alcance
- Edita SOLO: `apps/web/src/components/offline-runtime-mount.tsx`, `apps/web/src/lib/offline/web-sync-bridge.ts`, `apps/web/src/lib/offline/web-sync-bridge.test.ts`.
- Prohibido: API, migraciones, mobile, dependencias, rutas fuera del worktree. Sin commit ni push.

## Qué NO hacer
No toques `sync-device.service.ts` (el estado `"active"` coincide con la prueba PostgreSQL existente; el brief original estaba desfasado). Los P2/P3 de la revisión van a deuda.

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/shared-types build
& $PNPM --filter @super-restaurant/sync-engine build
& $PNPM --filter @super-restaurant/web lint
& $PNPM --filter @super-restaurant/web typecheck
Push-Location apps/web
& $PNPM exec tsc --ignoreConfig --target ES2024 --module ESNext --moduleResolution Bundler --lib ES2024,DOM --types node --outDir .test-dist --rootDir src --strict --skipLibCheck src/lib/sync-ui.ts src/lib/offline-pos.ts src/lib/offline/sync-transport.ts src/lib/offline/sync-store.ts src/lib/offline/web-sync-bridge.ts src/lib/offline/web-sync-bridge.test.ts
node --import ./test/proxy-esm-loader.mjs .test-dist/lib/offline/web-sync-bridge.test.js
Pop-Location
```
`pnpm exec` corre en el paquete: `node .test-dist/...` va dentro de `apps/web`.

## Hecho cuando
- Prueba nueva: dos actores con el mismo dispositivo base obtienen `deviceId` distintos y ambos registran sin 403 simulado; el orden registro→push está asertado.
- Suite `web-sync-bridge` completa en verde; lint, typecheck y `git diff --check` limpios, con salida real.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con bloques comando + salida real.
Aplica Ponytail: cambio más pequeño correcto, sin recortar validación ni pruebas.
