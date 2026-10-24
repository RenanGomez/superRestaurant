# web-e2e-harness-r3 · carrera al confirmar sucursal y rutas sin autorización

## Tarea
web-e2e-harness-r3 · capa L1 `implementer-claude` · nivel C (sólo `apps/web/e2e/**`) · riesgo bajo. Rama `claude/web-e2e-harness-r3` desde `main`.

## Hallazgos de la tercera corrida real (2026-10-22, desktop, 5 fallos de 25)
1. **Carrera en `ensureBranchSelected`**: en `/app/deliveries` y `/app/capture` el conteo dio exactamente 12 y la instantánea de la página muestra otra vez «Elige tu sucursal» (deliveries) o la pantalla de Mesas (capture). Tras pulsar «Confirmar sucursal», el helper vuelve a la ruta antes de que el servidor haya fijado la cookie de sucursal, o la navegación de vuelta no se espera bien. Las demás rutas sí funcionaron (Mesas 18, Menú 104, Órdenes 24, Zonas 23).
2. **`/app/system-admin/restaurants` con una cuenta sin rol global** muestra sólo un `alert`: «No tienes autorización de administrador global o el servicio no está disponible.» y 10 elementos; la guarda `> 12` lo marca como fallo, pero es el estado esperado para esa cuenta.
3. `/app/menu` falló por un bug real de producto (`CSS is not defined` en SSR), que se arregla en otro paquete; no tocar.

## Cambios
1. `e2e/helpers.ts` → `ensureBranchSelected`: tras pulsar «Confirmar sucursal», esperar explícitamente a `page.waitForURL` (cualquier URL) **y** a que `nav[aria-label="Navegación principal"]` contenga el texto «Sucursal activa» (`getByText(/Sucursal activa/)` visible, timeout 15 s) antes de `goto(path)`. Tras el `goto`, si vuelve a aparecer «Elige tu sucursal», reintentar una vez; si persiste, lanzar `Error("Sin sucursal: la selección no persistió tras confirmar")`. Devolver `{ selected: boolean, branchLabel: string | null }` para el resumen.
2. `e2e/helpers.ts` → nueva `detectUnauthorized(page)`: devuelve el texto si `main` contiene un `[role="alert"]` cuyo texto empiece por «No tienes autorización». En `smoke.spec.ts` y `dom-exhaustive.spec.ts`, si lo devuelve, marcar `testInfo.annotations.push({ type: "sin-autorizacion", description: texto })`, registrar en consola `[dom] <ruta>: sin autorización para esta cuenta` y terminar el test con `test.skip(true, texto)` (sin fallar y sin contar como cobertura). La guarda `> 12` se mantiene para el resto.
3. `e2e/dom-exhaustive.spec.ts`: el conteo inicial debe hacerse **después** de que el `main` tenga contenido: esperar a `page.locator("main").first()` visible y a `networkidle`; si `found <= 12`, esperar 2 s más y volver a contar una vez antes de fallar (evita falsos negativos por hidratación lenta).
4. `e2e/README.md`: una línea sobre la anotación «sin-autorizacion».

## Invariantes
Sin tocar `src/`. LF. Sin `any`. No pulsar nada destructivo nuevo.

## Verificación (Node 24 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; pnpm vía `node "<node24>\node_modules\corepack\dist\pnpm.js"`; servidores locales ya arriba en 8082/3000, no reiniciarlos; copiar `apps/web/playwright/.auth/user.json` del checkout principal a la misma ruta del worktree para verificar y borrarlo al terminar)
- `pnpm --filter @super-restaurant/web e2e:typecheck`
- `pnpm --filter @super-restaurant/web exec playwright test --project desktop --grep "Entregas|Captura|Administración"` → Entregas y Captura pasan con `encontrados` > 12 (pegar las líneas `[dom]`); Administración queda `skipped` con la anotación.
- Repetir el comando anterior una segunda vez para comprobar que no es intermitente.

## Formato de salida esperado
Resumen, archivos, salida literal, riesgos. Commit local con conventional commit. Sin merge ni push.
