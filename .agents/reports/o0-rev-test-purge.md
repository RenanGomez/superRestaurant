VEREDICTO: CAMBIOS

P1 apps/web/src/lib/offline/sync-purge.ts:22 `sign_out` sin evidencia decide `purge_all`, pero `sync-store.ts:332 purgeAll()` conserva el outbox (la propia prueba `sync-purge.test.ts:137-141` afirma `wiped:false` y `retainedOutboxCount:1`): el `purge_all` nunca purga todo y no hay prueba que conecte la decisión con un borrado real.
P2 apps/web/package.json:13 `decideOfflinePurge` no tiene ningún consumidor de producción (`git grep` solo lo halla en su test y su definición), así que la invariante «revocación de dispositivo con evidencia → lock_and_keep» solo está probada como función pura, nunca aplicada al `store.lock()`.
P2 apps/web/package.json:13 (y `tsconfig.test.build.json`) no incluyen `src/lib/offline/sync-purge.ts` ni `sync-purge.test.ts` en el tsc/paso Node offline; los 14 tests nuevos no se ejecutan en `pnpm test`/CI y se pudren sin avisar.
P3 apps/web/src/lib/offline/sync-store.ts:104 `lock()` sobre un almacén ya en cuarentena deja `locked+quarantined` sin prueba; y no hay test de que `purge→persist→loadState` siga leyendo tras el `reencrypt` que sobrescribe el slot activo.
P3 apps/web/src/lib/offline/sync-purge.test.ts:122 el caso AAD de otro scope relabela meta y slot de forma consistente; no cubre copiar un slot válido del scope B con `meta.scope=A` (guard `sync-store.ts:143`), que es el ataque descrito.

Evidencia ejecutada (plan mode impide escribir `.test-dist`, así que no pude compilar/ejecutar la prueba adversarial propia):
```
> git grep -n "decideOfflinePurge" harness/o0-web-purge -- apps/web/src
harness/o0-web-purge:apps/web/src/lib/offline/sync-purge.test.ts:5:import { decideOfflinePurge ...
harness/o0-web-purge:apps/web/src/lib/offline/sync-purge.test.ts:68:    const decision = decideOfflinePurge(input);
harness/o0-web-purge:apps/web/src/lib/offline/sync-purge.ts:17:export function decideOfflinePurge(input: OfflinePurgeInput): OfflinePurgeDecision {
> git grep -n "sync-purge" harness/o0-web-purge -- apps/web/package.json apps/web/tsconfig.test.build.json
(0 coincidencias)
```
NO VERIFICADO: la prueba adversarial ejecutada y su salida real; plan mode es solo lectura y el gate del brief requiere escribir `.test-dist`/temporal. Comando previsto: `tsc --ignoreConfig ... src/lib/offline/sync-store.ts src/lib/offline/sync-purge.test.ts && node .test-dist/lib/offline/sync-purge.test.js`.