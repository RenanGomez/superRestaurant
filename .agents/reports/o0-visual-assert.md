## Estado
done — helper puro, 17 pruebas y adaptador/spec visual creados; puertas verdes.

## Qué hice
- `visual-assert.ts`: `findViolations`/`assertVisualSnapshot`, 7 reglas y `MIN_TARGET_PX=44`.
- `visual-assert.test.ts`: 17 casos (incluye control 44×43 que falla); `assert-ui.ts` con consola, HTTP ≥400, diálogos, foco y captura; spec `@offline-visual` en `/app/sync` a 1280×800 y 390×844.

## Archivos tocados
- `apps/web/src/lib/visual-assert.ts`, `apps/web/src/lib/visual-assert.test.ts`, `apps/web/e2e/visual/assert-ui.ts`, `apps/web/e2e/visual/offline-kds.spec.ts` (nuevos).

## Verificación
```powershell
node .\apps\web\.test-dist\lib\visual-assert.test.js  →  ℹ tests 17 | ℹ pass 17 | ℹ fail 0
lint / typecheck / e2e:typecheck  →  lint_exit=0, e2e_typecheck_exit=0; whitespace check sin avisos
```

## Riesgos / dudas
- NO VERIFICADO: el spec no se ejecutó (requiere `E2E_VISUAL=1` y entorno local); usé `/app/sync` porque `apps/kds` no está cubierto por Playwright de web.

## Notas propuestas
- ninguna.