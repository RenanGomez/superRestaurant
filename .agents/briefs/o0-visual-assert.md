# Brief o0-visual-assert (nivel C · verificación visual sin visión)

## Objetivo
Crear el helper de aserciones visuales de §5.3 del plan (sin interpretar capturas) y un spec Playwright que lo aplique al KDS offline en 1280×800 y 390×844.

Tiempo estimado: 25 min.

## Alcance
- Crea SOLO: `apps/web/src/lib/visual-assert.ts`, `apps/web/src/lib/visual-assert.test.ts`, `apps/web/e2e/visual/assert-ui.ts`, `apps/web/e2e/visual/offline-kds.spec.ts`.
- Prohibido: tocar `apps/web/package.json` (lo cablea `o0-wire`), `playwright.ci.config.ts`, `playwright.config.ts`, apps de producto, migraciones, dependencias. Sin `git push`.
- Temporales en `.harness/state/tmp/`; bórralos al terminar.

## Contexto y firmas reales
- `apps/web/playwright.config.ts`: `testDir: "./e2e"`, proyectos `desktop` (1366×800, `grepInvert: /@offline/`), `mobile` (Pixel 7) y `offline` (`grep: /@offline/`).
- `.github/workflows/ci.yml` usa `playwright.ci.config.ts`, que **no** incluye tus specs: no rompes CI, pero tampoco corren allí.
- `apps/web/e2e/helpers.ts` y `apps/web/e2e/offline.spec.ts` muestran el estilo local (imports de `@playwright/test`, etiquetas `@offline`).
- Tests unitarios web: patrón `tsc --ignoreConfig ... src/lib/x.ts src/lib/x.test.ts && node .test-dist/lib/x.test.js`.

## Qué construir
1. `apps/web/src/lib/visual-assert.ts` — puro, sin Playwright, con tipos propios:
   - `MIN_TARGET_PX = 44`.
   - `findViolations(input: VisualSnapshot): VisualViolation[]` donde `VisualSnapshot` describe: `viewportWidth/Height`, `scrollWidth`, controles `{ name, width, height, visible }`, `consoleErrors: string[]`, `networkFailures: string[]`, `dialogCalls: string[]`, `focusedOutline: string | null`.
   - Reglas: caja ≥ 44×44 para todo control visible; nombre accesible no vacío; `scrollWidth <= viewportWidth`; cero errores de consola; cero fallos de red; cero llamadas a `alert/confirm/prompt`; foco visible (`outline` o `box-shadow` distinto de `none`).
   - `assertVisualSnapshot(snapshot)` que lanza `Error` con la lista legible de violaciones.
2. `apps/web/src/lib/visual-assert.test.ts` (`node:test`): un caso por regla (pasa y falla), incluido un control de 43 px que debe fallar.
3. `apps/web/e2e/visual/assert-ui.ts`: adaptador con Playwright que toma el snapshot real de la página (controles, overflow, consola, respuestas ≥ 400, diálogos interceptados con `page.on("dialog")`, foco) y llama a `assertVisualSnapshot`. Expone `assertVisualUi(page, label)` con captura en `docs/agentic/visual-m2/<label>-<ancho>.png`.
4. `apps/web/e2e/visual/offline-kds.spec.ts`: etiqueta `@offline-visual`, `test.skip(!process.env.E2E_VISUAL, "requiere E2E_VISUAL=1 y entorno local")`, dos `test.describe` (1280×800 y 390×844) que navegan a la ruta KDS offline existente y aplican `assertVisualUi`. No inventes rutas: usa las de `apps/kds` o `/app/sync` ya cubiertas por `e2e/offline.spec.ts`.

## Puertas (obligatorio, Node 24.19.0)
```powershell
. .\tools\agentic\use-node24.ps1
node -v   # debe imprimir v24.19.0
$PNPM = "C:\Users\Emmanuel G\AppData\Local\Programs\node24\pnpm.CMD"
& $PNPM --filter @super-restaurant/web lint
& $PNPM --filter @super-restaurant/web typecheck
& $PNPM --filter @super-restaurant/web e2e:typecheck
& $PNPM --filter @super-restaurant/web exec tsc --ignoreConfig --target ES2024 --module ESNext --moduleResolution Bundler --lib ES2024,DOM --types node --outDir .test-dist --rootDir src --strict --skipLibCheck src/lib/visual-assert.ts src/lib/visual-assert.test.ts
node .test-dist/lib/visual-assert.test.js
```
No uses el `pnpm` del PATH (es Node 22). No ejecutes Playwright: el spec se omite sin `E2E_VISUAL`.

## Hecho cuando
- Cada regla tiene prueba que falla si se rompe, con salida real pegada.
- `lint`, `typecheck`, `e2e:typecheck` y `git diff --check` en verde.

## Cierre
- **No hagas commit ni push**: el orquestador revisa y fusiona desde tu worktree.
- Tu respuesta final ES el informe, con bloques comando + salida real. Sin evidencia = NO VERIFICADO.
- Aplica Ponytail: cambio más pequeño correcto, reutiliza lo existente, sin recortar validación ni pruebas.
