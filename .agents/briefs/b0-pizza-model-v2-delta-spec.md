# Brief b0-pizza-model-v2-delta-spec (B0, nivel A, solo documento)

## Objetivo
Actualizar `docs/architecture/PIZZA_MODEL_V2.md` con el delta de la ronda 2. Sin tocar código.

## Alcance
- Solo editar `docs/architecture/PIZZA_MODEL_V2.md`. Lee `plan`: `docs/plans/smoke-2026-11-05-r2-plan.md` §3 (B0).
- Usa `codegraph explore "baseGroupId extraGroupIds pizzaMode"` para listar los archivos afectados (shared-types, domain, api, web, mobile, SQL).

## Decisiones ya tomadas (Emmanuel, 2026-11-20)
- `baseGroupIds: string[]` sustituye a `baseGroupId`: grupos gratuitos hasta N; los N gratuitos se reparten entre todos los grupos base con la misma regla de precio aprobada (más baratos gratis; mitades según los criterios ya documentados).
- `defaultIngredientOptionIds` puede tomar opciones de cualquier grupo base (receta incluida en el precio).
- `extraOptionIds: string[]` sustituye o complementa `extraGroupIds`: opciones sueltas, siempre cobradas, nunca consumen N. Una opción no puede ser base y extra a la vez en el mismo producto; el mismo grupo sí puede aparecer en ambos lados.
- **Unificar `pizzaMode` en un solo bloque**: personalizada = «Personalizar durante la orden» (desmarca la receta y la pone en gris; los ingredientes se eligen al tomar el pedido); especialidad = receta marcada. Cubrir impacto en snapshot y mobile.
- Productos legados con `fraction.enabled` (sabores) siguen funcionando en captura; el editor solo permite desactivarlos.
- Parser que acepte `baseGroupId` legado y lo normalice a `[id]`.
- Incluir la pertenencia de las opciones a los grupos asignados en `save_menu_catalog` (deuda de P3-2).

## Hecho cuando
- El documento contiene: delta de contrato (tipos), reglas de precio con el ejemplo «Pizza Italiana y chorizo» ($150; base = Ingredientes de pizza [pepperoni, champiñón, aceituna negra, pimiento verde] + Vegetales; extras = Orilla de queso y Aderezo ranch), impacto en snapshot, compatibilidad legada, lista de archivos afectados y orden de capas B1a-B1d.
- Resumen de ≤15 líneas en el informe. No commit/push.

## Cierre
Aplica Ponytail (AGENTS.md de DietrichGebert/ponytail): el cambio más pequeño correcto, reutiliza lo existente, sin recortar validación/errores/seguridad/tests. Sin evidencia = NO VERIFICADO. Informe con bloque ``` con el comando de codegraph y la salida resumida.
