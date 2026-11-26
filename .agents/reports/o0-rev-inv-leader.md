VEREDICTO: CAMBIOS
P1 apps/web/src/lib/offline/web-sync-bridge.ts:531 `release()` purga el almacén cuando solo quedan eventos `rejected`: `countUnconfirmed` usa `isTerminalState` y `TERMINAL_STATES` incluye `"rejected"` (packages/sync-engine/src/outbox-state.ts:14), aunque `canCompactOutboxEntry` prohíbe compactar financieros (outbox-state.ts:45). Se borra evidencia financiera rechazada al cerrar sesión. Prueba ausente: web-sync-bridge.test.ts:197 solo cubre `pending`; no hay caso `rejected`+`release`.
P2 apps/web/src/lib/offline/web-sync-bridge.ts:437 `commitLocalOperation` encola `input.scope` sin validarlo contra la sucursal/restaurante de la membresía montada; solo se prueba `ACTOR_MISMATCH` (test:383), ningún scope ajeno (el API revalida, de ahí P2).
P2 apps/web/src/lib/offline/web-sync-bridge.ts:413 `entityType`/`operation` del llamador sobrescriben el mapeo de `kind`; un `cash_collect` puede encolarse como entidad no financiera y evadir la retención/capability financiera; sin prueba.
P2 apps/web/src/lib/offline/web-sync-bridge.ts:223 `offlineCashUsedMinor: 0` fijo y `cashierShiftOpen: false` (218) ⇒ el tope de efectivo offline nunca se acumula ni se aplica; falta prueba del límite monetario (AGENTS §9).
P2 apps/web/src/components/offline-runtime-mount.tsx:82 `acquireSyncLeader` no se usa en producción: la elección de líder añadida no tiene efecto y varias pestañas siguen llamando `syncNow` (el brief solo pedía el módulo, pero hoy es código inerte).
P3 apps/web/src/app/api/sync/sync-proxy.ts:72 solo compara `body.scope` con la cookie; el scope por evento depende de `PUSH_SCOPE_VIOLATION` del API (ya registrado en debt.md).
NO VERIFICADO: ejecución de lint/typecheck/pruebas (modo plan de solo lectura; no se generó `.test-dist`).

```
git show harness/o0-web-leader:packages/sync-engine/src/outbox-state.ts | Select-String -SimpleMatch "TERMINAL_STATES"
export const TERMINAL_STATES: readonly OutboxState[] = Object.freeze<OutboxState[]>(["accepted", "duplicate", "rejected"]);
git grep -n "isTerminalState(entry.localState)" harness/o0-web-leader -- apps/web/src/lib/offline/web-sync-bridge.ts
harness/o0-web-leader:apps/web/src/lib/offline/web-sync-bridge.ts:531:      return outbox.filter((entry) => !isTerminalState(entry.localState)).length;
```