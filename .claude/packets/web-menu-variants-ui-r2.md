# web-menu-variants-ui-r2 (unificar ProductSheet con add-items y cerrar P2 de Sonnet)

## Tarea
web-menu-variants-ui-r2 · capa: L1 (`implementer-claude`, desviación: Codex sin cuota) · nivel C. Worktree `C:\tmp\sr-wt\web-menu-variants-ui` (rama codex/web-menu-variants-ui).

## Situación
El orquestador ejecutó `git merge codex/web-order-add-items` en este worktree; hay marcadores de conflicto sólo en `apps/web/src/app/app/capture/product-sheet.tsx`. Ambas ramas añadieron selector de tamaño a `ProductSheet` con firmas distintas de `onAdd`: add-items usa `(quantity, modifierGroups, note, variantId)` más props `showVariants` e `initialVariantId`; esta rama usa `(quantity, variantId, modifierGroups, note)` con `sizeMissing` y preselección al editar. **No ejecutes `git merge/rebase/commit`**: edita archivos; el orquestador commitea el merge.

## Criterios
- [ ] `product-sheet.tsx` sin marcadores, con una sola firma: `onAdd(quantity, modifierGroups, note, variantId)` (la de add-items, `variantId` al final) y props `showVariants`/`initialVariantId`; conserva de esta rama el bloque «Tamaño · obligatorio», `sizeMissing` (Agregar deshabilitado con «Elige un tamaño»), el estimado con precio del tamaño y la preselección al editar. Ajusta todos los llamadores (`capture-workspace.tsx`, `orders/order-detail-panel.tsx`) a esa firma.
- [ ] [P2 Sonnet] el editor de menú muestra el error de validación de tamaños indicando el producto («Pizza Margarita: nombre de tamaño repetido») y marca el campo con `aria-invalid`; helper `variantValidationError` devuelve `{ productId, message }`.
- [ ] [P3] helper puro `variantNameFor(catalog, productId, variantId)` con prueba, usado en `capture-ticket.tsx`.
- [ ] Puertas `pnpm --filter @super-restaurant/web lint && typecheck && test && build` (reconstruye shared-types/domain antes) y `git diff --check`.
- [ ] Informe de tres líneas con lo conservado de cada lado.
