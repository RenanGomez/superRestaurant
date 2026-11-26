## Estado
done — pestaña «Compras» en `/app/inventario?tab=compras`: proveedores (alta/edición/activar-desactivar), órdenes de compra con idempotencia estable y totales del servidor, y recepción contra almacén con `deviceId` de sesión.

## Qué hice
- Añadí `compras` a `INVENTORY_TABS` (tras `movimientos`) con su etiqueta y panel; el workspace carga insumos/almacenes también para esta pestaña.
- `actions.ts`: operaciones locales `list/create/updateSupplier`, `list/create/read/receivePurchaseOrder`; tipos `SupplierV1`, `PurchaseOrderSummaryV1`, `PurchaseOrderDetailV1` y `PurchaseOrderCreatedV1` locales; lectores defensivos y roles read/manage.
- `purchasing-panel.tsx`: diálogos con `InventoryModal`, validación previa, error dentro, sin `alert/confirm/prompt`; OC usa una `idempotencyKey` por borrador (`ensureInventoryIdempotencyKey`) y solo muestra `totalMinor` del servidor; recepción recarga OC/lista y avisa el conteo de movimientos.
- `inventory-ui.ts` (+test): `formatMinorUnits` (BigInt, escala por moneda), `validateSupplierDraft`, `validatePurchaseOrderDraft`, `purchaseOrderStatusLabel`.

## Archivos tocados
- `apps/web/src/app/app/inventario/{actions.ts,inventory-workspace.tsx,purchasing-panel.tsx}`, `apps/web/src/lib/{inventory-ui.ts,inventory-ui.test.ts}`; `git status --short`: ` M .../actions.ts`, ` M .../inventory-workspace.tsx`, ` M apps/web/src/lib/inventory-ui.test.ts`, ` M apps/web/src/lib/inventory-ui.ts`, `?? .../purchasing-panel.tsx`.

## Verificación
```
$ pnpm --filter @super-restaurant/shared-types build && pnpm --filter @super-restaurant/web lint && pnpm --filter @super-restaurant/web typecheck && pnpm --filter @super-restaurant/web test && pnpm --filter @super-restaurant/web build
$ tsc --project tsconfig.build.json
$ eslint --max-warnings=0 --config ../../eslint.config.mjs src
$ tsc --noEmit --project tsconfig.json
✔ purchase money formats from the exact minor total, never a local sum (3.144ms) … ✔ purchase order statuses carry an operator-facing Spanish label (0.1299ms) ℹ tests 19 ℹ pass 19 ℹ fail 0
✓ Compiled successfully in 15.8s … ƒ /app/inventario
```

## Riesgos / dudas
- NO VERIFICADO: navegador real, breakpoints 390×844 ni endpoints reales (los ejecuta el orquestador); sin cambios de esquema, migraciones ni `shared-types`.

## Notas propuestas
- La moneda por defecto es `MXN` porque la pantalla de inventario no recibe la moneda de la sucursal; el campo ISO queda editable y el total mostrado siempre sale de `totalMinor`.
