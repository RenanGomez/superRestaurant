# Brief b3-pizza-option-tiles (Componente tile de opción, nivel C)

## Objetivo
Componente tile de opción. Smoke r2, ola 2.

## Fuente de verdad
Crear `apps/web/src/app/app/menu/option-check-tile.tsx`: casilla, miniatura (`menuImagePublicUrl(option.imagePath)` o placeholder), nombre y precio opcional. Rejilla desde `sm`, lista vertical por debajo de `sm`, target de 44 px, etiquetas accesibles. Sin tocar otros archivos salvo un test si aplica.

## Hecho cuando
lint, typecheck, test y build de apps/web en verde.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Prohibido: git commit/push, aplicar migraciones en remoto, tocar archivos fuera del alcance. Informe de ≤15 líneas con bloque con comando y salida real; sin evidencia = NO VERIFICADO.
