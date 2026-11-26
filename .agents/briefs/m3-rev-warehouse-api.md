# Brief m3-rev-warehouse-api (revisión A · foco contratos/API/UI)

Diff: main...harness/m3-default-warehouse

Revisa contratos, API y UI del PR #125. **No escribas archivos ni uses `$env:TEMP`** (el sandbox los
rechaza): lee con `git show`. No ejecutes PostgreSQL ni Playwright.

Comprueba:

1. `packages/shared-types/src/inventory.ts`: `isDefault` obligatorio y estricto en
   `InventoryWarehouseV1`; ningún consumidor queda sin actualizar (grep de `InventoryWarehouseV1` y
   de literales de almacén en apps y tests); create/patch opcional no rompe el parseo exacto.
2. `apps/api/src/inventory/items.service.ts`: SQL de 6 y 5 placeholders con el orden correcto; patch
   sin `isDefault` conserva el valor (¿lee antes el actual?); `22000 → request`; `23505 → conflict`;
   un `isDefault` no booleano se rechaza; no se puede marcar default en una sucursal ajena.
3. UI `apps/web/src/app/app/inventario/`: el checkbox nuevo se ve, se etiqueta y se opera con teclado
   y táctil (≥ 44 px), el error se muestra en la UI y no con diálogos nativos; al guardar, la lista
   refresca el «Predeterminado» de los demás; sin estados incoherentes (dos predeterminados).
4. Tests: `items.test.ts` cubre create/update con y sin `isDefault`, `23505` y orden de parámetros;
   `inventory-ui.test.ts` prueba el helper nuevo; `inventory.runtime.test.ts` cubre el parseo.
   Señala huecos reales (no pidas cobertura vacía).

Entrega `VEREDICTO: APROBAR|CORREGIR` con P1/P2/P3, archivo y línea.
