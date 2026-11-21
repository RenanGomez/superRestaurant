# Brief capture-customer-search (C2, nivel C)

## Objetivo
Búsqueda de cliente en Captura como combobox con autocompletado, alta rápida y enlace al Directorio. Puntos 1, 6 y 12 del smoke.

## Alcance
- Crear `apps/web/src/app/app/capture/capture-customer-search.tsx` (+ helper puro en `apps/web/src/lib/` con su test si hace falta).
- Editar `capture-workspace.tsx` (CW) SOLO el bloque de búsqueda (~1146-1160, ubica por símbolo; C1 ya movió líneas) y el botón «Directorio» (~1424).
- Editar `apps/web/src/app/app/customers/page.tsx` y `customers/customer-editor.tsx` para aceptar `?customerId=<id>` y abrir ese cliente.
- Prohibido: `apps/api`, SQL, nuevas server actions, git commit/push.

## Contexto mínimo
- Hoy CW tiene un formulario con submit y resultados inline, sin debounce. El autocompletado con debounce de 250 ms existe en `customers/customer-editor.tsx` (~70-90) vía `getCustomerDirectorySuggestions` (`apps/web/src/lib/customer-directory.ts:59`). Reutilízalo.
- Combobox accesible: `role="combobox"`, listbox flotante, flechas, Enter, Escape; debounce de **500 ms**; la lista se cierra al elegir.
- Sin resultados: opción «Crear cliente rápido con <teléfono/nombre>» que abre en la misma pantalla el alta rápida que ya existe en Clientes (reutiliza la acción existente; no crees otra). Al guardar, el cliente queda seleccionado en la captura.
- «Directorio» abre `/app/customers?customerId=<id>` cuando hay cliente.

## Hecho cuando
- lint, typecheck y test de `@super-restaurant/web` en verde; tests de helpers puros (normalizar la consulta y decidir si se ofrece alta rápida).

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Sin alert/confirm/prompt; targets de 44 px. Puertas desde `apps/web` con `corepack pnpm lint`, `typecheck`, `test` una vez al final (tail -40). Cierra cualquier proceso que levantes. Informe en `.agents/reports/capture-customer-search.md` (≤15 líneas) con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
