I'll review PR #133 per the instructions. Let me inspect the diff.
VEREDICTO: APROBAR

P3 apps/web/src/lib/offline/sync-purge.test.ts:386 la prueba de `purgeAll` pasa también con el código anterior (scopes.length ya era 1 y no había wipe): protege, no discrimina la regresión.
P3 apps/web/src/lib/offline/sync-store.ts:323 un scope B registrado, vacío y con `pullCursor: null` no impide el wipe al purgar A; solo se pierde su registro (sin réplica/outbox/cursor), así que "no borra datos" se cumple pero el comentario promete preservar el registro.
P3 apps/web/src/lib/offline/sync-store.ts:336 `retainedScopeCount` pasa de "scopes registrados" a "scopes con réplica u outbox" sin actualizar el contrato de la interfaz en la línea 20 (solo los tests lo consumen).

1. OK: línea 317 fija `resync_required` + `pullCursor: null` y no toca el outbox; `parseDurableState` acepta ese estado (`SCOPE_STATUSES` incluye `resync_required` y cursor null es válido, packages/sync-engine/src/durable-state.ts:15,85-95).
2. OK: guardia de 323 impide el wipe si otro scope conserva réplica, outbox o cursor; `purgeAll` (`resetScope === null`) sigue limpiando un store vacío.
3. OK: 327-336 construye el set desde réplica y outbox normalizados.
4. Tests 1-3 fallarían con el código anterior (status `active`/`cursor-a`; wipe en el caso 3); el test 4 no.

NO VERIFICADO: no ejecuté vitest, typecheck ni build (modo solo lectura); los fallos "con el código anterior" salen de leer el diff, no de una corrida.

```text
$ git diff main...origin/harness/o4-purge-scope --stat
 apps/web/src/lib/offline/sync-purge.test.ts | 80 +++++++++++++++++++++++++++++
 apps/web/src/lib/offline/sync-store.ts      | 29 ++++++++---
 2 files changed, 101 insertions(+), 8 deletions(-)

$ git show origin/harness/o4-purge-scope:apps/web/src/lib/offline/sync-store.ts | Select-String "cursorRetained|resync_required|retainedScopes"
317: : state.scopes.map((item) => resetScope(item) ? { ...item, status: "resync_required" as const, pullCursor: null } : item);
322: const cursorRetained = parsed.value.scopes.some((item) => item.pullCursor !== null);
323: if (parsed.value.outbox.length === 0 && parsed.value.replica.length === 0 && (resetScope === null || !cursorRetained)) {
327: const retainedScopes = new Set<string>();
329: retainedScopeCount: retainedScopes.size,
```