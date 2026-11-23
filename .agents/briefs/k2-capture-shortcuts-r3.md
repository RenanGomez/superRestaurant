# Brief k2-capture-shortcuts-r3 (K2, nivel C)

## Objetivo
Atajos de teclado: Alt+N global, Alt+Shift+R reemplaza a Alt+R y Escape cierra capas. Smoke r2 «keys».

## Alcance
- `apps/web/src/app/app/layout.tsx` o componente cliente nuevo `apps/web/src/app/app/global-shortcuts.tsx`; `capture/capture-workspace.tsx` (tabla de atajos y leyenda); `apps/web/src/lib/shortcut-dispatch.ts` y su test; `capture/product-sheet.tsx` y `capture-customer-search.tsx` solo si causan el bug de Escape.
- Actualizar `docs/runbooks/guia-de-pruebas-operador.md` (atajos).
- Prohibido: `apps/api`, SQL, git commit/push.

## Contexto mínimo
- Alt+N global: fuera de Captura navega a `/app/capture?focus=customer`; dentro, enfoca el buscador de cliente. Con cambios sin guardar en la página actual, modal propio «Hay cambios sin guardar» con Salir / Quedarme (reutiliza la confirmación existente si la hay).
- Alt+Shift+R reinicia; elimina Alt+R de la tabla y de la leyenda. «N» sola no hace nada (correcto).
- Escape: DIAGNOSTICA primero por qué hoy no dispara (posibles causas: `stopPropagation` en combobox u hoja, listener en el elemento equivocado, `shortcut-dispatch.ts` descartándolo). Luego pila de capas en este orden: desplegable del buscador → hoja de producto → modal; si no hay nada abierto, `blur()` del campo activo. Describe la causa en el informe.
- Sin alert/confirm/prompt.

## Hecho cuando
- Tests de `shortcut-dispatch`: Alt+Shift+R, Alt+N con foco en un input, Escape con capas abiertas.
- lint, typecheck y test de `@super-restaurant/web` en verde.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Puertas desde `apps/web` con `corepack pnpm lint`, `typecheck`, `test` una vez al final (tail -40). Cierra cualquier proceso que levantes. Informe de ≤15 líneas con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
