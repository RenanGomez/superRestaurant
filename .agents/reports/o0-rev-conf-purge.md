VEREDICTO: CAMBIOS
P1 apps/web/src/lib/offline/sync-store.ts:312 `purgeForScope` llama `wipeRows()` (META+slots+todas las claves) cuando el scope purgado era la única réplica y no hay outbox, aunque otro scope conserve metadatos/pullCursor; el único test de aislamiento (sync-purge.test.ts:202-224) da réplica+outbox al otro scope, así que este camino de pérdida cross-scope no tiene prueba.
P1 apps/web/src/lib/offline/sync-purge.test.ts:202 afirma "key untouched" pero sync-store.ts:259 borra la clave anterior en `reencrypt`; el test solo verifica la clave nueva (223-224) y la propia suite se contradice en 127-129 (`oldKey === undefined`). Afirmación del brief "su clave no se retiró" sin prueba que falle si se rompe.
P2 apps/web/src/lib/offline/sync-purge.ts:22 `purge_all` no vacía el outbox: `purgeAll` = `purgeReplica(()=>true)` conserva eventos (sync-store.ts:312); ninguna prueba cubre `purge_all` con outbox.
P2 apps/web/src/lib/offline/sync-store.ts:322 `retainedScopeCount` incluye el scope purgado porque `purgeForScope` no elimina `state.scopes`; ninguna aserción lo verifica.
P3 apps/web/src/lib/offline/sync-purge.test.ts:271 el segundo tramo devuelve null por desajuste de `generation` (slot inactivo 2 generaciones atrás), no por la clave retirada; no aísla la invariante.
NO VERIFICADO: no ejecuté prueba adversarial; modo plan solo-lectura prohíbe crear/ejecutar archivos. Evidencia estática (comando real):
```powershell
git show harness/o0-web-purge:apps/web/src/lib/offline/sync-store.ts | Select-String "KEYS\).delete|outbox.length === 0|wipeRows"
259: tx.objectStore(KEYS).delete([this.deviceId, meta.keyVersion]);
312: if (parsed.value.outbox.length === 0 && parsed.value.replica.length === 0) {
313: await this.wipeRows();
git show harness/o0-web-purge:apps/web/src/lib/offline/sync-purge.test.ts | Select-String "meta.keyVersion, 2|notEqual\(key|oldKey"
129: assert.equal(oldKey, undefined);
223: assert.equal(meta.keyVersion, 2);
224: assert.notEqual(key, undefined);
```