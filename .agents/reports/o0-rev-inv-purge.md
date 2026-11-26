I'll review the diff against the branch, focusing on invariants. Let me inspect the branch and the sync-engine contracts it depends on.
VEREDICTO: CAMBIOS
P1 apps/web/src/lib/offline/sync-store.ts:308 purgeForScope borra la réplica pero deja el scope `active` y su `pullCursor` intactos (solo filtra `replica`; retorna retainedScopeCount=scopes.length sin tocar scopes ni cursor), así que tras sign_out/auth_revoked el device sigue sincronizando un tenant del que salió y un pull incremental desde el cursor viejo nunca re-trae entidades sin cambios → réplica incompleta. Sin prueba: sync-purge.test.ts:202 no afirma nada sobre scopes/pullCursor/resync_required. Comprobado leyendo packages/sync-engine/src/durable-state.ts:79-95,234-246 (acepta cualquier cursor y exige el scope en `scopes` para retener outbox: por eso hay que marcar `resync_required`/cursor null, no borrar el scope).
P2 apps/web/src/lib/offline/sync-store.ts:259 reencrypt borra la clave compartida `meta.keyVersion`; purgeForScope rota la clave de todo el device, así el slot inactivo (generación previa) del scope NO purgado queda indescifrable. El test :202 ("evidence and key untouched") hace un solo persist y afirma la clave NUEVA (keyVersion 2, :223), no que la evidencia previa del otro scope sobreviva.
P2 apps/web/src/lib/offline/sync-store.ts:312 la condición de wipe ignora `scopes`: si el otro scope tiene réplica+outbox vacíos pero cursor vivo, purgeForScope(A) llama wipeRows y borra el scope/cursor ajeno. No cubierto (el test de dos scopes da a B réplica+outbox).
P2 apps/web/src/lib/offline/sync-store.ts:300-333 purgeAll/purgeForScope/rotateKey no persisten auditoría (actor, motivo, timestamp, device) ni guardan el `reason` de decideOfflinePurge; sin prueba (AGENTS 8/10).
SIN HALLAZGO dinero/enteros: el diff no calcula importes ni cantidades (solo cifra JSON); idempotencia preservada: outbox se re-cifra verbatim y parseDurableState exige idempotencyKey única por scope (test :114/:287 deepEqual outbox).
Verificación (comandos reales, salida recortada):
```
$ git grep -n -E "leaves the other scope|meta.keyVersion" harness/o0-web-purge -- apps/web/src/lib/offline/sync-purge.test.ts
:202:test("purgeForScope leaves the other scope replica, evidence and key untouched", async () => {
:223:  assert.equal(meta.keyVersion, 2);
$ git show harness/o0-web-purge:apps/web/src/lib/offline/sync-store.ts (numerado) | Select-Object -Skip 243 -First 92
257:      tx.objectStore(SLOTS).put({ ciphertext, iv, generation, keyVersion, scope: binding } satisfies Slot, [this.deviceId, current.activeSlot]);
259:      tx.objectStore(KEYS).delete([this.deviceId, meta.keyVersion]);
308:        const replica = state.replica.filter((entity) => !shouldRemove(entity));
312:        if (parsed.value.outbox.length === 0 && parsed.value.replica.length === 0) {
```
NO VERIFICADO: ejecución de la suite de tests (modo read-only; compilar `.test-dist` escribiría archivos).