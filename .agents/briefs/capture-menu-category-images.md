# Brief capture-menu-category-images (C5, nivel C)

## Objetivo
Las pestañas de categoría en Captura deben mostrar la imagen de la categoría, no sólo el color.

## Alcance
- Editar SOLO `apps/web/src/app/app/capture/capture-menu.tsx` (~13-23 y 62-69; la imagen de producto ya se pinta en ~86 con `menuImagePublicUrl`: imita ese patrón).
- Prohibido: otros archivos, git commit/push.

## Contexto mínimo
Pintar `entry.category.imagePath` con `menuImagePublicUrl` sobre el color de fondo. Sin imagen: queda sólo el color. Target táctil de 44 px mínimo; `alt=""` (decorativa) con el nombre como texto visible.

## Hecho cuando
- lint, typecheck y test de `@super-restaurant/web` en verde.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Puertas desde `apps/web`: `corepack pnpm lint`, `typecheck`, `test` (tail -40). Informe en `.agents/reports/capture-menu-category-images.md` (≤10 líneas) con bloque ``` con comando y salida real; sin evidencia = NO VERIFICADO.
