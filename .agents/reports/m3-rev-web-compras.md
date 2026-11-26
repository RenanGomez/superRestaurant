I'll review the code against the specified contract and criteria.
VEREDICTO: CORREGIR

- **P1** `purchasing-panel.tsx:118,138` — todos los roles cargan proveedores/órdenes, pero la API exige `catalog.manage` (`purchasing.service.ts:370,380`); supervisor/cajero/waiter/viewer reciben `denied` y ven además el texto contradictorio de `purchasing-panel.tsx:241-245`. Rompe el modo solo lectura (criterio 6).
- **P2** `inventory-ui.ts:323` acepta cualquier ISO-4217, pero `formatMinorUnits` (`inventory-ui.ts:63-80`) solo cubre CAD/EUR/JPY/MXN/USD: una orden en GBP muestra «Moneda no admitida» en `purchasing-panel.tsx:483,503,517,875`.
- **P3** `purchasing-panel.tsx:515` usa `key={line.itemId}`; el servidor no deduplica líneas (`purchasing.service.ts:513-520`) → colisión de keys.
- **P3** `purchasing-panel.tsx:417` guarda `deviceId` en `sessionStorage`: rota por sesión y debilita la traza del receptor.

Verificado OK: contrato HTTP exacto sin `totalMinor` (`actions.ts:286-338`), total solo desde `totalMinor` con BigInt sin float ni suma (`inventory-ui.ts:77-103`), `idempotencyKey` estable por borrador (`purchasing-panel.tsx:673`), scope desde cookie de sucursal (`actions.ts:194`), modal con `role="dialog"`/Escape/foco (`inventory-modal.tsx:62-67`), sin `alert/confirm/prompt` ni UUIDs visibles, targets `min-h-11`, `?tab=compras` y pestañas previas intactas.

```text
git diff --stat main...harness/m3-web-compras
 apps/web/src/app/app/inventario/actions.ts         | 515 +++++++++++-
 .../src/app/app/inventario/purchasing-panel.tsx    | 902 +++++++++++++++++++++
 apps/web/src/lib/inventory-ui.ts                   | 141 +++-
```