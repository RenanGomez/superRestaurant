# Brief review-pizza-spec (revisión nivel A de una especificación, SIN escritura)

## Objetivo
Revisar `docs/architecture/PIZZA_MODEL_V2.md` contra AGENTS.md (§8 dominio, §9 dinero, §10 tenancy, §12 migraciones) y el código actual: `packages/shared-types/src/index.ts` (MenuProductV1, fraction), `packages/domain/src/menu.ts`, la migración `20261008000200…sql` (`replace_capture_selection_plan`, `confirm_capture_draft_v3`) y `apps/mobile/src/order-draft.ts`.

## Criterios
Huecos o contradicciones: dinero con enteros, orden de aplicación y redondeo, mitades (más cara; N cuenta 1), snapshot de OrderItem inmutable, compatibilidad con sabores legados y `lockedIngredientOptionIds`, idempotencia, aislamiento por restaurante, backfill sin editar migraciones aplicadas, casos de prueba que falten.

## Alcance
Solo lectura. Prohibido git commit/push. Informe en `.agents/reports/review-pizza-spec.md` (≤25 líneas): veredicto APROBAR/CORREGIR y por hallazgo severidad P1/P2/P3, sección y fix; con bloque ``` con el comando usado y salida real.
