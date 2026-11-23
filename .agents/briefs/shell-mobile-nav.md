# Brief shell-mobile-nav (R1, nivel C)

## Objetivo
En móvil (<640 px) la barra lateral fija angosta debe reemplazarse por una barra inferior.

## Alcance
- Editar `apps/web/src/app/app/app-nav.tsx` (riel fijo `w-[76px]` ~línea 32) y `apps/web/src/app/app/layout.tsx`.
- Prohibido: otros archivos, git commit/push.

## Contexto mínimo
Por debajo de `sm`: ocultar el riel y mostrar barra inferior fija con las 4-5 secciones principales más «Más» (hoja/menú accesible con el resto). Respetar `safe-area-inset-bottom`, targets de 44 px, foco visible y `aria-current`. El contenido debe tener padding inferior para no quedar tapado. Desde `sm` el comportamiento actual no cambia. Reutiliza las rutas/íconos/etiquetas que ya existen en `app-nav.tsx`, sin duplicar la lista.

## Hecho cuando
- lint, typecheck y test de `@super-restaurant/web` en verde; descríbelo en el informe (breakpoint y secciones elegidas).

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Sin alert/confirm/prompt. Puertas desde `apps/web`: `corepack pnpm lint`, `typecheck`, `test` (tail -40). Informe en `.agents/reports/shell-mobile-nav.md` (≤12 líneas) con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
