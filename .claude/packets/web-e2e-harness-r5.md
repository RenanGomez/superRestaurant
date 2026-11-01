# web-e2e-harness-r5 · recargar la ruta cuando un clic cambia la lista; cobertura real en Órdenes y Caja

## Tarea
web-e2e-harness-r5 · capa L1 `implementer-claude` · nivel C (sólo `apps/web/e2e/dom-exhaustive.spec.ts`, `apps/web/e2e/helpers.ts`, `apps/web/e2e/README.md`) · riesgo bajo. Rama `claude/web-e2e-harness-r5` desde `main`.

## Hallazgo de las corridas desktop y mobile del 2026-10-23 (`apps/web/e2e-report/dom-coverage-*.json`)
- Órdenes: 24 encontrados, 3 pulsados, 8 «ya no existe». Al pulsar la pestaña «Canceladas» la lista cambia y los índices siguientes apuntan a elementos que desaparecieron.
- Caja: 17 encontrados, 1 pulsado, 2 «ya no existe». Un clic abre otra vista de la caja y el resto del conteo se pierde.
- Captura: 22 encontrados, 5 pulsados. Los pasos (Cliente → Menú → Entrega → Cobro) cambian el contenido.
El crawl recorre índices fijos sobre un DOM que muta; en cuanto un clic cambia la pantalla, lo que queda se descarta.

## Cambio: crawl por «instantáneas» en vez de por índices fijos
1. En `dom-exhaustive.spec.ts`, sustituir el bucle `for i < total` por un bucle sobre una **cola de descriptores** tomados de una instantánea inicial: `{ key, tag, name, href, type }` donde `key` es una firma estable (tag + nombre accesible + href + posición entre hermanos con el mismo nombre). Para actuar sobre un descriptor, **relocalizarlo** con `page.locator(SELECTOR).filter({ hasText })` o por `aria-label`/`href`, tomando el primero visible; si no se encuentra, marcar «ya no existe» sin abortar.
2. Tras cada acción, si el número de elementos visibles o la URL cambian respecto a la instantánea, **recargar la ruta** (`goto(route.path)` + espera de `main` + `ensureBranchSelected`) antes del siguiente descriptor, y registrar `reloaded: true`. Con eso cada elemento se ejercita desde el mismo estado inicial.
3. Después de agotar la instantánea inicial, hacer **una segunda pasada de descubrimiento** acotada: para cada elemento pulsado que cambió el DOM (pestañas, botones que abren paneles) volver a pulsarlo, tomar instantánea de los elementos **nuevos** que aparecieron (no presentes en la inicial), ejercitarlos con las mismas reglas de seguridad y recargar. Límite: `E2E_MAX_DEPTH` (default 1) y `E2E_MAX_ELEMENTS` total por ruta (default 150). Registrar `depth: 0|1` en cada registro.
4. Conservar todas las reglas de seguridad actuales (`DESTRUCTIVE`, `SAFE_NAMES`, navegación principal sólo en `/app`, «Cambiar sucursal», herramientas de Next, `closeOpenDialog`, campos rellenados y restaurados).
5. El resumen `[dom]` añade `recargas=N` y `profundidad1=N`; el JSON de cobertura incluye `reloaded` y `depth` por registro.
6. `helpers.ts`: extraer `snapshotInteractive(page, selector)` que devuelve los descriptores, y `relocate(page, descriptor)` que devuelve el `Locator` o `null`.
7. README: dos líneas sobre instantáneas, recargas y `E2E_MAX_DEPTH`.

## Invariantes
Sin tocar `src/`. LF. Sin `any`. Nada destructivo nuevo. El test sigue sin pulsar «Cerrar sesión», «Publicar nueva versión», cobros, cancelaciones ni envíos a cocina.

## Verificación (Node 24 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; pnpm vía `node "<node24>\node_modules\corepack\dist\pnpm.js"`; levantar los servidores si no responden con `tools/agentic/local-servers/start-local.bat nobuild` desde cmd, no desde PowerShell; copiar `apps/web/playwright/.auth/user.json` del checkout principal a la misma ruta del worktree y borrarlo al terminar)
- `pnpm --filter @super-restaurant/web e2e:typecheck`
- `pnpm --filter @super-restaurant/web exec playwright test --project desktop --grep "Órdenes|Caja|Captura|Menú"` → 8 passed; pegar las líneas `[dom]`. Criterio: Órdenes y Caja con `pulsados+llenados` ≥ 8 cada una; Menú no baja de 60; ningún `pageerror` ni 5xx.
- Repetir el comando una segunda vez: los conteos no deben variar más de ±3 por ruta.

## Formato de salida esperado
Resumen, archivos, salida literal, riesgos. Commit local con conventional commit. Sin merge ni push.
