# p2-locked-ingredients-research — investigación de sólo lectura para el paquete P2 «ingredientes bloqueados»
Agente: Gemini   Nivel de rigor: A (la implementación; esta tarea es sólo investigación)   Complejidad: Estándar

## Objetivo
Preparar el paquete de contexto de P2 de `menu-modifier-model-v2`: sustituir `fraction.excludableIngredientIds` (etiquetas de texto) por `fraction.lockedIngredientOptionIds` (ids de opción del grupo de ingredientes, semántica «no se pueden quitar»), con migración de datos. Lee `.claude/packets/menu-modifier-model-v2-research.md` primero.

## Archivos (sólo lectura)
- packages/shared-types/src/index.ts (buscar `excludableIngredientIds`, `MenuVariantFractionV1`, `parseMenuVariantFractionV1`)
- packages/shared-types/src/line-fraction.ts
- packages/domain/src/menu.ts, packages/domain/src/fraction-pricing.ts, packages/domain/src/configured-catalog.ts
- supabase/migrations/20261006000400_catalog_halves.sql, 20261008000200_catalog_halves_product_level.sql, 20261101000100_menu_category_appearance.sql (funciones normalize_menu_catalog_payload, save_menu_catalog, build_menu_catalog_state, confirm_capture_draft_v3)
- apps/api/src/menu-catalog-domain.ts, apps/api/src/fraction-halves.test.ts
- apps/web/src/app/app/capture/product-sheet.tsx, apps/web/src/lib/line-halves.ts, apps/web/src/lib/menu-fraction.ts, apps/web/src/app/app/menu/menu-catalog-editor.tsx (sección «Ingredientes que se pueden quitar»)
- apps/mobile/src/order-draft.ts

## Tarea
1. Enumera cada lectura y escritura de `excludableIngredientIds` (archivo:línea) en contratos, dominio, SQL, API, web y mobile, y cómo viaja hasta el snapshot de la línea (`LineFractionV1`, `fractionBreakdown`).
2. Propón el mapeo etiqueta → option_id: regla exacta (igualdad normalizada por lower(trim()) dentro del grupo de ingredientes de esa fracción), qué pasa con etiquetas sin opción equivalente o con nombres duplicados, y redacta la consulta SQL de dry-run (sólo select) que cuente por restaurante: fracciones afectadas, etiquetas mapeadas, no mapeadas y duplicadas.
3. Define la migración en dos pasos (columna nueva `fraction_locked_ingredient_option_ids uuid[]` + backfill «bloqueado = opción del grupo de ingredientes que NO está en la lista excluible», conservando la columna legacy) y las invariantes SQL a probar en rollback.
4. Lista los tests existentes que cambian de semántica y los nuevos que hacen falta (dominio, API, web, mobile).
5. Señala riesgos: snapshots históricos, clientes móviles atrasados, pizzas sin grupo de ingredientes.

## Restricciones
- No modificar ningún archivo. No ejecutar comandos de instalación ni de red. No conectarte a ninguna base de datos.

## Criterios de aceptación
- El reporte tiene las cinco secciones anteriores, con rutas y líneas verificables, y la consulta de dry-run completa.

## Verificación
Ninguna (sólo lectura).

## Formato de salida
Reporte según `.harness/ORCHESTRATOR.md` §8, en `.agents/reports/p2-locked-ingredients-research.md`, máximo 150 líneas.
