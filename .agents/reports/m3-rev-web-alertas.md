## Estado
done — Revisión nivel C de `harness/m3-web-alertas` sin hallazgos P1.

## Qué hice
- VEREDICTO: **APROBAR**. Leí los 6 archivos del diff y contrasté con `costing.controller.ts` y `costing.service.ts`.
- Contrato exacto: `alerts`=restaurantId+branchId; `costs`=+warehouseId+itemId; `product-costs`=restaurantId+productId; `margins`=restaurantId+branchId+productId (`costing.service.ts:271-308`); acciones envían justo eso desde `scope` (`actions.ts:478-524`), sin campos extra.
- Dinero: solo formatea enteros del servidor; `currency: null` se conserva (`actions.ts:839,889`) y se muestra "(unidad menor)" sin inventar código (`alerts-panel.tsx:432-435`).
- Margen: `formatPercentFromMinor` usa BigInt, redondeo half-away-from-zero y guion con total 0/no entero (`inventory-ui.ts:68-88`); sin NaN/Infinity/floats.
- Aislamiento: scope desde cookie de sucursal (`actions.ts:256`), `denied` reflejado (`alerts-panel.tsx:176-194`). A11y: `min-h-11`, sin alert/confirm/prompt, sin UUIDs visibles, estados carga/vacío/error/reintento. Pestañas y `?tab=` intactos; aserción de `INVENTORY_TABS` actualizada junto.
- P3 (inventory-ui.ts:99-105): plural solo cubre pieza/unidad; déficit 1 en g/ml imprime "Faltan 1 gramos". P3: `parseStockAlert` no exige `deficit ≥ 0` (lo garantiza el API).

## Archivos tocados
- ninguno (solo lectura)

## Verificación
```
$ npx tsc ... src/lib/inventory-ui.ts src/lib/inventory-ui.test.ts && node .test-dist/lib/inventory-ui.test.js
# tests 21
# pass 21
# fail 0
```

## Riesgos / dudas
- Los dos P3 son de copy/validación menor; no bloquean.

## Notas propuestas
- ninguna