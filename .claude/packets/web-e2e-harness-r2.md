# web-e2e-harness-r2 · selección de sucursal, guardas de cobertura vacía y ruido de Next

## Tarea
web-e2e-harness-r2 · capa L1 `implementer-claude` · nivel C (sólo `apps/web/e2e/**` y `apps/web/playwright.config.ts`) · riesgo bajo. Rama `claude/web-e2e-harness-r2` desde `main`.

## Hallazgos de las dos primeras corridas reales (2026-10-22, proyecto desktop, 25 tests verdes)
1. Con sesión de una cuenta con membresía, `/app` muestra «Elige tu sucursal» con un radio `input[name="scope"]` por sucursal (ej. «Vittorinos Pizza · Sucursal Navojoa manager») y un botón «Confirmar sucursal» (server action; guarda la preferencia en cookie). Todas las rutas `/app/*` redirigen a `/app` hasta confirmar. `save-auth.ts` guardaba la sesión al llegar a `/app`, antes de confirmar, así que la cookie de sucursal no quedó en `user.json`.
2. `dom-exhaustive` saltó «Confirmar sucursal» por el verbo «confirmar» de `DESTRUCTIVE`, y por eso cada ruta sólo encontró ~12 elementos (la barra de navegación + el selector). Un smoke verde con cobertura vacía es engañoso.
3. Con la cuenta administradora sin membresías, `/app` muestra «Sin sucursales asignadas» y también todo pasó en verde.
4. El crawl pulsa «Open Next.js Dev Tools» (botón del indicador de Next en dev), que no es de la app.

## Cambios
1. `e2e/save-auth.ts`: tras llegar a `/app`, esperar a que desaparezca el selector: si existe `text=Elige tu sucursal`, imprimir «Elige tu sucursal y pulsa Confirmar sucursal en la ventana de Chrome» y esperar (hasta el mismo límite de 10 min) a que el texto deje de estar visible o la URL sea distinta de `/app`; si aparece «Sin sucursales asignadas», salir con código 1 y el mensaje «La cuenta no tiene membresía en ninguna sucursal; entra con otra cuenta». Sólo entonces guardar `storageState`.
2. `e2e/helpers.ts`: nueva función `ensureBranchSelected(page)`: si la página muestra «Elige tu sucursal», marcar el primer `input[name="scope"]` (o el que indique `E2E_BRANCH` por texto de etiqueta, si está definido), pulsar «Confirmar sucursal» con `noWaitAfter: false`, esperar navegación/`networkidle` y volver a la ruta pedida. Si tras eso sigue el selector, o aparece «Sin sucursales asignadas», lanzar `Error("Sin sucursal: ...")` con el texto exacto para que el test falle. Añadir `NEXT_DEVTOOLS` a los motivos de salto: elementos con nombre que contenga «Next.js Dev Tools» o dentro de `nextjs-portal` se saltan con `reason: "herramienta de Next"`.
3. `e2e/smoke.spec.ts` y `e2e/dom-exhaustive.spec.ts` y `e2e/offline.spec.ts`: después de `expectAuthenticated`, llamar a `ensureBranchSelected(page)` y luego comprobar la ruta final: si `new URL(page.url()).pathname !== route.path` (salvo `/app`), fallar con «La ruta X redirigió a Y». En `dom-exhaustive`, además de la guarda anterior, `expect(found, "elementos interactivos encontrados").toBeGreaterThan(12)` para toda ruta distinta de `/app` (cobertura vacía = fallo), y registrar en el resumen de consola el nombre de la sucursal activa si es legible en la cabecera.
4. `e2e/dom-exhaustive.spec.ts`: excluir del selector los elementos dentro de `nextjs-portal` (`:not(nextjs-portal *)` no es válido en CSS; filtrar en `describe()` con `node.closest("nextjs-portal") !== null` → `skipped`, motivo «herramienta de Next»). Quitar «confirmar» de `DESTRUCTIVE` **sólo** para el caso exacto «Confirmar sucursal» mediante una lista `SAFE_NAMES = [/^confirmar sucursal$/i]` evaluada antes de `isDestructive`; el resto de «confirmar» sigue siendo destructivo.
5. `e2e/README.md`: documentar `E2E_BRANCH` y que el login debe terminar con la sucursal confirmada.

## Invariantes
Sin tocar `src/`. Sin pulsar nada destructivo nuevo. LF. Sin `any`.

## Verificación (Node 24 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; pnpm vía `node "<node24>\node_modules\corepack\dist\pnpm.js"`; servidores locales ya arriba en 8082/3000, no reiniciarlos; `apps/web/playwright/.auth/user.json` existe en el checkout principal con sesión de `emmanuel.rgomez@gmail.com`: cópialo a tu worktree en la misma ruta para la verificación y bórralo de tu worktree al terminar)
- `pnpm --filter @super-restaurant/web e2e:typecheck`
- `pnpm --filter @super-restaurant/web lint` y `typecheck` (no deben cambiar)
- `pnpm --filter @super-restaurant/web exec playwright test --project desktop --grep "Mesas|Órdenes|Caja"` → deben pasar y el resumen `[dom]` de cada ruta debe mostrar `encontrados` > 12. Pegar esas líneas.
- `pnpm --filter @super-restaurant/web exec playwright test --project desktop --grep @public` → pasa.

## Formato de salida esperado
Resumen, archivos, salida literal (incluidas las líneas `[dom] ...`), riesgos. Commit local con conventional commit. Sin merge ni push.
