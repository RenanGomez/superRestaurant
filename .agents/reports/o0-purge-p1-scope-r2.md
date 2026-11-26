**Tarea:** o0-purge-p1-scope-r2 — P1 `purgeForScope` dejaba el scope `active` con su `pullCursor`.
**Estado:** REVIEW (sin commit); listo para puertas §19.6.
**Archivos:** `apps/web/src/lib/offline/sync-store.ts`, `apps/web/src/lib/offline/sync-purge.test.ts`.
**Cambios:** el scope purgado queda `status: "resync_required"` y `pullCursor: null` (se conserva para retener su outbox); `wipeRows` solo corre si no queda réplica, outbox ni cursor; `retainedScopeCount` cuenta scopes con réplica u outbox; `purgeAll` conserva su ruta.
**Pruebas nuevas (4):** outbox pendiente, dos scopes A/B, B registrado vacío con cursor, y `purgeAll` con evidencia financiera.
**Verificación (sin pnpm: el worktree no trae `node_modules`; binarios directos, como permite el brief):**
```text
node "C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\node_modules\typescript\bin\tsc" --noEmit --project apps\web\tsconfig.json  -> EXIT=0
node "C:\Users\Emmanuel G\Documents\ChatGPT\superRestaurant\node_modules\eslint\bin\eslint.js" --max-warnings=0 --config ../../eslint.config.mjs src/lib/offline/sync-store.ts src/lib/offline/sync-purge.test.ts  -> EXIT=0
node .test-dist/lib/offline/sync-purge.test.js  -> "# tests 19 / # pass 19 / # fail 0"
[git HEAD sync-store + pruebas nuevas]  -> "# pass 16 / # fail 3": 15/16 'active'/'cursor-a', 17 wiped=true
```
**Por qué fallan con el código anterior:** no reseteaba el scope (seguía `active` con `cursor-a`, tests 15/16) y el wipe de la línea 314 ignoraba el scope B, borrando su cursor (test 17); el test 18 es guarda de regresión y pasa en ambos.
**Hallazgo (no corregido, preexistente):** `reencrypt`/`rotateKey`, intactos, retiran la `keyVersion` anterior; tras un purge degradado la evidencia de la generación previa deja de ser inspeccionable para todos los scopes.
**CodeGraph:** NO VERIFICADO: este worktree no tiene `.codegraph/`; inspección manual dirigida.
**Riesgos:** ninguno; **siguiente:** el orquestador revisa y fusiona.