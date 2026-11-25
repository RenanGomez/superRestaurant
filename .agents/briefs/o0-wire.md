# Brief o0-wire (nivel B · cableado de la Ola 0)

## Objetivo
Registrar en los scripts de test las suites nuevas de la Ola 0 y del dominio de inventario, sin cambiar comportamiento.

Tiempo estimado: 15 min. Tu worktree ya contiene todas las ramas fusionadas (`sync-leader`, `sync-purge`, `visual-assert`, `sync-banner-lifecycle`, `units`, `stock-ledger`, `recipe-explosion`).

## Alcance
- Edita SOLO: `apps/web/package.json`, `apps/mobile/package.json`, `packages/domain/package.json`.
- Prohibido: cambiar versiones/dependencias, `pnpm-lock.yaml`, código de producto, migraciones. Sin commit ni push.

## Qué hacer
### `apps/web/package.json` → `scripts.test`
Sigue el bloque `tsc --ignoreConfig ... && node .test-dist/...` existente. Añade, antes de la limpieza final:
- `src/lib/offline/sync-leader.ts`, `src/lib/offline/sync-leader.test.ts` → `node .test-dist/lib/offline/sync-leader.test.js`
- `src/lib/offline/sync-purge.ts`, `src/lib/offline/sync-purge.test.ts` → `node .test-dist/lib/offline/sync-purge.test.js`
- `src/lib/visual-assert.ts`, `src/lib/visual-assert.test.ts` → `node .test-dist/lib/visual-assert.test.js`
- `src/lib/offline/web-sync-bridge.ts`, `src/lib/offline/web-sync-bridge.test.ts` → `node --import ./test/proxy-esm-loader.mjs .test-dist/lib/offline/web-sync-bridge.test.js` (comprueba si necesita el proxy loader igual que `offline-pos.test.js`; móntalo como el resto del bloque)

### `apps/mobile/package.json` → `scripts.test`
- Añade `node .test-dist/ui/sync-banner-lifecycle.test.js` tras las suites de `offline/`.

### `packages/domain/package.json` → `scripts.test`
- Añade antes de la limpieza: `node .test-dist/inventory/units.test.js`, `stock-ledger.test.js`, `recipe-explosion.test.js` (en ese orden).

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/shared-types build
& $PNPM --filter @super-restaurant/sync-engine build
& $PNPM --filter @super-restaurant/domain build
& $PNPM --filter @super-restaurant/web test
& $PNPM --filter @super-restaurant/mobile test
& $PNPM --filter @super-restaurant/domain test
```

## Hecho cuando
Las tres suites completas en verde y las suites nuevas visibles en la salida real; `git diff --check` limpio.

## Cierre
No hagas commit ni push. Tu respuesta final ES el informe con el resumen final de cada suite (bloque con comando + salida real).
Aplica Ponytail: solo el cableado.
