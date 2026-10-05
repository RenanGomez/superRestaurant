# web-order-add-items-r2 (ronda de revisión; log `.claude/runs/web-order-add-items/review-r1b.log`)

## Tarea
web-order-add-items-r2 · capa: L2 (Codex, `-Resume`) · nivel C. Worktree `C:\tmp\sr-wt\web-order-add-items`. El orquestador ya integró en tu rama (merge fb97ab3) el API de variantes: ahora existen `"addItem"` en `ORDER_DETAIL_ACTIONS`/`availableActions`, `note` y `variantId` en `AddOrderItemCommandV1`, `MenuProductV1.variants` y `variantName` en el detalle. Reconstruye `packages/shared-types` y `packages/domain` (`pnpm --filter @super-restaurant/shared-types build`, idem domain) antes de compilar web.

## Hallazgos
- [P1] `lib/order-detail.ts:155-156`: `canAddItems` infería el permiso de otras acciones y desaparecía en órdenes abiertas sin líneas pendientes. Sustituir por `hasAction(detail, "addItem")` (permiso del servidor) y borrar el TODO; prueba actualizada.
- [P2] `order-detail-panel.tsx:330-335`: tras un `conflict` en el reintento, si la recarga del detalle también falla, se descartaba el comando sin confirmar si la línea existe. Regla: el intento queda «pendiente de confirmar» hasta que una lectura exitosa del detalle muestre o no el `orderItemId`; mientras tanto el panel muestra «Confirmando el último producto…» con botón «Reintentar lectura» y no permite un intento nuevo con otro `orderItemId`; si el detalle confirma la línea, se limpia; si confirma que no existe, se reintenta con la versión nueva y el mismo `orderItemId`. Helper puro `resolvePendingAdd(detail, attempt)` con prueba.
- Además, ahora que el contrato lo admite: envía `note` (muestra el campo de nota en la hoja) y `variantId` (selector de tamaño si el producto tiene `variants` activas; si falta, «Agregar» deshabilitado con «Elige un tamaño»); el detalle muestra `variantName`. Si otra tarea (`web-menu-variants-ui`) ya añadió el selector en `product-sheet.tsx` cuando se integre, el orquestador resolverá el solape; aquí hazlo mínimo y reutilizable.

## Criterios
- [ ] Puertas `pnpm --filter @super-restaurant/web lint && typecheck && test && build`. Informe de tres líneas. No hagas commit.
