# Brief o0-bridge-p1-evidence

NO escribas archivos fuera del repo ni en `$env:TEMP`. NO ejecutes PostgreSQL ni Playwright. NO commitees, NO hagas push, NO instales dependencias.

## Objetivo
Cerrar un P1 real: `release()` del puente offline web borra el almacén cuando lo único que queda son eventos **rechazados financieros**, que son evidencia y no se pueden compactar.

Tiempo estimado: 20 min · Nivel A (evidencia financiera)

## Alcance (únicos archivos)
- `apps/web/src/lib/offline/web-sync-bridge.ts`
- `apps/web/src/lib/offline/web-sync-bridge.test.ts`

Prohibido: `packages/sync-engine/**`, `sync-store.ts`, `sync-purge.ts`, `package.json`.

## El fallo (verificado por revisión)
`countUnconfirmed` (`web-sync-bridge.ts:570-579`) cuenta solo `!isTerminalState(localState)`, y `TERMINAL_STATES` incluye `"rejected"` (`packages/sync-engine/src/outbox-state.ts:17`). Pero `canCompactOutboxEntry` (`outbox-state.ts:41-49`) devuelve `false` para **cualquier** entidad financiera, en cualquier estado. Resultado: un outbox con solo `cash_collect`/`payment` rechazados se considera "sin pendientes" y `release()` purga la base local (`web-sync-bridge.ts:605-614`), borrando la evidencia.

## Arreglo
1. Cambia la condición de "no hay pendientes" a "todo el outbox es compactable": un evento retiene el almacén si `canCompactOutboxEntry(entry, { olderThanMs: Number.POSITIVE_INFINITY, referencedEventIds: new Set() })` es `false`. Reutiliza el helper del motor (está exportado por `@super-restaurant/sync-engine`, `index.ts` reexporta `./outbox-state.js`); no dupliques la regla de "financiero".
2. Ajusta el JSDoc de `release()`/`retainedUnconfirmed` para que diga exactamente eso: se retiene mientras quede evidencia no compactable, incluidos rechazos financieros.
3. Pruebas nuevas en `web-sync-bridge.test.ts` (con `fake-indexeddb` como las existentes):
   - outbox con un `cash_collect` en `rejected` (y nada más) → `release()` no purga, `purged:false`, `retainedUnconfirmed:1`, y el estado sigue legible después.
   - control positivo: outbox solo con un `order` `accepted`/`duplicate` no financiero → sí purga (`purged:true`), como hoy.
   - si el helper no cubre bien el caso, añade también `order` `rejected` no financiero → purga (comportamiento actual).
4. No cambies el flujo de `commitLocalOperation` ni el de `syncNow`.

## Hecho cuando
- `pnpm --filter @super-restaurant/web run typecheck`, `lint` y `test` en 0 (puedes correrlos; `test` compila `.test-dist`).
- Las pruebas nuevas fallarían con el código anterior (dilo y demuéstralo en el reporte con la salida real).

## Reporte
`.agents/reports/o0-bridge-p1-evidence.md`: cambio, pruebas con salida real (bloque ```), y qué no verificaste. Aplica Ponytail.
