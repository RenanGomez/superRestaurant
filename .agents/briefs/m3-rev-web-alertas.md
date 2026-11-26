# Revisión · m3-web-alertas (nivel C)

No leas `.agents/reports/*`, no salgas del repo y no ejecutes nada. Responde en ≤ 14 líneas.

Diff: main...harness/m3-web-alertas

Lee:
- `apps/web/src/app/app/inventario/alerts-panel.tsx`
- `apps/web/src/app/app/inventario/actions.ts`
- `apps/web/src/app/app/inventario/inventory-workspace.tsx`
- `apps/web/src/lib/inventory-ui.ts` y `inventory-ui.test.ts`

Comprueba:
1. Contrato exacto: `GET /inventory/alerts`, `/costs`, `/product-costs` y `/margins` con los parámetros que exige el API (`restaurantId`, `branchId`, `warehouseId`, `itemId`, `productId`) y sin campos extra.
2. Dinero: nada se suma ni se recalcula en el cliente; precio, costo y margen salen del servidor y solo se formatean. `currency: null` no se sustituye por una moneda inventada.
3. Porcentaje de margen: `formatPercentFromMinor` usa enteros/BigInt, redondea de forma declarada y devuelve guion con total 0; sin `NaN`, `Infinity` ni flotantes acumulados.
4. Aislamiento y permisos: el alcance sale del contexto de sucursal, no del formulario; el estado `denied` del API se refleja sin afirmar que el rol puede leer.
5. Accesibilidad y copy: estados de carga/vacío/error/reintento, sin `alert/confirm/prompt`, sin UUIDs visibles, targets ≥ 44 px, texto en español operativo.
6. No rompe las pestañas previas ni `?tab=` (la lista de pestañas y su aserción se actualizan juntas).

Salida: `VEREDICTO: APROBAR` o `VEREDICTO: CORREGIR` y hallazgos con `archivo:línea`. Marca P1/P2/P3.
