# web-menu-css-escape-ssr · `/app/menu` falla en el servidor por `CSS.escape`

## Tarea
web-menu-css-escape-ssr · capa L1 `implementer-claude` · nivel C (sólo `apps/web/src/app/app/menu/reorder-controls.tsx` y `apps/web/src/lib/menu-reorder.ts` + su test) · riesgo bajo. Rama `claude/web-menu-css-escape-ssr` desde `main`.

## Bug (detectado por el smoke E2E el 2026-10-22, proyecto desktop)
En `/app/menu` el servidor lanza `ReferenceError: CSS is not defined` dos veces, Next cambia a renderizado en cliente («Switched to client rendering because the server rendering errored») y en dev muestra el overlay de error. Origen: `apps/web/src/app/app/menu/reorder-controls.tsx:34`, dentro del cuerpo de `ReorderHandle` (componente cliente, pero se prerenderiza en el servidor):
```ts
const selector = `[data-reorder-list="${CSS.escape(listKey)}"]`;
```
`CSS` es un global del navegador; no existe en Node durante SSR.

## Cambio
- Añadir en `apps/web/src/lib/menu-reorder.ts` una función pura `reorderListSelector(listKey: string): string` que construya `[data-reorder-list="<escapado>"]` escapando `\` y `"` (y rechazando/escapando saltos de línea) sin depender de `CSS`. Con prueba en `menu-reorder.test.ts`: `categories`, `products-abc-123`, una clave con comillas y con barra invertida; y que el resultado es estable e idéntico entre llamadas.
- En `reorder-controls.tsx` usar `reorderListSelector(listKey)` y eliminar `CSS.escape`. No mover la lógica a un `useEffect`: el selector debe seguir disponible en los handlers de puntero desde el primer render.
- Comprobar con `grep -rn "\bCSS\." src` que no queda otro uso de `CSS.*` en código que pueda ejecutarse en el servidor.

## Invariantes
Sin cambios de comportamiento del arrastre. LF. Sin `any`. Nada fuera de los tres archivos.

## Verificación (Node 24 en `C:\Users\Emmanuel G\AppData\Local\Programs\node24`; pnpm vía `node "<node24>\node_modules\corepack\dist\pnpm.js"`)
- `pnpm --filter @super-restaurant/web test` (incluye `menu-reorder.test.js` y `rsc-boundary.test.js`)
- `pnpm --filter @super-restaurant/web typecheck`
- `pnpm --filter @super-restaurant/web lint`

## Formato de salida esperado
Resumen, archivos, salida literal, riesgos. Commit local con conventional commit. Sin merge ni push.
