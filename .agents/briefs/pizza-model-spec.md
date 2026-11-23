# Brief pizza-model-spec (P3-0, nivel A, SIN escritura)

## Objetivo
Entregar en tu respuesta final (L0 lo guardará como `docs/architecture/PIZZA_MODEL_V2.md`) la especificación del modelo de pizza personalizada vs. especialidad. Lee la sección 4 de `docs/plans/smoke-2026-11-05-plan.md` (contenido requerido de P3-0) y sus entradas.

## Decisiones ya tomadas por Emmanuel
- Mitad y mitad entre especialidades: se cobra el precio de la MÁS CARA.
- Ingrediente extra: se cobra el precio propio de la opción del grupo.
- N ingredientes gratis: POR PRODUCTO (no por tamaño).
- Mitad/N: la N cuenta como cuenta 1 por ingrediente (un ingrediente en una sola mitad cuenta 1); la tecla «N» sola no lleva atajo.
## Supuestos recomendados (marcar como PENDIENTE DE APROBACIÓN)
- Especialidad: se puede quitar un ingrediente sin descuento; cambiar por otro cuesta el precio de la opción.
- Tipo de producto: no agregar campo, derivarlo de la categoría.
- Quitar un producto publicado: se borra del catálogo; el historial conserva snapshots.

## Alcance
Solo lectura; no edites ni ejecutes nada que escriba. Prohibido git commit/push. Dinero = enteros menores, nunca float; el total lo calcula el servidor.

## Hecho cuando
Especificación completa (campos de `MenuProductV1`, compatibilidad con `lockedIngredientOptionIds`, algoritmo de precio con mitades y orden de aplicación, snapshot de OrderItem, cambios en `replace_capture_selection_plan` y `confirm_capture_draft_v3`, impacto en `apps/mobile/src/order-draft.ts`, migración/backfill, invariantes, riesgos), con tabla de casos de precio (0, N, N+1, N+k, mitades). Escríbela completa en la respuesta final.
