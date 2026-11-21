# Brief b1d-pizza-v2-mobile (Pizza v2 delta: tipos mobile, nivel B)

## Objetivo
Pizza v2 delta: tipos mobile. Smoke r2, ola 2.

## Fuente de verdad
Capa B1d de `docs/architecture/PIZZA_MODEL_V2.md` §6: solo adaptar tipos en `apps/mobile/src/order-draft.ts` al contrato de B1a.

## Hecho cuando
typecheck y test de apps/mobile en verde.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Prohibido: git commit/push, aplicar migraciones en remoto, tocar archivos fuera del alcance. Informe de ≤15 líneas con bloque con comando y salida real; sin evidencia = NO VERIFICADO.
