I'll inspect the commit and current files, then produce the review report. But first — plan mode blocks writing the report file. Let me gather all evidence read-only.
Reporte (no pude escribir `.agents/reports/o0-rev-mobile-banner.md`: la sesión está en modo plan, solo lectura):

```text
VEREDICTO: APROBAR

P2 (previo #63/#75, sigue): la carrera openRuntime→stop está implementada (sync-banner-lifecycle.ts:60-66)
pero ninguna prueba la ejerce: onDiscard es un stub fijo (sync-banner-lifecycle.test.ts:32); borrar ese bloque deja la suite verde.
P2 (nuevo): el invariante "ningún snapshot tras desmontar" no cubre refresh/syncNow: el guard es solo por scope
(sync-banner.tsx:161), el early-return también hace setSnapshot (152-156) y syncNow refresca tras stop (206). Ninguna prueba lo toca.
P3 (previo #75, NO ERA CIERTO): sync-banner-lifecycle.ts:88 es la ruta "ready", alcanzable y cubierta por test:95 y :109; tsc y eslint verdes.
P3 (previo #63, sigue): en RN `navigator.onLine` no existe → deviceConnectivity() devuelve siempre "online"
(sync-banner.tsx:87-90) y el listener depende de window; el banner solo verá offline tras un fallo de sync. No verificable en dispositivo.
Copy: sin rutas internas ni códigos; mobile-state.test.ts asserta doesNotMatch /cobrad|pagad/ (no promete cobro offline). OK.
Pruebas: la de desmontar falla de verdad (sin el guard de :69, states=[{status:"ready"}] y revienta el assert de :54);
la de resume/locked falla si se invierte el mapeo (:68). Ganancias reales, no tautológicas.
Sin cubrir: reconnecting/degraded/sync_blocked (0 hits en las suites), open→stop/onDiscard y offline→reconnecting en el hook.
NO VERIFICADO: ejecución de la suite (escribe .test-dist, prohibido en modo plan) y dispositivo real (orquestador).
```

```text
> & node_modules\.bin\tsc.cmd --noEmit --project apps/mobile/tsconfig.json; exit=0
> & node_modules\.bin\eslint.cmd --max-warnings=0 --config eslint.config.mjs apps/mobile/src/ui/sync-banner-lifecycle.ts .test.ts; exit=0
88:       await deps.onState({ status: "ready" }, runtime, isActive);   <- git show 4bcdf03d:..lifecycle.ts
95: assert.deepEqual(states, [{ status: "ready" }]);                    <- .test.ts
128: git diff 4bcdf03d HEAD -- apps/mobile/package.json  (añade .test-dist/ui/sync-banner-lifecycle.test.js) => P2 "suite no registrada" cerrado
```