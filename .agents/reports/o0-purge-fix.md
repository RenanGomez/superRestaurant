Let me check the current state of tests before editing.
All 13 pass already. Let me inspect the recent commit that touched these files to understand what the reviewer saw.
Now I understand the full picture. The store already wipes when no outbox remains; the gap is that the policy/store contract isn't documented and the tests don't tie `sign_out` to the storage effect. Let me make the contract explicit and add the two required tests plus the cheap P3s.
## Estado
done — `purge_all` queda documentado y probado como purga total sin evidencia / degradación a keep-outbox con evidencia; suites verdes.

## Qué hice
- Documenté en `decideOfflinePurge` que `purge_all` es una solicitud: purga total solo sin evidencia, si la hay degrada a `purge_replica_keep_outbox`.
- Documenté el mismo contrato en `purgeAll()`/`purgeReplica` (la decisión de borrado de `purgeAll` se reduce a "sin outbox retenido").
- Reescribí las dos pruebas de purga atadas a `sign_out`: (a) sin evidencia y con réplica → `wiped:true`, outbox vacío, `loadState===null`; (b) con evidencia → `wiped:false`, outbox intacto y almacén releíble.
- Añadí los P3 baratos: `lock()` sobre almacén ya en cuarentena, y `purge → persist → loadState` tras el reencrypt.

## Archivos tocados
- `apps/web/src/lib/offline/sync-purge.ts` — JSDoc de semántica de `purge_all`.
- `apps/web/src/lib/offline/sync-store.ts` — JSDoc de `purgeAll` y comentario de la condición de borrado.
- `apps/web/src/lib/offline/sync-purge.test.ts` — dos casos `sign_out` + dos pruebas P3.

## Verificación
```
$ pnpm --filter @super-restaurant/web lint
$ eslint --max-warnings=0 --config ../../eslint.config.mjs src
$ pnpm --filter @super-restaurant/web typecheck
$ tsc --noEmit --project tsconfig.json
(ambos sin errores)
```
```
✔ sign_out with financial evidence degrades purge_all to keep-outbox and keeps the store readable
✔ sign_out without financial evidence purges everything even when a replica exists
✔ lock on an already quarantined store keeps both flags without corrupting the slot
✔ a degraded purge reencrypts and a later commit still loads
ℹ tests 15  pass 15  fail 0      (sync-purge)
ℹ tests 13  pass 13  fail 0      (sync-store)
```
```
$ git diff --check        (sin salida)
$ git status --short
 M apps/web/src/lib/offline/sync-purge.test.ts
 M apps/web/src/lib/offline/sync-purge.ts
 M apps/web/src/lib/offline/sync-store.ts
```

## Riesgos / dudas
- El cableado real `decideOfflinePurge → purgeAll` es de `o0-wire`; aquí solo se garantiza el contrato del almacén. Sin commit ni push, según brief.

## Notas propuestas
- `purge_all` es intención, no garantía: el almacén nunca borra evidencia financiera retenida y degrada a `purge_replica_keep_outbox`.