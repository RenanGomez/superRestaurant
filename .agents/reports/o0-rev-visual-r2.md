VEREDICTO: CAMBIOS

1. `P2` `apps/web/e2e/visual/offline-kds.spec.ts:27-32` — sigue sin `expectFinalRoute`/`assertBranchState` (otros specs sí los usan, p. ej. `offline.spec.ts:26`): una redirección de `/app/sync` a `/app` (o cualquier ruta ≠ `/login`) deja el caso en verde. Es el falso verde que el auditor debía cerrar.
2. `P3` `offline-kds.spec.ts:30-31` — `networkidle` se traga el timeout (`.catch`) y el único ancla es `main` visible; puede fotografiar un shell de carga/error y pasar.
3. `P3` `apps/web/e2e/visual/assert-ui.ts:63` — todo `status() >= 400` cuenta como fallo de red, incluidos 404/501 de `/api/sync/*` (backend sin desplegar).
4. `P3` `assert-ui.ts:83-119` — `accessibleName` no lee `img alt`; un botón/enlace con solo `<img alt="…">` da nombre vacío (falso rojo).
5. `P3` `assert-ui.ts:208-210` — `mkdirSync(directory)` y luego `mkdirSync(dirname(screenshotPath))` sobre el mismo directorio: redundante, sigue.
6. `P3` `assert-ui.ts:156-159` + `visual-assert.ts:132-146` — `focus-visible` examina solo el primer Tab; si ese control tiene outline, los demás pueden carecer de foco visible y pasa. Además, una página sin controles enfocables siempre falla (falso rojo).
7. `P3` `visual-assert.ts:42-50` + `assert-ui.ts:150-152` — insets no-`px` (`rem`, `%`, `calc` puro) se leen como 0, y no se comprueba que el control sea el bloque contenedor del `::before` absoluto (deuda `docs/agentic/debt.md:172`): un pseudo anclado a un ancestro puede dar por bueno un target pequeño.
8. `P3` tests `apps/web/src/lib/visual-assert.test.ts` — límite probado solo en alto (43 px, línea 66), no en ancho; consola/red/diálogos solo tienen el caso que falla (el pase existe únicamente en el agregado de línea 53); sin caso de inset no-`px`, sin `::after` directo en `insetsFromPseudo` ni de bloque contenedor. Faltan: «acepta 44×43 / falla 43×44», «acepta consoleErrors/networkFailures/dialogCalls vacíos por regla», «inset `-0.75rem` no expande», «::after con -12px expande», «control static con ::before absoluto no expande».
9. Invariantes sí presentes: umbral 44×44 (`visual-assert.ts:1,155`), desborde (`:169`), foco (`:188`), diálogos y consola (`assert-ui.ts:57-78`); capturas en `docs/agentic/visual-m2` (`:44`) y el spec se omite sin `E2E_VISUAL` (`offline-kds.spec.ts:10`) y no corre en CI (`playwright.ci.config.ts` usa `testMatch: "ci-smoke.spec.ts"`). Unitarias sí corren en `pnpm test` (CI `run: pnpm test`).
10. Estado P2/P3 previos: P2 ruta → **sigue**; 404/501 sync → **sigue**; `img alt` → **sigue**; doble `mkdirSync` → **sigue**; caso que pasa de consola/red/diálogos → **parcial** (solo agregado); bloque contenedor del pseudo (debt:172) → **sigue**.
11. NO VERIFICADO: navegador real, capturas, y si `/app/sync` redirige hoy (orquestador).

```text
$ git grep -n "expectFinalRoute" HEAD -- apps/web/e2e/visual
(no output)
$ git show HEAD:apps/web/playwright.ci.config.ts | Select-String -Pattern 'testMatch'
  testMatch: "ci-smoke.spec.ts",
$ git show HEAD:apps/web/e2e/visual/offline-kds.spec.ts | Select-String -Pattern 'test\.skip|page\.goto'
10: test.skip(!process.env.E2E_VISUAL, "requiere E2E_VISUAL=1 y entorno local");
27: await page.goto(KDS_OFFLINE_ROUTE);
```