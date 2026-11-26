# Brief o0-rev-visual

NO escribas archivos fuera de tu informe `.agents/reports/o0-rev-visual-r2.md`. NO edites cÃ³digo, NO commitees, NO hagas push. NO ejecutes PostgreSQL ni Playwright. Trabaja en la raÃ­z del repo y lee con `git show` (no abrir worktrees).

## Objetivo
RevisiÃ³n de cÃ³digo del commit `81c9a2d6` (PR #76, `o0-visual-assert`, nivel A): **dos focos** en un veredicto. Este helper decide si una pantalla Â«pasaÂ» la verificaciÃ³n visual; un falso verde es peor que un rojo.

Tiempo estimado: 12 min

## QuÃ© revisar
`git show 81c9a2d6` (`apps/web/src/lib/visual-assert.ts` y `.test.ts`, `apps/web/e2e/visual/assert-ui.ts`, `apps/web/e2e/visual/offline-kds.spec.ts`). Vigente: `git show HEAD:<ruta>`.

## Foco 1 â€” invariantes del auditor
- Umbral 44Ã—44 real, sin desborde horizontal, foco visible, cero `alert/confirm/prompt`, cero errores de consola y respuestas de red â‰¥400.
- P2 previo: `offline-kds.spec.ts` no usa `expectFinalRoute`; una redirecciÃ³n a `/app` puede dejarlo en verde. Confirma con lÃ­neas del commit.
- P3 previo: el helper cuenta 404/501 de `/api/sync/*` (backend no desplegado) como fallo de red; `accessibleName` ignora `img alt`; `mkdirSync` doble. Â¿Siguen?
- Â¿El spec se omite sin `E2E_VISUAL=1` y no corre en CI (`playwright.ci.config.ts`)? Â¿Guarda capturas bajo `docs/agentic/visual-m2/`?

## Foco 2 â€” pruebas adversariales
- P3 previo: las reglas de consola/red/diÃ¡logos solo tienen el caso que falla. Â¿Falta el caso que pasa (para no dar verde por error de forma)? Nombra quÃ© prueba falta.
- Â¿Cada regla tiene un caso lÃ­mite exacto (43Ã—44 falla, 44Ã—44 pasa) y de borde (pseudo-elementos, `::before` con inset negativo)?

## Reporte
`.agents/reports/o0-rev-visual-r2.md`, mÃ¡ximo 20 lÃ­neas:
1. `VEREDICTO: APROBAR` o `VEREDICTO: CAMBIOS`.
2. Hallazgos `P1`/`P2`/`P3` con `archivo:lÃ­nea` y una frase de por quÃ©.
3. Estado de los P2/P3 previos (debt.md PR #76): cerrado / sigue / no era cierto.
4. QuÃ© no pudiste verificar (navegador real = orquestador).

