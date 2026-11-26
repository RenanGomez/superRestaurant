# Revisión corta: PR #133 (purga de scope)

Lee el diff con `git diff main...origin/harness/o4-purge-scope` (o `git show origin/harness/o4-purge-scope:apps/web/src/lib/offline/sync-store.ts`). No escribas código, no commitees, no ejecutes nada.

Comprueba solo esto:
1. El scope purgado queda `resync_required` con `pullCursor: null` y el outbox se conserva.
2. La condición de wipe no puede borrar datos de otro scope; `purgeAll` sigue limpiando un store vacío.
3. `retainedScopeCount` cuenta scopes con réplica u outbox.
4. Las pruebas nuevas fallarían con el código anterior.

Responde en 10 líneas máximo, empezando por `VEREDICTO: APROBAR` o `VEREDICTO: CAMBIOS`, y luego los hallazgos como `P1|P2|P3 archivo:línea motivo`.
