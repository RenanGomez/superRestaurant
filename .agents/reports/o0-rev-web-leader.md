VEREDICTO: CAMBIOS

P2 `sync-leader.ts:49-51,97` `await granted` sin timeout/`AbortSignal`: mientras el líder viva el seguidor nunca resuelve; la segunda pestaña no puede ni pintar su cola (P2 previo, sigue).
P2 `offline-runtime-mount.tsx:84-102` no usa `acquireSyncLeader`: hoy cada pestaña corre su propio `DeviceSyncEngine` y la exclusividad por `deviceId` no existe en producción (P2 previo, sigue). Bloquea cerrar `o0-wire`: #85 solo registró la prueba en CI, no cableó el módulo.
P2 `sync-leader.test.ts:138-174` "pestaña obsoleta: descarta el motor…" no toca `acquireSyncLeader` ni la pérdida de lock: solo prueba que `DeviceSyncEngine.enqueue` reintenta contra el almacén. La invariante del brief (pérdida→descartar motor→misma key) NO tiene prueba, y `assert.equal(retried.idempotencyKey, input.idempotencyKey)` es cierta por construcción (mismo objeto `input`).
P3 `sync-leader.ts:77` `locks.request` sin `signal`; el fake de pérdida (`test:26-38`) rechaza una promesa que Web Locks real no rechaza → limita la prueba, no la invalida (el código maneja el rechazo defensivamente).
P3 `sync-leader.ts:110-121` `release()` llama `notifyLost`: `onLost` no distingue liberación voluntaria de preempción y no hay JSDoc (P3 previo, sigue).
P3 `sync-leader.ts:38-39` sin `navigator.locks` devuelve `unavailable()`: cero líderes, no "ninguno de más" — el sync offline queda mudo sin mensaje ni doc.
P3 `sync-leader.ts:56-58,79,117` el `BroadcastChannel` anuncia `leader-claimed/released` y nadie escucha (sin `onmessage`): código muerto hoy.

Estado de los previos: P2 timeout → SIGUE; P2 "prueba no registrada en package.json" → CERRADO en HEAD por `f675b335` (#85), no por `11ce78f3`; P2 "sin consumidor productivo" → SIGUE; P3 `onLost` en `release()` no documentado → SIGUE; P3 fake de pérdida irreal → SIGUE (solo limita).

NO VERIFICADO: ejecución de `npm test`/lint/typecheck ni el test stale-tab (modo plan de solo lectura: no se genera `.test-dist`). Tampoco se escribió `.agents/reports/o0-rev-web-leader.md` por esa restricción (este informe es la entrega).

```
$ git show 11ce78f3 --stat
 apps/web/src/lib/offline/sync-leader.test.ts | 174 +++++
 apps/web/src/lib/offline/sync-leader.ts      | 124 +++++
$ git log --oneline -- apps/web/src/lib/offline/sync-leader.ts
11ce78f3 feat(web): eleccion de lider de sync entre pestanas (o0-web-leader) (#73)
$ git log --oneline -S "sync-leader.test" -- apps/web/package.json
f675b335 chore(test): cablear suites de Ola 0 y dominio (o0-wire) (#85)
$ Select-String apps/web/package.json -Pattern "sync-leader|offline"   # test script
... src/lib/offline/sync-leader.ts src/lib/offline/sync-leader.test.ts ...
 node .test-dist/lib/offline/sync-leader.test.js
$ rg "acquireSyncLeader" apps/web/src
sync-leader.ts:37 + sync-leader.test.ts:{7,60,68,89,110}; sin consumidor en components/
```