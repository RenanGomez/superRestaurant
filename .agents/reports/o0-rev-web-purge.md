Plan mode is active (read-only), so I could not write `.agents/reports/o0-rev-web-purge.md`; the report is below.

**VEREDICTO: CAMBIOS**

1. **P1** `apps/web/src/lib/offline/sync-purge.ts:25-44` — `decideOfflinePurge` no tiene ningún llamador de producción (solo `sync-purge.test.ts:5`); en el sign-out real el camino es `web-sync-bridge.ts:605-613 → store.purge()`, que con evidencia no purga la réplica, y en `AUTH_REVOKED` (`web-sync-bridge.ts:409-410`) solo pone `sync_blocked`: el almacén no se bloquea ni se purga y la réplica sigue descifrable con la clave del mismo IDB.
2. **P1** `apps/web/src/lib/offline/sync-store.ts:305-306` — `purgeReplica` rechaza con `STORAGE_LOCKED` si el meta está bloqueado, y `sync-purge.test.ts:180-186` lo consagra: «bloquear» y «purgar la réplica» son mutuamente excluyentes, así que la invariante de AUTH_REVOKED del brief es inalcanzable por construcción.
3. **P2** `sync-store.ts:308-325` — la purga no toca `state.scopes`: conserva el `pullCursor` del scope purgado y el motor reanuda el pull desde ese cursor (`packages/sync-engine/src/engine.ts:1151`, `:1195`), dejando la réplica incompleta de forma permanente; además incumple «no queda cursores» en sign-out.
4. **P2** `sync-store.ts:87-95` — `purge()` corre fuera del Web Lock `sr-sync:<deviceId>` y `onblocked` rechaza mientras la petición de borrado sigue encolada: el borrado puede ejecutarse después de reportar fallo (perdiendo el estado de otra pestaña) y un commit entre `countUnconfirmed` (`web-sync-bridge.ts:598-602`) y el delete pierde un evento no confirmado.
5. **P2** `sync-store.ts:24` — `retryable` solo para `STORAGE_LOAD_FAILED`; el borrado bloqueado (transitorio) se reporta como `STORAGE_COMMIT_FAILED` no reintentable.
6. **P2** `sync-purge.ts:37-40` — `device_compromised` con evidencia devuelve `purge_replica_keep_outbox` sin bloquear: el outbox retenido queda descifrable en el dispositivo comprometido.
7. **P3** `sync-store.ts:314` — la rama de wipe total borra también otro scope que solo tenía cursor; y `sync-purge.test.ts:76-91` no puede distinguir el AAD con scope del chequeo de binding de `:160` (pasa aunque se quite el scope del AAD).
8. **Pruebas que faltan**: AUTH_REVOKED extremo a extremo (lock+réplica+outbox), blob cifrado en otro scope, intento real de descifrar con la clave vieja, `purge()`/`onblocked`/dos pestañas, purga durante un commit, segunda purga idempotente y purga interrumpida. Estado global: `locks` compartido entre tests (`sync-purge.test.ts:17-25`), pero cada test crea su `IDBFactory`.
9. **Deuda previa** `docs/agentic/debt.md:117-118` marca como resueltos los P2/P3 de #62 (purga, `keyVersion`, AAD): `keyVersion` y AAD sí; **purga entre pestañas sigue abierta** (hallazgo 4).
10. NO VERIFICADO: suites/lint/typecheck no ejecutadas (el brief las reserva al orquestador).

```
> Select-String -Path apps\web\src\lib\offline\*.ts,apps\web\src\components\*.tsx -Pattern "sync-purge|purgeAll|purgeForScope|rotateKey\("
sync-purge.test.ts:5: import { decideOfflinePurge, ... } from "./sync-purge.js";
sync-store.ts:329: public purgeForScope(scope: SyncScopeInput): Promise<WebSyncPurgeOutcome> {
sync-store.ts:339: public purgeAll(): Promise<WebSyncPurgeOutcome> {
(sin coincidencias en web-sync-bridge.ts ni componentes)

> git show 84d42eee:apps/web/src/lib/offline/sync-store.ts (extracto)
        if (meta.locked) throw new WebSyncStorageError("STORAGE_LOCKED");
      const deletion = this.factory.deleteDatabase(this.databaseName);
      deletion.onblocked = () => reject(new WebSyncStorageError("STORAGE_COMMIT_FAILED"));
```