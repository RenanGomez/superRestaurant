# Brief o0-web-leader (nivel A · offline web)

## Objetivo
Elección de líder entre pestañas para el motor de sync web y prueba, a nivel de motor, del protocolo de pestaña obsoleta (`STORAGE_COMMIT_FAILED` → descartar motor → recargar almacén → reintentar con la misma idempotency key).

Tiempo estimado: 30 min. Si te pasas del doble, cierra con informe `partial`.

## Alcance
- Crea/edita SOLO: `apps/web/src/lib/offline/sync-leader.ts`, `apps/web/src/lib/offline/sync-leader.test.ts`.
- Prohibido: tocar `sync-store.ts`, `sync-transport.ts`, `apps/web/package.json`, `apps/mobile/**`, `apps/api/**`, migraciones, dependencias. Sin `git push`.
- Temporales en `.harness/state/tmp/`; bórralos al terminar.

## Contexto y firmas reales
- `apps/web/src/lib/offline/sync-store.ts`: `WebIndexedDbSyncStorage.open(deviceId, { databaseName?, indexedDB?, crypto?, locks? })`; ya serializa con `locks.request("sr-sync:" + deviceId, { mode: "exclusive" }, work)` y lanza `WebSyncStorageError` con códigos (`STORAGE_LOCKED`, `STORAGE_QUARANTINED`, `STORAGE_COMMIT_FAILED`, `DEVICE_MISMATCH`, `STATE_CORRUPT`).
- `apps/web/src/lib/offline/sync-store.test.ts` líneas 14–21 tienen un `LockManager` falso mínimo; reutiliza ese patrón en tu test.
- `packages/sync-engine` exporta `DeviceSyncEngine` y `createEmptyState`.

## Qué construir
1. `sync-leader.ts` con una API pequeña y tipada, por ejemplo:
   - `acquireSyncLeader(deviceId: string, options?: { locks?: LockManager; channel?: BroadcastChannel | null }): Promise<SyncLeaderHandle>`
   - `SyncLeaderHandle`: `{ readonly isLeader: boolean; onLost(cb: () => void): () => void; release(): void }`
   - Implementación: un Web Lock exclusivo por `deviceId` retenido mientras viva el handle (nombre `sr-sync-leader:<deviceId>`), más `BroadcastChannel("sr-sync-leader")` para avisar la toma de relevo. Sin locks → fail-closed (`isLeader=false`), nunca liderazgo optimista.
2. Pruebas (`node:test` + `node:assert/strict`):
   - dos handles del mismo `deviceId`: solo el primero es líder; al `release()` el segundo pasa a líder y el primero recibe `onLost`.
   - la pérdida del lock dispara `onLost` una sola vez.
   - sin `locks` no hay líder.
   - protocolo de pestaña obsoleta a nivel de motor: simula un almacén que lanza `STORAGE_COMMIT_FAILED` una vez; el motor debe descartarse, reabrir el almacén y reintentar **con la misma idempotency key**, y la prueba debe afirmar que la key no cambió (usa el patrón de dobles existente en `sync-store.test.ts`/`sync-transport.test.ts`; no importes @playwright ni React).

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # debe imprimir v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/web lint
& $PNPM --filter @super-restaurant/web typecheck
& $PNPM --filter @super-restaurant/web exec tsc --ignoreConfig --target ES2024 --module ESNext --moduleResolution Bundler --lib ES2024,DOM --types node --outDir .test-dist --rootDir src --strict --skipLibCheck src/lib/offline/sync-leader.ts src/lib/offline/sync-leader.test.ts
node .test-dist/lib/offline/sync-leader.test.js
```
No uses el `pnpm` del PATH (es Node 22). `apps/web/package.json` lo cablea `o0-wire`: no lo toques.

## Hecho cuando
- Las cuatro pruebas pasan con salida real pegada en el informe.
- `lint` y `typecheck` en verde.
- `git diff --check` sin errores.

## Cierre
- **No hagas commit ni push**: el orquestador revisa y fusiona desde tu worktree.
- Tu respuesta final ES el informe: objetivo, archivos, decisiones y, por cada puerta, bloque de código con el comando exacto y su salida real. Sin ese bloque el informe es NO VERIFICADO y no se integra.
- Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación, errores, seguridad ni pruebas.
- Lecciones: `docs/agentic/LESSONS.md` está vacío; no hay reglas extra.
