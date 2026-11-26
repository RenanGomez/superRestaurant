I'll start by reading the operational files and the diff stats.
VEREDICTO: APROBAR
Alcance real de o0-web-leader: `8a49a619` toca solo `sync-leader.ts` + `.test.ts` (298 líneas); el resto del rango ya estaba en main (#70/#71/#72). Sin P1: las 4 invariantes del brief tienen prueba ejecutable y pasan.

P2 apps/web/src/lib/offline/sync-leader.ts:97 sin timeout/AbortSignal: un seguidor queda pendiente indefinidamente mientras el líder viva (mi S1: `b.pending=true`). Si o0-wire hace `await acquireSyncLeader` antes de registrar puertos, la 2.ª pestaña nunca pinta su cola; un líder en background conserva el lock aunque sus timers estén throttled, así que el relevo no ocurre.
P2 apps/web/src/lib/offline/sync-leader.test.ts:1 no figura en el script `test` de apps/web/package.json:13 (`sync-store/bridge/sync-proxy` sí): las 4 pruebas no corren en CI hoy; solo la puerta manual del brief las ejecutó (`tests 4/pass 4/fail 0` en `.harness/runs/o0-web-leader/log.txt`). Diferido a o0-wire según brief:39.
P3 apps/web/src/lib/offline/sync-leader.ts:110 `onLost` se dispara también en `release()` voluntario (mi S2: `lost=1`), así que el consumidor no distingue liberación de preempción; el test lo asume, pero no está documentado en la API.
P3 apps/web/src/lib/offline/sync-leader.test.ts:42 el fake de pérdida (`request` invoca el callback y luego rechaza) modela un modo que Web Locks real no produce sin `signal`; el modo real (documento destruido) no estaba cubierto (mi S4 lo cubre y pasa).
P3 apps/web/src/lib/offline/sync-leader.ts:37 sin consumidor productivo (`git grep` solo devuelve el propio archivo y el test); `offline-runtime-mount.tsx` no lo usa, así que "líder entre pestañas" aún no tiene efecto en runtime.

Verificación (comandos exactos + salida real; harness in-memory, sin escribir archivos):
```
$ node -e "<base64<script: ts.transpileModule(git show harness/o0-web-leader:apps/web/src/lib/offline/sync-leader.ts) + tramas S1-S6>"
S1 followers-blocked-while-leader: PASS (b.pending=true)
S2 voluntary-release-fires-onLost: PASS (lost=1, a.isLeader=false, b.isLeader=true)
S3 relay-chain-3-tabs-single-leader: PASS (h3.isLeader=true)
S4 leader-torn-down-promotes-follower: a.lost=1 a.isLeader=false b.isLeader=true
S5 throwing-onLost-isolated: secondCallbackRan=true isLeader=false
S6 per-device-scope: d1.isLeader=true d2.isLeader=true
```
NO VERIFICADO: no ejecuté la suite web completa ni el test stale-tab de `sync-leader.test.ts` (requiere `fake-indexeddb` + build de packages y Node 24); foco limitado a `sync-leader`. Doble envío/pérdida/relevo cubiertos arriba; AAD de otro scope ya está cubierto por `sync-store.test.ts` (cross-device → `STATE_CORRUPT`/`DEVICE_MISMATCH`).