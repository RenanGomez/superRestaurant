# Brief b1a-pizza-v2-contract-domain (Pizza v2 delta: shared-types y domain, nivel A)

## Objetivo
Pizza v2 delta: shared-types y domain. Smoke r2, ola 2.

## Fuente de verdad
Implementa SOLO la capa B1a de `docs/architecture/PIZZA_MODEL_V2.md` sección «Delta de la ronda 2» (§1 contrato, §2 reglas de precio, §4 compatibilidad legada, §7 orden de capas). Alcance: `packages/shared-types`, `packages/domain` y sus tests. Aprobado por Emmanuel el 2026-11-21 (pizzaMode unificado).

## Hecho cuando
Unitarias: varios grupos base, N repartido entre grupos, extras por opción, opción base/extra duplicada rechazada, parser legado (baseGroupId → baseGroupIds). lint, typecheck y test de shared-types y domain en verde.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Prohibido: git commit/push, aplicar migraciones en remoto, tocar archivos fuera del alcance. Informe de ≤15 líneas con bloque con comando y salida real; sin evidencia = NO VERIFICADO.
