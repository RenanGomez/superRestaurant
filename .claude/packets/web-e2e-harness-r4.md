# web-e2e-harness-r4 · el crawl pierde el contenido tras volver de los enlaces de navegación

## Tarea
web-e2e-harness-r4 · capa L1 `implementer-claude` · nivel C (sólo `apps/web/e2e/dom-exhaustive.spec.ts`, `apps/web/e2e/helpers.ts` y `apps/web/e2e/README.md`) · riesgo bajo. Rama `claude/web-e2e-harness-r4` desde `main` (que ya incluye r2 y r3).

## Hallazgo de la corrida completa en `main` (2026-10-23, desktop, 23 pasan / 2 omitidos)
En cada ruta el crawl pulsa primero los 9 enlaces de `nav[aria-label="Navegación principal"]`, navega fuera, vuelve con `goto(route.path)` + `domcontentloaded`, y a partir de ahí **todos** los elementos restantes salen como `tag: "?"` con motivo «no visible o deshabilitado», porque `.nth(i)` se evalúa antes de que `main` vuelva a renderizarse. Resultado: Menú 93 encontrados, 9 pulsados, 82 descartados; Órdenes 24/9/13; Mesas 18/9/7. La cobertura real es casi nula.

## Cambios en `dom-exhaustive.spec.ts`
1. Excluir del crawl los enlaces de la barra de navegación principal y el botón «Cerrar sesión» **salvo en la ruta `/app`**, donde sí se pulsan una vez: en `describe()` devolver `inMainNav: node.closest('nav[aria-label="Navegación principal"]') !== null` y marcarlos `skipped` con motivo «navegación principal».
2. Tras cualquier `goto(route.path)` de vuelta (cuando un clic cambió la URL), repetir la misma espera del inicio: `main` visible + `networkidle` con catch, y volver a llamar a `ensureBranchSelected` por si la cookie se perdió.
3. Al evaluar cada índice `i`: si `page.locator(SELECTOR).nth(i).count()` es 0, hacer `waitFor({ state: "attached", timeout: 5_000 }).catch(() => undefined)` y recontar; si sigue sin existir, `skipped` con motivo «ya no existe» (no «no visible»).
4. Si el elemento existe pero no es visible, intentar `scrollIntoViewIfNeeded({ timeout: 2_000 })` con catch y volver a comprobar antes de marcarlo «no visible o deshabilitado».
5. Pulsar los elementos que abren diálogos no debe dejar el diálogo abierto para el siguiente: tras cada clic, además de `Escape`, si hay `[role="dialog"]` visible con un botón «Cerrar», «Cancelar» o `aria-label="Cerrar"`, pulsarlo (no cuenta como destructivo: cerrar un diálogo no muta nada) y registrar `closedDialog: true` en el registro.
6. En el resumen `[dom]` y en el JSON, añadir `skippedByReason` (objeto motivo → cantidad).

## `helpers.ts`
Exportar `MAIN_NAV_SELECTOR = 'nav[aria-label="Navegación principal"]'` y usarlo en ambos sitios. Añadir `closeOpenDialog(page): Promise<boolean>` con la lógica del punto 5.

## Invariantes
Sin tocar `src/`. LF. Sin `any`. Nada destructivo nuevo: la lista `DESTRUCTIVE` y `SAFE_NAMES` no cambian.

## Verificación (Node 24 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; pnpm vía `node "<node24>\node_modules\corepack\dist\pnpm.js"`; servidores locales ya arriba en 8082/3000, no reiniciarlos; copiar `apps/web/playwright/.auth/user.json` del checkout principal a la misma ruta del worktree y borrarlo al terminar)
- `pnpm --filter @super-restaurant/web e2e:typecheck`
- `pnpm --filter @super-restaurant/web exec playwright test --project desktop --grep "Menú|Órdenes|Mesas|Inicio"` → 8 passed; pegar las líneas `[dom]`. Criterio: en Menú `pulsados+llenados` > 40 y en Órdenes y Mesas > 10; en `/app` los enlaces de navegación sí se pulsan.
- Si algún clic produce `pageerror` o 5xx reales, NO los ocultes: déjalos fallar y repórtalos con el nombre del elemento.

## Formato de salida esperado
Resumen, archivos, salida literal, riesgos. Commit local con conventional commit. Sin merge ni push.
