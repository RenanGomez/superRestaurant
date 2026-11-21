# Brief b4-pizza-capture-r2 (Captura de pizza ronda 2, nivel C)

## Objetivo
Captura de pizza ronda 2. Smoke r2, ola 2.

## Fuente de verdad
Plan B4. Archivos: `apps/web/src/app/app/capture/pizza-section.tsx`, `product-sheet.tsx`, `apps/web/src/lib/pizza-capture.ts` y tests. Muestra grupos base y extras por opción con el tile de B3; el contador «3 de 2 gratis · +$X» usa el monto del API; el cliente no calcula dinero.

## Hecho cuando
Puertas web en verde.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Prohibido: git commit/push, aplicar migraciones en remoto, tocar archivos fuera del alcance. Informe de ≤15 líneas con bloque con comando y salida real; sin evidencia = NO VERIFICADO.

## Reintento
La corrida previa murió sin cambios. No leas `.harness/runs/**` ni nada fuera del worktree (el motor lo rechaza); el componente `option-check-tile.tsx` de B3 ya está en tu worktree en `apps/web/src/app/app/menu/`.
