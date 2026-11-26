I'll perform this review read-only (plan mode active). Let me gather the actual branch content and the sync-engine contracts the diff depends on.
Let me read the full branch versions and the sync-engine contracts the diff relies on.
Now the sync-engine contracts (`parseDurableState`, `ReplicaEntity`, `createEmptyState`, `parseSyncScope`, `SyncScopeInput`).
Let me check the existing `sync-store.test.ts` on the branch (direct consumer) to see what's already covered and avoid false positives.
Let me pin exact line numbers on the branch for the spots I'm analyzing.
Let me quote the exact code for the two findings (real output as evidence).
VEREDICTO: CAMBIOS

P1 apps/web/src/lib/offline/sync-store.ts:314 `purgeForScope` cae en `wipeRows()` (borra META = todos los scopes, ambos slots y TODAS las claves del device) cuando la réplica del scope objetivo es la única y el outbox está vacío; así destruye cursores/estado de otros scopes. El comentario 312-313 ("purgeForScope ... nunca las borra") solo vale si el otro scope tiene réplica. Escenario: scopes=[A(cursor),B(cursor)], replica=[A], outbox=[] → purgeForScope(A) ⇒ wiped:true, loadState devuelve null (B perdido). La prueba de aislamiento (sync-purge.test.ts:206) siempre siembra outbox de ambos scopes, por lo que la rama 314 nunca se ejecuta. Ejecución runtime: NO VERIFICADO (plan mode read-only impide compilar/ejecutar).
P2 apps/web/src/lib/offline/sync-store.ts:160 el fallback AAD v1 (línea 133) no liga el scope; un slot legacy v1 reetiquetado a otro scope solo lo rechaza el post-chequeo `scopeBinding` de la 160 y ningún test lo cubre: el test de reetiquetado (sync-purge.test.ts:76) usa un slot v2 donde el mismatch AAD (152/153) ya rompe, así que borrar la línea 160 deja la suite verde. Falta prueba adversarial v1+relabel.
P3 apps/web/src/lib/offline/sync-purge.test.ts:160 no hay prueba de doble purga/idempotencia ("doble envío", que foco 2 exige) ni de `purgeForScope` con outbox ya drenado; el comportamiento parece seguro por lectura, pero no hay test ejecutable.

Evidencia (salida real, solo lectura):
```
$ git grep -n -E "outbox.length === 0|wipeRows|aadV1|scopeBinding" harness/o0-web-purge -- apps/web/src/lib/offline/sync-store.ts
sync-store.ts:44:function aadV1(...)  # v1 AAD: sr-sync-v1|device|1|key|gen  (sin scope)
sync-store.ts:160: if (typeof meta.scope === "string" && scopeBinding(parsed.value) !== meta.scope) throw "STATE_CORRUPT"
sync-store.ts:283: private async wipeRows() { tx.objectStore(META).delete(this.deviceId); ... }
sync-store.ts:314: if (parsed.value.outbox.length === 0 && parsed.value.replica.length === 0) { await this.wipeRows(); ... }
```
Prueba adversarial propuesta para P1/P2 (no ejecutada: plan mode read-only ⇒ NO VERIFICADO):
```ts
// P1: scopes=[A,B] con solo replica de A y outbox vacío
store.persist({...empty(device), scopes:[scopeState(A,"ca"), scopeState(B,"cb")],
  replica:[replicaEntity(A, "...c3")], outbox:[]});
const out = await store.purgeForScope(A);      // esperado: wiped:false y B intacto
assert.equal(await store.loadState(device) ? 1 : 0, 1); // HOY: wipe ⇒ null ⇒ falla
// P2: seedV1(scope A) + reetiquetar meta.scope=slot.scope="restB|branchB"
await assert.rejects(store.loadState(device), code("STATE_CORRUPT")); // prueba la línea 160
```
No ejecuté gates ni pruebas (plan mode read-only). Autor: revisar P1 antes de DONE.