# Brief o0-wire (nivel B · cableado Ola 0)

## Objetivo
Registrar en los scripts de test las suites nuevas de la Ola 0, manteniendo el patrón existente de compilación y ejecución.

Tiempo estimado: 10 min. Requiere que las cuatro tareas previas estén fusionadas en tu worktree (el orquestador te da la rama base).

## Alcance
- Edita SOLO: `apps/web/package.json`, `apps/mobile/package.json`.
- Prohibido: cambiar versiones o dependencias, tocar código fuente de producto, `pnpm-lock.yaml`, migraciones. Sin `git push`.
- Temporales en `.harness/state/tmp/`; bórralos al terminar.

## Contexto exacto
- `apps/web/package.json` → `scripts.test` ya termina con un bloque `tsc --ignoreConfig ... src/lib/sync-ui.ts src/lib/offline/sync-store.ts ... && node .test-dist/lib/offline/sync-store.test.js && ... && rmSync('.test-dist')`. Sigue **ese mismo patrón**: añade al `tsc --ignoreConfig` los archivos nuevos y sus `node .test-dist/...` en el orden correcto, antes de la limpieza final:
  - `src/lib/offline/sync-leader.ts`, `src/lib/offline/sync-leader.test.ts` → `node .test-dist/lib/offline/sync-leader.test.js`
  - `src/lib/offline/sync-purge.ts`, `src/lib/offline/sync-purge.test.ts` → `node .test-dist/lib/offline/sync-purge.test.js`
  - `src/lib/visual-assert.ts`, `src/lib/visual-assert.test.ts` → `node .test-dist/lib/visual-assert.test.js`
- `apps/mobile/package.json` → `scripts.test` encadena `node .test-dist/...test.js`; añade `node .test-dist/ui/sync-banner-lifecycle.test.js` en el lugar que corresponda (después de las suites de `offline/`).
- `apps/mobile/tsconfig.test.build.json` ya lo ajustó `o0-mobile-banner-tests`: no lo toques.

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # debe imprimir v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/shared-types build
& $PNPM --filter @super-restaurant/sync-engine build
& $PNPM --filter @super-restaurant/web test
& $PNPM --filter @super-restaurant/mobile test
```

## Hecho cuando
- Ambas suites completas en verde y las cuatro suites nuevas aparecen ejecutadas en la salida real.
- `git diff --check` en verde.

## Cierre
- **No hagas commit ni push**: el orquestador revisa y fusiona desde tu worktree.
- Tu respuesta final ES el informe, con los dos bloques de comando y salida real (basta el resumen final de cada suite). Sin evidencia = NO VERIFICADO.
- Aplica Ponytail: cambio más pequeño correcto, sin tocar nada más.
