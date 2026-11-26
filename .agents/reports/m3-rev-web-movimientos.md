VEREDICTO: APROBAR

P1/P2: ninguno.
P3 `apps/web/src/lib/inventory-ui.ts:169` — plural fijo «pieza» («-3 pieza», test :93); solo copy.
P3 `apps/web/src/app/app/inventario/inventory-modal.tsx:42` — al guardar todo queda `disabled`, la lista enfocable se vacía y Tab puede escapar un instante.
P3 `apps/web/src/app/app/inventario/movements-panel.tsx:349` — la idempotencyKey no se regenera si se editan datos tras un fallo (correcto para reintento idéntico).
Contrato OK: `POST /api/v1/inventory/movements` (movements.controller.ts:33); body actions.ts:137-152 = 14 claves + `actorId` inyectado en servidor (movements.service.ts → parseInventoryMovementRequestV1) ≡ InventoryMovementRequestV1 (inventory.ts:608); `toWarehouseId` solo transfer, `reason` ≥3, key UUID estable vía `useState`.
Tabs/UI OK: sin alert/confirm/prompt; carga/vacío/error+Reintentar/éxito (`role=status/alert`); `role=dialog`+Escape+foco contenido/devuelto+submit `disabled`; `min-h-11` (44px); `?tab=` preservado (inventory-workspace.tsx:208-229,323-335; tests :22-37).
Verificación:
```
$ git show --stat HEAD
5077ed59 feat(web): inventory movements tab with adjustments and transfers
 apps/web/src/app/app/inventario/movements-panel.tsx | 465 +++++++++++++++++++++
 apps/web/src/lib/inventory-ui.test.ts              | 115 ++++-
$ Select-String apps/web/package.json -Pattern inventory-ui.test.js
node .test-dist/lib/inventory-ui.test.js
```
NO VERIFICADO: lint/typecheck/tests/build y navegador real (modo plan solo-lectura; el test escribe `.test-dist`).