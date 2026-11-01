# Investigación 2026-11-01 · menu-modifier-model-v2 (resumen del researcher)

Partición acordada: **P1** `menu-shared-modifier-groups` (grupos compartidos, paquete propio) → **P2** ingredientes bloqueados → **P3** especialidades.

## Discrepancias con el backlog
1. No existe `removableIngredientOptionIds`: el campo real es `fraction.excludableIngredientIds` (etiquetas de texto ≤40/80 caracteres, `shared-types/index.ts:347`, `20261006000400:19`). P2 debe mapear etiquetas → `option_id`; no es determinista con nombres duplicados o ausentes: dry-run con conteo de no mapeados antes de pedir autorización.
2. `product.modifierGroupIds` ya existe en dominio como allowlist (`domain/menu.ts:108,280`); lo que falta es romper «un producto por grupo» (dominio 298-316, FK `20260902000100:93`, CHECK `20261006000400:352-359`).
3. Los grupos de sabores son grupos con precio por opción; no hay correspondencia automática con productos «especialidad». El backfill de `specialtyProductIds` no se deriva de datos.

## Decisiones pendientes de Emmanuel (bloquean P3)
- Regla de precio de mitades con especialidades: ¿máximo de los precios de las dos especialidades, o precio fijo del producto base? (AGENTS §9).
- Destino de los grupos de sabores actuales: ¿se conservan como legado hasta configurar especialidades, o se reconfiguran a mano?

## Alcance adicional detectado
- `apps/mobile/src/order-draft.ts:377-400` filtra grupos por `productId`; imprescindible para compatibilidad offline.
- `domain/configured-catalog.ts:157-160` `validateVariants` exige `groupId` único global.
- Sin tests de dominio para `ConfiguredCatalogProductV2` ni `ConfiguredProductCatalog`.

## Autorizaciones
- Escribir migraciones y backfill en el repo: sin permiso adicional.
- Aplicar en remoto: P1 contiene backfill determinista (asignación grupo→producto original); P2 cambia semántica de ingredientes existentes. Ambos son «paso de datos» → autorización explícita de Emmanuel, con dry-run y conteos.

## Riesgos
Fuga entre restaurantes si una FK omite `restaurant_id`; snapshots históricos alterados si cambia la forma del resolver; móviles atrasados sin grupos; etiquetas no mapeadas que bloqueen ingredientes en silencio.
