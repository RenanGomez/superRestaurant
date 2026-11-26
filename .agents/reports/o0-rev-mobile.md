VEREDICTO: APROBAR

P2 apps/mobile/package.json:13 — el test nuevo no está en el script `test`, así que `pnpm test`/CI nunca ejecuta `sync-banner-lifecycle.test.js`; el `include` lo compila pero nada lo corre hasta que `o0-wire` lo cablee. Evidencia: `git show harness/o0-mobile-banner-tests:apps/mobile/package.json | Select-String "sync-banner"` → sin coincidencias.
P2 apps/mobile/src/ui/sync-banner-lifecycle.test.ts:32 — falta la carrera más delicada: `openRuntime` que resuelve después de `stop()` debe disparar `onDiscard` (closePushGate+prepareSignOut+close). `onDiscard` sólo se stubbea (`onDiscard: () => Promise.resolve()`) y nunca se verifica; el test (a) cubre sólo la promesa de `loadHealth`, no la del open.
P3 apps/mobile/src/ui/sync-banner-lifecycle.ts:88 — el guard `if (opened === undefined) return` en la rama `ready` es inalcanzable (ready sólo se emite con runtime); Ponytail: rama muerta por hacer el parámetro opcional en ambos estados.

Alcance OK: el commit sólo toca los 4 archivos permitidos (`sync-banner.tsx`, `sync-banner-lifecycle.{ts,test.ts}`, `tsconfig.test.build.json`), sin `package.json` ni `apps/web|api`. Refactor equivalente al efecto original (mismos `closedRef`/`runtimeRef`/snapshot), textos y JSX intactos, sin `alert/confirm/prompt`.

Evidencia (log del run, leído en esta tarea, `.harness/runs/o0-mobile-banner-tests/log.txt`):
```
$ ... tsc --project tsconfig.test.build.json      # línea 209, sin errores
$ node .test-dist/ui/sync-banner-lifecycle.test.js
✔ a health result that resolves after stop never reaches onState (24.871ms)
✔ a locked store that cannot be resumed reports the lock notice (0.7187ms)
✔ a resume that does not return resumed reports the resume notice (10.5641ms)
✔ a usable store emits the normal ready state (0.9179ms)
✔ a locked store resumed for this session emits the normal ready state (1.0142ms)
✔ an open that rejects reports unavailable storage (12.689ms)
ℹ tests 6  ℹ pass 6  ℹ fail 0
```
`typecheck` (línea 200-203) y `lint` (208) corrieron sin salida de error. NO VERIFICADO por mí: re-ejecución propia de las puertas (modo plan, sin escritura); me apoyo en la salida real del log del run. El `.agents/reports/o0-mobile-banner-tests.md` dice "blocked — el motor no produjo informe (exit 1)", pero las puertas del log sí quedaron en verde.