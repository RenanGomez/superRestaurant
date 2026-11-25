# Brief o0-web-purge (nivel A · offline web, dinero y evidencia)

## Objetivo
Purga y rotación del almacén cifrado web: purga al cerrar sesión, bloqueo + purga de réplica con `AUTH_REVOKED`, rotación de `keyVersion` y `restaurantId`/`branchId` dentro de la AAD.

Tiempo estimado: 30 min. Si te pasas del doble, cierra con informe `partial`.

## Alcance
- Crea/edita SOLO: `apps/web/src/lib/offline/sync-store.ts`, `apps/web/src/lib/offline/sync-purge.ts`, `apps/web/src/lib/offline/sync-purge.test.ts`.
- Prohibido: tocar `sync-leader.ts`, `sync-transport.ts`, `apps/web/package.json`, otras apps, migraciones, dependencias. Sin `git push`.
- `sync-store.ts` es tuyo en exclusiva en esta ola; no cambies las firmas públicas existentes (`open`, `close`, `loadState`, `inspectPreviousEvidence`, `commit`, `update`) ni suscódigos de error: solo añade lo necesario.
- Temporales en `.harness/state/tmp/`; bórralos al terminar.

## Contexto y firmas reales
- `WebIndexedDbSyncStorage` guarda en IndexedDB tres almacenes: `META`, `SLOTS`, `KEYS`; cada slot se cifra con AES-GCM y `aad(deviceId, keyVersion, generation)` (función local del archivo).
- `WebSyncStorageError` lleva `code`; se lanza `STORAGE_LOCKED`, `STORAGE_QUARANTINED`, `STATE_CORRUPT`, `STORAGE_LOAD_FAILED`, `STORAGE_COMMIT_FAILED`, `DEVICE_MISMATCH`.
- El scope autorizado vive en `DurableSyncState` (`restaurantId`, `branchId`) — ver `packages/sync-engine/src/durable-state.ts`.
- `apps/web/src/lib/offline/sync-store.test.ts` tiene el patrón de `LockManager` falso y `fake-indexeddb` (dependencia ya instalada).

## Qué construir
1. En `sync-store.ts`:
   - AAD ligada al scope: incluye `restaurantId` y `branchId` del estado (defensa en profundidad). Un cambio de scope en el estado invalida el descifrado de slots viejos; el motor debe tratarlo como `STATE_CORRUPT`, nunca como éxito silencioso.
   - `rotateKey()` que re-cifra el slot activo con una `keyVersion` nueva y retira la clave anterior (`KEYS`).
   - `purgeForScope(scope)` y `purgeAll()` que borran slots y claves del scope sin tocar la evidencia de outbox que el motor marque como retenida (si el motor no distingue, conserva el outbox y borra solo la réplica).
   - `lock()` / `quarantine()` públicos si no existen (hoy `quarantine` es privado).
2. `sync-purge.ts`: política pura, sin IndexedDB, que decide la acción desde un evento:
   `decideOfflinePurge({ event: "sign_out" | "auth_revoked" | "device_revoked" | "device_compromised", hasFinancialEvidence: boolean })` → `{ action: "purge_all" | "purge_replica_keep_outbox" | "lock_and_keep", reason: string }`.
   Regla conservadora: `sign_out` sin evidencia financiera → `purge_all`; `sign_out` con evidencia → `purge_replica_keep_outbox`; `auth_revoked` → `purge_replica_keep_outbox`; `device_revoked` con evidencia → `lock_and_keep`; `device_compromised` sin evidencia → `purge_all`.
3. Pruebas nuevas (`node:test` + `fake-indexeddb`): AAD con scope distinto → `STATE_CORRUPT`; rotación conserva el estado legible y retira la clave vieja; purga borra slots/claves del scope y conserva evidencia cuando la política lo pide; cada rama de `decideOfflinePurge` con su expectativa.

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # debe imprimir v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/web lint
& $PNPM --filter @super-restaurant/web typecheck
& $PNPM --filter @super-restaurant/web exec tsc --ignoreConfig --target ES2024 --module ESNext --moduleResolution Bundler --lib ES2024,DOM --types node --outDir .test-dist --rootDir src --strict --skipLibCheck src/lib/offline/sync-store.ts src/lib/offline/sync-store.test.ts src/lib/offline/sync-purge.ts src/lib/offline/sync-purge.test.ts
node .test-dist/lib/offline/sync-store.test.js
node .test-dist/lib/offline/sync-purge.test.js
```
La suite previa de `sync-store` debe seguir entera en verde (no la recortes). `apps/web/package.json` lo cablea `o0-wire`: no lo toques.

## Hecho cuando
- Pruebas nuevas y las previas de `sync-store` pasan con salida real pegada.
- `lint`, `typecheck` y `git diff --check` en verde.

## Cierre
- **No hagas commit ni push**: el orquestador revisa y fusiona desde tu worktree.
- Tu respuesta final ES el informe, con bloques de comando + salida real. Sin evidencia = NO VERIFICADO.
- Aplica Ponytail: cambio más pequeño correcto, reutiliza lo existente, sin recortar validación, errores, seguridad ni pruebas.
