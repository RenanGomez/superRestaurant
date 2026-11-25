# Brief o0-sync-p3 (nivel B · sync API + transporte web)

## Objetivo
Corregir los P3 de sync: distinguir `DEVICE_UNKNOWN` de `DEVICE_REVOKED` y `ACTOR_MISMATCH` de `AUTH_REVOKED`, registrar el rechazo con log estructurado sin secretos, y poner timeout de 30 s por defecto en el transporte web.

Tiempo estimado: 25 min.

## Alcance
- Edita SOLO: `apps/api/src/sync/sync-merge-executor.ts`, `apps/api/src/sync/sync-push.test.ts`, `apps/web/src/lib/offline/sync-transport.ts`, `apps/web/src/lib/offline/sync-transport.test.ts`.
- Prohibido: `apps/web/src/lib/offline/sync-store.ts`, `sync-leader.ts`, `sync-purge.ts`, `apps/web/package.json`, migraciones, dependencias. Sin `git push`.
- Temporales en `.harness/state/tmp/`; bórralos al terminar.

## Contexto y firmas reales
- `apps/api/src/sync/sync-merge-executor.ts` línea ~27–36: hoy devuelve `revoked(event, "AUTH_REVOKED")` cuando `actor !== event.actorId` o cuando el scope no es UUID válido, y `revoked(event, "DEVICE_REVOKED")` cuando `row.device !== "active"`.
- El contrato `SyncEventResultV1` (`packages/shared-types/src/sync*`) ya admite códigos de rechazo; **no añadas códigos nuevos al contrato** si no existen: si `DEVICE_UNKNOWN`/`ACTOR_MISMATCH` están en el union, úsalos; si no, mantén los códigos actuales y limita el cambio al log estructurado. Verifica con `codegraph explore "SyncEventResultV1"` antes de decidir y anótalo en el informe.
- `apps/web/src/lib/offline/sync-transport.ts` línea 107: `const timeoutMs = options.timeoutMs ?? 0;` — cámbialo a 30_000 por defecto manteniendo `options.timeoutMs` como override y sin romper las pruebas existentes.
- Logging: sigue el patrón de logs estructurados de `apps/api` (busca `correlationId` en `apps/api/src`). Nunca loguees token, PII ni payload completo.

## Qué construir
1. En el ejecutor: mapear el estado de dispositivo `unknown` a `DEVICE_UNKNOWN` (si el contrato lo permite) y el actor distinto a `ACTOR_MISMATCH`; si el contrato no los admite, deja una función `classifyRejection()` con comentario `shortcut:` explicando por qué y cubre con prueba el código real devuelto.
2. Log estructurado de cada rechazo: `{ eventId, deviceId, restaurantId, branchId, code, correlationId }`, sin token ni payload.
3. Pruebas API en `sync-push.test.ts` para los dos códigos nuevos (o los reales) y para que el log no incluya el token.
4. Transporte web: default 30 s + prueba de corte con `AbortController` (usa temporizadores falsos o un `fetch` doble que nunca resuelve y un `timeoutMs` corto explícito para no esperar 30 s reales).

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # debe imprimir v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/api lint
& $PNPM --filter @super-restaurant/api typecheck
& $PNPM --filter @super-restaurant/api exec tsc --project tsconfig.test.build.json
node .test-dist/sync/sync-push.test.js
& $PNPM --filter @super-restaurant/web exec tsc --ignoreConfig --target ES2024 --module ESNext --moduleResolution Bundler --lib ES2024,DOM --types node --outDir .test-dist --rootDir src --strict --skipLibCheck src/lib/offline/sync-transport.ts src/lib/offline/sync-transport.test.ts
node .test-dist/lib/offline/sync-transport.test.js
```
Si el build de `shared-types` o `domain` falta en el worktree, ejecuta antes `& $PNPM --filter @super-restaurant/shared-types build` y `& $PNPM --filter @super-restaurant/domain build`.

## Hecho cuando
- Códigos diferenciados (o decisión documentada con prueba del código real).
- Log estructurado sin secretos y con su prueba.
- Timeout 30 s por defecto con prueba de corte.
- `lint`, `typecheck`, suites y `git diff --check` en verde, con salida real.

## Cierre
- **No hagas commit ni push**: el orquestador revisa y fusiona desde tu worktree.
- Tu respuesta final ES el informe, con bloques comando + salida real. Sin evidencia = NO VERIFICADO.
- Aplica Ponytail: cambio más pequeño correcto, reutiliza lo existente, sin recortar validación, seguridad ni pruebas.
