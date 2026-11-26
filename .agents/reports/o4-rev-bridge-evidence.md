I'll review the PR diff as instructed.
VEREDICTO: APROBAR

1. OK — `countUnconfirmed` retiene toda entrada financiera en cualquier estado y toda entrada no terminal, delegando en el motor (`web-sync-bridge.ts:594`).
2. OK — sigue purgando con terminales no financieras: `accepted`, `duplicate` y `rejected` no financieras cumplen `canCompactOutboxEntry` (no financiera + terminal + `updatedAt <= Infinity`).
3. OK — lectura fallida devuelve `-1`, no entra en `unconfirmed === 0`, no purga y cierra el almacén (`web-sync-bridge.ts:596,650`).
P3 `apps/web/src/lib/offline/web-sync-bridge.test.ts:300,326` — solo la prueba del `cash_collect` rechazado (`:268`) fallaría con el código anterior; las dos de `order` terminal (`accepted`/`rejected`) ya pasaban con el viejo `!isTerminalState`, así que no demuestran la corrección, solo evitan regresión.
P3 `apps/web/src/lib/offline/web-sync-bridge.ts:650` — con fallo de lectura (`-1`) el resultado informa `retainedUnconfirmed: 0` aunque el estado es desconocido; comportamiento previo, informativo.

```powershell
> git show origin/harness/o4-bridge-evidence:packages/sync-engine/src/outbox-state.ts
  if (isSyncFinancialEntityTypeV1(entry.entityType)) return false;
  if (!isTerminalState(entry.localState)) return false;
  if (entry.updatedAt > context.olderThanMs) return false;
> git show origin/harness/o4-bridge-evidence:packages/shared-types/src/sync.ts
  Payment: catalogEntry("Payment", ["create", "compensate"], true, false, true),
> git show origin/harness/o4-bridge-evidence:apps/web/src/lib/offline/web-sync-bridge.ts | Select-String "canCompactOutboxEntry|return -1"
594: return outbox.filter((entry) => !canCompactOutboxEntry(entry, RELEASE_COMPACTION_CONTEXT)).length;
596: return -1;
```