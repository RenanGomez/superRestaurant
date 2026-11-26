# Revisión · m3-web-compras (nivel C)

No leas `.agents/reports/*`, no salgas del repo y no ejecutes nada. Responde en ≤ 14 líneas.

Diff: main...harness/m3-web-compras

Lee:
- `apps/web/src/app/app/inventario/purchasing-panel.tsx`
- `apps/web/src/app/app/inventario/actions.ts`
- `apps/web/src/app/app/inventario/inventory-workspace.tsx`
- `apps/web/src/lib/inventory-ui.ts` y `inventory-ui.test.ts`

Comprueba:
1. El contrato HTTP coincide: `POST /inventory/suppliers` con `restaurantId/name/contact/active`; `PATCH /inventory/suppliers/:id`; `POST /inventory/purchase-orders` con `restaurantId/branchId/supplierId/currency/idempotencyKey/orderedAt?/lines[{itemId,quantity,unitCode,unitCostMinor}]`; `POST /purchase-orders/:id/receive` con `warehouseId` y `deviceId`. Ningún campo que el servidor prohíbe (`totalMinor`).
2. El dinero no se calcula en el cliente: el total mostrado sale de `totalMinor` del servidor y `formatMinorUnits` no usa división float ni suma líneas.
3. La `idempotencyKey` es estable por borrador (una generación, mismo valor en reintentos) y no se regenera en cada render.
4. Aislamiento y permisos: el `restaurantId`/`branchId` salen del contexto de sucursal, no del formulario; un rol sin `catalog.manage` no puede escribir y la UI lo refleja sin decidir permisos por sí sola.
5. Accesibilidad: diálogos con `role="dialog"`, Escape, foco contenido y devuelto; sin `alert/confirm/prompt`; sin UUIDs visibles; targets ≥ 44 px; estados de carga/vacío/error/reintento.
6. No rompe `?tab=` ni las pestañas previas (insumos, recetas, almacenes, movimientos) ni el modo solo lectura.

Salida: `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR` y hallazgos con `archivo:línea`. Marca P1/P2/P3.
