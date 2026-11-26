I'll review the branch as instructed. Let me start by inspecting the diff scope.
VEREDICTO: APROBAR
P2 apps/web/e2e/visual/offline-kds.spec.ts:27-29 falta `expectFinalRoute`; `/app/sync` puede redirigir a `/app` (page.tsx:27 `redirect("/app")`, :37 `redirect("/app?branchError=not_authorized")`) y solo se descarta `/login` (helpers.expectAuthenticated), así que el test puede quedar verde sin verificar la pantalla offline-sync. Prueba: offline.spec.ts:26 sí llama `expectFinalRoute`.
P3 apps/web/e2e/visual/assert-ui.ts:41 registra todo HTTP≥400, incluido 404/501 de `/api/sync/*` cuando el backend no está desplegado (server-fetch.ts mapea 404/501 a `not_deployed`); el gate puede fallar por backend y no por UI. NO VERIFICADO en ejecución.
P3 apps/web/e2e/visual/assert-ui.ts:95 `accessibleName` cae a `textContent`/`title`; controles icon-only cuyo nombre sale de `<img alt>` se reportan sin nombre (falso positivo de accessible-name).
P3 apps/web/e2e/visual/assert-ui.ts:149-151 doble `mkdirSync` y `resolve(dirname(...))` redundantes sobre `CAPTURE_DIR` ya creado (Ponytail).
P3 apps/web/src/lib/visual-assert.test.ts:128-166 console-error/network-failure/native-dialog solo tienen caso que falla; el caso "pasa" queda implícito en el snapshot base, no explícito por regla.
P3 apps/web/e2e/visual/offline-kds.spec.ts:8 el brief afirma que `/app/sync` "ya cubierta por e2e/offline.spec.ts", pero `APP_ROUTES` (routes.ts) no la incluye; la ruta sí existe en `src/app/app/sync/page.tsx`, no es inventada. Premisa del brief incorrecta.
Alcance: el commit 8a84b733 solo toca los 4 archivos permitidos; el rango 182fbb6c... incluye además los PR #70/#71/#72 ya integrados, ajenos a este brief. Sin `alert/confirm/prompt` en los 4 archivos (grep vacío).
```powershell
git show 8a84b733 --stat
 apps/web/e2e/visual/assert-ui.ts        | 154 ++++
 apps/web/e2e/visual/offline-kds.spec.ts |  35 ++
 apps/web/src/lib/visual-assert.test.ts  | 143 ++++
 apps/web/src/lib/visual-assert.ts       | 110 ++++
 4 files changed, 442 insertions(+)
git show 8a84b733:apps/web/src/app/app/sync/page.tsx | Select-String "redirect\("
22: redirect("/login");  27: redirect("/app");  37: redirect("/app?branchError=not_authorized");
git show 8a84b733:apps/web/e2e/routes.ts | Select-String "/app/sync"   # (sin salida: no está en APP_ROUTES)
```
NO VERIFICADO: no ejecuté lint/typecheck/e2e del árbol de la rama (modo solo-lectura impide crear `.test-dist`) ni Playwright (requiere `E2E_VISUAL=1` y entorno local); las puertas verdes son solo las reportadas por el implementador en `.agents/reports/o0-visual-assert.md`.