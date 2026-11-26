Now I'll implement the fixes in `sync-store.ts`.
Now add the new tests and helpers to `sync-purge.test.ts`.
## Estado
done — los 5 hallazgos corregidos; lint, typecheck y 26 pruebas en verde.

## Qué hice
- P1 guardas: `purgeReplica`/`purgeForScope`/`purgeAll`/`rotateKey` fallan con `STORAGE_QUARANTINED`/`STORAGE_LOCKED` antes de borrar o re-cifrar; prueba con evidencia confirma slots y claves intactos en ambos estados.
- P1 aislamiento: prueba con dos scopes (`restaurantA|branchA`, `restaurantB|branchB`); tras purgar A, la réplica, outbox y clave vigente de B siguen legibles.
- P2 AAD: lectura dual `sr-sync-v1`/`sr-sync-v2`; el siguiente `commit` reescribe en v2; prueba v1→v2 sin `STATE_CORRUPT`.
- P3 rotación: se retira la clave anterior; `inspectPreviousEvidence()` devuelve `null` determinista sin cuarentena (elegida la opción de menos código, documentada y probada).
- P3 scope: `purgeForScope` compara UUID normalizados (trim+lowercase); prueba con scope en mayúsculas purga la réplica.

## Archivos tocados
- `apps/web/src/lib/offline/sync-store.ts` — AAD dual, guardas locked/quarantined y normalización.
- `apps/web/src/lib/offline/sync-purge.test.ts` — 6 pruebas nuevas.

## Verificación
```
lint/typecheck: exit 0 sin salida. `node .test-dist/lib/offline/sync-store.test.js; node .test-dist/lib/offline/sync-purge.test.js`
ℹ tests 13  ℹ pass 13  ℹ fail 0   ·   ℹ tests 13  ℹ pass 13  ℹ fail 0
```

## Riesgos / dudas
- Ninguno abierto; sin commit ni push (worktree para revisión).

## Notas propuestas
- La rotación de clave destruye a propósito la evidencia previa; solo los commits normales la conservan.