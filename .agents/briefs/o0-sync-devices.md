# Brief o0-sync-devices (nivel A · registrar dispositivo antes del primer push)

## Objetivo
Añadir `POST /sync/devices` al API y llamarlo desde el puente web antes del primer push, para que el dispositivo quede registrado y el servidor no lo trate como `DEVICE_REVOKED`.

Tiempo estimado: 35 min.

## Contexto (hallazgo P1 de revisión)
`apps/web/src/lib/offline/web-sync-bridge.ts` nunca llama a `/sync/devices`. `apps/api/src/sync/sync-merge-executor.ts:36` devuelve `DEVICE_REVOKED` cuando el dispositivo no está `active`, y `packages/sync-engine/src/engine.ts` revoca el scope al primer push; la cola nunca drena. El endpoint **no existe** hoy en el API (`apps/api/src/sync/sync.controller.ts` solo monta `sync/push`; `sync-review.controller.ts` monta `manual-review`). Sí existe la función SQL `app_private.sync_register_device(p_actor uuid, p_restaurant uuid, p_branch uuid, p_device text)` (`supabase/migrations/20261123000300_sync_ledger.sql:138`).

## Alcance
- Crea: `apps/api/src/sync/sync-device.service.ts`, `apps/api/src/sync/sync-device.service.test.ts`.
- Edita: `apps/api/src/sync/sync.controller.ts` (añadir la ruta), `apps/api/src/sync/sync-push.service.ts` solo si hace falta un helper reutilizable, `apps/api/src/sync/sync-result.ts` si necesitas un tipo de respuesta, `apps/api/package.json` (registrar el test nuevo en `scripts.test`), `apps/web/src/lib/offline/web-sync-bridge.ts`, `apps/web/src/lib/offline/web-sync-bridge.test.ts`.
- Prohibido: migraciones, `apps/mobile/**`, dependencias nuevas, tocar `sync-merge-executor.ts` salvo que sea imprescindible (justifícalo). Sin commit ni push; sin rutas fuera del worktree.

## Qué construir
1. **Contrato**: `POST /api/v1/sync/devices` con cuerpo `{ scope: { restaurantId, branchId }, deviceId }` (uuid) y respuesta `{ status: "registered" }`. Valida con parser exact-key en `packages/shared-types` **solo si** ya existe un patrón equivalente; si no, valida en el servicio con `parseSyncScope` del sync-engine (no inventes un contrato nuevo). Rate limit como el push.
2. **Servicio**: `SyncDeviceService.register(token, body)` → resuelve principal con `getAuthenticatedPrincipal`/`parseBearerAuthorization` como en `sync.controller.ts`, valida que el actor tenga membresía en el scope (reutiliza lo que use `SyncPushService`), y ejecuta `select app_private.sync_register_device($1::uuid,$2::uuid,$3::uuid,$4::text)`. Mapea errores SQL a códigos estables (`SYNC_SCOPE_FORBIDDEN`, `SYNC_DEVICE_INVALID`, `SYNC_REQUEST_INVALID`).
3. **Controlador**: `@Post("sync/devices")`, `@HttpCode(200)`, `@Header("Cache-Control","private, no-store")`, `@RateLimited`.
4. **Puente web**: antes del primer push de una sesión, llama a `POST /api/v1/sync/devices` (vía el proxy existente `apps/web/src/app/api/sync/sync-proxy.ts` si aplica) con el scope y el `deviceId`; si falla con 401/403, no encola y muestra el estado de error ya previsto; si responde ok, continúa. Una sola vez por sesión (guarda en memoria, no en disco).
5. **Pruebas**:
   - API: registro exitoso, scope ajeno rechazado, cuerpo inválido rechazado, token ausente 400/401, y que tras registrar el ejecutor deja de devolver `DEVICE_UNKNOWN/DEVICE_REVOKED` (puedes doblar el ejecutor o comprobar el estado del dispositivo).
   - Web: el puente llama exactly-once a `/sync/devices`, no llama si ya hay sesión registrada, y ante 403 no encola.

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/shared-types build
& $PNPM --filter @super-restaurant/sync-engine build
& $PNPM --filter @super-restaurant/api lint
& $PNPM --filter @super-restaurant/api typecheck
Push-Location apps/api
& $PNPM exec tsc --project tsconfig.test.build.json
node .test-dist/sync/sync-device.service.test.js
Pop-Location
& $PNPM --filter @super-restaurant/web lint
& $PNPM --filter @super-restaurant/web typecheck
Push-Location apps/web
& $PNPM exec tsc --ignoreConfig --target ES2024 --module ESNext --moduleResolution Bundler --lib ES2024,DOM --types node --outDir .test-dist --rootDir src --strict --skipLibCheck src/lib/offline/sync-transport.ts src/lib/offline/web-sync-bridge.ts src/lib/offline/web-sync-bridge.test.ts
node .test-dist/lib/offline/web-sync-bridge.test.js
Pop-Location
```
`pnpm exec` corre en el directorio del paquete: `node .test-dist/...` va dentro de `apps/web` o `apps/api`, nunca en la raíz del worktree.

## Hecho cuando
Endpoint, servicio, llamada desde el puente y pruebas en verde con salida real; `lint`/`typecheck` en api y web; `git diff --check` limpio.
Si el gate PostgreSQL no se puede correr (sandbox), dilo: `NO VERIFICADO: PG por orquestador`.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con archivos, contrato exacto y bloques comando + salida real.
Aplica Ponytail: cambio más pequeño correcto, reutiliza `sync_register_device` y los patrones existentes, sin recortar validación, seguridad ni pruebas.
