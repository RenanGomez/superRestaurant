# Brief b1c-pizza-v2-api (Pizza v2 delta: API, nivel A)

## Objetivo
Pizza v2 delta: API. Smoke r2, ola 2.

## Fuente de verdad
Capa B1c de `docs/architecture/PIZZA_MODEL_V2.md` §2, §3 y §6: `apps/api/src/capture-pizza-pricing.ts`, `capture-pizza-plan.ts`, `menu-catalog-domain.ts`, `captures.ts`, `capture-repeat-order-plan.ts` y codec. Extras por opción siempre cobrados, N repartido entre grupos base, el monto lo calcula el API.

## Hecho cuando
Contract tests de captura de pizza con varios grupos base y extras; lint, typecheck y test de apps/api en verde.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Prohibido: git commit/push, aplicar migraciones en remoto, tocar archivos fuera del alcance. Informe de ≤15 líneas con bloque con comando y salida real; sin evidencia = NO VERIFICADO.
