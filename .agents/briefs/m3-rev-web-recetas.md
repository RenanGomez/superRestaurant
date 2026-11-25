# Revisión · m3-web-recetas (nivel C)

No leas `.agents/reports/*` ni salgas del repo; no ejecutes nada. Responde en ≤ 12 líneas.

Lee:
- `apps/web/src/app/app/inventario/recipes-panel.tsx`
- `git diff -- apps/web/src/app/app/inventario/actions.ts apps/web/src/app/app/inventario/inventory-workspace.tsx apps/web/src/lib/inventory-ui.ts`
- casos nuevos de `apps/web/src/lib/inventory-ui.test.ts`

Comprueba:
1. El POST coincide con el contrato (`lines[{itemId,quantity,unitCode}]`, `notes`, `modifierId`), usa el `restaurantId` del contexto y recarga desde el servidor tras publicar.
2. Sin duplicados de insumo, cantidades > 0, unidad del insumo; botón deshabilitado al guardar; error dentro del diálogo.
3. Accesibilidad del diálogo y de la lista de versiones (activa vs histórica), sin `alert/confirm/prompt` ni UUIDs visibles.
4. No rompe `?tab=` ni las pestañas previas.

Salida: `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR` y hallazgos con `archivo:línea`.
